import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPackageDir = resolve(__dirname, '..');

function isModuleNotFoundFor(specifier, error) {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code !== 'MODULE_NOT_FOUND') return false;
  return error.message.includes(specifier);
}

export function findInstallRoot(packageJsonPath) {
  let currentDir = dirname(packageJsonPath);

  while (true) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    if (
      currentDir.endsWith('/node_modules') ||
      currentDir.endsWith('\\node_modules')
    ) {
      return parentDir;
    }
    currentDir = parentDir;
  }

  throw new Error(
    `[warden-mcp] could not determine install root from ${packageJsonPath}`,
  );
}

export function resolvePatchPackagePlan({
  packageDir = defaultPackageDir,
  resolveDependency = (specifier) => require.resolve(specifier),
  exists = existsSync,
} = {}) {
  const patchesDir = resolve(packageDir, 'patches');
  if (!exists(patchesDir)) {
    throw new Error(
      `[warden-mcp] patches directory not found at ${patchesDir}`,
    );
  }

  let cliPackageJsonPath;
  try {
    cliPackageJsonPath = resolveDependency('@bitwarden/cli/package.json');
  } catch (error) {
    if (isModuleNotFoundFor('@bitwarden/cli/package.json', error)) {
      return null;
    }
    throw error;
  }

  const installRoot = findInstallRoot(cliPackageJsonPath);
  const patchDir = relative(installRoot, patchesDir) || '.';
  if (isAbsolute(patchDir) || patchDir.startsWith('..')) {
    throw new Error(
      `[warden-mcp] patch directory ${patchesDir} is outside install root ${installRoot}`,
    );
  }

  return {
    cwd: installRoot,
    args: [
      resolveDependency('patch-package/dist/index.js'),
      '--patch-dir',
      patchDir,
      '--error-on-fail',
    ],
  };
}

const bootstrapPackageJson = `${JSON.stringify(
  { name: 'warden-mcp-postinstall-bootstrap', private: true },
  null,
  2,
)}\n`;

export function ensurePatchPackageAppRoot({
  appRoot,
  exists = existsSync,
  writeFile = writeFileSync,
} = {}) {
  const packageJsonPath = resolve(appRoot, 'package.json');
  if (exists(packageJsonPath)) return null;
  writeFile(packageJsonPath, bootstrapPackageJson);
  return packageJsonPath;
}

export function applyBundledBwPatch({
  packageDir = defaultPackageDir,
  resolveDependency,
  exists,
  spawn = spawnSync,
  nodeExecPath = process.execPath,
  writeFile,
  removeFile = (path) => rmSync(path, { force: true }),
  logError = (message) => console.error(message),
} = {}) {
  let plan;
  try {
    plan = resolvePatchPackagePlan({ packageDir, resolveDependency, exists });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '[warden-mcp] failed to prepare patch-package';
    logError(message);
    return 1;
  }

  if (!plan) return 0;

  const temporaryPackageJsonPath = ensurePatchPackageAppRoot({
    appRoot: plan.cwd,
    exists,
    writeFile,
  });

  let result;
  try {
    result = spawn(nodeExecPath, plan.args, {
      cwd: plan.cwd,
      stdio: 'inherit',
    });
  } finally {
    if (temporaryPackageJsonPath) {
      removeFile(temporaryPackageJsonPath);
    }
  }

  if (result.error) {
    logError(
      `[warden-mcp] failed to execute patch-package: ${result.error.message}`,
    );
    return 1;
  }

  return result.status ?? 1;
}

export function isDirectRun(importMetaUrl, argv = process.argv) {
  return argv[1] === fileURLToPath(importMetaUrl);
}

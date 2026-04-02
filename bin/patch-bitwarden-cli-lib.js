import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compatMarker = 'icoretech-vaultwarden-compat';

function isModuleNotFoundFor(specifier, error) {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code !== 'MODULE_NOT_FOUND') return false;
  return error.message.includes(specifier);
}

export function resolveBundledBwCliPath({
  resolveDependency = (specifier) => require.resolve(specifier),
} = {}) {
  try {
    const cliPackageJsonPath = resolveDependency('@bitwarden/cli/package.json');
    return join(dirname(cliPackageJsonPath), 'build', 'bw.js');
  } catch (error) {
    if (isModuleNotFoundFor('@bitwarden/cli/package.json', error)) {
      return null;
    }
    throw error;
  }
}

function buildCompatBlock(indent) {
  return [
    `${indent}/* ${compatMarker} */`,
    `${indent}if (response.accountKeysResponseModel) {`,
    `${indent}    yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);`,
    `${indent}}`,
    `${indent}else if (response.privateKey) {`,
    `${indent}    yield this.accountCryptographicStateService.setAccountCryptographicState({`,
    `${indent}        V1: {`,
    `${indent}            private_key: response.privateKey,`,
    `${indent}        },`,
    `${indent}    }, userId);`,
    `${indent}}`,
  ].join('\n');
}

const strategyMethodRegex =
  /(setAccountCryptographicState\(response, userId\) \{\n\s+return [^\n]+\(\s*this, void 0, void 0, function\* \(\) \{\n)(\s*)yield this\.accountCryptographicStateService\.setAccountCryptographicState\(response\.accountKeysResponseModel\.toWrappedAccountCryptographicState\(\), userId\);\n(\s*\}\);\n\s*\})/g;

export function patchBundledBwSource(source) {
  let replacements = 0;

  const patchedSource = source.replace(
    strategyMethodRegex,
    (_match, prefix, indent, suffix) => {
      replacements += 1;
      return `${prefix}${buildCompatBlock(indent)}\n${suffix}`;
    },
  );

  if (replacements > 0) {
    return { source: patchedSource, replacements };
  }

  if (source.includes(compatMarker)) {
    return { source, replacements: 0 };
  }

  throw new Error(
    '[warden-mcp] could not locate the expected setAccountCryptographicState blocks in @bitwarden/cli/build/bw.js',
  );
}

export function applyBundledBwPatch({
  resolveDependency,
  readFile = (path) => readFileSync(path, 'utf8'),
  writeFile = (path, contents) => writeFileSync(path, contents),
  logError = (message) => console.error(message),
} = {}) {
  let bwCliPath;
  try {
    bwCliPath = resolveBundledBwCliPath({ resolveDependency });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '[warden-mcp] failed to resolve @bitwarden/cli';
    logError(message);
    return 1;
  }

  if (!bwCliPath) return 0;

  try {
    const currentSource = readFile(bwCliPath);
    const { source: patchedSource, replacements } =
      patchBundledBwSource(currentSource);

    if (replacements > 0) {
      writeFile(bwCliPath, patchedSource);
    }

    return 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '[warden-mcp] failed to patch bundled @bitwarden/cli';
    logError(message);
    return 1;
  }
}

export function isDirectRun(importMetaUrl, argv = process.argv) {
  return argv[1] === fileURLToPath(importMetaUrl);
}

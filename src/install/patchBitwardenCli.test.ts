import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

async function loadPatchLibModule() {
  const modulePath = pathToFileURL(
    resolve(process.cwd(), 'bin/patch-bitwarden-cli-lib.js'),
  ).href;
  return import(`${modulePath}?test=${Date.now()}`);
}

test('resolvePatchPackagePlan targets the hoisted npx install root', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'warden-patch-plan-'));
  const installRoot = join(tempRoot, '_npx', 'abc123');
  const packageDir = join(
    installRoot,
    'node_modules',
    '@icoretech',
    'warden-mcp',
  );
  const patchesDir = join(packageDir, 'patches');
  const cliPackageJsonPath = join(
    installRoot,
    'node_modules',
    '@bitwarden',
    'cli',
    'package.json',
  );

  mkdirSync(patchesDir, { recursive: true });
  writeFileSync(join(patchesDir, '@bitwarden+cli+2026.2.0.patch'), 'patch');
  mkdirSync(dirname(cliPackageJsonPath), { recursive: true });
  writeFileSync(cliPackageJsonPath, '{}');

  const { resolvePatchPackagePlan } = await loadPatchLibModule();
  const plan = resolvePatchPackagePlan({
    packageDir,
    resolveDependency(specifier: string) {
      if (specifier === '@bitwarden/cli/package.json')
        return cliPackageJsonPath;
      if (specifier === 'patch-package/dist/index.js') {
        return '/tmp/fake-patch-package.js';
      }
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  });

  assert.deepEqual(plan, {
    cwd: installRoot,
    args: [
      '/tmp/fake-patch-package.js',
      '--patch-dir',
      join('node_modules', '@icoretech', 'warden-mcp', 'patches'),
      '--error-on-fail',
    ],
  });
});

test('resolvePatchPackagePlan skips cleanly when @bitwarden/cli is absent', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'warden-patch-plan-'));
  const packageDir = join(tempRoot, 'node_modules', '@icoretech', 'warden-mcp');
  const patchesDir = join(packageDir, 'patches');

  mkdirSync(patchesDir, { recursive: true });
  writeFileSync(join(patchesDir, '@bitwarden+cli+2026.2.0.patch'), 'patch');

  const { resolvePatchPackagePlan } = await loadPatchLibModule();
  const plan = resolvePatchPackagePlan({
    packageDir,
    resolveDependency(specifier: string) {
      if (specifier === '@bitwarden/cli/package.json') {
        const error = new Error(`Cannot find module '${specifier}'`);
        Object.assign(error, { code: 'MODULE_NOT_FOUND' });
        throw error;
      }
      if (specifier === 'patch-package/dist/index.js') {
        return '/tmp/fake-patch-package.js';
      }
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  });

  assert.equal(plan, null);
});

test('applyBundledBwPatch bootstraps and cleans up a temporary app package.json', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'warden-patch-plan-'));
  const installRoot = join(tempRoot, '_npx', 'abc123');
  const packageDir = join(
    installRoot,
    'node_modules',
    '@icoretech',
    'warden-mcp',
  );
  const patchesDir = join(packageDir, 'patches');
  const cliPackageJsonPath = join(
    installRoot,
    'node_modules',
    '@bitwarden',
    'cli',
    'package.json',
  );
  const appPackageJsonPath = join(installRoot, 'package.json');

  mkdirSync(patchesDir, { recursive: true });
  writeFileSync(join(patchesDir, '@bitwarden+cli+2026.2.0.patch'), 'patch');
  mkdirSync(dirname(cliPackageJsonPath), { recursive: true });
  writeFileSync(cliPackageJsonPath, '{}');

  const { applyBundledBwPatch } = await loadPatchLibModule();
  const status = applyBundledBwPatch({
    packageDir,
    resolveDependency(specifier: string) {
      if (specifier === '@bitwarden/cli/package.json')
        return cliPackageJsonPath;
      if (specifier === 'patch-package/dist/index.js') {
        return '/tmp/fake-patch-package.js';
      }
      throw new Error(`unexpected dependency: ${specifier}`);
    },
    spawn(
      command: string,
      args: readonly string[],
      options: { cwd?: string; stdio?: string },
    ) {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [
        '/tmp/fake-patch-package.js',
        '--patch-dir',
        join('node_modules', '@icoretech', 'warden-mcp', 'patches'),
        '--error-on-fail',
      ]);
      assert.equal(options?.cwd, installRoot);
      assert.equal(options?.stdio, 'inherit');
      assert.equal(existsSync(appPackageJsonPath), true);
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(existsSync(appPackageJsonPath), false);
});

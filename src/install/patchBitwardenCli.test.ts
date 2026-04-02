import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const unpatchedMethod = (
  awaiterName: string,
) => `    setAccountCryptographicState(response, userId) {
        return ${awaiterName}(this, void 0, void 0, function* () {
            yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
        });
    }
`;

const sampleBwSource = `${unpatchedMethod('auth_request_login_strategy_awaiter')}
${unpatchedMethod('password_login_strategy_awaiter')}
yield this.accountCryptographicStateService.setAccountCryptographicState(tokenResponse.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
${unpatchedMethod('user_api_login_strategy_awaiter')}
${unpatchedMethod('webauthn_login_strategy_awaiter')}
`;

async function loadPatchLibModule() {
  const modulePath = pathToFileURL(
    resolve(process.cwd(), 'bin/patch-bitwarden-cli-lib.js'),
  ).href;
  return import(`${modulePath}?test=${Date.now()}`);
}

test('patchBundledBwSource patches the four login strategies and leaves tokenResponse untouched', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const result = patchBundledBwSource(sampleBwSource);

  assert.equal(result.replacements, 4);
  assert.match(result.source, /icoretech-vaultwarden-compat/);
  assert.match(
    result.source,
    /else if \(response\.privateKey\) \{\n\s+yield this\.accountCryptographicStateService\.setAccountCryptographicState\(\{\n\s+V1: \{\n\s+private_key: response\.privateKey,/,
  );
  assert.match(
    result.source,
    /yield this\.accountCryptographicStateService\.setAccountCryptographicState\(tokenResponse\.accountKeysResponseModel\.toWrappedAccountCryptographicState\(\), userId\);/,
  );
});

test('patchBundledBwSource is idempotent once the compat block is present', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const firstPass = patchBundledBwSource(sampleBwSource);
  const secondPass = patchBundledBwSource(firstPass.source);

  assert.equal(secondPass.replacements, 0);
  assert.equal(secondPass.source, firstPass.source);
});

test('applyBundledBwPatch skips cleanly when @bitwarden/cli is absent', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'warden-bw-patch-'));
  const packageDir = join(tempRoot, 'node_modules', '@icoretech', 'warden-mcp');

  mkdirSync(packageDir, { recursive: true });

  const { applyBundledBwPatch } = await loadPatchLibModule();
  const status = applyBundledBwPatch({
    packageDir,
    resolveDependency(specifier: string) {
      if (specifier === '@bitwarden/cli/package.json') {
        const error = new Error(`Cannot find module '${specifier}'`);
        Object.assign(error, { code: 'MODULE_NOT_FOUND' });
        throw error;
      }
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  });

  assert.equal(status, 0);
});

test('applyBundledBwPatch rewrites build/bw.js in place', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'warden-bw-patch-'));
  const packageDir = join(tempRoot, 'node_modules', '@icoretech', 'warden-mcp');
  const cliPackageJsonPath = join(
    tempRoot,
    'node_modules',
    '@bitwarden',
    'cli',
    'package.json',
  );
  const cliBundlePath = join(
    tempRoot,
    'node_modules',
    '@bitwarden',
    'cli',
    'build',
    'bw.js',
  );

  mkdirSync(dirname(cliPackageJsonPath), { recursive: true });
  mkdirSync(dirname(cliBundlePath), { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(cliPackageJsonPath, '{}');
  writeFileSync(cliBundlePath, sampleBwSource);

  const { applyBundledBwPatch } = await loadPatchLibModule();
  const status = applyBundledBwPatch({
    packageDir,
    resolveDependency(specifier: string) {
      if (specifier === '@bitwarden/cli/package.json') {
        return cliPackageJsonPath;
      }
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  });

  assert.equal(status, 0);
  assert.match(
    readFileSync(cliBundlePath, 'utf8'),
    /icoretech-vaultwarden-compat/,
  );
});

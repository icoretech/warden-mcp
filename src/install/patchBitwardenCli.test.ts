import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const unpatchedMethod = (
  awaiterName: string,
) => `    setAccountCryptographicState(response, userId) {
        return ${awaiterName}(this, void 0, void 0, function* () {
            yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
        });
    }
`;

const policyConstructor = `class Policy extends Domain {
    constructor(obj) {
        super();
        if (obj == null) {
            return;
        }
        this.revisionDate = new Date(obj.revisionDate);
    }
    static fromResponse(response) {
        return new Policy(response);
    }
}
`;

const sampleBwSource = `${unpatchedMethod('auth_request_login_strategy_awaiter')}
${unpatchedMethod('password_login_strategy_awaiter')}
yield this.accountCryptographicStateService.setAccountCryptographicState(tokenResponse.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
${unpatchedMethod('user_api_login_strategy_awaiter')}
${unpatchedMethod('webauthn_login_strategy_awaiter')}
${policyConstructor}`;

const guardedMethod = `    setAccountCryptographicState(response, userId) {
        return login_strategy_awaiter(this, void 0, void 0, function* () {
            // The accountKeysResponseModel is always present except for JIT SSO users
            // which have just registered but not yet initialized the cryptographic state
            // for their account.
            if (response.accountKeysResponseModel) {
                yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
            }
        });
    }
${policyConstructor}`;

function removeCompatPatches(source: string): string {
  const marker = '/* icoretech-vaultwarden-compat */';
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'installed bundle must be patched');

  const blockStart = source.lastIndexOf('\n', markerIndex) + 1;
  const indent = source.slice(blockStart, markerIndex);
  const guardedStart = source.indexOf(
    `${indent}if (response.accountKeysResponseModel)`,
    markerIndex,
  );
  const fallbackStart = source.indexOf(
    `\n${indent}else if (response.privateKey)`,
    guardedStart,
  );
  const blockEnd = source.indexOf('\n        });', fallbackStart);

  assert.ok(guardedStart > blockStart, 'guarded state block must exist');
  assert.ok(fallbackStart > guardedStart, 'fallback block must exist');
  assert.ok(blockEnd > fallbackStart, 'login strategy must have a close');

  const guardedState = source.slice(guardedStart, fallbackStart);
  const loginUnpatched =
    source.slice(0, blockStart) + guardedState + source.slice(blockEnd);
  return loginUnpatched.replace(
    /\s*\/\* icoretech-vaultwarden-policy-revision-date-compat \*\/\n\s*this\.revisionDate = obj\.revisionDate == null\n\s*\? undefined\n\s*: new Date\(obj\.revisionDate\);/,
    '\n        this.revisionDate = new Date(obj.revisionDate);',
  );
}

async function loadPatchLibModule() {
  const modulePath = pathToFileURL(
    resolve(process.cwd(), 'bin/patch-bitwarden-cli-lib.js'),
  ).href;
  return import(`${modulePath}?test=${Date.now()}`);
}

test('patchBundledBwSource patches the four login strategies and leaves tokenResponse untouched', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const result = patchBundledBwSource(sampleBwSource);

  assert.equal(result.replacements, 5);
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

test('patchBundledBwSource patches the guarded login strategy shape', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const result = patchBundledBwSource(guardedMethod);

  assert.equal(result.replacements, 2);
  assert.match(result.source, /icoretech-vaultwarden-compat/);
  assert.match(
    result.source,
    /if \(response\.accountKeysResponseModel\) \{[\s\S]+else if \(response\.privateKey\) \{/,
  );
  assert.match(result.source, /private_key: response\.privateKey,/);
});

test('patchBundledBwSource reconstructs the installed Bitwarden CLI bundle', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const cliPackageJsonPath = require.resolve('@bitwarden/cli/package.json');
  const bundlePath = join(dirname(cliPackageJsonPath), 'build', 'bw.js');
  const patchedSource = readFileSync(bundlePath, 'utf8');
  const unpatchedSource = removeCompatPatches(patchedSource);
  const result = patchBundledBwSource(unpatchedSource);

  assert.equal(result.replacements, 2);
  assert.equal(result.source, patchedSource);
  const secondPass = patchBundledBwSource(result.source);

  assert.equal(secondPass.replacements, 0);
  assert.equal(secondPass.source, patchedSource);
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
  chmodSync(cliBundlePath, 0o755);

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
  const patchedSource = readFileSync(cliBundlePath, 'utf8');
  assert.match(patchedSource, /icoretech-vaultwarden-compat/);
  assert.match(
    patchedSource,
    /icoretech-vaultwarden-policy-revision-date-compat/,
  );
  assert.equal(statSync(cliBundlePath).mode & 0o777, 0o755);
  assert.deepEqual(
    readdirSync(dirname(cliBundlePath)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

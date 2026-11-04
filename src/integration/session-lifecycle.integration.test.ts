import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  type BwSessionConfig,
  BwSessionManager,
  readBwEnv,
} from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';

test('integration: provider-backed memory-only sessions revoke and reopen', {
  timeout: 180_000,
}, async (t) => {
  if (!process.env.BW_HOST) {
    t.skip('BW_HOST not set (integration tests require docker compose env)');
    return;
  }
  const credentials = readBwEnv();
  const homeDir = await mkdtemp(join(tmpdir(), 'bw-session-lifecycle-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const config: BwSessionConfig = {
    host: credentials.host,
    login:
      credentials.login.method === 'apikey'
        ? { method: 'apikey', clientId: credentials.login.clientId }
        : { method: 'userpass', user: credentials.login.user },
    homeDir,
    unlockIntervalSeconds: 10,
  };
  let providerCalls = 0;
  const options = {
    persistSession: false,
    credentialProvider: () => {
      providerCalls += 1;
      return credentials;
    },
  };
  const manager = new BwSessionManager(config, options);
  const sdk = new KeychainSdk(manager);
  await manager.status();
  assert.equal(providerCalls, 0, 'status must not load credentials');

  const [folders, template] = await Promise.all([
    sdk.listFolders({ limit: 1 }),
    manager.getTemplateItem(),
  ]);
  assert.ok(Array.isArray(folders));
  assert.ok(template && typeof template === 'object');
  assert.equal(providerCalls, 1, 'concurrent first use shares authentication');
  const cachePath = join(homeDir, '.bitwarden-cli', '.warden-mcp-session.json');
  await assert.rejects(stat(cachePath), { code: 'ENOENT' });

  await manager.revoke();
  const status = await manager.status();
  assert.ok(status && typeof status === 'object' && 'status' in status);
  assert.equal(status.status, 'locked');
  assert.ok('operational' in status);
  const operational = status.operational;
  assert.ok(
    operational && typeof operational === 'object' && 'ready' in operational,
  );
  assert.equal(operational.ready, false);
  assert.equal(
    providerCalls,
    1,
    'revocation and status must not reauthenticate',
  );

  assert.ok(Array.isArray(await sdk.listFolders({ limit: 1 })));
  assert.equal(providerCalls, 2, 'explicit use reopens the session');
  await manager.revoke();

  const freshManager = new BwSessionManager(config, options);
  assert.ok(
    Array.isArray(
      await new KeychainSdk(freshManager).listFolders({ limit: 1 }),
    ),
  );
  assert.equal(providerCalls, 3, 'a fresh manager must load credentials');
  await freshManager.revoke();
  await assert.rejects(stat(cachePath), { code: 'ENOENT' });
});

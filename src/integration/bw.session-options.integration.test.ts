import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { type BwCredentials, BwSessionManager } from '../bw/bwSession.js';

test('integration: on-demand memory-only sessions revoke and reopen', {
  timeout: 180_000,
}, async (t) => {
  const host = process.env.BW_HOST;
  const password = process.env.BW_PASSWORD;
  const user = process.env.BW_USER ?? process.env.BW_USERNAME;
  const clientId = process.env.BW_CLIENTID;
  const clientSecret = process.env.BW_CLIENTSECRET;
  if (!host || !password || (!(clientId && clientSecret) && !user)) {
    t.skip('Missing synthetic integration credentials');
    return;
  }
  const credentials: BwCredentials = {
    password,
    login:
      clientId && clientSecret
        ? { method: 'apikey', clientId, clientSecret }
        : { method: 'userpass', user: user ?? '' },
  };
  const homeDir = await mkdtemp(join(tmpdir(), 'bw-memory-integration-'));
  const identity = {
    host,
    homeDir,
    unlockIntervalSeconds: 300,
    login: credentials.login,
  };
  let providerCalls = 0;
  const options = {
    persistSession: false,
    credentialProvider: async () => {
      providerCalls++;
      return credentials;
    },
  };
  const manager = new BwSessionManager(identity, options);
  const sessionPath = join(
    homeDir,
    '.bitwarden-cli',
    '.warden-mcp-session.json',
  );
  t.after(async () => {
    try {
      await manager.revoke();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
  const list = (active: BwSessionManager) =>
    active.withSession(async (session) => {
      const result = await active.runForSession(session, [
        'list',
        'items',
        '--search',
        'synthetic-memory-session-contract',
      ]);
      assert.ok(Array.isArray(JSON.parse(result.stdout)));
    });
  assert.equal(providerCalls, 0);
  await list(manager);
  assert.ok(providerCalls > 0);
  const afterUnlock = providerCalls;
  await list(manager);
  assert.equal(providerCalls, afterUnlock);
  await assert.rejects(readFile(sessionPath), { code: 'ENOENT' });

  await manager.revoke();
  const status = (await manager.status()) as {
    operational: { ready: boolean };
  };
  assert.equal(status.operational.ready, false);
  assert.equal(providerCalls, afterUnlock);
  await list(manager);
  assert.ok(providerCalls > afterUnlock);
  await assert.rejects(readFile(sessionPath), { code: 'ENOENT' });
  await manager.revoke();

  const fresh = new BwSessionManager(identity, options);
  try {
    const beforeRestart = providerCalls;
    await list(fresh);
    assert.ok(providerCalls > beforeRestart);
    await assert.rejects(readFile(sessionPath), { code: 'ENOENT' });
  } finally {
    await fresh.revoke();
  }
});

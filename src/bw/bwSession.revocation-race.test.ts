import assert from 'node:assert/strict';
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';

import { BwSessionManager, BwSessionRevokeError } from './bwSession.js';
import { sessionFixture } from './bwSession.lifecycle.fixture.js';

test('revoke clears local session and template when the profile lock cannot be acquired', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  assert.deepEqual(await manager.getTemplateItem(), { revision: 1 });
  const appDataDir = dirname(fixture.cachePath);
  const backupDir = `${appDataDir}-saved`;
  await rename(appDataDir, backupDir);
  await writeFile(appDataDir, 'blocks profile-directory creation');

  try {
    await assert.rejects(manager.revoke(), (error: unknown) => {
      assert.ok(error instanceof BwSessionRevokeError);
      assert.deepEqual(error.failures, ['profile']);
      return true;
    });
  } finally {
    await rm(appDataDir);
    await rename(backupDir, appDataDir);
  }
  await rm(fixture.cachePath);

  assert.deepEqual(await manager.getTemplateItem(), { revision: 2 });
  assert.equal(await fixture.counter('sessions'), 2);
  assert.equal(await fixture.counter('locks'), 0);
});

test('a cold status completing after revoke cannot start background authentication', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  await fixture.write('pause-status', 'yes');
  const statusStarted = fixture.waitFor('status-started');
  const status = manager.status();
  await statusStarted;

  const revoked = manager.revoke();
  await fixture.write('release-status', 'yes');
  await Promise.all([status, revoked]);
  await manager.status();

  assert.equal(await fixture.counter('unlocks'), 0);
  assert.equal(await fixture.counter('locks'), 1);
  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
});

test('late status validation cannot reinstall a persisted session after revoke', async (t) => {
  const fixture = await sessionFixture(t);
  const previous = new BwSessionManager(fixture.credentials);
  await previous.withSession(async () => undefined);
  await fixture.write('lock-preserves-key', 'yes');
  await fixture.write('pause-check', 'yes');
  let credentialCalls = 0;
  const manager = new BwSessionManager(fixture.config, {
    credentialProvider: () => {
      credentialCalls += 1;
      return fixture.credentials;
    },
  });
  const validationStarted = fixture.waitFor('check-started');
  const status = manager.status();
  await validationStarted;

  const revoked = manager.revoke();
  await fixture.write('release-check', 'yes');
  await Promise.all([status, revoked]);
  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
  assert.equal(credentialCalls, 0);

  await manager.withSession(async () => undefined);

  assert.equal(credentialCalls, 1);
  assert.equal(await fixture.counter('sessions'), 2);
});

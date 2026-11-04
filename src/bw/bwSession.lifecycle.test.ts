import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { BwSessionManager, BwSessionRevokeError } from './bwSession.js';
import { deferred, sessionFixture } from './bwSession.lifecycle.fixture.js';

test('memory-only managers ignore and preserve an existing persisted key', async (t) => {
  const fixture = await sessionFixture(t);
  const persistent = new BwSessionManager(fixture.credentials);
  await persistent.withSession(async () => undefined);
  const existing = await readFile(fixture.cachePath, 'utf8');
  const manager = new BwSessionManager(fixture.credentials, {
    persistSession: false,
  });

  const session = await manager.withSession(async (value) => value);
  const fresh = new BwSessionManager(fixture.credentials, {
    persistSession: false,
  });
  const freshSession = await fresh.withSession(async (value) => value);

  assert.equal(session, 'session-2');
  assert.equal(freshSession, 'session-3');
  assert.equal(await readFile(fixture.cachePath, 'utf8'), existing);
});

test('revoke clears persisted and template caches and permits an explicit reopen', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  assert.deepEqual(await manager.getTemplateItem(), { revision: 1 });

  await manager.revoke();

  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
  assert.equal(await fixture.counter('locks'), 1);
  assert.deepEqual(await manager.getTemplateItem(), { revision: 2 });
  assert.equal(await fixture.counter('sessions'), 2);
});

test('revoke waits for active session work before locking the profile', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  const entered = deferred();
  const release = deferred();
  const operation = manager.withSession(async () => {
    entered.resolve();
    await release.promise;
    assert.equal(await fixture.counter('locks'), 0);
  });
  await entered.promise;

  const revocation = manager.revoke();
  release.resolve();
  await Promise.all([operation, revocation]);

  assert.equal(await fixture.counter('locks'), 1);
  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
});

test('memory-only revoke explicitly removes a key left by an earlier manager', async (t) => {
  const fixture = await sessionFixture(t);
  const persistent = new BwSessionManager(fixture.credentials);
  await persistent.withSession(async () => undefined);
  const manager = new BwSessionManager(fixture.credentials, {
    persistSession: false,
  });

  await manager.revoke();

  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
  assert.equal(await fixture.counter('locks'), 1);
});

test('revoke attempts CLI lock and reports a persisted-key deletion failure', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials, {
    persistSession: false,
  });
  await manager.withSession(async () => undefined);
  await mkdir(fixture.cachePath);
  await writeFile(`${fixture.cachePath}/occupied`, 'fixture');

  await assert.rejects(manager.revoke(), (error: unknown) => {
    assert.ok(error instanceof BwSessionRevokeError);
    assert.deepEqual(error.failures, ['cache']);
    assert.equal('cause' in error, false);
    return true;
  });

  assert.equal(await fixture.counter('locks'), 1);
  await rm(fixture.cachePath, { recursive: true });
  assert.equal(
    await manager.withSession(async (session) => session),
    'session-2',
  );
});

test('revoke reports CLI lock failure after clearing local caches', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  await manager.getTemplateItem();
  await fixture.write('fail-lock', 'yes');

  await assert.rejects(manager.revoke(), (error: unknown) => {
    assert.ok(error instanceof BwSessionRevokeError);
    assert.deepEqual(error.failures, ['lock']);
    assert.equal('cause' in error, false);
    assert.doesNotMatch(error.message, /private cli failure detail/);
    return true;
  });

  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
  await fixture.write('fail-lock', '');
  assert.deepEqual(await manager.getTemplateItem(), { revision: 2 });
  assert.equal(await fixture.counter('sessions'), 2);
});

test('revoke reports both cache deletion and CLI lock failures', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials, {
    persistSession: false,
  });
  await mkdir(fixture.cachePath);
  await writeFile(`${fixture.cachePath}/occupied`, 'fixture');
  await fixture.write('fail-lock', 'yes');

  await assert.rejects(manager.revoke(), (error: unknown) => {
    assert.ok(error instanceof BwSessionRevokeError);
    assert.deepEqual(error.failures, ['cache', 'lock']);
    assert.equal('cause' in error, false);
    return true;
  });

  assert.equal(await fixture.counter('locks'), 1);
});

test('static status after revoke does not restart background authentication', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(fixture.credentials);
  await manager.withSession(async () => undefined);
  await manager.revoke();

  await manager.status();
  await setImmediate();
  await manager.status();

  assert.equal(await fixture.counter('sessions'), 1);
  await assert.rejects(stat(fixture.cachePath), { code: 'ENOENT' });
});

test('revoke cancels keepalive authentication already queued behind active work', async (t) => {
  const fixture = await sessionFixture(t);
  let tick: () => void = () => {
    throw new Error('keepalive interval was not registered');
  };
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    tick = callback;
    const timer = setTimeout(() => {}, 2 ** 30);
    timer.unref();
    return timer;
  });
  const manager = new BwSessionManager(fixture.credentials);
  await manager.withSession(async () => undefined);
  manager.startKeepUnlocked();
  const entered = deferred();
  const release = deferred();
  const operation = manager.withSession(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  await fixture.write('active', '');

  tick();
  const revocation = manager.revoke();
  release.resolve();
  await Promise.all([operation, revocation]);

  assert.equal(await fixture.counter('sessions'), 1);
  assert.equal(await fixture.counter('locks'), 1);
});

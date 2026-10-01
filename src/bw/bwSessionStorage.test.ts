import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BwSessionStorage } from './bwSessionStorage.js';

test('session storage restricts new and existing session files to the owner', {
  skip: process.platform === 'win32',
}, async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), 'bw-session-permissions-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const storage = new BwSessionStorage(
    homeDir,
    'https://example.test',
    'user@example.test',
  );
  const sessionPath = join(storage.appDataDir, '.warden-mcp-session.json');

  await storage.writeSession('test-session-one');
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);

  await chmod(sessionPath, 0o644);
  await storage.writeSession('test-session-two');
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);
  const persisted = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.equal(persisted.session, 'test-session-two');
});

test('reading a legacy session file repairs its permissions before reuse', {
  skip: process.platform === 'win32',
}, async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), 'bw-session-legacy-mode-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const storage = new BwSessionStorage(
    homeDir,
    'https://example.test',
    'user@example.test',
  );
  const sessionPath = join(storage.appDataDir, '.warden-mcp-session.json');

  await storage.writeSession('test-session');
  await chmod(sessionPath, 0o644);
  assert.equal(await storage.readSession(), 'test-session');
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);

  const otherIdentity = new BwSessionStorage(
    homeDir,
    'https://example.test',
    'other@example.test',
  );
  assert.equal(await otherIdentity.readSession(), null);
  const otherHost = new BwSessionStorage(
    homeDir,
    'https://other.example.test',
    'user@example.test',
  );
  assert.equal(await otherHost.readSession(), null);
});

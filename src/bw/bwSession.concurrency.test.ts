import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BwCliError } from './bwCli.js';
import { type BwEnv, BwSessionManager } from './bwSession.js';

function makeEnv(homeDir: string): BwEnv {
  return {
    host: 'https://bw.test',
    password: 'test-password',
    unlockIntervalSeconds: 300,
    login: { method: 'userpass', user: 'test@example.test' },
    homeDir,
  };
}

function invalidSessionError(): BwCliError {
  return new BwCliError('invalid session', {
    exitCode: 1,
    stdout: '',
    stderr: 'Invalid BW session',
  });
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function createSessionAwareFakeBw(dir: string): Promise<{
  readonly path: string;
  readonly unlockCounterPath: string;
}> {
  const path = join(dir, 'fake-bw');
  const unlockCounterPath = join(dir, 'unlock-count');
  const currentSessionPath = join(dir, 'current-session');
  await writeFile(unlockCounterPath, '0');
  await writeFile(currentSessionPath, '');
  const script = `#!/bin/sh
if echo "$*" | grep -q 'status'; then
  printf '%s' '{"status":"locked","serverUrl":"https://bw.test"}'
  exit 0
fi
if echo "$*" | grep -q 'unlock --check'; then
  current=$(cat '${currentSessionPath}')
  if [ -n "$current" ] && echo "$*" | grep -q -- "--session $current"; then
    exit 0
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat '${unlockCounterPath}')
  count=$((count + 1))
  printf '%s' "$count" > '${unlockCounterPath}'
  session="session-v$count"
  printf '%s' "$session" > '${currentSessionPath}'
  printf '%s' "$session"
  exit 0
fi
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'login'; then exit 1; fi
printf '%s' '{}'
exit 0
`;
  await writeFile(path, script, { mode: 0o755 });
  return { path, unlockCounterPath };
}

test('auth recovery preserves a newer session stored by another manager', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-concurrency-test-'));
  const savedBin = process.env.BW_BIN;
  try {
    const fakeBw = await createSessionAwareFakeBw(dir);
    process.env.BW_BIN = fakeBw.path;
    const managerA = new BwSessionManager(makeEnv(dir));
    const managerB = new BwSessionManager(makeEnv(dir));

    assert.equal(
      await managerA.withSession(async (session) => session),
      'session-v1',
    );
    assert.equal(
      await managerB.withSession(async (session) => session),
      'session-v1',
    );

    const callbackStarted = createDeferred();
    const releaseCallback = createDeferred();
    let managerBAttempts = 0;
    const managerBResult = managerB.withSession(async (session) => {
      managerBAttempts += 1;
      if (managerBAttempts === 1) {
        assert.equal(session, 'session-v1');
        callbackStarted.resolve();
        await releaseCallback.promise;
        throw invalidSessionError();
      }
      return session;
    });

    await callbackStarted.promise;
    let managerAAttempts = 0;
    const refreshedSession = await managerA.withSession(async (session) => {
      managerAAttempts += 1;
      if (managerAAttempts === 1) throw invalidSessionError();
      return session;
    });
    assert.equal(refreshedSession, 'session-v2');

    releaseCallback.resolve();
    assert.equal(await managerBResult, refreshedSession);
    assert.equal(managerBAttempts, 2);
    assert.equal(
      (await readFile(fakeBw.unlockCounterPath, 'utf8')).trim(),
      '2',
    );
  } finally {
    process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  }
});

test('status does not rewrite a valid shared persisted session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-concurrency-test-'));
  const savedBin = process.env.BW_BIN;
  try {
    const fakeBw = await createSessionAwareFakeBw(dir);
    process.env.BW_BIN = fakeBw.path;
    const manager = new BwSessionManager(makeEnv(dir));
    await manager.withSession(async (session) => session);

    const statePath = join(dir, '.bitwarden-cli', '.warden-mcp-session.json');
    const seededState = (await readFile(statePath, 'utf8'))
      .replace(/"createdAt":"[^"]+"/, '"createdAt":"2000-01-01T00:00:00.000Z"')
      .replace(
        /"validatedAt":"[^"]+"/,
        '"validatedAt":"2000-01-01T00:00:00.000Z"',
      );
    await writeFile(statePath, seededState, 'utf8');

    const freshManager = new BwSessionManager(makeEnv(dir));
    await freshManager.status();

    assert.equal(await readFile(statePath, 'utf8'), seededState);
  } finally {
    process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  }
});

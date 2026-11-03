import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, type TestContext, test } from 'node:test';
import {
  type BwCredentials,
  type BwEnv,
  type BwSessionIdentity,
  BwSessionManager,
} from './bwSession.js';
import { BwSessionStorage } from './bwSessionStorage.js';

interface State {
  unlocks: number;
  current: string;
  loggedIn: boolean;
  failLock: boolean;
}

interface Call {
  args: string[];
  password?: string;
  clientSecret?: string;
}

async function fixture(t: TestContext, apiKey = false) {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-options-'));
  const saved = { ...process.env };
  t.after(async () => {
    process.env = saved;
    await rm(dir, { recursive: true, force: true });
  });
  const statePath = join(dir, 'fixture-state.json');
  const logPath = join(dir, 'calls.jsonl');
  const script = join(dir, 'fake-bw.mjs');
  await writeFile(
    script,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2).filter(x => x !== '--nointeraction');
const index = args.indexOf('--session');
const session = index < 0 ? process.env.BW_SESSION : args.splice(index, 2)[1];
const state = JSON.parse(readFileSync(process.env.BW_FIXTURE_STATE, 'utf8'));
const save = () => writeFileSync(process.env.BW_FIXTURE_STATE, JSON.stringify(state));
appendFileSync(process.env.BW_FIXTURE_LOG, JSON.stringify({
  args, password: process.env.BW_PASSWORD, clientSecret: process.env.BW_CLIENTSECRET,
}) + '\\n');
const issue = () => {
  state.current = 'synthetic-session-' + (++state.unlocks);
  save();
  process.stdout.write(state.current);
};
if (args[0] === 'status') {
  console.log(JSON.stringify({status:'locked', serverUrl:'https://vault.example.test'}));
} else if (args[0] === 'unlock' && args.includes('--check')) {
  process.exit(session && session === state.current ? 0 : 1);
} else if (args[0] === 'unlock') {
  if (!state.loggedIn || process.env.BW_PASSWORD !== 'synthetic-master') process.exit(1);
  issue();
} else if (args[0] === 'login') {
  if (args.includes('--apikey')) {
    if (process.env.BW_CLIENTID !== 'synthetic-client' ||
        process.env.BW_CLIENTSECRET !== 'synthetic-api-secret') process.exit(2);
    state.loggedIn = true; save();
  } else {
    if (args[1] !== 'synthetic@example.test' ||
        process.env.BW_PASSWORD !== 'synthetic-master') process.exit(2);
    state.loggedIn = true; issue();
  }
} else if (args[0] === 'lock') {
  if (state.failLock) process.exit(9);
  state.current = ''; save();
} else if (args[0] === 'get') {
  console.log(JSON.stringify({type:1, fixtureSession:state.current}));
}
`,
    { mode: 0o755 },
  );
  const initial: State = {
    unlocks: 0,
    current: '',
    loggedIn: !apiKey,
    failLock: false,
  };
  await writeFile(statePath, JSON.stringify(initial));
  const storage = new BwSessionStorage(
    dir,
    'https://vault.example.test',
    apiKey ? 'apikey:synthetic-client' : 'userpass:synthetic@example.test',
  );
  await mkdir(storage.appDataDir, { recursive: true });
  await writeFile(
    join(storage.appDataDir, 'data.json'),
    JSON.stringify({
      global_environment_environment: {
        urls: { base: 'https://vault.example.test' },
      },
    }),
  );
  const credentials: BwCredentials = {
    password: 'synthetic-master',
    login: apiKey
      ? {
          method: 'apikey',
          clientId: 'synthetic-client',
          clientSecret: 'synthetic-api-secret',
        }
      : { method: 'userpass', user: 'synthetic@example.test' },
  };
  const identity: BwSessionIdentity = {
    host: 'https://vault.example.test',
    homeDir: dir,
    unlockIntervalSeconds: 10,
    login: apiKey
      ? { method: 'apikey', clientId: 'synthetic-client' }
      : { method: 'userpass', user: 'synthetic@example.test' },
  };
  const env: BwEnv = { ...identity, ...credentials };
  process.env.BW_BIN = script;
  process.env.BW_FIXTURE_STATE = statePath;
  process.env.BW_FIXTURE_LOG = logPath;
  delete process.env.BW_SESSION;
  return {
    env,
    identity,
    credentials,
    storage,
    sessionPath: join(storage.appDataDir, '.warden-mcp-session.json'),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')) as State,
    setState: (state: State) => writeFile(statePath, JSON.stringify(state)),
    calls: async () =>
      (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Call),
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('optional SDK session management', {
  skip: process.platform === 'win32',
  concurrency: 1,
}, () => {
  test('default persisted sessions are reusable by a fresh manager', async (t) => {
    const f = await fixture(t);
    const first = new BwSessionManager(f.env);
    const key = await first.withSession(async (value) => value);
    assert.equal(await f.storage.readSession(), key);
    const second = new BwSessionManager(f.env);
    assert.equal(await second.withSession(async (value) => value), key);
    assert.equal((await f.state()).unlocks, 1);
  });

  test('memory-only providers are lazy and do not run in background', async (t) => {
    const f = await fixture(t);
    let providerCalls = 0;
    t.mock.timers.enable({ apis: ['setInterval'] });
    const manager = new BwSessionManager(f.identity, {
      persistSession: false,
      credentialProvider: async () => {
        providerCalls++;
        return f.credentials;
      },
    });
    manager.startKeepUnlocked();
    await manager.status();
    t.mock.timers.tick(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(providerCalls, 0);
    assert.ok(!(await f.calls()).some((call) => call.args[0] === 'unlock'));
    await manager.withSession(async () => undefined);
    await manager.withSession(async () => undefined);
    assert.equal(providerCalls, 1);
    await assert.rejects(readFile(f.sessionPath), { code: 'ENOENT' });
    const callsBeforeTick = (await f.calls()).length;
    t.mock.timers.tick(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((await f.calls()).length, callsBeforeTick);
  });

  test('memory-only sessions ignore an existing disk key across restarts', async (t) => {
    const f = await fixture(t);
    await f.storage.writeSession('legacy-disk-session');
    await f.setState({ ...(await f.state()), current: 'legacy-disk-session' });
    const original = await readFile(f.sessionPath, 'utf8');
    let providerCalls = 0;
    const options = {
      persistSession: false,
      credentialProvider: async () => {
        providerCalls++;
        return f.credentials;
      },
    };
    const first = new BwSessionManager(f.identity, options);
    const key = await first.withSession(async (value) => value);
    assert.equal(key, 'synthetic-session-1');
    assert.equal(await first.withSession(async (value) => value), key);
    const fresh = new BwSessionManager(f.identity, options);
    assert.equal(
      await fresh.withSession(async (value) => value),
      'synthetic-session-2',
    );
    assert.equal(providerCalls, 2);
    assert.equal(await readFile(f.sessionPath, 'utf8'), original);
  });

  test('concurrent operations share one on-demand credential lookup', async (t) => {
    const f = await fixture(t);
    let providerCalls = 0;
    const manager = new BwSessionManager(f.identity, {
      persistSession: false,
      credentialProvider: async () => {
        providerCalls++;
        return f.credentials;
      },
    });
    const values = await Promise.all(
      Array.from({ length: 6 }, () => manager.withSession(async (key) => key)),
    );
    assert.deepEqual(new Set(values), new Set(['synthetic-session-1']));
    assert.equal(providerCalls, 1);
  });

  test('API-key login and subsequent unlock use on-demand credentials', async (t) => {
    const f = await fixture(t, true);
    let providerCalls = 0;
    const manager = new BwSessionManager(f.identity, {
      persistSession: false,
      credentialProvider: async () => {
        providerCalls++;
        return f.credentials;
      },
    });
    await manager.withSession(async () => undefined);
    const login = (await f.calls()).find((call) => call.args[0] === 'login');
    assert.equal(login?.clientSecret, 'synthetic-api-secret');
    assert.ok(providerCalls >= 2);
    assert.equal((await f.state()).unlocks, 1);
    await assert.rejects(readFile(f.sessionPath), { code: 'ENOENT' });
  });

  test('provider errors are replaced without exposing the cause', async (t) => {
    const f = await fixture(t);
    const manager = new BwSessionManager(f.identity, {
      credentialProvider: async () => {
        throw new Error('synthetic-private-provider-error');
      },
    });
    await assert.rejects(
      manager.withSession(async () => undefined),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'Could not load credentials for configured bw identity',
        );
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(
          error.stack ?? '',
          /synthetic-private-provider-error/,
        );
        return true;
      },
    );
    assert.equal((await f.state()).unlocks, 0);
  });

  for (const [label, apiKey, credentials] of [
    [
      'user changed',
      false,
      {
        password: 'synthetic-master',
        login: { method: 'userpass', user: 'different@example.test' },
      },
    ],
    [
      'method changed',
      false,
      {
        password: 'synthetic-master',
        login: {
          method: 'apikey',
          clientId: 'synthetic-client',
          clientSecret: 'synthetic-api-secret',
        },
      },
    ],
    [
      'client ID changed',
      true,
      {
        password: 'synthetic-master',
        login: {
          method: 'apikey',
          clientId: 'different-client',
          clientSecret: 'synthetic-api-secret',
        },
      },
    ],
    [
      'empty master password',
      false,
      {
        password: '',
        login: { method: 'userpass', user: 'synthetic@example.test' },
      },
    ],
    [
      'empty API secret',
      true,
      {
        password: 'synthetic-master',
        login: {
          method: 'apikey',
          clientId: 'synthetic-client',
          clientSecret: '',
        },
      },
    ],
  ] as const) {
    test(`provider rejects ${label} before authenticating`, async (t) => {
      const f = await fixture(t, apiKey);
      const manager = new BwSessionManager(f.identity, {
        credentialProvider: async () => credentials,
      });
      await assert.rejects(
        manager.withSession(async () => undefined),
        /Could not load credentials/,
      );
      assert.equal((await f.state()).unlocks, 0);
      const calls = await f.calls().catch(() => []);
      assert.ok(
        !calls.some((call) => ['unlock', 'login'].includes(call.args[0])),
      );
    });
  }

  test('revocation waits for active work, clears disk and template caches', async (t) => {
    const f = await fixture(t);
    const manager = new BwSessionManager(f.env);
    const before = await manager.getTemplateItem();
    const started = deferred();
    const release = deferred();
    t.after(release.resolve);
    const running = manager.withSession(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;
    let revoked = false;
    const revocation = manager.revoke().then(() => {
      revoked = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(revoked, false);
    release.resolve();
    await running;
    await revocation;
    assert.equal(await f.storage.readSession(), null);
    assert.equal((await f.state()).current, '');
    assert.notDeepEqual(await manager.getTemplateItem(), before);
    assert.equal((await f.state()).unlocks, 2);
  });

  test('keepalive queued behind revoke cannot unlock again', async (t) => {
    const f = await fixture(t);
    const manager = new BwSessionManager(f.env);
    t.mock.timers.enable({ apis: ['setInterval'] });
    await manager.withSession(async () => undefined);
    manager.startKeepUnlocked();
    const started = deferred();
    const release = deferred();
    t.after(release.resolve);
    const running = manager.withSession(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;
    const revocation = manager.revoke();
    t.mock.timers.tick(10_000);
    release.resolve();
    await running;
    await revocation;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal((await f.state()).unlocks, 1);
    assert.equal((await f.calls()).at(-1)?.args[0], 'lock');
  });

  test('CLI lock failure is reported after memory and disk keys are cleared', async (t) => {
    const f = await fixture(t);
    const manager = new BwSessionManager(f.env);
    await manager.withSession(async () => undefined);
    await f.setState({ ...(await f.state()), failLock: true });
    await assert.rejects(manager.revoke(), /failed with exit code 9/);
    assert.equal(await f.storage.readSession(), null);
    await f.setState({ ...(await f.state()), failLock: false });
    await manager.withSession(async () => undefined);
    assert.equal((await f.state()).unlocks, 2);
  });

  test('cache deletion failure is reported and CLI lock is still attempted', async (t) => {
    const f = await fixture(t);
    const manager = new BwSessionManager(f.env);
    await manager.withSession(async () => undefined);
    await rm(f.sessionPath);
    await mkdir(f.sessionPath);
    await assert.rejects(
      manager.revoke(),
      /Could not remove persisted bw session/,
    );
    assert.equal((await f.calls()).at(-1)?.args[0], 'lock');
    assert.equal((await f.state()).current, '');
  });
});

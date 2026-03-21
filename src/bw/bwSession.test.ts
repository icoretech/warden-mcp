import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { BwSessionManager, readBwEnv } from './bwSession.js';

function clearBwEnv() {
  delete process.env.BW_HOST;
  delete process.env.BW_PASSWORD;
  delete process.env.BW_CLIENTID;
  delete process.env.BW_CLIENTSECRET;
  delete process.env.BW_USER;
  delete process.env.BW_USERNAME;
  delete process.env.BW_UNLOCK_INTERVAL;
}

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved = { ...process.env };
  clearBwEnv();
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    fn();
  } finally {
    process.env = saved;
  }
}

test('readBwEnv explains stdio env requirements when BW_HOST is missing', () => {
  withEnv({}, () => {
    assert.throws(
      () => readBwEnv(),
      /stdio mode.*BW_HOST.*BW_PASSWORD.*BW_CLIENTID\+BW_CLIENTSECRET.*BW_USER\/BW_USERNAME.*X-BW-/is,
    );
  });
});

describe('readBwEnv: apikey login', () => {
  test('returns apikey login when BW_CLIENTID and BW_CLIENTSECRET set', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'master-pw',
        BW_CLIENTID: 'client.abc',
        BW_CLIENTSECRET: 'secret123',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.host, 'https://bw.test');
        assert.equal(env.password, 'master-pw');
        assert.equal(env.login.method, 'apikey');
        if (env.login.method === 'apikey') {
          assert.equal(env.login.clientId, 'client.abc');
          assert.equal(env.login.clientSecret, 'secret123');
        }
      },
    );
  });
});

describe('readBwEnv: userpass login', () => {
  test('returns userpass login when BW_USER set', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'master-pw',
        BW_USER: 'alice@test.com',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.login.method, 'userpass');
        if (env.login.method === 'userpass') {
          assert.equal(env.login.user, 'alice@test.com');
        }
      },
    );
  });

  test('accepts BW_USERNAME as alias for BW_USER', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'master-pw',
        BW_USERNAME: 'bob@test.com',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.login.method, 'userpass');
        if (env.login.method === 'userpass') {
          assert.equal(env.login.user, 'bob@test.com');
        }
      },
    );
  });

  test('apikey takes priority over userpass when both set', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'pw',
        BW_CLIENTID: 'id',
        BW_CLIENTSECRET: 'secret',
        BW_USER: 'user@test.com',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.login.method, 'apikey');
      },
    );
  });
});

describe('readBwEnv: missing login', () => {
  test('throws when no login method provided', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'pw',
      },
      () => {
        assert.throws(() => readBwEnv(), /Missing login env/);
      },
    );
  });
});

describe('readBwEnv: unlock interval', () => {
  test('defaults to 300 seconds', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'pw',
        BW_USER: 'u',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.unlockIntervalSeconds, 300);
      },
    );
  });

  test('parses custom interval', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'pw',
        BW_USER: 'u',
        BW_UNLOCK_INTERVAL: '60',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.unlockIntervalSeconds, 60);
      },
    );
  });

  test('falls back to 300 for non-numeric interval', () => {
    withEnv(
      {
        BW_HOST: 'https://bw.test',
        BW_PASSWORD: 'pw',
        BW_USER: 'u',
        BW_UNLOCK_INTERVAL: 'abc',
      },
      () => {
        const env = readBwEnv();
        assert.equal(env.unlockIntervalSeconds, 300);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// BwSessionManager tests using a fake bw binary
// ---------------------------------------------------------------------------

interface FakeBwOpts {
  /** Map of arg substrings to stdout responses. Default response is '{}'. */
  responses?: Record<string, string>;
  /** Exit code map: arg substring → exit code. Default is 0. */
  exitCodes?: Record<string, number>;
}

async function createFakeBw(
  dir: string,
  opts: FakeBwOpts = {},
): Promise<string> {
  const responses = opts.responses ?? {};
  const exitCodes = opts.exitCodes ?? {};
  const scriptPath = join(dir, 'fake-bw');

  // Build a shell script that inspects $@ to decide what to return.
  // Each case block checks if the args contain a known substring.
  let caseBody = '';
  for (const [pattern, stdout] of Object.entries(responses)) {
    const exitCode = exitCodes[pattern] ?? 0;
    const escapedStdout = stdout.replace(/'/g, "'\\''");
    const escapedPattern = pattern.replace(/'/g, "'\\''");
    caseBody += `if echo "$*" | grep -q '${escapedPattern}'; then printf '%s' '${escapedStdout}'; exit ${exitCode}; fi\n`;
  }
  // Add default exit-code-only patterns
  for (const [pattern, code] of Object.entries(exitCodes)) {
    if (!(pattern in responses)) {
      const escapedPattern = pattern.replace(/'/g, "'\\''");
      caseBody += `if echo "$*" | grep -q '${escapedPattern}'; then exit ${code}; fi\n`;
    }
  }

  const script = `#!/bin/sh\n${caseBody}printf '%s' '{}'\nexit 0\n`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

function makeEnv(homeDir: string): import('./bwSession.js').BwEnv {
  return {
    host: 'https://bw.test',
    password: 'test-password',
    unlockIntervalSeconds: 300,
    login: { method: 'userpass', user: 'test@test.com' },
    homeDir,
  };
}

describe('BwSessionManager', () => {
  test('withSession: unlock then invoke callback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'test-session-token',
          status: '{"status":"unlocked"}',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const result = await manager.withSession(async (session) => {
        assert.equal(session, 'test-session-token');
        return 'callback-result';
      });
      assert.equal(result, 'callback-result');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: caches session on second call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'cached-session',
          'unlock --check': '',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));

      const s1 = await manager.withSession(async (session) => session);
      const s2 = await manager.withSession(async (session) => session);
      assert.equal(s1, 'cached-session');
      assert.equal(s2, 'cached-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: falls back to login when unlock returns empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          // unlock returns empty, login returns a session
          unlock: '',
          'login test@test.com': 'login-session-token',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'login-session-token');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: throws when all auth methods return empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: '',
          login: '',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      await assert.rejects(
        () => manager.withSession(async (s) => s),
        /empty session/,
      );
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('status returns parsed status with summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const statusJson = JSON.stringify({
        serverUrl: 'https://bw.test',
        userEmail: 'test@test.com',
        status: 'unlocked',
      });
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'status-session',
          'unlock --check': '',
          status: statusJson,
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const status = (await manager.status()) as {
        summary: string;
        operational: { ready: boolean };
      };
      assert.ok(status.summary.includes('Vault access ready'));
      assert.ok(status.summary.includes('test@test.com'));
      assert.equal(status.operational.ready, true);
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('runForSession delegates to runBw with session and HOME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'run-session',
          'unlock --check': '',
          'list items': '[{"id":"1"}]',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const result = await manager.withSession(async (session) => {
        return manager.runForSession(session, ['list', 'items']);
      });
      const items = JSON.parse(result.stdout);
      assert.deepEqual(items, [{ id: '1' }]);
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getTemplateItem fetches and caches template', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const tpl = { type: 1, name: '', notes: '' };
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'tpl-session',
          'unlock --check': '',
          'get template item': JSON.stringify(tpl),
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const t1 = await manager.getTemplateItem();
      const t2 = await manager.getTemplateItem();
      assert.deepEqual(t1, tpl);
      assert.deepEqual(t2, tpl); // cached
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('ensureServerConfigured recovers from corrupt config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      // First config server call fails, second succeeds after cleanup.
      // Use a script
      // that fails on first 'config server' and succeeds on second.
      const scriptPath = join(dir, 'fake-bw');
      const counterFile = join(dir, 'config-count');
      await writeFile(counterFile, '0');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then
  count=$(cat "${counterFile}")
  count=$((count + 1))
  echo "$count" > "${counterFile}"
  if [ "$count" -le 1 ]; then
    exit 1
  fi
  exit 0
fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock'; then printf 'recover-session'; exit 0; fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      // Should succeed despite first config failure (recovery path)
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'recover-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('apikey login path works', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: '',
          'login --apikey': 'apikey-session',
        },
      });
      process.env.BW_BIN = fakeBw;
      const env = makeEnv(dir);
      const apiEnv = {
        ...env,
        login: {
          method: 'apikey' as const,
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      };
      const manager = new BwSessionManager(apiEnv);
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'apikey-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: invalidates cached session when unlock --check fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      // Script: first unlock succeeds, unlock --check fails, second unlock succeeds
      const counterFile = join(dir, 'unlock-count');
      await writeFile(counterFile, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${counterFile}")
  count=$((count + 1))
  echo "$count" > "${counterFile}"
  printf "session-v%s" "$count"
  exit 0
fi
if echo "$*" | grep -q 'login'; then printf 'login-session'; exit 0; fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      const s1 = await manager.withSession(async (s) => s);
      assert.equal(s1, 'session-v1');

      // Second call: unlock --check fails → session invalidated → re-unlocks
      const s2 = await manager.withSession(async (s) => s);
      assert.ok(s2 !== s1, 'should get a new session after invalidation');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('status with apikey login shows null userEmail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const statusJson = JSON.stringify({
        serverUrl: 'https://bw.test',
        status: 'unlocked',
      });
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: '',
          'login --apikey': 'api-session',
          'unlock --check': '',
          status: statusJson,
        },
      });
      process.env.BW_BIN = fakeBw;

      const apiEnv = {
        ...makeEnv(dir),
        login: {
          method: 'apikey' as const,
          clientId: 'id',
          clientSecret: 'secret',
        },
      };
      const manager = new BwSessionManager(apiEnv);
      const status = (await manager.status()) as {
        summary: string;
      };
      // apikey login has no userEmail, so summary should not include an email
      assert.ok(status.summary.includes('Vault access ready'));
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getTemplateItem throws on non-JSON output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'tpl-session',
          'unlock --check': '',
          'get template item': 'NOT-JSON-AT-ALL',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      await assert.rejects(
        () => manager.getTemplateItem(),
        /Failed to parse bw template output/,
      );
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('status throws on non-JSON output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'status-session',
          'unlock --check': '',
          status: 'INVALID-JSON',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      await assert.rejects(
        () => manager.status(),
        /Failed to parse bw status output/,
      );
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('tryUnlock failure falls through to tryLogin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      // unlock exits non-zero (failure), login succeeds
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          'login test@test.com': 'login-fallback-session',
        },
        exitCodes: {
          unlock: 1,
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'login-fallback-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('both tryUnlock and tryLogin fail falls through to second tryUnlock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      // First unlock fails, login fails, second unlock succeeds
      const counterFile = join(dir, 'unlock-count');
      await writeFile(counterFile, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${counterFile}")
  count=$((count + 1))
  echo "$count" > "${counterFile}"
  if [ "$count" -le 1 ]; then exit 1; fi
  printf 'second-unlock-session'
  exit 0
fi
if echo "$*" | grep -q 'login'; then exit 1; fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;
      const manager = new BwSessionManager(makeEnv(dir));
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'second-unlock-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

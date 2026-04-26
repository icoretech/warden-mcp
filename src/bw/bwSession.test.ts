import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { BwCliError } from './bwCli.js';
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

  test('withSession: reuses persisted session across fresh managers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const unlockCounter = join(dir, 'unlock-count');
      await writeFile(unlockCounter, '0');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then
  if echo "$*" | grep -q 'persisted-session'; then
    printf 'Vault is unlocked!'
    exit 0
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounter}")
  count=$((count + 1))
  echo "$count" > "${unlockCounter}"
  printf 'persisted-session'
  exit 0
fi
if echo "$*" | grep -q 'login'; then exit 1; fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager1 = new BwSessionManager(makeEnv(dir));
      const s1 = await manager1.withSession(async (session) => session);
      assert.equal(s1, 'persisted-session');
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '1');

      const manager2 = new BwSessionManager(makeEnv(dir));
      const s2 = await manager2.withSession(async (session) => session);
      assert.equal(s2, 'persisted-session');
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '1');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: invalid persisted session triggers fresh unlock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const unlockCounter = join(dir, 'unlock-count');
      await writeFile(unlockCounter, '0');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then
  if echo "$*" | grep -q 'persisted-session'; then exit 1; fi
  if echo "$*" | grep -q 'fresh-session'; then
    printf 'Vault is unlocked!'
    exit 0
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounter}")
  count=$((count + 1))
  echo "$count" > "${unlockCounter}"
  if [ "$count" -eq 1 ]; then printf 'persisted-session'; exit 0; fi
  printf 'fresh-session'
  exit 0
fi
if echo "$*" | grep -q 'login'; then exit 1; fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager1 = new BwSessionManager(makeEnv(dir));
      const s1 = await manager1.withSession(async (session) => session);
      assert.equal(s1, 'persisted-session');
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '1');

      const manager2 = new BwSessionManager(makeEnv(dir));
      const s2 = await manager2.withSession(async (session) => session);
      assert.equal(s2, 'fresh-session');
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '2');
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

  test('status returns not-ready summary without forcing unlock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const unlockCounter = join(dir, 'unlock-count');
      await writeFile(unlockCounter, '0');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'status'; then
  printf '%s' '{"status":"unauthenticated","serverUrl":"https://bw.test"}'
  exit 0
fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounter}")
  count=$((count + 1))
  echo "$count" > "${unlockCounter}"
  printf 'unexpected-session'
  exit 0
fi
if echo "$*" | grep -q 'login'; then exit 1; fi
printf '{}'
exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      const status = (await manager.status()) as {
        summary: string;
        operational: { ready: boolean; sessionValid: boolean };
        status: string;
      };
      assert.equal(status.status, 'unauthenticated');
      assert.equal(status.operational.ready, false);
      assert.equal(status.operational.sessionValid, false);
      assert.ok(status.summary.includes('Vault access not ready'));
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '0');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('status reports ready when a persisted session is still valid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const unlockCounter = join(dir, 'unlock-count');
      await writeFile(unlockCounter, '0');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'status'; then
  printf '%s' '{"status":"locked","serverUrl":"https://bw.test"}'
  exit 0
fi
if echo "$*" | grep -q 'unlock --check'; then
  if echo "$*" | grep -q 'persisted-session'; then
    printf 'Vault is unlocked!'
    exit 0
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounter}")
  count=$((count + 1))
  echo "$count" > "${unlockCounter}"
  printf 'persisted-session'
  exit 0
fi
if echo "$*" | grep -q 'login'; then exit 1; fi
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
printf '{}'
exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      await manager.withSession(async (session) => session);
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '1');

      const freshManager = new BwSessionManager(makeEnv(dir));
      const status = (await freshManager.status()) as {
        summary: string;
        operational: { ready: boolean; sessionValid: boolean };
      };
      assert.equal(status.operational.ready, true);
      assert.equal(status.operational.sessionValid, true);
      assert.ok(status.summary.includes('Vault access ready'));
      assert.equal((await readFile(unlockCounter, 'utf8')).trim(), '1');
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

  test('runForSession passes a stable Bitwarden appdata dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'unlock'; then printf 'env-session'; exit 0; fi
if echo "$*" | grep -q 'status'; then
  printf '{"home":"%s","appData":"%s"}' "$HOME" "$BITWARDENCLI_APPDATA_DIR"
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      const result = await manager.withSession(async (session) => {
        return manager.runForSession(session, ['status']);
      });
      const parsed = JSON.parse(result.stdout) as {
        home: string;
        appData: string;
      };
      assert.equal(parsed.home, dir);
      assert.equal(parsed.appData, join(dir, '.bitwarden-cli'));
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

  test('fresh process reuses existing host config without logout or reconfigure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'status'; then
  printf '%s' '{"status":"locked","serverUrl":"https://bw.test"}'
  exit 0
fi
if echo "$*" | grep -q 'config server'; then exit 1; fi
if echo "$*" | grep -q 'logout'; then exit 1; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'unlock'; then
  printf 'reused-session'
  exit 0
fi
printf '{}'
exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      const session = await manager.withSession(async (s) => s);
      assert.equal(session, 'reused-session');
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

  test('apikey login retries unlock when login succeeds without raw session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const unlockCounter = join(dir, 'unlock-count');
      const loginMarker = join(dir, 'login-done');
      await writeFile(unlockCounter, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'login --apikey'; then
  echo ok > "${loginMarker}"
  exit 0
fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounter}")
  count=$((count + 1))
  echo "$count" > "${unlockCounter}"
  if [ ! -f "${loginMarker}" ]; then exit 0; fi
  if [ "$count" -lt 4 ]; then exit 0; fi
  printf 'delayed-apikey-session'
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;
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
      assert.equal(session, 'delayed-apikey-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('apikey login resets stale cli profile and retries once after empty session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const logoutCounter = join(dir, 'logout-count');
      await writeFile(logoutCounter, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'logout'; then
  count=$(cat "${logoutCounter}")
  count=$((count + 1))
  echo "$count" > "${logoutCounter}"
  exit 0
fi
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'login --apikey'; then exit 1; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${logoutCounter}")
  if [ "$count" -ge 2 ]; then
    printf 'recovered-apikey-session'
  fi
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;
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
      assert.equal(session, 'recovered-apikey-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('apikey login resets stale macos cli profile and retries once after empty session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const staleDir = join(
        dir,
        'Library',
        'Application Support',
        'Bitwarden CLI',
      );
      await mkdir(staleDir, { recursive: true });
      await writeFile(join(staleDir, 'data.json'), '{"stale":true}');

      const scriptPath = join(dir, 'fake-bw');
      const staleFile = join(staleDir, 'data.json');
      const script = `#!/bin/sh
STALE_FILE="${staleFile}"
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'login --apikey'; then
  if [ -f "$STALE_FILE" ]; then
    printf 'You are already logged in as masterkain@gmail.com.' >&2
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  if [ -f "$STALE_FILE" ]; then
    exit 0
  fi
  printf 'recovered-macos-session'
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

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
      assert.equal(session, 'recovered-macos-session');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('apikey login resets stale custom appdata dir and retries once after empty session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const staleDir = join(dir, '.bitwarden-cli');
      await mkdir(staleDir, { recursive: true });
      await writeFile(join(staleDir, 'data.json'), '{"stale":true}');

      const scriptPath = join(dir, 'fake-bw');
      const staleFile = join(staleDir, 'data.json');
      const script = `#!/bin/sh
STALE_FILE="${staleFile}"
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 1; fi
if echo "$*" | grep -q 'login --apikey'; then
  if [ -f "$STALE_FILE" ]; then
    printf 'You are already logged in as masterkain@gmail.com.' >&2
  fi
  exit 1
fi
if echo "$*" | grep -q 'unlock'; then
  if [ -f "$STALE_FILE" ]; then
    exit 0
  fi
  printf 'recovered-custom-appdata-session'
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

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
      assert.equal(session, 'recovered-custom-appdata-session');
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

  test('withSession: refreshes session once when protected operation reports invalid session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const counterFile = join(dir, 'unlock-count');
      await writeFile(counterFile, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 0; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${counterFile}")
  count=$((count + 1))
  echo "$count" > "${counterFile}"
  printf "session-v%s" "$count"
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      let attempts = 0;
      const result = await manager.withSession(async (session) => {
        attempts += 1;
        if (attempts === 1) {
          assert.equal(session, 'session-v1');
          throw new BwCliError('invalid session', {
            exitCode: 1,
            stdout: '',
            stderr: 'Invalid BW session',
          });
        }
        assert.equal(session, 'session-v2');
        return 'recovered';
      });

      assert.equal(result, 'recovered');
      assert.equal(attempts, 2);
      assert.equal((await readFile(counterFile, 'utf8')).trim(), '2');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: retries auth invalidation only once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const counterFile = join(dir, 'unlock-count');
      await writeFile(counterFile, '0');
      const scriptPath = join(dir, 'fake-bw');
      const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then exit 0; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${counterFile}")
  count=$((count + 1))
  echo "$count" > "${counterFile}"
  printf 'session-v%s' "$count"
  exit 0
fi
printf '{}'; exit 0
`;
      await writeFile(scriptPath, script, { mode: 0o755 });
      process.env.BW_BIN = scriptPath;

      const manager = new BwSessionManager(makeEnv(dir));
      let attempts = 0;

      await assert.rejects(
        () =>
          manager.withSession(async (session) => {
            attempts += 1;
            assert.equal(session, attempts === 1 ? 'session-v1' : 'session-v2');
            throw new BwCliError('invalid session', {
              exitCode: 1,
              stdout: '',
              stderr: 'Invalid BW session',
            });
          }),
        /invalid session/i,
      );

      assert.equal(attempts, 2);
      assert.equal((await readFile(counterFile, 'utf8')).trim(), '2');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('withSession: does not retry lookup failures as session failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-session-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const fakeBw = await createFakeBw(dir, {
        responses: {
          'config server': '',
          unlock: 'lookup-session',
          'unlock --check': '',
        },
      });
      process.env.BW_BIN = fakeBw;
      const manager = new BwSessionManager(makeEnv(dir));
      let attempts = 0;

      await assert.rejects(
        () =>
          manager.withSession(async () => {
            attempts += 1;
            throw new BwCliError('not found', {
              exitCode: 1,
              stdout: '',
              stderr: 'Not found.',
            });
          }),
        /not found/,
      );

      assert.equal(attempts, 1);
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

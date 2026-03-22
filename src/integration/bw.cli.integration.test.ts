import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runBw } from '../bw/bwCli.js';

const POST_LOGIN_UNLOCK_RETRY_ATTEMPTS = 20;
const POST_LOGIN_UNLOCK_RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVaultwardenAlive(baseUrl: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/alive`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for vaultwarden alive at ${baseUrl}`);
}

test('integration: direct bw cli auth contract works against vaultwarden', {
  timeout: 120_000,
}, async (t) => {
  const bwHost = process.env.BW_HOST ?? '';
  const bwPassword = process.env.BW_PASSWORD ?? '';
  const bwUser = process.env.BW_USER ?? process.env.BW_USERNAME;
  const bwClientId = process.env.BW_CLIENTID;
  const bwClientSecret = process.env.BW_CLIENTSECRET;
  const hasUserPass = Boolean(bwUser);
  const hasApiKey = Boolean(bwClientId && bwClientSecret);
  if (!bwHost || !bwPassword || (!hasUserPass && !hasApiKey)) {
    t.skip(
      'Missing BW_HOST/BW_PASSWORD and either BW_USER/BW_USERNAME or BW_CLIENTID/BW_CLIENTSECRET',
    );
    return;
  }

  await waitForVaultwardenAlive(bwHost);

  const bwHome = await mkdtemp(join(tmpdir(), 'bw-cli-contract-'));
  const env: NodeJS.ProcessEnv = {
    HOME: bwHome,
    BW_HOST: bwHost,
    BW_PASSWORD: bwPassword,
    ...(hasUserPass ? { BW_USER: bwUser } : {}),
    ...(hasApiKey
      ? {
          BW_CLIENTID: bwClientId,
          BW_CLIENTSECRET: bwClientSecret,
        }
      : {}),
  };
  const authMode = hasApiKey ? 'apikey' : 'userpass';

  t.after(async () => {
    try {
      await runBw(['logout'], {
        env,
        timeoutMs: 30_000,
        noInteraction: false,
      });
    } catch {
      // Best-effort cleanup only.
    }
    await rm(bwHome, { recursive: true, force: true });
  });

  await runBw(['config', 'server', bwHost], {
    env,
    timeoutMs: 60_000,
  });

  const tryUnlock = async (): Promise<string> => {
    try {
      const unlock = await runBw(
        ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw'],
        {
          env,
          timeoutMs: 60_000,
          noInteraction: false,
        },
      );
      return unlock.stdout.trim();
    } catch {
      return '';
    }
  };

  const tryLogin = async (): Promise<{
    completed: boolean;
    session: string;
  }> => {
    const loginArgs = hasApiKey
      ? ['login', '--apikey', '--raw']
      : ['login', bwUser as string, '--passwordenv', 'BW_PASSWORD', '--raw'];
    try {
      const login = await runBw(loginArgs, {
        env,
        timeoutMs: 60_000,
        noInteraction: false,
      });
      return { completed: true, session: login.stdout.trim() };
    } catch {
      return { completed: false, session: '' };
    }
  };

  const retryUnlockAfterLogin = async (): Promise<string> => {
    for (
      let attempt = 0;
      attempt < POST_LOGIN_UNLOCK_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      const session = await tryUnlock();
      if (session) return session;
      if (attempt < POST_LOGIN_UNLOCK_RETRY_ATTEMPTS - 1) {
        await sleep(POST_LOGIN_UNLOCK_RETRY_DELAY_MS);
      }
    }
    return '';
  };

  let session = await tryUnlock();
  if (!session) {
    const login = await tryLogin();
    if (login.session) {
      session = login.session;
    } else if (login.completed) {
      session = await retryUnlockAfterLogin();
    }
  }
  if (!session) session = await tryUnlock();

  assert.match(
    session,
    /\S+/,
    `expected non-empty ${authMode} session from unlock/login/unlock contract`,
  );

  const status = await runBw(['--session', session, 'status'], {
    env,
    timeoutMs: 60_000,
  });
  const parsedStatus = JSON.parse(status.stdout) as {
    serverUrl?: unknown;
    status?: unknown;
  };
  assert.equal(parsedStatus.status, 'unlocked');
  assert.equal(parsedStatus.serverUrl, bwHost);

  const searchNeedle = `bw-cli-contract-${Date.now()}`;
  const listItems = await runBw(
    ['--session', session, 'list', 'items', '--search', searchNeedle],
    {
      env,
      timeoutMs: 60_000,
    },
  );
  const parsedItems = JSON.parse(listItems.stdout);
  assert.ok(Array.isArray(parsedItems));
});

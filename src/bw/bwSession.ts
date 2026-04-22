// src/bw/bwSession.ts

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BwRunOptions, BwRunResult } from './bwCli.js';
import { runBw } from './bwCli.js';
import { Mutex } from './mutex.js';

const POST_LOGIN_UNLOCK_RETRY_ATTEMPTS = 20;
const POST_LOGIN_UNLOCK_RETRY_DELAY_MS = 2_000;
const PROCESS_LOCK_WAIT_MS = 100;
const PROCESS_LOCK_TIMEOUT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BwEnv {
  host: string;
  password: string;
  unlockIntervalSeconds: number;
  login:
    | { method: 'apikey'; clientId: string; clientSecret: string }
    | { method: 'userpass'; user: string };
  // Optional: isolate bw CLI config/state per profile (multi-tenant / multi-host support).
  homeDir?: string;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var for stdio mode: ${name}. ` +
        'For --stdio, set BW_HOST, BW_PASSWORD, and either ' +
        'BW_CLIENTID+BW_CLIENTSECRET or BW_USER/BW_USERNAME. ' +
        'For HTTP mode, omit --stdio and send X-BW-* headers per request.',
    );
  }
  return v;
}

export function readBwEnv(): BwEnv {
  const unlockIntervalSecondsRaw = process.env.BW_UNLOCK_INTERVAL ?? '300';
  const unlockIntervalSeconds = Number.parseInt(unlockIntervalSecondsRaw, 10);

  const host = requiredEnv('BW_HOST');
  const password = requiredEnv('BW_PASSWORD');

  const clientId = process.env.BW_CLIENTID;
  const clientSecret = process.env.BW_CLIENTSECRET;
  const user = process.env.BW_USER ?? process.env.BW_USERNAME;

  const login: BwEnv['login'] =
    clientId && clientSecret
      ? { method: 'apikey', clientId, clientSecret }
      : user
        ? { method: 'userpass', user }
        : (() => {
            throw new Error(
              'Missing login env: set BW_CLIENTID+BW_CLIENTSECRET or BW_USER/BW_USERNAME',
            );
          })();

  return {
    host,
    password,
    unlockIntervalSeconds: Number.isFinite(unlockIntervalSeconds)
      ? unlockIntervalSeconds
      : 300,
    login,
  };
}

export class BwSessionManager {
  private readonly lock = new Mutex();
  private session: string | null = null;
  private templateItem: unknown | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private configuredHost: string | null = null;
  private readonly homeDir: string;
  private readonly appDataDir: string;
  private readonly processLockDir: string;

  constructor(private readonly env: BwEnv) {
    this.homeDir = env.homeDir ?? process.env.HOME ?? '/data';
    this.appDataDir = join(this.homeDir, '.bitwarden-cli');
    this.processLockDir = join(this.appDataDir, '.warden-mcp-auth-lock');
  }

  private baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      HOME: this.homeDir,
      BITWARDENCLI_APPDATA_DIR: this.appDataDir,
      ...(extra ?? {}),
    };
  }

  // Must be called while holding `this.lock` (i.e. from within `withSession`).
  private async getTemplateItemLocked(session: string): Promise<unknown> {
    if (this.templateItem) return this.templateItem;
    const { stdout } = await runBw(
      ['--session', session, 'get', 'template', 'item'],
      {
        env: this.baseEnv(),
        timeoutMs: 60_000,
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Failed to parse bw template output (${stdout.length} bytes)`,
        { cause: err },
      );
    }
    this.templateItem = parsed;
    return parsed;
  }

  startKeepUnlocked(): void {
    if (this.keepaliveTimer) return;
    const intervalMs = Math.max(10, this.env.unlockIntervalSeconds) * 1000;
    this.keepaliveTimer = setInterval(() => {
      if (!this.session) return;
      void this.lock.runExclusive(async () => {
        try {
          await this.ensureUnlockedInternal();
        } catch {
          // Keepalive is best-effort; tools will surface failures.
        }
      });
    }, intervalMs);
    this.keepaliveTimer.unref?.();
  }

  async withSession<T>(fn: (session: string) => Promise<T>): Promise<T> {
    return this.lock.runExclusive(async () => {
      const session = await this.ensureUnlockedInternal();
      return fn(session);
    });
  }

  async getTemplateItem(): Promise<unknown> {
    return this.lock.runExclusive(async () => {
      const session = await this.ensureUnlockedInternal();
      return this.getTemplateItemLocked(session);
    });
  }

  // Use this inside a `withSession` callback to avoid deadlocking by re-taking the same mutex.
  async getTemplateItemForSession(session: string): Promise<unknown> {
    return this.getTemplateItemLocked(session);
  }

  async status(): Promise<unknown> {
    const { stdout } = await runBw(['status'], {
      env: this.baseEnv(),
      timeoutMs: 60_000,
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to parse bw status output (${stdout.length} bytes)`,
        {
          cause: err,
        },
      );
    }

    const rawStatus = typeof parsed.status === 'string' ? parsed.status : null;
    const serverUrl =
      typeof parsed.serverUrl === 'string' ? parsed.serverUrl : this.env.host;
    const userEmail =
      typeof parsed.userEmail === 'string'
        ? parsed.userEmail
        : this.env.login.method === 'userpass'
          ? this.env.login.user
          : null;

    const isUnlocked = rawStatus === 'unlocked';
    const summaryParts = isUnlocked
      ? ['Vault access ready']
      : ['Vault access not ready'];
    if (userEmail) summaryParts.push(`for ${userEmail}`);
    if (serverUrl) summaryParts.push(`on ${serverUrl}`);

    return {
      ...parsed,
      summary: `${summaryParts.join(' ')}.`,
      operational: {
        ready: isUnlocked,
        sessionValid: isUnlocked,
        source: 'session_manager',
      },
    };
  }

  // Run a bw command within an existing session, using this manager's HOME/profile.
  // Intended to be used from inside `withSession` to avoid relocking.
  async runForSession(
    session: string,
    args: string[],
    opts: BwRunOptions = {},
  ): Promise<BwRunResult> {
    return runBw(['--session', session, ...args], {
      ...opts,
      env: this.baseEnv(opts.env),
    });
  }

  private async resetCliProfile(): Promise<void> {
    this.session = null;
    this.templateItem = null;
    this.configuredHost = null;

    await runBw(['logout'], { env: this.baseEnv(), timeoutMs: 30_000 }).catch(
      () => {},
    );

    const home = this.homeDir;
    const cliStateDirs = [
      this.appDataDir,
      join(home, '.config', 'Bitwarden CLI'),
      join(home, 'Library', 'Application Support', 'Bitwarden CLI'),
      join(home, 'AppData', 'Roaming', 'Bitwarden CLI'),
    ];
    for (const dir of cliStateDirs) {
      await rm(join(dir, 'data.json'), {
        force: true,
      }).catch(() => {});
      await rm(join(dir, 'config.json'), {
        force: true,
      }).catch(() => {});
    }
  }

  private async currentServerUrl(): Promise<string | null> {
    try {
      const { stdout } = await runBw(['status'], {
        env: this.baseEnv(),
        timeoutMs: 30_000,
      });
      const parsed = JSON.parse(stdout) as { serverUrl?: unknown };
      return typeof parsed.serverUrl === 'string' ? parsed.serverUrl : null;
    } catch {
      return null;
    }
  }

  private async ensureUnlockedInternal(): Promise<string> {
    return this.withProcessAuthLock(async () => {
      // Ensure server config points to BW_HOST.
      await this.ensureServerConfigured();

      // If we already have a session, check if it still works.
      if (this.session) {
        try {
          const { stdout } = await runBw(
            ['--session', this.session, 'unlock', '--check'],
            {
              env: this.baseEnv(),
              timeoutMs: 30_000,
            },
          );
          void stdout;
          return this.session;
        } catch {
          this.session = null;
        }
      }

      const unlockEnv = this.baseEnv({
        BW_PASSWORD: this.env.password,
        BW_HOST: this.env.host,
      });

      const tryUnlock = async (): Promise<string> => {
        try {
          const { stdout } = await runBw(
            ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw'],
            { env: unlockEnv, timeoutMs: 60_000, noInteraction: false },
          );
          return stdout.trim();
        } catch {
          return '';
        }
      };

      const tryLoginRaw = async (): Promise<{
        completed: boolean;
        session: string;
      }> => {
        try {
          if (this.env.login.method === 'apikey') {
            const { stdout } = await runBw(['login', '--apikey', '--raw'], {
              env: this.baseEnv({
                BW_CLIENTID: this.env.login.clientId,
                BW_CLIENTSECRET: this.env.login.clientSecret,
                BW_HOST: this.env.host,
              }),
              timeoutMs: 60_000,
              noInteraction: false,
            });
            return { completed: true, session: stdout.trim() };
          }

          const { stdout } = await runBw(
            [
              'login',
              this.env.login.user,
              '--passwordenv',
              'BW_PASSWORD',
              '--raw',
            ],
            { env: unlockEnv, timeoutMs: 60_000, noInteraction: false },
          );
          return { completed: true, session: stdout.trim() };
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

      const obtainSession = async (): Promise<string> => {
        let session = await tryUnlock();
        if (!session) {
          const login = await tryLoginRaw();
          if (login.session) {
            session = login.session;
          } else if (login.completed) {
            session = await retryUnlockAfterLogin();
          }
        }
        if (!session) session = await tryUnlock();
        return session;
      };

      let session = await obtainSession();
      if (!session) {
        await this.resetCliProfile();
        await this.ensureServerConfigured();
        session = await obtainSession();
      }
      if (!session)
        throw new Error('bw login/unlock returned an empty session');
      this.session = session;
      return session;
    });
  }

  private async withProcessAuthLock<T>(fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();

    while (true) {
      try {
        await mkdir(this.processLockDir);
        break;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code !== 'EEXIST') throw error;
        if (Date.now() - startedAt >= PROCESS_LOCK_TIMEOUT_MS) {
          throw new Error(
            `Timed out waiting for process auth lock after ${PROCESS_LOCK_TIMEOUT_MS}ms`,
          );
        }
        await sleep(PROCESS_LOCK_WAIT_MS);
      }
    }

    try {
      return await fn();
    } finally {
      await rm(this.processLockDir, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  }

  private async ensureServerConfigured(): Promise<void> {
    if (this.configuredHost === this.env.host) return;

    const currentHost = await this.currentServerUrl();
    if (currentHost === this.env.host) {
      this.configuredHost = currentHost;
      return;
    }

    // bw requires logout before config server update.
    await runBw(['logout'], { env: this.baseEnv(), timeoutMs: 30_000 }).catch(
      () => {},
    );

    try {
      await runBw(['config', 'server', this.env.host], {
        env: this.baseEnv(),
        timeoutMs: 30_000,
      });
      this.configuredHost = this.env.host;
      return;
    } catch {
      // If the CLI data is corrupt/out-of-sync, wiping config is the fastest recovery.
    }
    await this.resetCliProfile();

    await runBw(['config', 'server', this.env.host], {
      env: this.baseEnv(),
      timeoutMs: 30_000,
    });
    this.configuredHost = this.env.host;
  }
}

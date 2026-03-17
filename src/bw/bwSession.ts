// src/bw/bwSession.ts

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BwRunOptions, BwRunResult } from './bwCli.js';
import { runBw } from './bwCli.js';
import { Mutex } from './mutex.js';

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
  if (!v) throw new Error(`Missing required env var: ${name}`);
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

  constructor(private readonly env: BwEnv) {
    this.homeDir = env.homeDir ?? process.env.HOME ?? '/data';
  }

  private baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { HOME: this.homeDir, ...(extra ?? {}) };
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
    const parsed = JSON.parse(stdout);
    this.templateItem = parsed;
    return parsed;
  }

  startKeepUnlocked(): void {
    if (this.keepaliveTimer) return;
    const intervalMs = Math.max(10, this.env.unlockIntervalSeconds) * 1000;
    this.keepaliveTimer = setInterval(() => {
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
    return this.withSession(async (session) => {
      const { stdout } = await runBw(['--session', session, 'status'], {
        env: this.baseEnv(),
        timeoutMs: 60_000,
      });
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const serverUrl =
        typeof parsed.serverUrl === 'string' ? parsed.serverUrl : this.env.host;
      const userEmail =
        typeof parsed.userEmail === 'string'
          ? parsed.userEmail
          : this.env.login.method === 'userpass'
            ? this.env.login.user
            : null;
      const summaryParts = ['Vault access ready'];
      if (userEmail) summaryParts.push(`for ${userEmail}`);
      if (serverUrl) summaryParts.push(`on ${serverUrl}`);

      return {
        ...parsed,
        summary: `${summaryParts.join(' ')}.`,
        operational: {
          ready: true,
          sessionValid: true,
          source: 'session_manager',
        },
      };
    });
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

  private async ensureUnlockedInternal(): Promise<string> {
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
        // unlock --check prints "Vault is unlocked!" or similar; exit code 0 means ok.
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
          { env: unlockEnv, timeoutMs: 60_000 },
        );
        return stdout.trim();
      } catch {
        return '';
      }
    };

    const tryLoginRaw = async (): Promise<string> => {
      try {
        if (this.env.login.method === 'apikey') {
          const { stdout } = await runBw(['login', '--apikey', '--raw'], {
            env: this.baseEnv({
              BW_CLIENTID: this.env.login.clientId,
              BW_CLIENTSECRET: this.env.login.clientSecret,
              BW_HOST: this.env.host,
            }),
            timeoutMs: 60_000,
          });
          return stdout.trim();
        }

        const { stdout } = await runBw(
          [
            'login',
            this.env.login.user,
            '--passwordenv',
            'BW_PASSWORD',
            '--raw',
          ],
          { env: unlockEnv, timeoutMs: 60_000 },
        );
        return stdout.trim();
      } catch {
        return '';
      }
    };

    // Prefer unlocking first (works when already logged in). If it yields an empty
    // stdout on exit=0 (observed in some bw builds), fall back to login --raw.
    let session = await tryUnlock();
    if (!session) session = await tryLoginRaw();
    if (!session) session = await tryUnlock();

    if (!session) throw new Error('bw login/unlock returned an empty session');
    this.session = session;
    return session;
  }

  private async ensureServerConfigured(): Promise<void> {
    if (this.configuredHost === this.env.host) return;

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

    const home = this.homeDir;
    await rm(join(home, '.config', 'Bitwarden CLI', 'data.json'), {
      force: true,
    }).catch(() => {});
    await rm(join(home, '.config', 'Bitwarden CLI', 'config.json'), {
      force: true,
    }).catch(() => {});

    await runBw(['config', 'server', this.env.host], {
      env: this.baseEnv(),
      timeoutMs: 30_000,
    });
    this.configuredHost = this.env.host;
  }
}

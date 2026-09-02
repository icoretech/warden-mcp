import type { BwRunOptions, BwRunResult } from './bwCli.js';
import { isBwAuthSessionInvalidError, runBw } from './bwCli.js';
import type { BwEnv } from './bwEnv.js';
import { BwSessionAuth } from './bwSessionAuth.js';
import { Mutex } from './mutex.js';

export type { BwEnv } from './bwEnv.js';
export { readBwEnv } from './bwEnv.js';

export class BwSessionManager {
  private readonly lock = new Mutex();
  private readonly auth: BwSessionAuth;
  private templateItem: unknown | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly env: BwEnv) {
    this.auth = new BwSessionAuth(env, () => {
      this.templateItem = null;
    });
  }

  startKeepUnlocked(): void {
    if (this.keepaliveTimer) return;
    const intervalMs = Math.max(10, this.env.unlockIntervalSeconds) * 1000;
    this.keepaliveTimer = setInterval(() => {
      if (!this.auth.hasSession()) return;
      void this.lock.runExclusive(async () => {
        try {
          await this.auth.ensureUnlocked();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
        }
      });
    }, intervalMs);
    this.keepaliveTimer.unref?.();
  }

  async withSession<T>(fn: (session: string) => Promise<T>): Promise<T> {
    return this.lock.runExclusive(async () => {
      const session = await this.auth.ensureUnlocked();
      try {
        return await fn(session);
      } catch (error) {
        if (!isBwAuthSessionInvalidError(error)) throw error;
        const refreshedSession = await this.auth.ensureUnlocked(session);
        return fn(refreshedSession);
      }
    });
  }

  async getTemplateItem(): Promise<unknown> {
    return this.lock.runExclusive(async () => {
      const session = await this.auth.ensureUnlocked();
      return this.getTemplateItemLocked(session);
    });
  }

  async getTemplateItemForSession(session: string): Promise<unknown> {
    return this.getTemplateItemLocked(session);
  }

  async status(): Promise<unknown> {
    const { stdout } = await runBw(['status'], {
      env: this.auth.storage.baseEnv(),
      timeoutMs: 60_000,
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse bw status output (${stdout.length} bytes)`,
        { cause: error },
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
    const isUnlocked =
      rawStatus === 'unlocked' ||
      (await this.auth.hasValidSessionWithoutUnlock());

    if (rawStatus === 'locked') this.startBackgroundUnlock();
    const summaryParts = isUnlocked
      ? ['Vault access ready']
      : [
          'Vault access not ready yet; this lazy status check does not unlock the vault, but keychain tools will attempt unlock/recovery on demand',
        ];
    if (userEmail) summaryParts.push(`for ${userEmail}`);
    if (serverUrl) summaryParts.push(`on ${serverUrl}`);

    return {
      ...parsed,
      summary: `${summaryParts.join(' ')}.`,
      operational: {
        ready: isUnlocked,
        sessionValid: isUnlocked,
        recoverable: !isUnlocked,
        nextAction: isUnlocked
          ? 'continue'
          : 'call a keychain tool such as search_items or get_username to initialize vault access on demand',
        source: 'session_manager',
      },
    };
  }

  async runForSession(
    session: string,
    args: string[],
    opts: BwRunOptions = {},
  ): Promise<BwRunResult> {
    return runBw(['--session', session, ...args], {
      ...opts,
      env: this.auth.storage.baseEnv(opts.env),
    });
  }

  private async getTemplateItemLocked(session: string): Promise<unknown> {
    if (this.templateItem) return this.templateItem;
    const { stdout } = await runBw(
      ['--session', session, 'get', 'template', 'item'],
      { env: this.auth.storage.baseEnv(), timeoutMs: 60_000 },
    );
    try {
      this.templateItem = JSON.parse(stdout);
      return this.templateItem;
    } catch (error) {
      throw new Error(
        `Failed to parse bw template output (${stdout.length} bytes)`,
        { cause: error },
      );
    }
  }

  private startBackgroundUnlock(): void {
    if (this.auth.hasSession() || this.warmupPromise) return;
    this.warmupPromise = this.withSession(async () => undefined)
      .catch(() => {})
      .finally(() => {
        this.warmupPromise = null;
      });
  }
}

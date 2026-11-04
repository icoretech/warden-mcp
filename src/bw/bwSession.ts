import type { BwRunOptions, BwRunResult } from './bwCli.js';
import { isBwAuthSessionInvalidError, runBw } from './bwCli.js';
import { sessionConfig, staticCredentialProvider } from './bwCredentials.js';
import type {
  BwCredentialProvider,
  BwEnv,
  BwSessionConfig,
  BwSessionOptions,
} from './bwEnv.js';
import { BwSessionAuth } from './bwSessionAuth.js';
import { Mutex } from './mutex.js';

export { BwCredentialError } from './bwCredentials.js';
export type {
  BwCredentialProvider,
  BwEnv,
  BwSessionConfig,
  BwSessionOptions,
} from './bwEnv.js';
export { readBwEnv } from './bwEnv.js';
export { BwSessionRevokeError } from './bwSessionRevocation.js';

export class BwSessionManager {
  private readonly lock = new Mutex();
  private readonly auth: BwSessionAuth;
  private templateItem: unknown | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private warmupPromise: Promise<void> | null = null;
  private readonly env: BwSessionConfig;
  private readonly backgroundAuthEnabled: boolean;
  private backgroundGeneration = 0;
  private backgroundAuthSuspended = false;

  constructor(env: BwEnv, options?: BwSessionOptions);
  constructor(
    env: BwSessionConfig,
    options: BwSessionOptions & {
      readonly credentialProvider: BwCredentialProvider;
    },
  );
  constructor(env: BwSessionConfig, options: BwSessionOptions = {}) {
    this.env = sessionConfig(env);
    this.backgroundAuthEnabled =
      options.persistSession !== false &&
      options.credentialProvider === undefined;
    this.auth = new BwSessionAuth(
      this.env,
      () => {
        this.templateItem = null;
      },
      options.credentialProvider ?? staticCredentialProvider(env),
      options.persistSession ?? true,
    );
  }

  startKeepUnlocked(): void {
    if (!this.backgroundAuthEnabled || this.keepaliveTimer) return;
    const generation = this.backgroundGeneration;
    const intervalMs = Math.max(10, this.env.unlockIntervalSeconds) * 1000;
    this.keepaliveTimer = setInterval(() => {
      if (!this.auth.hasSession()) return;
      void this.lock.runExclusive(async () => {
        if (generation !== this.backgroundGeneration || !this.auth.hasSession())
          return;
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
    const generation = this.backgroundGeneration;
    return this.lock.runExclusive(() => this.statusLocked(generation));
  }

  async revoke(): Promise<void> {
    this.backgroundGeneration += 1;
    this.backgroundAuthSuspended = true;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    await this.lock.runExclusive(() => this.auth.revoke());
  }

  private async statusLocked(generation: number): Promise<unknown> {
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

    if (rawStatus === 'locked') this.startBackgroundUnlock(generation);
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
    return runBw(args, {
      ...opts,
      env: this.auth.storage.baseEnv({ ...opts.env, BW_SESSION: session }),
    });
  }

  private async getTemplateItemLocked(session: string): Promise<unknown> {
    if (this.templateItem) return this.templateItem;
    const { stdout } = await this.runForSession(
      session,
      ['get', 'template', 'item'],
      { timeoutMs: 60_000 },
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

  private startBackgroundUnlock(generation: number): void {
    if (
      !this.backgroundAuthEnabled ||
      this.backgroundAuthSuspended ||
      generation !== this.backgroundGeneration ||
      this.auth.hasSession() ||
      this.warmupPromise
    )
      return;
    this.warmupPromise = this.lock
      .runExclusive(async () => {
        if (generation !== this.backgroundGeneration) return;
        await this.auth.ensureUnlocked();
      })
      .catch(() => {})
      .finally(() => {
        this.warmupPromise = null;
      });
  }
}

import { runBw } from './bwCli.js';
import type { BwEnv } from './bwEnv.js';
import { BwSessionStorage } from './bwSessionStorage.js';

const POST_LOGIN_UNLOCK_RETRY_ATTEMPTS = 20;
const POST_LOGIN_UNLOCK_RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BwSessionAuth {
  readonly storage: BwSessionStorage;
  private session: string | null = null;
  private configuredHost: string | null = null;

  constructor(
    private readonly env: BwEnv,
    private readonly onSessionCleared: () => void,
  ) {
    const homeDir = env.homeDir ?? process.env.HOME ?? '/data';
    const identity =
      env.login.method === 'apikey'
        ? `apikey:${env.login.clientId}`
        : `userpass:${env.login.user}`;
    this.storage = new BwSessionStorage(homeDir, env.host, identity);
  }

  hasSession(): boolean {
    return this.session !== null;
  }

  async ensureUnlocked(invalidatedSession?: string): Promise<string> {
    return this.storage.withAuthLock(async () => {
      if (invalidatedSession) {
        this.clearInMemorySession();
        if ((await this.storage.readSession()) === invalidatedSession) {
          await this.storage.clearSession();
        }
      }

      await this.ensureServerConfigured();
      if (this.session && (await this.isSessionValid(this.session))) {
        return this.session;
      }
      this.session = null;

      const storedSession = await this.storage.readSession();
      if (storedSession) {
        if (await this.isSessionValid(storedSession)) {
          this.session = storedSession;
          await this.storage.writeSession(storedSession);
          return storedSession;
        }
        await this.storage.clearSession();
      }

      let session = await this.obtainSession();
      if (!session) {
        await this.resetCliProfile();
        await this.ensureServerConfigured();
        session = await this.obtainSession();
      }
      if (!session) {
        throw new Error('bw login/unlock returned an empty session');
      }
      this.session = session;
      await this.storage.writeSession(session);
      return session;
    });
  }

  async hasValidSessionWithoutUnlock(): Promise<boolean> {
    if (this.session && (await this.isSessionValid(this.session))) return true;
    const storedSession = await this.storage.readSession();
    if (!storedSession || !(await this.isSessionValid(storedSession))) {
      return false;
    }
    this.session = storedSession;
    return true;
  }

  currentSession(): string | null {
    return this.session;
  }

  async isSessionValid(session: string): Promise<boolean> {
    try {
      const { stdout } = await runBw(
        ['--session', session, 'unlock', '--check'],
        { env: this.storage.baseEnv(), timeoutMs: 30_000 },
      );
      void stdout;
      return true;
    } catch {
      return false;
    }
  }

  private async tryUnlock(): Promise<string> {
    try {
      const { stdout } = await runBw(
        ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw'],
        {
          env: this.storage.baseEnv({
            BW_PASSWORD: this.env.password,
            BW_HOST: this.env.host,
          }),
          timeoutMs: 60_000,
          noInteraction: false,
        },
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async tryLogin(): Promise<{
    readonly completed: boolean;
    readonly session: string;
  }> {
    try {
      if (this.env.login.method === 'apikey') {
        const { stdout } = await runBw(['login', '--apikey', '--raw'], {
          env: this.storage.baseEnv({
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
        ['login', this.env.login.user, '--passwordenv', 'BW_PASSWORD', '--raw'],
        {
          env: this.storage.baseEnv({
            BW_PASSWORD: this.env.password,
            BW_HOST: this.env.host,
          }),
          timeoutMs: 60_000,
          noInteraction: false,
        },
      );
      const session = stdout.trim();
      return { completed: session.length > 0, session };
    } catch {
      return { completed: false, session: '' };
    }
  }

  private async retryUnlockAfterLogin(): Promise<string> {
    for (
      let attempt = 0;
      attempt < POST_LOGIN_UNLOCK_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      const session = await this.tryUnlock();
      if (session) return session;
      if (attempt < POST_LOGIN_UNLOCK_RETRY_ATTEMPTS - 1) {
        await sleep(POST_LOGIN_UNLOCK_RETRY_DELAY_MS);
      }
    }
    return '';
  }

  private async obtainSession(): Promise<string> {
    let session = await this.tryUnlock();
    if (!session) {
      const login = await this.tryLogin();
      if (login.session) {
        session = login.session;
      } else if (login.completed) {
        session = await this.retryUnlockAfterLogin();
      }
    }
    if (!session) session = await this.tryUnlock();
    return session;
  }

  private async resetCliProfile(): Promise<void> {
    this.clearInMemorySession();
    await this.storage.clearSession();
    this.configuredHost = null;
    await runBw(['logout'], {
      env: this.storage.baseEnv(),
      timeoutMs: 30_000,
    }).catch(() => {});
    await this.storage.clearCliDataFiles();
  }

  private async ensureServerConfigured(): Promise<void> {
    if (this.configuredHost === this.env.host) return;
    const currentHost = await this.storage.currentServerUrl();
    if (currentHost === this.env.host) {
      this.configuredHost = currentHost;
      return;
    }

    await runBw(['logout'], {
      env: this.storage.baseEnv(),
      timeoutMs: 30_000,
    }).catch(() => {});
    try {
      await runBw(['config', 'server', this.env.host], {
        env: this.storage.baseEnv(),
        timeoutMs: 30_000,
      });
      this.configuredHost = this.env.host;
      return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }

    await this.resetCliProfile();
    await runBw(['config', 'server', this.env.host], {
      env: this.storage.baseEnv(),
      timeoutMs: 30_000,
    });
    this.configuredHost = this.env.host;
  }

  private clearInMemorySession(): void {
    this.session = null;
    this.onSessionCleared();
  }
}

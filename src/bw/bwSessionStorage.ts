import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runBw } from './bwCli.js';

const PROCESS_LOCK_WAIT_MS = 100;
const PROCESS_LOCK_TIMEOUT_MS = 90_000;
const PROCESS_LOCK_OWNER_FILE = 'owner.json';

interface StoredSessionState {
  readonly version: 1;
  readonly host: string;
  readonly identity: string;
  readonly session: string;
  readonly createdAt: string;
  readonly validatedAt: string;
}

interface ProcessLockOwner {
  readonly pid: number;
  readonly createdAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return error.code;
}

function isProcessLockOwner(value: unknown): value is ProcessLockOwner {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pid' in value &&
    'createdAt' in value &&
    typeof value.pid === 'number' &&
    Number.isInteger(value.pid) &&
    typeof value.createdAt === 'string'
  );
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return errorCode(error) !== 'ESRCH';
  }
}

export class BwSessionStorage {
  readonly homeDir: string;
  readonly appDataDir: string;
  private readonly processLockDir: string;
  private readonly sessionStatePath: string;

  constructor(
    homeDir: string,
    private readonly host: string,
    private readonly identity: string,
  ) {
    this.homeDir = homeDir;
    this.appDataDir = join(homeDir, '.bitwarden-cli');
    this.processLockDir = join(this.appDataDir, '.warden-mcp-auth-lock');
    this.sessionStatePath = join(this.appDataDir, '.warden-mcp-session.json');
  }

  baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      HOME: this.homeDir,
      BITWARDENCLI_APPDATA_DIR: this.appDataDir,
      ...(extra ?? {}),
    };
  }

  async currentServerUrl(): Promise<string | null> {
    try {
      const raw = await readFile(join(this.appDataDir, 'data.json'), 'utf8');
      const parsed = JSON.parse(raw) as {
        global_environment_environment?: { urls?: { base?: unknown } };
      };
      const base = parsed.global_environment_environment?.urls?.base;
      if (typeof base === 'string' && base.length > 0) return base;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }

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

  async readSession(): Promise<string | null> {
    try {
      const raw = await readFile(this.sessionStatePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredSessionState>;
      if (
        parsed.version !== 1 ||
        parsed.host !== this.host ||
        parsed.identity !== this.identity ||
        typeof parsed.session !== 'string' ||
        parsed.session.length === 0
      ) {
        return null;
      }
      return parsed.session;
    } catch {
      return null;
    }
  }

  async writeSession(session: string): Promise<void> {
    const now = new Date().toISOString();
    const state: StoredSessionState = {
      version: 1,
      host: this.host,
      identity: this.identity,
      session,
      createdAt: now,
      validatedAt: now,
    };
    await mkdir(this.appDataDir, { recursive: true });
    await writeFile(this.sessionStatePath, JSON.stringify(state), 'utf8');
  }

  async clearSession(): Promise<void> {
    await rm(this.sessionStatePath, { force: true }).catch(() => {});
  }

  async clearCliDataFiles(): Promise<void> {
    const stateDirs = [
      this.appDataDir,
      join(this.homeDir, '.config', 'Bitwarden CLI'),
      join(this.homeDir, 'Library', 'Application Support', 'Bitwarden CLI'),
      join(this.homeDir, 'AppData', 'Roaming', 'Bitwarden CLI'),
    ];
    for (const dir of stateDirs) {
      await rm(join(dir, 'data.json'), { force: true }).catch(() => {});
      await rm(join(dir, 'config.json'), { force: true }).catch(() => {});
    }
  }

  async withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    await mkdir(this.appDataDir, { recursive: true });
    while (true) {
      try {
        await mkdir(this.processLockDir);
        try {
          await this.writeLockOwner();
        } catch (error) {
          await rm(this.processLockDir, { recursive: true, force: true });
          throw error;
        }
        break;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        if (await this.reclaimLockIfStale()) continue;
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

  private async writeLockOwner(): Promise<void> {
    const owner: ProcessLockOwner = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    await writeFile(
      join(this.processLockDir, PROCESS_LOCK_OWNER_FILE),
      JSON.stringify(owner),
      'utf8',
    );
  }

  private async reclaimLockIfStale(): Promise<boolean> {
    const ownerPath = join(this.processLockDir, PROCESS_LOCK_OWNER_FILE);
    try {
      const parsed = JSON.parse(await readFile(ownerPath, 'utf8'));
      if (isProcessLockOwner(parsed) && !isProcessAlive(parsed.pid)) {
        await rm(this.processLockDir, { recursive: true, force: true });
        return true;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }

    const lockStats = await stat(this.processLockDir).catch(() => null);
    if (
      lockStats &&
      Date.now() - lockStats.mtimeMs >= PROCESS_LOCK_TIMEOUT_MS
    ) {
      await rm(this.processLockDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }
}

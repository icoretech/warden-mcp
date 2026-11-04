import { runBw } from './bwCli.js';
import type { BwSessionStorage } from './bwSessionStorage.js';

export type BwSessionRevokeFailure = 'profile' | 'cache' | 'lock';

export class BwSessionRevokeError extends Error {
  readonly failures: readonly BwSessionRevokeFailure[];

  constructor(failures: readonly BwSessionRevokeFailure[]) {
    super(`Bitwarden session revocation failed (${failures.join(', ')})`);
    this.name = 'BwSessionRevokeError';
    this.failures = [...failures];
  }
}

export async function revokeProfile(storage: BwSessionStorage): Promise<void> {
  try {
    await storage.withAuthLock(async () => {
      const failures: BwSessionRevokeFailure[] = [];
      try {
        await storage.deleteSession();
      } catch {
        failures.push('cache');
      }
      try {
        await runBw(['lock'], {
          env: storage.baseEnv(),
          timeoutMs: 30_000,
        });
      } catch {
        failures.push('lock');
      }
      if (failures.length > 0) throw new BwSessionRevokeError(failures);
    });
  } catch (error) {
    if (error instanceof BwSessionRevokeError) throw error;
    throw new BwSessionRevokeError(['profile']);
  }
}

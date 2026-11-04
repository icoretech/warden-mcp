import { z } from 'zod';
import type { BwCredentialProvider, BwEnv, BwSessionConfig } from './bwEnv.js';

const credentialsSchema = z.object({
  host: z.string().min(1),
  password: z.string().min(1),
  login: z.discriminatedUnion('method', [
    z.object({
      method: z.literal('apikey'),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    }),
    z.object({ method: z.literal('userpass'), user: z.string().min(1) }),
  ]),
});

export class BwCredentialError extends Error {
  constructor() {
    super(
      'Bitwarden credential provider failed or returned mismatched credentials',
    );
    this.name = 'BwCredentialError';
  }
}

function assertNever(_login: never): never {
  throw new BwCredentialError();
}

export function sessionConfig(env: BwSessionConfig): BwSessionConfig {
  return {
    host: env.host,
    unlockIntervalSeconds: env.unlockIntervalSeconds,
    homeDir: env.homeDir,
    login:
      env.login.method === 'apikey'
        ? { method: 'apikey', clientId: env.login.clientId }
        : { method: 'userpass', user: env.login.user },
  };
}

export function staticCredentialProvider(
  env: BwSessionConfig,
): BwCredentialProvider {
  const parsed = credentialsSchema.safeParse(env);
  if (!parsed.success) throw new BwCredentialError();
  const credentials: BwEnv = { ...sessionConfig(env), ...parsed.data };
  return () => credentials;
}

export async function loadCredentials(
  config: BwSessionConfig,
  provider: BwCredentialProvider,
): Promise<BwEnv> {
  let supplied: unknown;
  try {
    supplied = await provider();
  } catch {
    // Provider failures are an untrusted boundary; never preserve their cause.
    throw new BwCredentialError();
  }
  const parsed = credentialsSchema.safeParse(supplied);
  if (!parsed.success || parsed.data.host !== config.host) {
    throw new BwCredentialError();
  }
  const credentials = parsed.data;
  switch (config.login.method) {
    case 'apikey':
      if (
        credentials.login.method !== 'apikey' ||
        credentials.login.clientId !== config.login.clientId
      ) {
        throw new BwCredentialError();
      }
      break;
    case 'userpass':
      if (
        credentials.login.method !== 'userpass' ||
        credentials.login.user !== config.login.user
      ) {
        throw new BwCredentialError();
      }
      break;
    default:
      return assertNever(config.login);
  }
  return { ...config, ...credentials };
}

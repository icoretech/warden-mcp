export interface BwEnv {
  readonly host: string;
  readonly password: string;
  readonly unlockIntervalSeconds: number;
  readonly login:
    | {
        readonly method: 'apikey';
        readonly clientId: string;
        readonly clientSecret: string;
      }
    | { readonly method: 'userpass'; readonly user: string };
  readonly homeDir?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var for stdio mode: ${name}. ` +
        'For --stdio, set BW_HOST, BW_PASSWORD, and either ' +
        'BW_CLIENTID+BW_CLIENTSECRET or BW_USER/BW_USERNAME. ' +
        'For HTTP mode, omit --stdio and send X-BW-* headers per request.',
    );
  }
  return value;
}

export function readBwEnv(): BwEnv {
  const rawInterval = process.env.BW_UNLOCK_INTERVAL ?? '300';
  const unlockIntervalSeconds = Number.parseInt(rawInterval, 10);
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

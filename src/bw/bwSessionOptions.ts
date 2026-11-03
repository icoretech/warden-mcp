import type { BwEnv } from './bwEnv.js';

export type BwCredentials = Pick<BwEnv, 'password' | 'login'>;

/** Stable profile identity; credentials are supplied separately on demand. */
export interface BwSessionIdentity extends Omit<BwEnv, 'password' | 'login'> {
  readonly login:
    | { readonly method: 'apikey'; readonly clientId: string }
    | { readonly method: 'userpass'; readonly user: string };
}

export type BwCredentialProvider = () => Promise<BwCredentials>;

export interface BwSessionOptions {
  readonly credentialProvider?: BwCredentialProvider;
  /** Defaults to true. False also disables background unlock/keepalive. */
  readonly persistSession?: boolean;
}

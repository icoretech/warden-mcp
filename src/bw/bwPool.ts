// src/bw/bwPool.ts

import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BwEnv } from './bwSession.js';
import { BwSessionManager } from './bwSession.js';

export class BwSessionPool {
  private readonly managers = new Map<string, BwSessionManager>();
  private readonly rootDir: string;

  constructor(opts: { rootDir: string }) {
    this.rootDir = opts.rootDir;
  }

  private keyForEnv(env: BwEnv): string {
    const identity =
      env.login.method === 'apikey'
        ? { method: 'apikey', clientId: env.login.clientId }
        : { method: 'userpass', user: env.login.user };

    const secrets =
      env.login.method === 'apikey'
        ? {
            clientSecret: this.hashSecret(env.login.clientSecret),
            password: this.hashSecret(env.password),
          }
        : { password: this.hashSecret(env.password) };

    const keyMaterial = JSON.stringify({ host: env.host, identity, secrets });
    return crypto.createHash('sha256').update(keyMaterial).digest('hex');
  }

  private hashSecret(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  async getOrCreate(envLike: unknown): Promise<BwSessionManager> {
    // Validate the minimum shape we need at runtime.
    if (!envLike || typeof envLike !== 'object') {
      throw new Error('Invalid Bitwarden config payload (expected object).');
    }
    const env = envLike as BwEnv;
    if (!env.host || typeof env.host !== 'string') {
      throw new Error('Invalid Bitwarden config: missing host.');
    }
    if (!env.password || typeof env.password !== 'string') {
      throw new Error('Invalid Bitwarden config: missing password.');
    }
    if (!env.login || typeof env.login !== 'object') {
      throw new Error('Invalid Bitwarden config: missing login.');
    }

    const key = this.keyForEnv(env);
    const existing = this.managers.get(key);
    if (existing) return existing;

    const homeDir = join(this.rootDir, key);
    await mkdir(homeDir, { recursive: true });

    const manager = new BwSessionManager({ ...env, homeDir });
    manager.startKeepUnlocked();

    this.managers.set(key, manager);
    return manager;
  }
}

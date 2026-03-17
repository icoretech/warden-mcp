// src/bw/bwHeaders.ts

import type express from 'express';
import type { BwEnv } from './bwSession.js';

function header(req: express.Request, name: string): string | undefined {
  const v = req.header(name);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

function headerPresent(req: express.Request, name: string): boolean {
  return Boolean(header(req, name));
}

function requireHeader(req: express.Request, name: string): string {
  const v = header(req, name);
  if (!v) throw new Error(`Missing required header: ${name}`);
  return v;
}

function parseBwHost(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('x-bw-host must be an https url');
  }

  if (url.protocol !== 'https:') {
    throw new Error('x-bw-host must be an https url');
  }

  if (url.username || url.password) {
    throw new Error('x-bw-host must not include credentials');
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'x-bw-host must be an https origin without path, query, or fragment',
    );
  }

  return url.origin;
}

export function bwEnvFromExpressHeaders(req: express.Request): BwEnv | null {
  const anyBwHeader =
    headerPresent(req, 'x-bw-host') ||
    headerPresent(req, 'x-bw-password') ||
    headerPresent(req, 'x-bw-user') ||
    headerPresent(req, 'x-bw-username') ||
    headerPresent(req, 'x-bw-clientid') ||
    headerPresent(req, 'x-bw-clientsecret');

  if (!anyBwHeader) return null;

  const host = parseBwHost(requireHeader(req, 'x-bw-host'));
  const password = requireHeader(req, 'x-bw-password');
  const unlockIntervalRaw = header(req, 'x-bw-unlock-interval');
  const unlockIntervalSeconds = unlockIntervalRaw
    ? Number.parseInt(unlockIntervalRaw, 10)
    : 300;

  const clientId = header(req, 'x-bw-clientid');
  const clientSecret = header(req, 'x-bw-clientsecret');
  const user = header(req, 'x-bw-user') ?? header(req, 'x-bw-username');

  const login: BwEnv['login'] =
    clientId && clientSecret
      ? { method: 'apikey', clientId, clientSecret }
      : user
        ? { method: 'userpass', user }
        : (() => {
            throw new Error(
              'Missing Bitwarden login headers: provide x-bw-clientid + x-bw-clientsecret OR x-bw-user',
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

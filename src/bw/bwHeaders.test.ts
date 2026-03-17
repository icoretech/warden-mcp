import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import test from 'node:test';
import type express from 'express';

import { bwEnvFromExpressHeaders, bwEnvFromHeadersOrEnv } from './bwHeaders.js';

function makeReq(headers: Record<string, string>) {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as express.Request;
}

test('returns null when no bw headers are present', () => {
  const req = makeReq({});
  assert.equal(bwEnvFromExpressHeaders(req), null);
});

test('rejects non-https x-bw-host values', () => {
  const req = makeReq({
    'x-bw-host': 'http://vaultwarden.local',
    'x-bw-password': 'pw',
    'x-bw-user': 'user@example.com',
  });

  assert.throws(
    () => bwEnvFromExpressHeaders(req),
    /x-bw-host must be an https url/i,
  );
});

test('accepts a minimal https header set', () => {
  const req = makeReq({
    'x-bw-host': 'https://vaultwarden.example.com',
    'x-bw-password': 'pw',
    'x-bw-user': 'user@example.com',
    'x-bw-unlock-interval': '60',
  });

  assert.deepEqual(bwEnvFromExpressHeaders(req), {
    host: 'https://vaultwarden.example.com',
    password: 'pw',
    unlockIntervalSeconds: 60,
    login: {
      method: 'userpass',
      user: 'user@example.com',
    },
  });
});

function mockReq(headers: Record<string, string>) {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    headers,
  } as unknown as express.Request;
}

describe('bwEnvFromHeadersOrEnv', () => {
  it('returns null when no headers and no env vars', () => {
    const saved = { ...process.env };
    delete process.env.BW_HOST;
    delete process.env.BW_PASSWORD;
    delete process.env.BW_CLIENTID;
    delete process.env.BW_CLIENTSECRET;
    delete process.env.BW_USER;
    delete process.env.BW_USERNAME;

    const result = bwEnvFromHeadersOrEnv(mockReq({}));
    assert.equal(result, null);

    Object.assign(process.env, saved);
  });

  it('returns BwEnv from env vars when headers absent', () => {
    const saved = { ...process.env };
    process.env.BW_HOST = 'https://vault.example.com';
    process.env.BW_PASSWORD = 'secret';
    process.env.BW_CLIENTID = 'user.abc';
    process.env.BW_CLIENTSECRET = 'clientsecret';
    delete process.env.BW_USER;
    delete process.env.BW_USERNAME;

    const result = bwEnvFromHeadersOrEnv(mockReq({}));
    assert.ok(result);
    assert.equal(result.host, 'https://vault.example.com');
    assert.equal(result.login.method, 'apikey');

    Object.assign(process.env, saved);
  });

  it('headers take priority over env vars when both present', () => {
    const saved = { ...process.env };
    // Set env vars
    process.env.BW_HOST = 'https://env.example.com';
    process.env.BW_PASSWORD = 'envpassword';
    process.env.BW_CLIENTID = 'user.env';
    process.env.BW_CLIENTSECRET = 'envsecret';

    // Also provide X-BW-* headers — these should win
    const result = bwEnvFromHeadersOrEnv(mockReq({
      'x-bw-host': 'https://headers.example.com',
      'x-bw-password': 'headerpassword',
      'x-bw-clientid': 'user.headers',
      'x-bw-clientsecret': 'headersecret',
    }));

    assert.ok(result);
    assert.equal(result.host, 'https://headers.example.com');
    assert.equal(result.password, 'headerpassword');

    Object.assign(process.env, saved);
  });
});

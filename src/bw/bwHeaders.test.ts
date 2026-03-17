import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';

import { bwEnvFromExpressHeaders } from './bwHeaders.js';

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

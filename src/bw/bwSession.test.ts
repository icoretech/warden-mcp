import assert from 'node:assert/strict';
import test from 'node:test';

import { readBwEnv } from './bwSession.js';

function clearBwEnv() {
  delete process.env.BW_HOST;
  delete process.env.BW_PASSWORD;
  delete process.env.BW_CLIENTID;
  delete process.env.BW_CLIENTSECRET;
  delete process.env.BW_USER;
  delete process.env.BW_USERNAME;
  delete process.env.BW_UNLOCK_INTERVAL;
}

test('readBwEnv explains stdio env requirements when BW_HOST is missing', () => {
  const saved = { ...process.env };
  clearBwEnv();

  assert.throws(
    () => readBwEnv(),
    /stdio mode.*BW_HOST.*BW_PASSWORD.*BW_CLIENTID\+BW_CLIENTSECRET.*BW_USER\/BW_USERNAME.*X-BW-/is,
  );

  process.env = saved;
});

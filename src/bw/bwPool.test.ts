import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// bwPool depends on bwSession (which spawns real bw processes), so we can't
// fully unit-test getOrCreate without mocking the constructor.  We can,
// however, validate the input-validation and key-derivation logic by
// importing the class and calling getOrCreate with deliberately bad data.

import { BwSessionPool } from './bwPool.js';

describe('BwSessionPool validation', () => {
  test('rejects null payload', async () => {
    const pool = new BwSessionPool({ rootDir: '/tmp/pool-test' });
    await assert.rejects(() => pool.getOrCreate(null), /expected object/i);
  });

  test('rejects non-object payload', async () => {
    const pool = new BwSessionPool({ rootDir: '/tmp/pool-test' });
    await assert.rejects(() => pool.getOrCreate('string'), /expected object/i);
  });

  test('rejects missing host', async () => {
    const pool = new BwSessionPool({ rootDir: '/tmp/pool-test' });
    await assert.rejects(
      () =>
        pool.getOrCreate({
          password: 'pw',
          login: { method: 'userpass', user: 'u' },
        }),
      /missing host/i,
    );
  });

  test('rejects missing password', async () => {
    const pool = new BwSessionPool({ rootDir: '/tmp/pool-test' });
    await assert.rejects(
      () =>
        pool.getOrCreate({
          host: 'https://bw.test',
          login: { method: 'userpass', user: 'u' },
        }),
      /missing password/i,
    );
  });

  test('rejects missing login', async () => {
    const pool = new BwSessionPool({ rootDir: '/tmp/pool-test' });
    await assert.rejects(
      () =>
        pool.getOrCreate({
          host: 'https://bw.test',
          password: 'pw',
        }),
      /missing login/i,
    );
  });
});

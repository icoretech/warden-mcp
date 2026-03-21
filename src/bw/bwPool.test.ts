import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

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

describe('BwSessionPool integration', () => {
  async function createFakeBw(dir: string): Promise<string> {
    const scriptPath = join(dir, 'fake-bw');
    const script =
      '#!/bin/sh\nif echo "$*" | grep -q "config server"; then exit 0; fi\nif echo "$*" | grep -q "logout"; then exit 0; fi\nif echo "$*" | grep -q "unlock"; then printf "pool-session"; exit 0; fi\nprintf "{}"; exit 0\n';
    await writeFile(scriptPath, script, { mode: 0o755 });
    return scriptPath;
  }

  test('getOrCreate deduplicates by credentials (userpass)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-pool-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      process.env.BW_BIN = await createFakeBw(dir);
      const pool = new BwSessionPool({ rootDir: dir });
      const env = {
        host: 'https://bw.test',
        password: 'pw',
        unlockIntervalSeconds: 9999,
        login: { method: 'userpass' as const, user: 'u@test.com' },
      };
      const m1 = await pool.getOrCreate(env);
      const m2 = await pool.getOrCreate(env);
      assert.equal(m1, m2, 'same env should return same manager');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getOrCreate deduplicates by credentials (apikey)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-pool-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      process.env.BW_BIN = await createFakeBw(dir);
      const pool = new BwSessionPool({ rootDir: dir });
      const env = {
        host: 'https://bw.test',
        password: 'pw',
        unlockIntervalSeconds: 9999,
        login: {
          method: 'apikey' as const,
          clientId: 'user.abc',
          clientSecret: 'secret123',
        },
      };
      const m1 = await pool.getOrCreate(env);
      const m2 = await pool.getOrCreate(env);
      assert.equal(m1, m2, 'same apikey env should return same manager');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getOrCreate isolates different credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-pool-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      process.env.BW_BIN = await createFakeBw(dir);
      const pool = new BwSessionPool({ rootDir: dir });
      const env1 = {
        host: 'https://bw.test',
        password: 'pw1',
        unlockIntervalSeconds: 9999,
        login: { method: 'userpass' as const, user: 'a@test.com' },
      };
      const env2 = {
        host: 'https://bw.test',
        password: 'pw2',
        unlockIntervalSeconds: 9999,
        login: { method: 'userpass' as const, user: 'b@test.com' },
      };
      const m1 = await pool.getOrCreate(env1);
      const m2 = await pool.getOrCreate(env2);
      assert.notEqual(
        m1,
        m2,
        'different envs should return different managers',
      );
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { BwCliError, runBw } from './bwCli.js';
import { resolveBundledBwBin } from './resolveBwBin.js';

async function createScript(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, content, { mode: 0o755 });
  return p;
}

describe('runBw', () => {
  test('successful command returns stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(
        dir,
        'bw',
        '#!/bin/sh\nprintf "hello world"\n',
      );
      process.env.BW_BIN = bw;
      const result = await runBw(['test'], { timeoutMs: 5000 });
      assert.equal(result.stdout, 'hello world');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('captures stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(
        dir,
        'bw',
        '#!/bin/sh\nprintf "out"; printf "err" >&2\n',
      );
      process.env.BW_BIN = bw;
      const result = await runBw(['test'], { timeoutMs: 5000 });
      assert.equal(result.stdout, 'out');
      assert.equal(result.stderr, 'err');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('non-zero exit code throws BwCliError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(
        dir,
        'bw',
        '#!/bin/sh\nprintf "fail output" >&2\nexit 1\n',
      );
      process.env.BW_BIN = bw;
      try {
        await runBw(['test'], { timeoutMs: 5000 });
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(err instanceof BwCliError);
        assert.equal(err.exitCode, 1);
        assert.equal(err.stderr, 'fail output');
      }
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('auto-injects --nointeraction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      // Script that echoes args to stdout
      const bw = await createScript(dir, 'bw', '#!/bin/sh\necho "$@"\n');
      process.env.BW_BIN = bw;
      const result = await runBw(['status'], { timeoutMs: 5000 });
      assert.ok(result.stdout.includes('--nointeraction'));
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('does not double-inject --nointeraction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\necho "$@"\n');
      process.env.BW_BIN = bw;
      const result = await runBw(['--nointeraction', 'status'], {
        timeoutMs: 5000,
      });
      // Count occurrences of --nointeraction
      const matches = result.stdout.match(/--nointeraction/g);
      assert.equal(matches?.length, 1);
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('can skip --nointeraction injection when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\necho "$@"\n');
      process.env.BW_BIN = bw;
      const result = await runBw(['login', 'user@example.com'], {
        timeoutMs: 5000,
        noInteraction: false,
      });
      assert.ok(!result.stdout.includes('--nointeraction'));
      assert.ok(result.stdout.includes('login user@example.com'));
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('prefers bundled optional bw when BW_BIN is unset', async (t) => {
    const savedBin = process.env.BW_BIN;
    const savedPath = process.env.PATH;
    const bundled = resolveBundledBwBin();
    if (!bundled) {
      t.skip('bundled @bitwarden/cli is not installed in this environment');
      return;
    }

    try {
      delete process.env.BW_BIN;
      process.env.PATH = dirname(process.execPath);
      const result = await runBw(['--version'], { timeoutMs: 30_000 });
      assert.match(
        result.stdout,
        /\d{4}\.\d+\.\d+/,
        'runBw should resolve the bundled bw binary without relying on PATH',
      );
    } finally {
      process.env.BW_BIN = savedBin;
      process.env.PATH = savedPath;
    }
  });

  test('timeout kills process and throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nsleep 30\n');
      process.env.BW_BIN = bw;
      await assert.rejects(
        () => runBw(['slow'], { timeoutMs: 100 }),
        /timed out/,
      );
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('stdin is piped to process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\ncat\n');
      process.env.BW_BIN = bw;
      const result = await runBw(['encode'], {
        stdin: 'piped-input',
        timeoutMs: 5000,
      });
      assert.equal(result.stdout, 'piped-input');
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('debug mode logs and handles non-zero exit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    const savedDebug = process.env.KEYCHAIN_DEBUG_BW;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nexit 2\n');
      process.env.BW_BIN = bw;
      process.env.KEYCHAIN_DEBUG_BW = 'true';
      try {
        await runBw(['test'], { timeoutMs: 5000 });
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(err instanceof BwCliError);
        assert.equal(err.exitCode, 2);
      }
    } finally {
      process.env.BW_BIN = savedBin;
      process.env.KEYCHAIN_DEBUG_BW = savedDebug;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('debug mode logs successful commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    const savedDebug = process.env.KEYCHAIN_DEBUG_BW;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nprintf "ok"\n');
      process.env.BW_BIN = bw;
      process.env.KEYCHAIN_DEBUG_BW = 'true';
      const result = await runBw(['test'], { timeoutMs: 5000 });
      assert.equal(result.stdout, 'ok');
    } finally {
      process.env.BW_BIN = savedBin;
      process.env.KEYCHAIN_DEBUG_BW = savedDebug;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('BwCliError exposes stdout and stderr', () => {
    const err = new BwCliError('test error', {
      exitCode: 42,
      stdout: 'out',
      stderr: 'err',
    });
    assert.equal(err.name, 'BwCliError');
    assert.equal(err.exitCode, 42);
    assert.equal(err.stdout, 'out');
    assert.equal(err.stderr, 'err');
    assert.ok(err.message.includes('test error'));
  });

  test('redacts --session value in debug error messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    const savedDebug = process.env.KEYCHAIN_DEBUG_BW;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nexit 1\n');
      process.env.BW_BIN = bw;
      process.env.KEYCHAIN_DEBUG_BW = 'true';
      try {
        await runBw(['--session', 'super-secret-token', 'status'], {
          timeoutMs: 5000,
        });
        assert.fail('should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        assert.ok(
          !msg.includes('super-secret-token'),
          'error message must not contain session token',
        );
        assert.ok(msg.includes('<redacted>'));
      }
    } finally {
      process.env.BW_BIN = savedBin;
      process.env.KEYCHAIN_DEBUG_BW = savedDebug;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('redacts long arguments in error messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nexit 1\n');
      process.env.BW_BIN = bw;
      const longArg = 'x'.repeat(100);
      try {
        await runBw(['create', 'item', longArg], { timeoutMs: 5000 });
        assert.fail('should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        assert.ok(
          !msg.includes(longArg),
          'error message must not contain long argument',
        );
        assert.ok(msg.includes('<redacted>'));
      }
    } finally {
      process.env.BW_BIN = savedBin;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('debug error path tolerates non-string argv values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-cli-test-'));
    const savedBin = process.env.BW_BIN;
    const savedDebug = process.env.KEYCHAIN_DEBUG_BW;
    try {
      const bw = await createScript(dir, 'bw', '#!/bin/sh\nexit 1\n');
      process.env.BW_BIN = bw;
      process.env.KEYCHAIN_DEBUG_BW = 'true';
      await assert.rejects(
        () =>
          runBw(['config', 'server', undefined] as unknown as string[], {
            timeoutMs: 5000,
          }),
        (err: unknown) => {
          assert.ok(err instanceof BwCliError);
          assert.equal(err.exitCode, 1);
          return true;
        },
      );
    } finally {
      process.env.BW_BIN = savedBin;
      process.env.KEYCHAIN_DEBUG_BW = savedDebug;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

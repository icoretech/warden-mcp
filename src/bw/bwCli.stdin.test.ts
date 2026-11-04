import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BwCliError, BwCliStdinError, runBw } from './bwCli.js';

const input = 'input-data-'.repeat(1024 * 1024);

test('early stdin closure preserves the CLI failure', async (t) => {
  const savedBin = process.env.BW_BIN;
  process.env.BW_BIN = process.execPath;
  t.after(() => {
    if (savedBin === undefined) delete process.env.BW_BIN;
    else process.env.BW_BIN = savedBin;
  });

  await assert.rejects(
    runBw(
      [
        '-e',
        "process.stdin.destroy(); process.stderr.write('command rejected'); process.exit(23)",
      ],
      { stdin: input, noInteraction: false, timeoutMs: 5_000 },
    ),
    (error: unknown) => {
      assert.ok(error instanceof BwCliError);
      assert.equal(error.exitCode, 23);
      assert.equal(error.stderr, 'command rejected');
      return true;
    },
  );
});

test('early stdin closure cannot report successful input delivery', async (t) => {
  const savedBin = process.env.BW_BIN;
  process.env.BW_BIN = process.execPath;
  t.after(() => {
    if (savedBin === undefined) delete process.env.BW_BIN;
    else process.env.BW_BIN = savedBin;
  });

  await assert.rejects(
    runBw(['-e', 'process.stdin.destroy(); process.exit(0)'], {
      stdin: input,
      noInteraction: false,
      timeoutMs: 5_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof BwCliStdinError);
      assert.equal(error.message, 'Failed to write input to bw CLI');
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('a missing executable with stdin retains the spawn error', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-cli-stdin-'));
  const savedBin = process.env.BW_BIN;
  process.env.BW_BIN = join(dir, 'missing-bw');
  t.after(async () => {
    if (savedBin === undefined) delete process.env.BW_BIN;
    else process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    runBw(['status'], { stdin: input, timeoutMs: 5_000 }),
    /bw CLI not available.*Install @bitwarden\/cli.*BW_BIN/s,
  );
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BwCliError, runBw } from './bwCli.js';

for (const exitCode of [0, 7]) {
  test(`early stdin closure preserves CLI exit code ${exitCode}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-early-stdin-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const saved = process.env.BW_BIN;
    t.after(() => {
      if (saved === undefined) delete process.env.BW_BIN;
      else process.env.BW_BIN = saved;
    });
    const script = join(dir, 'early-exit.mjs');
    await writeFile(
      script,
      [
        "import { closeSync } from 'node:fs';",
        'closeSync(0);',
        "process.stdout.write('early stdout');",
        "process.stderr.write('early stderr');",
        `process.exitCode = ${exitCode};`,
      ].join('\n'),
    );
    process.env.BW_BIN = process.execPath;
    const operation = runBw([script], {
      noInteraction: false,
      stdin: 'x'.repeat(8 * 1024 * 1024),
      timeoutMs: 10_000,
    });
    if (exitCode === 0) {
      const result = await operation;
      assert.equal(result.stdout, 'early stdout');
      assert.equal(result.stderr, 'early stderr');
    } else {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof BwCliError);
        assert.equal(error.exitCode, exitCode);
        assert.equal(error.stdout, 'early stdout');
        assert.equal(error.stderr, 'early stderr');
        return true;
      });
    }
  });
}

test('missing CLI with stdin reports spawn failure', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-missing-stdin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = process.env.BW_BIN;
  t.after(() => {
    if (saved === undefined) delete process.env.BW_BIN;
    else process.env.BW_BIN = saved;
  });
  process.env.BW_BIN = join(dir, 'missing-bw');
  await assert.rejects(
    runBw(['status'], { stdin: 'x'.repeat(1024 * 1024), timeoutMs: 5_000 }),
    /bw CLI not available/,
  );
});

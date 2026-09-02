import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';

import { BwCliError, runBw } from './bwCli.js';
import { renderSafeBwCommand } from './bwCommandDisplay.js';

test('Vaultwarden policy date failures expose a safe diagnostic code', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-cli-diagnostic-test-'));
  const savedBin = process.env.BW_BIN;
  const sensitiveDetail = 'sensitive-cli-detail';
  try {
    const bw = join(dir, 'bw');
    await writeFile(
      bw,
      `#!/bin/sh
printf "Error getting vault timeout: RangeError: Invalid time value\\nno elements in sequence\\n${sensitiveDetail}\\n" >&2
exit 1
`,
      { mode: 0o755 },
    );
    process.env.BW_BIN = bw;

    await assert.rejects(
      () => runBw(['list', 'items'], { timeoutMs: 5_000 }),
      (error: unknown) => {
        assert.ok(error instanceof BwCliError);
        assert.equal(error.diagnosticCode, 'VAULTWARDEN_POLICY_REVISION_DATE');
        assert.match(error.message, /VAULTWARDEN_POLICY_REVISION_DATE/);
        assert.ok(!error.message.includes(sensitiveDetail));
        return true;
      },
    );
  } finally {
    process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  }
});

test('search terms are redacted in both supported option forms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-cli-diagnostic-test-'));
  const savedBin = process.env.BW_BIN;
  try {
    const bw = join(dir, 'bw');
    await writeFile(bw, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.BW_BIN = bw;

    await assert.rejects(
      () =>
        runBw(
          [
            'list',
            'items',
            '--search',
            'internal-search-term',
            '--search=equals-search-term',
          ],
          { timeoutMs: 5_000 },
        ),
      (error: unknown) => {
        assert.ok(error instanceof BwCliError);
        assert.ok(!error.message.includes('internal-search-term'));
        assert.ok(!error.message.includes('equals-search-term'));
        assert.match(error.message, /--search <redacted>/);
        assert.match(error.message, /--search=<redacted>/);
        return true;
      },
    );
  } finally {
    process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  }
});

test('positional values and the local executable path are redacted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-cli-diagnostic-test-'));
  const savedBin = process.env.BW_BIN;
  try {
    const bw = join(dir, 'private-bw-path');
    await writeFile(bw, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.BW_BIN = bw;

    await assert.rejects(
      () =>
        runBw(
          [
            'get',
            'item',
            'internal-item-id',
            '--url',
            'https://internal.example.test/private',
          ],
          { timeoutMs: 5_000 },
        ),
      (error: unknown) => {
        assert.ok(error instanceof BwCliError);
        assert.ok(!error.message.includes(dir));
        assert.ok(!error.message.includes('internal-item-id'));
        assert.ok(!error.message.includes('internal.example.test'));
        assert.match(
          error.message,
          /^private-bw-path --nointeraction get item <redacted>/,
        );
        return true;
      },
    );
  } finally {
    process.env.BW_BIN = savedBin;
    await rm(dir, { recursive: true, force: true });
  }
});

test('BwCliError raw streams are readable but not enumerable or inspected', () => {
  const error = new BwCliError('safe message', {
    exitCode: 1,
    stdout: 'private-stdout',
    stderr: 'private-stderr',
  });

  assert.equal(error.stdout, 'private-stdout');
  assert.equal(error.stderr, 'private-stderr');
  assert.ok(!JSON.stringify(error).includes('private-stdout'));
  assert.ok(!JSON.stringify(error).includes('private-stderr'));
  assert.ok(!inspect(error).includes('private-stdout'));
  assert.ok(!inspect(error).includes('private-stderr'));
});

test('command words in payload positions are always redacted', () => {
  assert.equal(
    renderSafeBwCommand('/Users/private/bin/bw', [
      '--nointeraction',
      'send',
      '--',
      'create',
    ]),
    'bw --nointeraction send -- <redacted>',
  );
  assert.equal(
    renderSafeBwCommand('/Users/private/bin/bw', ['send', '--text', 'get']),
    'bw send <redacted> <redacted>',
  );
  assert.equal(
    renderSafeBwCommand('/Users/private/bin/bw', [
      'send',
      '--file',
      'payload.bin',
      '--name',
      'delete',
    ]),
    'bw send --file <redacted> <redacted> <redacted>',
  );
});

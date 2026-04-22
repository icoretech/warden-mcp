import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('http entrypoint stays alive after startup', {
  timeout: 10_000,
}, async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  await Promise.race([
    new Promise<void>((resolve) => {
      const checkReady = () => {
        if (
          stdout.includes('[warden-mcp] listening on http://localhost:0/sse')
        ) {
          resolve();
          return;
        }
        setTimeout(checkReady, 25);
      };
      checkReady();
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`server did not report startup: ${stdout} ${stderr}`),
          ),
        4_000,
      ),
    ),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(child.exitCode, null, `server exited unexpectedly: ${stderr}`);
  assert.equal(stderr, '');

  child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
});

test('stdio bin exits cleanly without unsettled top-level await warning', {
  timeout: 10_000,
}, async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'warden-stdio-exit-'));
  const bwScript = join(dir, 'fake-bw');
  await writeFile(
    bwScript,
    `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then printf 'Vault is unlocked!'; exit 0; fi
if echo "$*" | grep -q 'unlock'; then printf 'exit-session-token'; exit 0; fi
if echo "$*" | grep -q 'status'; then
  printf '%s' '{"serverUrl":"https://example.test","userEmail":"user@example.test","status":"unlocked"}'
  exit 0
fi
printf '%s' '{}'
exit 0
`,
    { mode: 0o755 },
  );
  const child = spawn(process.execPath, ['bin/warden-mcp.js', '--stdio'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BW_BIN: bwScript,
      BW_HOST: 'https://example.test',
      BW_PASSWORD: 'test-password',
      BW_USER: 'user@example.test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });

  assert.equal(
    exitCode,
    0,
    `stdio bin exited with stderr: ${stderr || stdout}`,
  );
  assert.equal(stdout, '');
  assert.ok(
    !stderr.includes('Detected unsettled top-level await'),
    `unexpected warning: ${stderr}`,
  );
  await rm(dir, { recursive: true, force: true });
});

test('stdio startup does not unlock before first tool call', {
  timeout: 15_000,
}, async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'warden-stdio-warmup-'));
  const bwScript = join(dir, 'fake-bw');
  const unlockCounterFile = join(dir, 'unlock-count');
  await writeFile(unlockCounterFile, '0');
  await writeFile(
    bwScript,
    `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then printf 'Vault is unlocked!'; exit 0; fi
if echo "$*" | grep -q 'unlock'; then
  count=$(cat "${unlockCounterFile}")
  count=$((count + 1))
  echo "$count" > "${unlockCounterFile}"
  printf 'warm-session-token'
  exit 0
fi
    if echo "$*" | grep -q 'status'; then
      printf '%s' '{"serverUrl":"https://example.test","userEmail":"user@example.test","status":"locked"}'
      exit 0
    fi
printf '%s' '{}'
exit 0
`,
    { mode: 0o755 },
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/warden-mcp.js', '--stdio'],
    cwd: projectRoot,
    env: {
      ...process.env,
      BW_BIN: bwScript,
      BW_HOST: 'https://example.test',
      BW_PASSWORD: 'test-password',
      BW_USER: 'user@example.test',
      BW_UNLOCK_INTERVAL: '300',
      HOME: dir,
    },
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'stdio-warmup-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const unlocksBeforeCall = Number.parseInt(
      await readFile(unlockCounterFile, 'utf8'),
      10,
    );
    assert.equal(
      unlocksBeforeCall,
      0,
      `expected stdio startup to avoid unlock before first tool call, got ${unlocksBeforeCall}`,
    );

    const result = await client.callTool(
      { name: 'keychain_status', arguments: {} },
      undefined,
      { timeout: 30_000 },
    );
    const status = (result.structuredContent ?? {}) as {
      status?: { status?: string };
    };
    assert.equal(status.status?.status, 'locked');
    const unlocksAfterCall = Number.parseInt(
      await readFile(unlockCounterFile, 'utf8'),
      10,
    );
    assert.equal(
      unlocksAfterCall,
      0,
      `expected keychain_status to avoid unlock, got ${unlocksAfterCall}`,
    );
  } finally {
    await client.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

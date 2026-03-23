import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  const child = spawn(process.execPath, ['bin/warden-mcp.js', '--stdio'], {
    cwd: projectRoot,
    env: {
      ...process.env,
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
});

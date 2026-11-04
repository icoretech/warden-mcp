import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';

import { BwSessionManager } from './bwSession.js';

test('authenticated children isolate sessions from argv, logs and parent env', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-env-'));
  const savedEnv = { ...process.env };
  process.env.BW_BIN = process.execPath;
  process.env.BW_SESSION = 'parent-session';
  process.env.KEYCHAIN_DEBUG_BW = 'true';
  t.after(async () => {
    process.env = savedEnv;
    await rm(dir, { recursive: true, force: true });
  });
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });
  const manager = new BwSessionManager({
    host: 'https://vault.example.com',
    password: 'example-password',
    unlockIntervalSeconds: 300,
    login: { method: 'userpass', user: 'user@example.com' },
    homeDir: dir,
  });
  const env = { BW_SESSION: 'caller-session', EXAMPLE_VALUE: 'kept' };
  const command = [
    '-e',
    'process.stdout.write(JSON.stringify({session:process.env.BW_SESSION,args:process.argv.slice(1),value:process.env.EXAMPLE_VALUE}))',
    'example-argument',
  ];

  const results = await Promise.all(
    ['child-session-a', 'child-session-b'].map((session) =>
      manager.runForSession(session, command, {
        env,
        noInteraction: false,
      }),
    ),
  );

  const output = z.object({
    session: z.string(),
    args: z.array(z.string()),
    value: z.string(),
  });
  assert.deepEqual(
    results.map((result) => output.parse(JSON.parse(result.stdout))),
    [
      {
        session: 'child-session-a',
        args: ['example-argument'],
        value: 'kept',
      },
      {
        session: 'child-session-b',
        args: ['example-argument'],
        value: 'kept',
      },
    ],
  );
  assert.equal(process.env.BW_SESSION, 'parent-session');
  assert.equal(env.BW_SESSION, 'caller-session');
  for (const session of ['child-session-a', 'child-session-b']) {
    assert.equal(logs.join('\n').includes(session), false);
  }
});

test('template reads and session validation authenticate through child env', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-env-'));
  const savedEnv = { ...process.env };
  const bw = join(dir, 'bw');
  const checkedPath = join(dir, 'checked');
  await writeFile(
    bw,
    `#!/bin/sh
case "$*" in
  *--session*) exit 89 ;;
  *'unlock --check'*)
    [ "$BW_SESSION" = 'example-session' ] || exit 88
    printf 'checked' > '${checkedPath}'
    exit 0 ;;
  *unlock*) printf 'example-session'; exit 0 ;;
  *'get template item'*)
    [ "$BW_SESSION" = 'example-session' ] || exit 88
    printf '{"type":1,"name":""}'
    exit 0 ;;
  *status*) printf '{"status":"locked","serverUrl":"https://vault.example.com"}'; exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.BW_BIN = bw;
  process.env.BW_SESSION = 'unrelated-parent-session';
  t.after(async () => {
    process.env = savedEnv;
    await rm(dir, { recursive: true, force: true });
  });
  const manager = new BwSessionManager({
    host: 'https://vault.example.com',
    password: 'example-password',
    unlockIntervalSeconds: 300,
    login: { method: 'userpass', user: 'user@example.com' },
    homeDir: dir,
  });

  assert.deepEqual(await manager.getTemplateItem(), { type: 1, name: '' });
  assert.deepEqual(await manager.getTemplateItem(), { type: 1, name: '' });

  assert.equal(await readFile(checkedPath, 'utf8'), 'checked');
  assert.equal(process.env.BW_SESSION, 'unrelated-parent-session');
});

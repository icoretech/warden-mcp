import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BwSessionManager } from './bwSession.js';

test('session commands keep keys out of argv and isolate child environments', {
  skip: process.platform === 'win32',
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bw-session-argv-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  const logPath = join(dir, 'calls.jsonl');
  const script = join(dir, 'fake-bw.mjs');
  await writeFile(
    script,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs';",
      "const args = process.argv.slice(2).filter(x => x !== '--nointeraction');",
      'const call = { args, session: process.env.BW_SESSION };',
      "appendFileSync(process.env.BW_CALL_LOG, JSON.stringify(call) + '\\n');",
      "if (args.includes('--session')) process.exit(23);",
      "if (args[0] === 'status') console.log(JSON.stringify({status:'locked', serverUrl:'https://vault.example.test'}));",
      "else if (args[0] === 'unlock' && !args.includes('--check')) process.stdout.write('test-session-current');",
      "else if (args[0] === 'unlock') process.exit(process.env.BW_SESSION === 'test-session-current' ? 0 : 24);",
      "else if (args[0] === 'get') console.log(JSON.stringify({type:1}));",
      "else if (args[0] === 'echo') console.log(JSON.stringify(call));",
    ].join('\n'),
    { mode: 0o755 },
  );
  process.env.BW_BIN = script;
  process.env.BW_CALL_LOG = logPath;
  process.env.BW_SESSION = 'parent-session-unchanged';
  process.env.KEYCHAIN_DEBUG_BW = 'true';
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: string) => messages.push(message));
  const manager = new BwSessionManager({
    host: 'https://vault.example.test',
    password: 'synthetic-master',
    login: { method: 'userpass', user: 'synthetic@example.test' },
    unlockIntervalSeconds: 300,
    homeDir: dir,
  });
  assert.equal(
    await manager.withSession(async (session) => session),
    'test-session-current',
  );
  await manager.withSession(async () => undefined);
  assert.deepEqual(await manager.getTemplateItem(), { type: 1 });
  const keys = ['test-session-a', 'test-session-b', 'test-session-c'];
  await Promise.all(
    keys.map(async (key) => {
      const result = await manager.runForSession(key, ['echo'], {
        env: { BW_SESSION: 'caller-must-not-override', EXTRA_OPTION: 'kept' },
      });
      const call = JSON.parse(result.stdout);
      assert.deepEqual(call, { args: ['echo'], session: key });
    }),
  );
  assert.equal(process.env.BW_SESSION, 'parent-session-unchanged');
  const calls = (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { args: string[]; session?: string });
  assert.ok(
    calls.some((call) => call.args.includes('--check')),
    'exercise cached-session validation',
  );
  assert.ok(calls.some((call) => call.args[0] === 'get'));
  for (const call of calls) {
    assert.ok(!call.args.includes('--session'));
    assert.ok(!call.args.some((arg) => arg.startsWith('test-session-')));
    if (call.args[0] === 'get' || call.args.includes('--check'))
      assert.equal(call.session, 'test-session-current');
  }
  assert.doesNotMatch(messages.join('\n'), /test-session-|synthetic-master/);
});

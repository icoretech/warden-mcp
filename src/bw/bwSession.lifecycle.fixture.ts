import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import type { BwEnv, BwSessionConfig } from './bwSession.js';

export function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export async function sessionFixture(t: TestContext) {
  const homeDir = await mkdtemp(join(tmpdir(), 'bw-lifecycle-'));
  const appDataDir = join(homeDir, '.bitwarden-cli');
  const savedBin = process.env.BW_BIN;
  await mkdir(appDataDir);
  const binary = join(homeDir, 'fixture-bw');
  await writeFile(
    binary,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.BITWARDENCLI_APPDATA_DIR;
const args = process.argv.slice(2).filter((a) => a !== '--nointeraction');
const file = (name) => path.join(dir, name);
const read = (name) => fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : '';
const write = (name, value) => fs.writeFileSync(file(name), value);
const count = (name) => { const value = Number(read(name) || '0') + 1; write(name, String(value)); return value; };
const pause = async (name) => {
  if (!read('pause-' + name)) return;
  await new Promise((resolve) => {
    const release = () => {
      if (!read('release-' + name)) return;
      watcher.close(); resolve();
    };
    const watcher = fs.watch(dir, release);
    write(name + '-started', 'yes');
    release();
  });
};
(async () => {
fs.appendFileSync(file('operations'), args[0] + '\\n');
if (args[0] === 'status') { await pause('status'); console.log(JSON.stringify({status:'locked',serverUrl:'https://vault.example.test'})); process.exit(0); }
if (args[0] === 'config') { write('data.json', JSON.stringify({global_environment_environment:{urls:{base:args[2]}}})); process.exit(0); }
if (args[0] === 'logout') { process.exit(0); }
if (args[0] === 'lock') {
  count('locks');
  if (read('fail-lock')) { console.error('private cli failure detail'); process.exit(1); }
  if (!read('lock-preserves-key')) write('active', ''); process.exit(0);
}
if (args[0] === 'unlock' && args.includes('--check')) {
  const valid = process.env.BW_SESSION && process.env.BW_SESSION === read('active');
  await pause('check');
  process.exit(valid ? 0 : 1);
}
if (args[0] === 'login') {
  if (args.includes('--apikey') && process.env.BW_CLIENTID === 'client.example' && process.env.BW_CLIENTSECRET === 'api-secret') {
    write('logged-in', 'yes'); process.exit(0);
  }
  process.exit(1);
}
if (args[0] === 'unlock') {
  count('unlocks');
  if (process.env.BW_PASSWORD !== 'master-password' || (read('require-login') && !read('logged-in'))) { process.exit(1); }
  const session = 'session-' + count('sessions'); write('active', session); process.stdout.write(session); process.exit(0);
}
if (args.join(' ') === 'get template item') {
  console.log(JSON.stringify({revision:count('templates')})); process.exit(0);
}
console.error('unknown fixture command'); process.exit(1);
})().catch(() => { console.error('fixture command failed'); process.exit(1); });
`,
    { mode: 0o755 },
  );
  process.env.BW_BIN = binary;
  t.after(async () => {
    if (savedBin === undefined) delete process.env.BW_BIN;
    else process.env.BW_BIN = savedBin;
    await rm(homeDir, { recursive: true, force: true });
  });
  const config = {
    host: 'https://vault.example.test',
    login: { method: 'userpass', user: 'user@example.test' },
    unlockIntervalSeconds: 10,
    homeDir,
  } satisfies BwSessionConfig;
  const credentials: BwEnv = { ...config, password: 'master-password' };
  return {
    config,
    credentials,
    cachePath: join(appDataDir, '.warden-mcp-session.json'),
    async counter(name: string) {
      const value = await readFile(join(appDataDir, name), 'utf8').catch(
        (error: unknown) => {
          assert.ok(error instanceof Error && 'code' in error);
          if (error.code === 'ENOENT') return '0';
          throw error;
        },
      );
      return Number(value);
    },
    async write(name: string, value: string) {
      await writeFile(join(appDataDir, name), value);
    },
    async waitFor(name: string): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const watcher = watch(appDataDir, (_event, filename) => {
          if (filename === name) finish();
        });
        const timeout = setTimeout(() => {
          watcher.close();
          reject(new Error(`Timed out waiting for fixture event ${name}`));
        }, 5_000);
        const finish = () => {
          clearTimeout(timeout);
          watcher.close();
          resolve();
        };
        watcher.on('error', (error) => {
          clearTimeout(timeout);
          watcher.close();
          reject(error);
        });
        void access(join(appDataDir, name)).then(finish, (error: unknown) => {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return;
          clearTimeout(timeout);
          watcher.close();
          reject(error);
        });
      });
    },
  };
}

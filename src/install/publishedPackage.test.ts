import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';

import packageJson from '../../package.json' with { type: 'json' };

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

test('published package installs the vetted CLI dependency tree in a clean consumer', {
  timeout: 120_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'warden-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await run(
    process.execPath,
    ['scripts/package-release.mjs', '--pack-destination', directory],
    { cwd: projectRoot },
  );
  const archive = z
    .string()
    .regex(/\.tgz$/)
    .parse(stdout.trim());
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'package-install-contract', private: true }),
  );

  await run(
    'npm',
    [
      'install',
      '--prefer-offline',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      archive,
    ],
    { cwd: directory, timeout: 90_000 },
  );

  const consumerRequire = createRequire(join(directory, 'package.json'));
  const installedManifest = consumerRequire.resolve(
    `${packageJson.name}/package.json`,
  );
  const installed = z
    .object({ version: z.string(), private: z.literal(false) })
    .parse(JSON.parse(await readFile(installedManifest, 'utf8')));
  assert.equal(installed.version, packageJson.version);
  const installedRequire = createRequire(installedManifest);
  await run('npm', ['ls', '--all', '--omit=dev', '--json'], {
    cwd: directory,
    maxBuffer: 8 * 1024 * 1024,
  });
  const cliManifest = installedRequire.resolve('@bitwarden/cli/package.json');
  const cli = z
    .object({ version: z.string(), bin: z.object({ bw: z.string() }) })
    .parse(JSON.parse(await readFile(cliManifest, 'utf8')));
  assert.equal(cli.version, packageJson.dependencies['@bitwarden/cli']);
  const cliRequire = createRequire(cliManifest);
  const forgeManifest = cliRequire.resolve('node-forge/package.json');
  const forge = z
    .object({ version: z.string() })
    .parse(JSON.parse(await readFile(forgeManifest, 'utf8')));

  assert.equal(forge.version, packageJson.overrides['node-forge']);
  const result = await run(process.execPath, [
    join(dirname(cliManifest), cli.bin.bw),
    '--version',
  ]);
  assert.equal(result.stdout.trim(), cli.version);
});

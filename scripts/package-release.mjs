#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const dependencies = z.record(z.string(), z.string());
const manifestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    dependencies: dependencies.optional(),
    optionalDependencies: dependencies.optional(),
    peerDependencies: dependencies.optional(),
  })
  .passthrough();
const policySchema = z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/));

class ReleaseAssemblyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseAssemblyError';
  }
}

async function manifest(path) {
  return manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

async function packageDirectories(modulesPath) {
  const entries = await readdir(modulesPath, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) {
      throw new ReleaseAssemblyError(
        `Linked dependency cannot be bundled: ${entry.name}`,
      );
    }
    if (!entry.isDirectory()) continue;
    const path = join(modulesPath, entry.name);
    if (entry.name.startsWith('@')) {
      directories.push(...(await packageDirectories(path)));
    } else {
      directories.push(path);
    }
  }
  return directories;
}

async function installedManifest(ownerPath, name) {
  const search = createRequire(ownerPath).resolve.paths(name) ?? [];
  for (const directory of search) {
    try {
      const path = join(directory, name, 'package.json');
      return { path, data: await manifest(path) };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
  throw new ReleaseAssemblyError(`Dependency is not installed: ${name}`);
}

async function reconcileDependencies(staging, policy) {
  const edits = [];
  const encountered = new Set();
  const queue = await packageDirectories(join(staging, 'node_modules'));
  for (const directory of queue) {
    const ownerPath = join(directory, 'package.json');
    const data = await manifest(ownerPath);
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const entries = dependencies.optional().parse(data[field]);
      for (const [name, requirement] of Object.entries(entries ?? {})) {
        const expected = policy[name];
        if (expected === undefined) continue;
        const installed = await installedManifest(ownerPath, name);
        const installedRelative = relative(staging, installed.path);
        if (
          isAbsolute(installedRelative) ||
          installedRelative.startsWith('..') ||
          installed.data.version !== expected
        ) {
          throw new ReleaseAssemblyError(
            `Installed ${name} does not match release policy ${expected}`,
          );
        }
        encountered.add(name);
        if (requirement === expected) continue;
        entries[name] = expected;
        edits.push({
          package: data.name,
          version: data.version,
          field,
          dependency: name,
          from: requirement,
          to: expected,
        });
      }
      if (entries !== undefined) data[field] = entries;
    }
    await writeFile(ownerPath, `${JSON.stringify(data, null, 2)}\n`);
    const nested = join(directory, 'node_modules');
    try {
      queue.push(...(await packageDirectories(nested)));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
  for (const name of Object.keys(policy)) {
    if (!encountered.has(name))
      throw new ReleaseAssemblyError(
        `Release policy has no dependency edge: ${name}`,
      );
  }
  return edits;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--pack-destination') {
    throw new ReleaseAssemblyError(
      'Usage: node scripts/package-release.mjs --pack-destination PATH',
    );
  }
  const destination = resolve(args[1]);
  const source = await manifest(join(root, 'package.json'));
  const policy = policySchema.parse(source.overrides);
  const staging = await mkdtemp(join(tmpdir(), 'warden-release-'));
  try {
    await mkdir(destination, { recursive: true });
    for (const path of ['dist', 'bin', 'README.md', 'LICENSE']) {
      await cp(join(root, path), join(staging, path), { recursive: true });
    }
    await cp(join(root, 'node_modules'), join(staging, 'node_modules'), {
      recursive: true,
    });
    await rm(join(staging, 'node_modules', '.package-lock.json'), {
      force: true,
    });
    const edits = await reconcileDependencies(staging, policy);
    const cli = await installedManifest(
      join(staging, 'package.json'),
      '@bitwarden/cli',
    );
    const packaged = {
      ...source,
      private: false,
      bundleDependencies: ['@bitwarden/cli'],
      scripts: { postinstall: 'node bin/patch-bitwarden-cli.js' },
    };
    delete packaged.overrides;
    delete packaged.devDependencies;
    packaged.files = [
      ...z.array(z.string()).parse(source.files),
      'bundled-dependency-policy.json',
    ];
    await writeFile(
      join(staging, 'package.json'),
      `${JSON.stringify(packaged, null, 2)}\n`,
    );
    const provenance = {
      version: 1,
      upstream: { name: cli.data.name, version: cli.data.version },
      overrides: policy,
      edits,
    };
    await writeFile(
      join(staging, 'bundled-dependency-policy.json'),
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
    await run('npm', ['ls', '--all', '--omit=dev', '--json'], {
      cwd: staging,
      maxBuffer: 8 * 1024 * 1024,
    });
    const { stdout } = await run(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--loglevel=error',
        '--pack-destination',
        destination,
      ],
      { cwd: staging, timeout: 120_000 },
    );
    const filename = z
      .string()
      .regex(/^[\w.-]+\.tgz$/)
      .parse(stdout.trim());
    process.stdout.write(`${join(destination, filename)}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (!(error instanceof Error)) throw error;
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});

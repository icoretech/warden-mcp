import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  resolveBundledBwBin,
  resolveBundledBwCandidate,
} from './resolveBwBin.js';

test('resolveBundledBwCandidate uses named bw bin entry when present', () => {
  const actual = resolveBundledBwCandidate(
    '/tmp/pkg/node_modules/@bitwarden/cli/package.json',
    { bw: 'build/bw.js' },
  );

  assert.equal(actual, '/tmp/pkg/node_modules/@bitwarden/cli/build/bw.js');
});

test('resolveBundledBwCandidate uses string bin entry when present', () => {
  const actual = resolveBundledBwCandidate(
    '/tmp/pkg/node_modules/@bitwarden/cli/package.json',
    'bin/cli.js',
  );

  assert.equal(actual, '/tmp/pkg/node_modules/@bitwarden/cli/bin/cli.js');
});

test('resolveBundledBwCandidate falls back to legacy dist path', () => {
  const actual = resolveBundledBwCandidate(
    '/tmp/pkg/node_modules/@bitwarden/cli/package.json',
    undefined,
  );

  assert.equal(actual, '/tmp/pkg/node_modules/@bitwarden/cli/dist/bw');
});

test('resolveBundledBwBin returns executable bundled bw path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resolve-bw-bin-'));
  try {
    const pkgManifest = join(dir, 'node_modules/@bitwarden/cli/package.json');
    const binPath = join(dirname(pkgManifest), 'bin/bw.js');
    await mkdir(dirname(pkgManifest), { recursive: true });
    await mkdir(dirname(binPath), { recursive: true });
    await writeFile(
      pkgManifest,
      JSON.stringify({ bin: { bw: 'bin/bw.js' } }),
      'utf8',
    );
    await writeFile(binPath, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(binPath, 0o755);

    const actual = resolveBundledBwBin(() => pkgManifest);
    assert.equal(actual, binPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveBundledBwBin returns null for non-executable candidate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resolve-bw-bin-'));
  try {
    const pkgManifest = join(dir, 'node_modules/@bitwarden/cli/package.json');
    const binPath = join(dirname(pkgManifest), 'bin/bw.js');
    await mkdir(dirname(pkgManifest), { recursive: true });
    await mkdir(dirname(binPath), { recursive: true });
    await writeFile(
      pkgManifest,
      JSON.stringify({ bin: { bw: 'bin/bw.js' } }),
      'utf8',
    );
    await writeFile(binPath, '#!/bin/sh\nexit 0\n', 'utf8');

    const actual = resolveBundledBwBin(() => pkgManifest);
    assert.equal(actual, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

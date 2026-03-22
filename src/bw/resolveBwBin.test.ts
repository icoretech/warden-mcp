import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBundledBwCandidate } from './resolveBwBin.js';

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

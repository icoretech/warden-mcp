import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBwGenerateArgs } from './generateArgs.js';

test('buildBwGenerateArgs: default uses bw defaults (no charset flags)', () => {
  assert.deepEqual(buildBwGenerateArgs({}), ['--raw', 'generate']);
});

test('buildBwGenerateArgs: ambiguous does not force explicit charset mode', () => {
  assert.deepEqual(buildBwGenerateArgs({ ambiguous: true }), [
    '--raw',
    'generate',
    '--ambiguous',
  ]);
});

test('buildBwGenerateArgs: toggling special on keeps UI defaults for other charsets', () => {
  assert.deepEqual(buildBwGenerateArgs({ special: true }), [
    '--raw',
    'generate',
    '--uppercase',
    '--lowercase',
    '--number',
    '--special',
  ]);
});

test('buildBwGenerateArgs: explicit charset exclusions are respected', () => {
  assert.deepEqual(
    buildBwGenerateArgs({
      special: true,
      uppercase: false,
      lowercase: false,
      number: false,
    }),
    ['--raw', 'generate', '--special'],
  );
});

test('buildBwGenerateArgs: passphrase mode ignores charset flags', () => {
  assert.deepEqual(
    buildBwGenerateArgs({
      passphrase: true,
      words: 4,
      separator: '_',
      includeNumber: true,
      // should be ignored in passphrase mode:
      special: true,
    }),
    [
      '--raw',
      'generate',
      '--passphrase',
      '--words',
      '4',
      '--separator',
      '_',
      '--includeNumber',
    ],
  );
});

test('buildBwGenerateArgs: throws if all charsets explicitly disabled', () => {
  assert.throws(() =>
    buildBwGenerateArgs({
      uppercase: false,
      lowercase: false,
      number: false,
      special: false,
    }),
  );
});

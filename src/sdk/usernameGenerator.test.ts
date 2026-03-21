import assert from 'node:assert/strict';
import test from 'node:test';
import { generateUsername } from './usernameGenerator.js';

test('generateUsername: random_word default', () => {
  const v = generateUsername({}, { randInt: () => 0 });
  assert.ok(typeof v === 'string' && v.length > 0);
  assert.ok(!v.includes('@'));
});

test('generateUsername: random_word capitalize/includeNumber', () => {
  const v = generateUsername(
    { type: 'random_word', capitalize: true, includeNumber: true },
    { randInt: () => 0 },
  );
  assert.ok(/[A-Z]/.test(v[0] ?? ''));
  assert.ok(/[0-9]$/.test(v));
});

test('generateUsername: plus_addressed_email', () => {
  const v = generateUsername(
    {
      type: 'plus_addressed_email',
      email: 'alice@example.com',
      capitalize: true,
      includeNumber: true,
    },
    { randInt: () => 0 },
  );
  assert.ok(v.startsWith('alice+'));
  assert.ok(v.endsWith('@example.com'));
  assert.ok(v.includes('+'));
});

test('generateUsername: plus_addressed_email strips existing plus tag', () => {
  const v = generateUsername(
    { type: 'plus_addressed_email', email: 'a+old@example.com' },
    { randInt: () => 0 },
  );
  assert.ok(v.startsWith('a+'));
  assert.ok(v.endsWith('@example.com'));
});

test('generateUsername: catch_all_email', () => {
  const v = generateUsername(
    { type: 'catch_all_email', domain: 'example.com', includeNumber: true },
    { randInt: () => 0 },
  );
  assert.ok(v.endsWith('@example.com'));
});

test('generateUsername: forwarded_email_alias not supported', () => {
  assert.throws(() =>
    generateUsername({ type: 'forwarded_email_alias' }, { randInt: () => 0 }),
  );
});

test('generateUsername: plus_addressed_email throws on invalid email', () => {
  assert.throws(
    () =>
      generateUsername(
        { type: 'plus_addressed_email', email: 'invalid' },
        { randInt: () => 0 },
      ),
    /Invalid email/,
  );
});

test('generateUsername: catch_all_email with domain starting with @', () => {
  const v = generateUsername(
    { type: 'catch_all_email', domain: '@example.com' },
    { randInt: () => 0 },
  );
  assert.ok(v.endsWith('@example.com'));
  assert.ok(!v.includes('@@'));
});

test('generateUsername: throws on unsupported type', () => {
  assert.throws(
    () =>
      generateUsername(
        { type: 'unknown_type' as 'random_word' },
        { randInt: () => 0 },
      ),
    /Unsupported username generator type/,
  );
});

test('generateUsername: plus_addressed_email throws without email', () => {
  assert.throws(
    () =>
      generateUsername({ type: 'plus_addressed_email' }, { randInt: () => 0 }),
    /email is required/,
  );
});

test('generateUsername: catch_all_email throws without domain', () => {
  assert.throws(
    () => generateUsername({ type: 'catch_all_email' }, { randInt: () => 0 }),
    /domain is required/,
  );
});

test('generateUsername: catch_all_email throws on invalid domain', () => {
  assert.throws(
    () =>
      generateUsername(
        { type: 'catch_all_email', domain: 'has spaces' },
        { randInt: () => 0 },
      ),
    /Invalid domain/,
  );
});

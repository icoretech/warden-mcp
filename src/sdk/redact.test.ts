import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED, redactItem } from './redact.js';

test('redactItem redacts login.password and login.totp', () => {
  const item = {
    id: 'x',
    login: { username: 'u', password: 'p', totp: 't' },
  };
  const redacted = redactItem(item) as unknown as {
    login: { password: string; totp: string };
  };
  assert.equal(redacted.login.password, REDACTED);
  assert.equal(redacted.login.totp, REDACTED);
});

test('redactItem redacts hidden custom fields', () => {
  const item = {
    id: 'x',
    fields: [
      { name: 'a', value: '1', type: 0 },
      { name: 'b', value: '2', type: 1 },
    ],
  };
  const redacted = redactItem(item) as unknown as {
    fields: { value: string }[];
  };
  assert.equal(redacted.fields[0].value, '1');
  assert.equal(redacted.fields[1].value, REDACTED);
});

test('redactItem always redacts private_key field', () => {
  const item = {
    id: 'x',
    fields: [{ name: 'private_key', value: 'SECRET', hidden: false }],
  };
  const redacted = redactItem(item) as unknown as {
    fields: { value: string }[];
  };
  assert.equal(redacted.fields[0].value, REDACTED);
});

test('redactItem redacts card number and code', () => {
  const item = {
    id: 'x',
    card: { number: '4111111111111111', code: '123', brand: 'visa' },
  };
  const redacted = redactItem(item) as unknown as {
    card: { number: string; code: string; brand: string };
  };
  assert.equal(redacted.card.number, REDACTED);
  assert.equal(redacted.card.code, REDACTED);
  assert.equal(redacted.card.brand, 'visa');
});

test('redactItem redacts identity ssn/passport/license', () => {
  const item = {
    id: 'x',
    identity: {
      firstName: 'Jane',
      ssn: '111-22-3333',
      passportNumber: 'P123',
      licenseNumber: 'D123',
    },
  };
  const redacted = redactItem(item) as unknown as {
    identity: {
      firstName: string;
      ssn: string;
      passportNumber: string;
      licenseNumber: string;
    };
  };
  assert.equal(redacted.identity.firstName, 'Jane');
  assert.equal(redacted.identity.ssn, REDACTED);
  assert.equal(redacted.identity.passportNumber, REDACTED);
  assert.equal(redacted.identity.licenseNumber, REDACTED);
});

test('redactItem redacts attachment urls', () => {
  const item = {
    id: 'x',
    attachments: [
      { id: 'a', fileName: 'f', url: 'https://example.com/?token=1' },
    ],
  };
  const redacted = redactItem(item) as unknown as {
    attachments: { url: string }[];
  };
  assert.equal(redacted.attachments[0].url, REDACTED);
});

test('redactItem redacts passwordHistory passwords', () => {
  const item = {
    id: 'x',
    passwordHistory: [
      { lastUsedDate: '2020-01-01T00:00:00.000Z', password: 'old' },
    ],
  };
  const redacted = redactItem(item) as unknown as {
    passwordHistory: { password: string }[];
  };
  assert.equal(redacted.passwordHistory[0].password, REDACTED);
});

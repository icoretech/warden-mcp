import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyItemPatch } from './patch.js';

test('applyItemPatch only changes whitelisted fields', () => {
  const base = {
    id: 'id',
    name: 'old',
    notes: 'n',
    favorite: false,
    type: 1,
    login: { username: 'u', password: 'p', totp: 't', uris: [] },
    fields: [{ name: 'x', value: '1', type: 0 }],
    organizationId: 'org',
    folderId: null,
    collectionIds: [],
  };

  const patched = applyItemPatch(base as unknown as Record<string, unknown>, {
    name: 'new',
    login: { password: 'p2' },
    fields: [{ name: 'y', value: '2', hidden: true }],
    folderId: 'folder',
    collectionIds: ['c1', 'c2'],
  }) as unknown as {
    name: string;
    login: { password: string };
    organizationId: string;
    fields: { name: string; type: number }[];
    folderId: string;
    collectionIds: string[];
  };

  assert.equal(patched.name, 'new');
  assert.equal(patched.login.password, 'p2');
  assert.equal(patched.organizationId, 'org');
  assert.equal(patched.fields[0].name, 'y');
  assert.equal(patched.fields[0].type, 1);
  assert.equal(patched.folderId, 'folder');
  assert.deepEqual(patched.collectionIds, ['c1', 'c2']);
});

describe('applyItemPatch branch coverage', () => {
  const base = {
    id: 'id',
    name: 'old',
    notes: 'old notes',
    favorite: false,
    type: 1,
    login: { username: 'u', password: 'p', totp: 't', uris: [] },
    fields: [],
    folderId: null,
    collectionIds: [],
  } as unknown as Record<string, unknown>;

  test('patches notes', () => {
    const r = applyItemPatch(base, { notes: 'new notes' }) as { notes: string };
    assert.equal(r.notes, 'new notes');
  });

  test('patches favorite', () => {
    const r = applyItemPatch(base, { favorite: true }) as { favorite: boolean };
    assert.equal(r.favorite, true);
  });

  test('patches login.username', () => {
    const r = applyItemPatch(base, { login: { username: 'new-user' } }) as {
      login: { username: string; password: string };
    };
    assert.equal(r.login.username, 'new-user');
    assert.equal(r.login.password, 'p'); // unchanged
  });

  test('patches login.totp', () => {
    const r = applyItemPatch(base, { login: { totp: 'new-totp' } }) as {
      login: { totp: string };
    };
    assert.equal(r.login.totp, 'new-totp');
  });

  test('patches login.uris', () => {
    const r = applyItemPatch(base, {
      login: { uris: [{ uri: 'https://new.com' }] },
    }) as { login: { uris: Array<{ uri: string }> } };
    assert.equal(r.login.uris.length, 1);
    assert.equal(r.login.uris[0].uri, 'https://new.com');
  });

  test('creates login object when base has no login', () => {
    const noLogin = { id: 'id', type: 2, name: 'note' } as unknown as Record<
      string,
      unknown
    >;
    const r = applyItemPatch(noLogin, {
      login: { username: 'u' },
    }) as { login: { username: string } };
    assert.equal(r.login.username, 'u');
  });

  test('patches fields with hidden=false', () => {
    const r = applyItemPatch(base, {
      fields: [{ name: 'visible', value: 'v', hidden: false }],
    }) as { fields: Array<{ name: string; type: number }> };
    assert.equal(r.fields[0].type, 0);
  });

  test('empty patch returns unchanged clone', () => {
    const r = applyItemPatch(base, {}) as { name: string };
    assert.equal(r.name, 'old');
  });
});

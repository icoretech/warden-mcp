import assert from 'node:assert/strict';
import test from 'node:test';
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

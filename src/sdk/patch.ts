// src/sdk/patch.ts

import type { ItemFieldInput, UriInput } from './types.js';

export interface UpdatePatch {
  name?: string;
  notes?: string;
  favorite?: boolean;
  folderId?: string | null;
  collectionIds?: string[];
  login?: {
    username?: string;
    password?: string;
    totp?: string;
    uris?: UriInput[];
  };
  fields?: ItemFieldInput[];
}

type AnyRecord = Record<string, unknown>;

export function applyItemPatch(item: AnyRecord, patch: UpdatePatch): AnyRecord {
  const out: AnyRecord = JSON.parse(JSON.stringify(item)) as AnyRecord;

  if (patch.name !== undefined) out.name = patch.name;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.favorite !== undefined) out.favorite = patch.favorite;
  if (patch.folderId !== undefined) out.folderId = patch.folderId;
  if (patch.collectionIds !== undefined)
    out.collectionIds = patch.collectionIds;

  if (patch.login) {
    const login = (
      out.login && typeof out.login === 'object' ? (out.login as AnyRecord) : {}
    ) as AnyRecord;
    if (patch.login.username !== undefined)
      login.username = patch.login.username;
    if (patch.login.password !== undefined)
      login.password = patch.login.password;
    if (patch.login.totp !== undefined) login.totp = patch.login.totp;
    if (patch.login.uris !== undefined) login.uris = patch.login.uris;
    out.login = login;
  }

  if (patch.fields !== undefined) {
    out.fields = patch.fields.map((f) => ({
      name: f.name,
      value: f.value,
      type: f.hidden ? 1 : 0,
    }));
  }

  return out;
}

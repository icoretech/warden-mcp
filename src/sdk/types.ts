// src/sdk/types.ts

export type ItemKind = 'login' | 'note' | 'ssh_key' | 'card' | 'identity';

export type UriMatch =
  | 'domain'
  | 'host'
  | 'startsWith'
  | 'exact'
  | 'regex'
  | 'never';

export interface ItemFieldInput {
  name: string;
  value: string;
  hidden?: boolean;
}

export interface UriInput {
  uri: string;
  match?: UriMatch;
}

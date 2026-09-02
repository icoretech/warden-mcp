import { basename } from 'node:path';

const COMMAND_PATHS = [
  ['config', 'server'],
  ['create', 'attachment'],
  ['create', 'folder'],
  ['create', 'item'],
  ['create', 'org-collection'],
  ['delete', 'attachment'],
  ['delete', 'folder'],
  ['delete', 'item'],
  ['delete', 'org-collection'],
  ['edit', 'folder'],
  ['edit', 'item'],
  ['edit', 'item-collections'],
  ['edit', 'org-collection'],
  ['encode'],
  ['generate'],
  ['get', 'attachment'],
  ['get', 'collection'],
  ['get', 'exposed'],
  ['get', 'folder'],
  ['get', 'item'],
  ['get', 'notes'],
  ['get', 'organization'],
  ['get', 'org-collection'],
  ['get', 'password'],
  ['get', 'password-history'],
  ['get', 'template', 'item'],
  ['get', 'totp'],
  ['get', 'uri'],
  ['get', 'username'],
  ['list', 'collections'],
  ['list', 'folders'],
  ['list', 'items'],
  ['list', 'organizations'],
  ['list', 'org-collections'],
  ['lock'],
  ['login'],
  ['logout'],
  ['move'],
  ['receive'],
  ['restore', 'item'],
  ['send'],
  ['status'],
  ['sync'],
  ['unlock'],
] as const;

const SAFE_OPTION_FLAGS = new Set([
  '--apikey',
  '--check',
  '--cleanexit',
  '--fullobject',
  '--nointeraction',
  '--obj',
  '--raw',
  '--response',
  '--trash',
  '--version',
]);

const VALUE_OPTION_FLAGS = new Set([
  '--clientsecret',
  '--collectionid',
  '--emails',
  '--file',
  '--folderid',
  '--itemid',
  '--organizationid',
  '--password',
  '--passwordenv',
  '--passwordfile',
  '--search',
  '--session',
  '--url',
]);

export function renderSafeBwCommand(bwBin: string, argv: string[]): string {
  const rendered = [basename(bwBin)];
  const commandPath: string[] = [];
  let commandPathFrozen = false;
  let redactRemaining = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (redactRemaining) {
      rendered.push('<redacted>');
      continue;
    }
    if (typeof arg !== 'string') {
      rendered.push('<redacted>');
      if (commandPath.length > 0) commandPathFrozen = true;
      continue;
    }

    if (arg === '--') {
      rendered.push(arg);
      commandPathFrozen = true;
      redactRemaining = true;
      continue;
    }

    const equalsFlag = [...VALUE_OPTION_FLAGS].find((flag) =>
      arg.startsWith(`${flag}=`),
    );
    if (equalsFlag) {
      rendered.push(`${equalsFlag}=<redacted>`);
      if (commandPath.length > 0) commandPathFrozen = true;
      continue;
    }

    if (VALUE_OPTION_FLAGS.has(arg)) {
      rendered.push(arg);
      if (index + 1 < argv.length) {
        rendered.push('<redacted>');
        index += 1;
      }
      if (commandPath.length > 0) commandPathFrozen = true;
      continue;
    }

    if (SAFE_OPTION_FLAGS.has(arg)) {
      rendered.push(arg);
      if (commandPath.length > 0) commandPathFrozen = true;
      continue;
    }

    const possibleCommandPaths = COMMAND_PATHS.filter((path) =>
      commandPath.every((word, wordIndex) => path[wordIndex] === word),
    );
    if (
      !commandPathFrozen &&
      possibleCommandPaths.some((path) => path[commandPath.length] === arg)
    ) {
      rendered.push(arg);
      commandPath.push(arg);
      continue;
    }

    rendered.push('<redacted>');
    if (commandPath.length > 0) commandPathFrozen = true;
  }

  return rendered.join(' ');
}

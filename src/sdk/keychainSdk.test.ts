import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { BwRunResult } from '../bw/bwCli.js';
import type { BwSessionManager } from '../bw/bwSession.js';
import { KeychainSdk } from './keychainSdk.js';

function decodeLastArg(calls: MockCall[], command: string): unknown {
  const call = calls.find((c) => c.args.includes(command));
  assert.ok(call, `expected call containing '${command}'`);
  const encodedArg = call.args.at(-1) ?? '';
  return JSON.parse(Buffer.from(encodedArg, 'base64').toString('utf8'));
}

// ---------------------------------------------------------------------------
// Mock BwSessionManager
// ---------------------------------------------------------------------------

interface MockCall {
  args: string[];
  opts?: unknown;
}

function createMockBw(opts?: {
  runResponses?: Map<string, BwRunResult>;
  /** Side-effect callback invoked with (args) before returning response.
   *  Use to write files to --output dirs for attachment/send download tests. */
  sideEffect?: (args: string[]) => Promise<void>;
  templateItem?: unknown;
  statusResult?: unknown;
}) {
  const calls: MockCall[] = [];
  const defaultTemplate = {
    organizationId: null,
    collectionIds: [],
    folderId: null,
    type: 1,
    name: '',
    notes: '',
    favorite: false,
    fields: [],
    login: { uris: [], username: null, password: null, totp: null },
    card: {},
    identity: {},
    reprompt: 0,
  };

  const runResponses = opts?.runResponses ?? new Map<string, BwRunResult>();
  const sideEffect = opts?.sideEffect;
  const templateItem = opts?.templateItem ?? defaultTemplate;

  function findResponse(args: string[]): BwRunResult {
    // Try exact match first, then partial
    const key = args.join(' ');
    const exact = runResponses.get(key);
    if (exact) return exact;

    // Try matching by first few args
    for (const [pattern, result] of runResponses) {
      if (key.includes(pattern)) return result;
    }

    return { stdout: '{}', stderr: '' };
  }

  const mock: BwSessionManager = {
    withSession: async (fn: (session: string) => Promise<unknown>) => {
      return fn('mock-session');
    },
    runForSession: async (
      _session: string,
      args: string[],
      runOpts?: unknown,
    ) => {
      calls.push({ args, opts: runOpts });
      if (sideEffect) await sideEffect(args);
      return findResponse(args);
    },
    getTemplateItemForSession: async () => {
      return JSON.parse(JSON.stringify(templateItem));
    },
    status: async () => opts?.statusResult ?? { status: 'unlocked' },
    getTemplateItem: async () => JSON.parse(JSON.stringify(templateItem)),
    startKeepUnlocked: () => {},
  } as unknown as BwSessionManager;

  return { mock, calls };
}

// ---------------------------------------------------------------------------
// Helper function tests (tested indirectly through SDK methods)
// ---------------------------------------------------------------------------

describe('KeychainSdk helper logic', () => {
  test('sdkVersion uses bw --version instead of sdk-version', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['--version', { stdout: '2026.2.0', stderr: '' }],
        ['sdk-version', { stdout: "COMMERCIAL-' ()'", stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.sdkVersion();

    assert.equal(result.version, '2026.2.0');
    assert.ok(calls.some((c) => c.args.includes('--version')));
    assert.ok(!calls.some((c) => c.args.includes('sdk-version')));
  });

  test('searchItems: basic text search', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        [
          'list items --search test',
          {
            stdout: JSON.stringify([{ id: '1', name: 'test-item', type: 1 }]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ text: 'test' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '1');
    assert.ok(calls.some((c) => c.args.includes('--search')));
  });

  test('searchItems: multi-term OR via pipe delimiter', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items --search foo',
          {
            stdout: JSON.stringify([{ id: '1', name: 'foo', type: 1 }]),
            stderr: '',
          },
        ],
        [
          'list items --search bar',
          {
            stdout: JSON.stringify([{ id: '2', name: 'bar', type: 1 }]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ text: 'foo | bar' });
    assert.equal(results.length, 2);
  });

  test('searchItems: deduplicates by id across terms', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items --search foo',
          {
            stdout: JSON.stringify([{ id: 'dup', name: 'item', type: 1 }]),
            stderr: '',
          },
        ],
        [
          'list items --search bar',
          {
            stdout: JSON.stringify([{ id: 'dup', name: 'item', type: 1 }]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ text: 'foo | bar' });
    assert.equal(results.length, 1);
  });

  test('searchItems: filters by type=login', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1 },
              { id: '2', type: 2 },
              { id: '3', type: 3 },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ type: 'login' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '1');
  });

  test('searchItems: filters by type=note excludes ssh_key', async () => {
    const sshKeyItem = {
      id: 'ssh',
      type: 2,
      fields: [{ name: 'public_key' }, { name: 'private_key' }],
    };
    const noteItem = { id: 'note', type: 2, fields: [] };

    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([sshKeyItem, noteItem]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ type: 'note' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, 'note');
  });

  test('searchItems: filters by type=ssh_key', async () => {
    const sshKeyItem = {
      id: 'ssh',
      type: 2,
      fields: [{ name: 'public_key' }, { name: 'private_key' }],
    };
    const noteItem = { id: 'note', type: 2, fields: [] };

    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([sshKeyItem, noteItem]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ type: 'ssh_key' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, 'ssh');
  });

  test('searchItems: organizationId=null filters correctly', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1, organizationId: null },
              { id: '2', type: 1, organizationId: 'org-123' },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ organizationId: 'null' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '1');
  });

  test('searchItems: folderId=notnull filters correctly', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1, folderId: null },
              { id: '2', type: 1, folderId: 'folder-1' },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ folderId: 'notnull' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '2');
  });

  test('searchItems: limit caps results', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      type: 1,
    }));
    const { mock } = createMockBw({
      runResponses: new Map([
        ['list items', { stdout: JSON.stringify(items), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ limit: 3 });
    assert.equal(results.length, 3);
  });
});

// ---------------------------------------------------------------------------
// CRUD method tests
// ---------------------------------------------------------------------------

describe('KeychainSdk CRUD', () => {
  test('getItem with reveal=false redacts passwords', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'get item',
          {
            stdout: JSON.stringify({
              id: '1',
              type: 1,
              login: { password: 'secret', totp: 'OTP123' },
            }),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.getItem('1', { reveal: false })) as {
      login: { password: string; totp: string };
    };
    assert.equal(result.login.password, '[REDACTED]');
    assert.equal(result.login.totp, '[REDACTED]');
  });

  test('getItem with reveal=true returns raw data', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'get item',
          {
            stdout: JSON.stringify({
              id: '1',
              type: 1,
              login: { password: 'secret' },
            }),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.getItem('1', { reveal: true })) as {
      login: { password: string };
    };
    assert.equal(result.login.password, 'secret');
  });

  test('createLogin calls create item with encoded template', async () => {
    const createdItem = { id: 'new-1', type: 1, name: 'Test Login' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['get item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createLogin({
      name: 'Test Login',
      username: 'user@test.com',
      password: 'pw123',
    })) as { id: string };

    assert.equal(result.id, 'new-1');
    assert.ok(calls.some((c) => c.args.includes('create')));
  });

  test('createLogin passes URI normalization', async () => {
    const createdItem = { id: 'new-1', type: 1 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['get item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createLogin({
      name: 'test',
      uris: [{ uri: 'https://example.com', match: 'domain' }],
    });

    // The encoded arg should be a base64 string containing URI match=0 (domain)
    const decoded = decodeLastArg(calls, 'create') as {
      login: { uris: Array<{ match: number }> };
    };
    assert.equal(decoded.login.uris[0].match, 0); // domain=0
  });

  test('createNote creates a note-type item', async () => {
    const createdNote = { id: 'note-1', type: 2, name: 'My Note' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdNote), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createNote({ name: 'My Note' })) as {
      id: string;
    };

    assert.equal(result.id, 'note-1');
    const decoded = decodeLastArg(calls, 'create') as { type: number };
    assert.equal(decoded.type, 2); // note
  });

  test('deleteItem calls delete with --permanent flag', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['delete item', { stdout: '', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.deleteItem({ id: 'item-1', permanent: true });

    const deleteCall = calls.find((c) => c.args.includes('delete'));
    assert.ok(deleteCall);
    assert.ok(deleteCall.args.includes('--permanent'));
  });

  test('deleteItem without permanent does soft delete', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['delete item', { stdout: '', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.deleteItem({ id: 'item-1' });

    const deleteCall = calls.find((c) => c.args.includes('delete'));
    assert.ok(deleteCall);
    assert.ok(!deleteCall.args.includes('--permanent'));
  });

  test('deleteItems rejects >200 ids', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);

    await assert.rejects(
      () =>
        sdk.deleteItems({
          ids: Array.from({ length: 201 }, (_, i) => String(i)),
        }),
      { message: 'Too many ids (max 200)' },
    );
  });

  test('deleteItems returns empty for empty input', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const results = await sdk.deleteItems({ ids: [] });
    assert.deepEqual(results, []);
  });

  test('deleteItems reports per-item success/failure', async () => {
    let callCount = 0;
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async (_s: string, args: string[]) => {
        if (args.includes('sync')) return { stdout: '', stderr: '' };
        callCount++;
        if (callCount === 2) throw new Error('item not found');
        return { stdout: '', stderr: '' };
      },
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    const results = await sdk.deleteItems({ ids: ['a', 'b', 'c'] });

    assert.equal(results.length, 3);
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    assert.ok(results[1]?.error?.includes('not found'));
    assert.equal(results[2]?.ok, true);
  });

  test('listFolders passes search and limit', async () => {
    const folders = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['list folders', { stdout: JSON.stringify(folders), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.listFolders({ search: 'test', limit: 2 });

    assert.equal(result.length, 2);
    assert.ok(calls.some((c) => c.args.includes('--search')));
  });

  test('listCollections passes organizationId', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['list collections', { stdout: '[]', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.listCollections({ organizationId: 'org-1' });

    assert.ok(calls.some((c) => c.args.includes('--organizationid')));
  });

  test('generate returns null value when reveal=false', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.generate({ reveal: false });

    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('generate calls bw generate when reveal=true', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['generate', { stdout: 'Xk9#mP2$vL\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.generate({ reveal: true, length: 12 });

    assert.equal(result.value, 'Xk9#mP2$vL');
    assert.equal(result.revealed, true);
    assert.ok(calls.some((c) => c.args.includes('generate')));
  });

  test('getPassword returns null when reveal=false', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.getPassword({ term: 'test' }, { reveal: false });

    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('getPassword returns value when reveal=true', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get password', { stdout: 'my-secret\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getPassword({ term: 'test' }, { reveal: true });

    assert.equal(result.value, 'my-secret');
    assert.equal(result.revealed, true);
  });

  test('getTotp returns null when reveal=false', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.getTotp({ term: 'test' }, { reveal: false });

    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('getNotes returns null when reveal=false', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.getNotes({ term: 'test' }, { reveal: false });

    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('encode sends value to bw encode stdin', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['encode', { stdout: 'aGVsbG8=\n', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.encode({ value: 'hello' });
    assert.equal(result.encoded, 'aGVsbG8=');
    assert.ok(calls.some((c) => c.args.includes('encode')));
  });

  test('status delegates to bw.status()', async () => {
    const statusData = { status: 'unlocked', serverUrl: 'https://bw.test' };
    const { mock } = createMockBw({ statusResult: statusData });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.status();
    assert.deepEqual(result, statusData);
  });

  test('restoreItem restores then refetches', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['restore item', { stdout: 'ok', stderr: '' }],
        [
          'get item',
          {
            stdout: JSON.stringify({ id: 'restored', type: 1 }),
            stderr: '',
          },
        ],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.restoreItem({ id: 'restored' })) as {
      id: string;
    };

    assert.equal(result.id, 'restored');
    assert.ok(calls.some((c) => c.args.includes('restore')));
    // Should also refetch after restore
    assert.ok(calls.filter((c) => c.args.includes('get')).length >= 1);
  });

  test('getPasswordHistory with reveal=false redacts passwords', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'get item',
          {
            stdout: JSON.stringify({
              id: '1',
              type: 1,
              passwordHistory: [
                { lastUsedDate: '2024-01-01', password: 'old-secret' },
              ],
            }),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getPasswordHistory('1', { reveal: false });

    assert.equal(result.revealed, false);
    const entry = result.value[0] as { password: unknown };
    assert.equal(entry.password, null); // redactPasswordHistoryForTool sets null
  });

  test('getPasswordHistory with reveal=true preserves passwords', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'get item',
          {
            stdout: JSON.stringify({
              id: '1',
              type: 1,
              passwordHistory: [
                { lastUsedDate: '2024-01-01', password: 'old-secret' },
              ],
            }),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getPasswordHistory('1', { reveal: true });

    assert.equal(result.revealed, true);
    const entry = result.value[0] as { password: string };
    assert.equal(entry.password, 'old-secret');
  });

  test('createFolder syncs then creates', async () => {
    const folder = { id: 'f1', name: 'new-folder' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['sync', { stdout: '', stderr: '' }],
        ['create folder', { stdout: JSON.stringify(folder), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createFolder({ name: 'new-folder' })) as {
      id: string;
    };
    assert.equal(result.id, 'f1');
    // Verify sync was called before create
    const syncIdx = calls.findIndex((c) => c.args.includes('sync'));
    const createIdx = calls.findIndex((c) => c.args.includes('create'));
    assert.ok(syncIdx < createIdx);
  });

  test('sendList returns parsed JSON', async () => {
    const sends = [{ id: 's1', name: 'test send' }];
    const { mock } = createMockBw({
      runResponses: new Map([
        ['send list', { stdout: JSON.stringify(sends), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.sendList();
    assert.deepEqual(result, sends);
  });

  test('sendGet with text=true returns raw text', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['send get', { stdout: 'secret text content\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.sendGet({
      id: 's1',
      text: true,
    })) as { text: string };
    assert.equal(result.text, 'secret text content');
  });

  test('sendDelete delegates correctly', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['send delete', { stdout: '{}', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendDelete({ id: 's1' });
    assert.ok(
      calls.some((c) => c.args.includes('send') && c.args.includes('delete')),
    );
  });

  test('sendRemovePassword delegates correctly', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['send remove-password', { stdout: '{}', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendRemovePassword({ id: 's1' });
    assert.ok(calls.some((c) => c.args.includes('remove-password')));
  });

  test('sendTemplate returns parsed template', async () => {
    const tpl = { type: 0, text: { text: '', hidden: false } };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['send template', { stdout: JSON.stringify(tpl), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.sendTemplate({ object: 'send.text' });
    assert.deepEqual(result, tpl);
  });

  test('sendGet without text or downloadFile returns parsed JSON', async () => {
    const sendObj = { id: 's1', name: 'my send' };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['send get', { stdout: JSON.stringify(sendObj), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.sendGet({ id: 's1' });
    assert.deepEqual(result, sendObj);
  });

  test('sendCreate with text type sends text arg', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['send', { stdout: '"https://send.example/abc"', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendCreate({
      type: 'text',
      text: 'hello world',
      name: 'test send',
      deleteInDays: 7,
      maxAccessCount: 10,
      hidden: true,
    });

    const sendCall = calls.find((c) => c.args.includes('send'));
    assert.ok(sendCall);
    assert.ok(sendCall.args.includes('--name'));
    assert.ok(sendCall.args.includes('--deleteInDays'));
    assert.ok(sendCall.args.includes('--maxAccessCount'));
    assert.ok(sendCall.args.includes('--hidden'));
  });

  test('sendCreate text type throws without text', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.sendCreate({ type: 'text' }),
      /Missing text/,
    );
  });

  test('sendCreate file type throws without filename', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.sendCreate({ type: 'file' }),
      /Missing filename/,
    );
  });

  test('getUsername returns raw value', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get username', { stdout: 'alice@test.com\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getUsername({ term: 'test' });
    assert.equal(result.value, 'alice@test.com');
    assert.equal(result.revealed, true);
  });

  test('getUri returns raw value', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get uri', { stdout: 'https://example.com\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getUri({ term: 'test' });
    assert.equal(result.value, 'https://example.com');
  });

  test('getTotp returns value when reveal=true', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get totp', { stdout: '123456\n', stderr: '' }],
        [
          'get item test',
          {
            stdout: JSON.stringify({
              id: 'test',
              type: 1,
              name: 'otp-item',
              login: {},
            }),
            stderr: '',
          },
        ],
        [
          'list items --search test',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1, name: 'otp-item', login: { username: 'u' } },
            ]),
            stderr: '',
          },
        ],
        [
          'get item 1',
          {
            stdout: JSON.stringify({
              id: '1',
              type: 1,
              name: 'otp-item',
              login: {
                totp: 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=Test&period=45',
              },
            }),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const originalDateNow = Date.now;
    Date.now = () => 41_000;
    try {
      const result = await sdk.getTotp({ term: 'test' }, { reveal: true });
      assert.equal(result.value, '123456');
      assert.equal(result.revealed, true);
      assert.equal(result.period, 45);
      assert.equal(result.timeLeft, 4);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('getNotes returns value when reveal=true', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get notes', { stdout: 'my secret note\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getNotes({ term: 'test' }, { reveal: true });
    assert.equal(result.value, 'my secret note');
    assert.equal(result.revealed, true);
  });

  test('generateUsername delegates correctly when reveal=true', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.generateUsername({ reveal: true });
    assert.equal(result.revealed, true);
    assert.ok(typeof result.value === 'string' && result.value.length > 0);
  });

  test('generateUsername returns null when reveal=false', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    const result = await sdk.generateUsername({ reveal: false });
    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('listOrganizations passes search', async () => {
    const orgs = [{ id: 'org1' }];
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['list organizations', { stdout: JSON.stringify(orgs), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.listOrganizations({ search: 'test' });
    assert.equal(result.length, 1);
    assert.ok(calls.some((c) => c.args.includes('--search')));
  });

  test('editFolder encodes name and passes id', async () => {
    const folder = { id: 'f1', name: 'renamed' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['edit folder', { stdout: JSON.stringify(folder), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.editFolder({ id: 'f1', name: 'renamed' });
    assert.ok(
      calls.some((c) => c.args.includes('edit') && c.args.includes('folder')),
    );
  });

  test('deleteFolder calls delete', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['delete folder', { stdout: '', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.deleteFolder({ id: 'f1' });
    assert.ok(
      calls.some((c) => c.args.includes('delete') && c.args.includes('folder')),
    );
  });

  test('getFolder fetches by id', async () => {
    const folder = { id: 'f1', name: 'test' };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get folder', { stdout: JSON.stringify(folder), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.getFolder({ id: 'f1' })) as { id: string };
    assert.equal(result.id, 'f1');
  });

  test('getCollection fetches with optional organizationId', async () => {
    const col = { id: 'c1' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get collection', { stdout: JSON.stringify(col), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.getCollection({ id: 'c1', organizationId: 'org1' });
    assert.ok(calls.some((c) => c.args.includes('--organizationid')));
  });

  test('getOrganization fetches by id', async () => {
    const org = { id: 'org1', name: 'My Org' };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get organization', { stdout: JSON.stringify(org), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.getOrganization({ id: 'org1' })) as {
      id: string;
    };
    assert.equal(result.id, 'org1');
  });

  test('listOrgCollections passes organizationId', async () => {
    const cols = [{ id: 'c1' }];
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['list org-collections', { stdout: JSON.stringify(cols), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.listOrgCollections({ organizationId: 'org1' });
    assert.ok(calls.some((c) => c.args.includes('--organizationid')));
  });

  test('createOrgCollection syncs then creates', async () => {
    const col = { id: 'c1', name: 'New Col' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create org-collection', { stdout: JSON.stringify(col), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createOrgCollection({
      organizationId: 'org1',
      name: 'New Col',
    })) as { id: string };
    assert.equal(result.id, 'c1');
    assert.ok(calls.some((c) => c.args.includes('sync')));
  });

  test('editOrgCollection edits with encoded JSON', async () => {
    const col = { id: 'c1', name: 'Updated' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['edit org-collection', { stdout: JSON.stringify(col), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.editOrgCollection({
      organizationId: 'org1',
      id: 'c1',
      name: 'Updated',
    });
    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('org-collection'),
      ),
    );
  });

  test('deleteOrgCollection deletes', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['delete org-collection', { stdout: '', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.deleteOrgCollection({ organizationId: 'org1', id: 'c1' });
    assert.ok(
      calls.some(
        (c) => c.args.includes('delete') && c.args.includes('org-collection'),
      ),
    );
  });

  test('moveItemToOrganization calls move with collectionIds', async () => {
    const moved = { id: 'item1', organizationId: 'org1' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['move', { stdout: JSON.stringify(moved), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.moveItemToOrganization({
      id: 'item1',
      organizationId: 'org1',
      collectionIds: ['c1', 'c2'],
    });
    assert.ok(calls.some((c) => c.args.includes('move')));
  });

  test('getOrgCollection fetches with optional organizationId', async () => {
    const col = { id: 'c1' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get org-collection', { stdout: JSON.stringify(col), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.getOrgCollection({ id: 'c1', organizationId: 'org1' });
    assert.ok(calls.some((c) => c.args.includes('--organizationid')));
  });

  test('createCard creates card-type item', async () => {
    const card = { id: 'card-1', type: 3 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(card), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createCard({
      name: 'My Card',
      cardholderName: 'Alice',
      number: '4111111111111111',
      code: '123',
    })) as { id: string };

    assert.equal(result.id, 'card-1');
    const decoded = decodeLastArg(calls, 'create') as { type: number };
    assert.equal(decoded.type, 3);
  });

  test('createIdentity creates identity-type item', async () => {
    const identity = { id: 'id-1', type: 4 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(identity), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createIdentity({
      name: 'My Identity',
      identity: { firstName: 'Alice', lastName: 'Smith' },
    })) as { id: string };

    assert.equal(result.id, 'id-1');
    const decoded = decodeLastArg(calls, 'create') as { type: number };
    assert.equal(decoded.type, 4);
  });

  test('createLogins batch creates with continueOnError', async () => {
    let createCount = 0;
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async (_s: string, args: string[]) => {
        if (args.includes('sync')) return { stdout: '', stderr: '' };
        if (args.includes('get'))
          return {
            stdout: JSON.stringify({ id: `item-${createCount}`, type: 1 }),
            stderr: '',
          };
        if (args.includes('create')) {
          createCount++;
          if (createCount === 2) throw new Error('duplicate name');
          return {
            stdout: JSON.stringify({ id: `item-${createCount}`, type: 1 }),
            stderr: '',
          };
        }
        return { stdout: '{}', stderr: '' };
      },
      getTemplateItemForSession: async () => ({
        type: 1,
        name: '',
        notes: '',
        favorite: false,
        fields: [],
        login: {},
        organizationId: null,
        collectionIds: [],
        folderId: null,
        reprompt: 0,
      }),
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    const results = await sdk.createLogins({
      items: [{ name: 'Login 1' }, { name: 'Login 2' }, { name: 'Login 3' }],
    });

    assert.equal(results.length, 3);
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    assert.ok(results[1]?.error?.includes('duplicate'));
    assert.equal(results[2]?.ok, true);
  });

  test('deleteAttachment calls delete then refetches item', async () => {
    const item = { id: 'item-1', type: 1, attachments: [] };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['delete attachment', { stdout: '', stderr: '' }],
        ['get item', { stdout: JSON.stringify(item), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.deleteAttachment({
      itemId: 'item-1',
      attachmentId: 'att-1',
    })) as { id: string };

    assert.equal(result.id, 'item-1');
    assert.ok(
      calls.some(
        (c) => c.args.includes('delete') && c.args.includes('attachment'),
      ),
    );
  });

  test('updateItem gets current, patches, then edits', async () => {
    const currentItem = {
      id: 'u1',
      type: 1,
      name: 'Old Name',
      notes: 'old notes',
      login: { username: 'old', password: 'oldpw', uris: [] },
    };
    const updatedItem = {
      id: 'u1',
      type: 1,
      name: 'New Name',
      notes: 'old notes',
      login: { username: 'old', password: 'oldpw', uris: [] },
    };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get item', { stdout: JSON.stringify(currentItem), stderr: '' }],
        ['edit item', { stdout: JSON.stringify(updatedItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.updateItem(
      'u1',
      { name: 'New Name' },
      { reveal: true },
    )) as { name: string };

    assert.equal(result.name, 'New Name');
    // Should get current, then edit
    assert.ok(calls.some((c) => c.args.includes('get')));
    assert.ok(
      calls.some((c) => c.args.includes('edit') && c.args.includes('item')),
    );
  });

  test('sendEdit delegates with encoded JSON', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['send edit', { stdout: '{}', stderr: '' }],
        ['encode', { stdout: 'encoded123\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendEdit({ json: { id: 's1', name: 'updated' } });
    assert.ok(
      calls.some((c) => c.args.includes('send') && c.args.includes('edit')),
    );
  });

  test('sendEdit throws without encodedJson or json', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.sendEdit({}),
      /sendEdit requires encodedJson or json/,
    );
  });

  test('sendCreateEncoded throws without any input', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.sendCreateEncoded({}),
      /sendCreateEncoded requires one of/,
    );
  });

  test('receive with text returns raw text', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        ['receive', { stdout: 'received text\n', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.receive({ url: 'https://send.bw/abc' })) as {
      text: string;
    };
    assert.equal(result.text, 'received text');
  });

  test('receive with obj returns parsed JSON', async () => {
    const obj = { id: 's1', text: { text: 'hello' } };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['receive', { stdout: JSON.stringify(obj), stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.receive({ url: 'https://send.bw/abc', obj: true });
    assert.deepEqual(result, obj);
  });

  test('getExposed returns value on success', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([['get exposed', { stdout: '3\n', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getExposed({ term: 'test' });
    assert.equal(result.value, '3');
    assert.equal(result.revealed, true);
  });

  test('getExposed returns null for not-found errors', async () => {
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async () => {
        const err = Object.assign(new Error('bw failed with exit code 1'), {
          name: 'BwCliError',
          exitCode: 1,
          stdout: 'Not found.',
          stderr: 'Not found.',
        });
        throw err;
      },
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    const result = await sdk.getExposed({ term: 'nonexistent' });
    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('createLogin with custom fields normalizes hidden type', async () => {
    const createdItem = { id: 'f1', type: 1 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['get item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createLogin({
      name: 'with fields',
      fields: [
        { name: 'visible', value: 'v1' },
        { name: 'secret', value: 'v2', hidden: true },
      ],
    });

    const decoded = decodeLastArg(calls, 'create') as {
      fields: Array<{ name: string; type: number }>;
    };
    assert.equal(decoded.fields[0].type, 0); // text
    assert.equal(decoded.fields[1].type, 1); // hidden
  });

  test('updateItem with URI normalization converts match strings', async () => {
    const currentItem = {
      id: 'u1',
      type: 1,
      name: 'test',
      notes: '',
      login: {
        username: 'u',
        password: 'p',
        uris: [{ uri: 'https://old.com', match: 0 }],
      },
    };
    const updatedItem = { ...currentItem, name: 'updated' };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get item', { stdout: JSON.stringify(currentItem), stderr: '' }],
        ['edit item', { stdout: JSON.stringify(updatedItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.updateItem(
      'u1',
      { login: { uris: [{ uri: 'https://new.com', match: 'exact' }] } },
      { reveal: true },
    );

    // Verify the edit call has numeric match value
    const editCall = calls.find(
      (c) => c.args.includes('edit') && c.args.includes('item'),
    );
    assert.ok(editCall);
    const encodedArg = editCall.args.at(-1) ?? '';
    const decoded = JSON.parse(
      Buffer.from(encodedArg, 'base64').toString('utf8'),
    );
    assert.equal(decoded.login.uris[0].match, 3); // exact=3
  });

  test('searchItems with url passes --url flag', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([{ id: '1', type: 1 }]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.searchItems({ url: 'https://example.com' });
    assert.ok(calls.some((c) => c.args.includes('--url')));
  });

  test('searchItems with trash passes --trash flag', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['list items', { stdout: '[]', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.searchItems({ trash: true });
    assert.ok(calls.some((c) => c.args.includes('--trash')));
  });

  test('searchItems filters by type=card', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1 },
              { id: '2', type: 3 },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ type: 'card' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '2');
  });

  test('searchItems filters by type=identity', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1 },
              { id: '2', type: 4 },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ type: 'identity' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '2');
  });

  test('searchItems with collectionId passes --collectionid flag', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['list items', { stdout: '[]', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.searchItems({ collectionId: 'col-1' });
    assert.ok(calls.some((c) => c.args.includes('--collectionid')));
  });

  test('searchItems organizationId=notnull filters correctly', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1, organizationId: null },
              { id: '2', type: 1, organizationId: 'org-123' },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ organizationId: 'notnull' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '2');
  });

  test('searchItems folderId=null filters correctly', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 1, folderId: null },
              { id: '2', type: 1, folderId: 'folder-1' },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const results = await sdk.searchItems({ folderId: 'null' });
    assert.equal(results.length, 1);
    assert.equal((results[0] as { id: string }).id, '1');
  });

  test('sendCreateEncoded with json encodes and creates', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['encode', { stdout: 'encoded-json\n', stderr: '' }],
        ['send create', { stdout: '{}', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendCreateEncoded({ json: { name: 'test' } });
    assert.ok(
      calls.some((c) => c.args.includes('send') && c.args.includes('create')),
    );
  });

  test('sendCreateEncoded with text creates send', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['send create', { stdout: '{}', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendCreateEncoded({ text: 'hello' });
    assert.ok(calls.some((c) => c.args.includes('--text')));
  });

  test('sendEdit with json encodes then edits', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['encode', { stdout: 'encoded\n', stderr: '' }],
        ['send edit', { stdout: '{}', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendEdit({ json: { name: 'updated' }, itemId: 'i1' });
    assert.ok(calls.some((c) => c.args.includes('--itemid')));
  });
});

// ---------------------------------------------------------------------------
// File I/O tests (attachments, send file download, etc.)
// ---------------------------------------------------------------------------

describe('KeychainSdk file I/O', () => {
  test('getAttachment writes file and returns base64', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([['get attachment', { stdout: '', stderr: '' }]]),
      sideEffect: async (args) => {
        // Simulate bw writing a file to the --output dir
        const outputIdx = args.indexOf('--output');
        if (outputIdx >= 0) {
          const dir = args[outputIdx + 1];
          if (dir) {
            await writeFile(join(dir, 'downloaded.txt'), 'file-content');
          }
        }
      },
    });

    const sdk = new KeychainSdk(mock);
    const result = await sdk.getAttachment({
      itemId: 'item-1',
      attachmentId: 'att-1',
    });
    assert.equal(result.filename, 'downloaded.txt');
    assert.equal(result.bytes, 12); // 'file-content'.length
    assert.equal(
      Buffer.from(result.contentBase64, 'base64').toString(),
      'file-content',
    );
  });

  test('createLogin with attachments writes temp files', async () => {
    const createdItem = { id: 'att-item', type: 1 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['create attachment', { stdout: '{}', stderr: '' }],
        ['get item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createLogin({
      name: 'With Attachment',
      attachments: [
        {
          filename: 'test.txt',
          contentBase64: Buffer.from('hello').toString('base64'),
        },
      ],
    })) as { id: string };

    assert.equal(result.id, 'att-item');
    // Verify attachment create was called with --file and --itemid
    const attachCall = calls.find(
      (c) =>
        c.args.includes('create') &&
        c.args.includes('attachment') &&
        c.args.includes('--file'),
    );
    assert.ok(attachCall, 'expected create attachment call');
    assert.ok(attachCall.args.includes('--itemid'));
  });

  test('createLogin with collectionIds calls item-collections edit', async () => {
    const createdItem = { id: 'col-item', type: 1 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['get item', { stdout: JSON.stringify(createdItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createLogin({
      name: 'With Collections',
      organizationId: 'org1',
      collectionIds: ['c1', 'c2'],
    });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });

  test('sendGet with downloadFile writes and reads file', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([['send get', { stdout: '', stderr: '' }]]),
      sideEffect: async (args) => {
        const outputIdx = args.indexOf('--output');
        if (outputIdx >= 0) {
          const dir = args[outputIdx + 1];
          if (dir) {
            await writeFile(join(dir, 'sent-file.bin'), 'binary-data');
          }
        }
      },
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.sendGet({
      id: 's1',
      downloadFile: true,
    })) as { file: { filename: string; bytes: number; contentBase64: string } };

    assert.equal(result.file.filename, 'sent-file.bin');
    assert.equal(
      Buffer.from(result.file.contentBase64, 'base64').toString(),
      'binary-data',
    );
  });

  test('sendCreate with file type writes temp file', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['send', { stdout: '"https://send.bw/xyz"', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendCreate({
      type: 'file',
      filename: 'upload.txt',
      contentBase64: Buffer.from('upload content').toString('base64'),
      name: 'file send',
    });

    // Verify --file flag was used
    const sendCall = calls.find(
      (c) => c.args.includes('send') && c.args.includes('--file'),
    );
    assert.ok(sendCall, 'expected send --file call');
  });

  test('sendCreateEncoded with file writes temp file', async () => {
    const { mock, calls } = createMockBw({
      runResponses: new Map([['send create', { stdout: '{}', stderr: '' }]]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.sendCreateEncoded({
      file: {
        filename: 'encoded-file.txt',
        contentBase64: Buffer.from('data').toString('base64'),
      },
    });

    assert.ok(
      calls.some(
        (c) =>
          c.args.includes('send') &&
          c.args.includes('create') &&
          c.args.includes('--file'),
      ),
    );
  });

  test('receive with downloadFile reads file', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([['receive', { stdout: '', stderr: '' }]]),
      sideEffect: async (args) => {
        const outputIdx = args.indexOf('--output');
        if (outputIdx >= 0) {
          const filePath = args[outputIdx + 1];
          if (filePath) {
            await writeFile(filePath, 'received-binary');
          }
        }
      },
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.receive({
      url: 'https://send.bw/abc',
      downloadFile: true,
    })) as { file: { filename: string; bytes: number; contentBase64: string } };

    assert.ok(result.file);
    assert.equal(
      Buffer.from(result.file.contentBase64, 'base64').toString(),
      'received-binary',
    );
  });

  test('createAttachment writes temp file and refetches item', async () => {
    const item = { id: 'att-item', type: 1, attachments: [{ id: 'a1' }] };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create attachment', { stdout: '{}', stderr: '' }],
        ['get item', { stdout: JSON.stringify(item), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createAttachment({
      itemId: 'att-item',
      filename: 'new-attach.pdf',
      contentBase64: Buffer.from('pdf-data').toString('base64'),
    })) as { id: string };

    assert.equal(result.id, 'att-item');
    assert.ok(
      calls.some(
        (c) =>
          c.args.includes('create') &&
          c.args.includes('attachment') &&
          c.args.includes('--file'),
      ),
    );
  });

  test('createCard with collectionIds calls item-collections edit', async () => {
    const card = { id: 'card-col', type: 3 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(card), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createCard({
      name: 'Card With Cols',
      organizationId: 'org1',
      collectionIds: ['c1'],
    });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Security: receive URL validation
// ---------------------------------------------------------------------------

describe('KeychainSdk security', () => {
  test('receive rejects http:// URLs', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.receive({ url: 'http://send.bw/abc' }),
      /HTTPS/,
    );
  });

  test('receive rejects file:// URLs', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.receive({ url: 'file:///etc/passwd' }),
      /HTTPS/,
    );
  });

  test('receive accepts https:// URLs', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([['receive', { stdout: 'ok\n', stderr: '' }]]),
    });
    const sdk = new KeychainSdk(mock);
    const result = (await sdk.receive({ url: 'https://send.bw/abc' })) as {
      text: string;
    };
    assert.equal(result.text, 'ok');
  });

  test('parseBwJson error does not leak raw stdout', async () => {
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async () => ({
        stdout: '{"password":"super-secret-value',
        stderr: '',
      }),
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    try {
      await sdk.getItem('1');
      assert.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      assert.ok(
        !msg.includes('super-secret'),
        'error must not contain secrets',
      );
      assert.ok(msg.includes('bytes'), 'error should mention byte count');
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage: setLoginUris, createSshKey, getExposed error paths
// ---------------------------------------------------------------------------

describe('KeychainSdk additional coverage', () => {
  test('setLoginUris replace mode', async () => {
    const currentItem = {
      id: 'u1',
      type: 1,
      login: { uris: [{ uri: 'https://old.com', match: 0 }] },
    };
    const updatedItem = { ...currentItem };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get item', { stdout: JSON.stringify(currentItem), stderr: '' }],
        ['edit item', { stdout: JSON.stringify(updatedItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.setLoginUris({
      id: 'u1',
      mode: 'replace',
      uris: [{ uri: 'https://new.com', match: 'exact' }],
    });

    const editCall = calls.find(
      (c) => c.args.includes('edit') && c.args.includes('item'),
    );
    assert.ok(editCall);
  });

  test('setLoginUris merge mode merges and deduplicates', async () => {
    const currentItem = {
      id: 'u1',
      type: 1,
      login: {
        uris: [
          { uri: 'https://existing.com', match: 0 },
          { uri: 'https://shared.com', match: 1 },
        ],
      },
    };
    const updatedItem = { ...currentItem };
    const { mock } = createMockBw({
      runResponses: new Map([
        ['get item', { stdout: JSON.stringify(currentItem), stderr: '' }],
        ['edit item', { stdout: JSON.stringify(updatedItem), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.setLoginUris({
      id: 'u1',
      mode: 'merge',
      uris: [
        { uri: 'https://shared.com', match: 'exact' },
        { uri: 'https://brand-new.com', match: 'domain' },
      ],
    });
    // merge should deduplicate by URI
  });

  test('setLoginUris rejects invalid mode', async () => {
    const { mock } = createMockBw();
    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () =>
        sdk.setLoginUris({
          id: 'u1',
          mode: 'invalid' as 'replace',
          uris: [],
        }),
      /Invalid mode/,
    );
  });

  test('createSshKey creates note with SSH key fields', async () => {
    const createdNote = { id: 'ssh-1', type: 2 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(createdNote), stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    const result = (await sdk.createSshKey({
      name: 'My SSH Key',
      publicKey: 'ssh-ed25519 AAAA...',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
      fingerprint: 'SHA256:abc123',
      comment: 'work laptop',
    })) as { id: string };

    assert.equal(result.id, 'ssh-1');
    const createCall = calls.find((c) => c.args.includes('create'));
    assert.ok(createCall);
    const encoded = createCall.args.at(-1) ?? '';
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assert.equal(decoded.type, 2); // note
    const fieldNames = decoded.fields.map((f: { name: string }) => f.name);
    assert.ok(fieldNames.includes('public_key'));
    assert.ok(fieldNames.includes('private_key'));
    assert.ok(fieldNames.includes('fingerprint'));
    assert.ok(fieldNames.includes('comment'));
  });

  test('getExposed returns null for BwCliError not-found', async () => {
    const { BwCliError: BwCliErrorClass } = await import('../bw/bwCli.js');
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async () => {
        throw new BwCliErrorClass('bw get exposed failed with exit code 1', {
          exitCode: 1,
          stdout: 'Not found.',
          stderr: '',
        });
      },
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    const result = await sdk.getExposed({ term: 'nonexistent' });
    assert.equal(result.value, null);
    assert.equal(result.revealed, false);
  });

  test('getExposed rethrows on connection errors', async () => {
    const { BwCliError: BwCliErrorClass } = await import('../bw/bwCli.js');
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async () => {
        throw new BwCliErrorClass('bw failed', {
          exitCode: 1,
          stdout: '',
          stderr: 'could not connect to server',
        });
      },
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    await assert.rejects(() => sdk.getExposed({ term: 'test' }));
  });

  test('getExposed rethrows on multiple results error', async () => {
    const { BwCliError: BwCliErrorClass } = await import('../bw/bwCli.js');
    const bw = {
      withSession: async (fn: (s: string) => Promise<unknown>) => fn('s'),
      runForSession: async () => {
        throw new BwCliErrorClass('bw failed', {
          exitCode: 1,
          stdout: 'More than one result was found.',
          stderr: '',
        });
      },
    } as unknown as BwSessionManager;

    const sdk = new KeychainSdk(bw);
    await assert.rejects(() => sdk.getExposed({ term: 'test' }));
  });

  test('createIdentity with collectionIds calls item-collections edit', async () => {
    const identity = { id: 'id-col', type: 4 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(identity), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createIdentity({
      name: 'ID with cols',
      organizationId: 'org1',
      collectionIds: ['c1'],
    });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });

  test('updateItem with collectionIds calls item-collections edit', async () => {
    const currentItem = { id: 'u1', type: 1, name: 'test', login: {} };
    const updatedItem = { ...currentItem };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['get item', { stdout: JSON.stringify(currentItem), stderr: '' }],
        ['edit item', { stdout: JSON.stringify(updatedItem), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.updateItem('u1', { collectionIds: ['c1', 'c2'] });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });

  test('searchItems returns card items via kindFromItem', async () => {
    const { mock } = createMockBw({
      runResponses: new Map([
        [
          'list items',
          {
            stdout: JSON.stringify([
              { id: '1', type: 3 },
              { id: '2', type: 4 },
              { id: '3', type: 99 },
            ]),
            stderr: '',
          },
        ],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    // type=card filters for type 3
    const cards = await sdk.searchItems({ type: 'card' });
    assert.equal(cards.length, 1);
    // type=identity filters for type 4
    const ids = await sdk.searchItems({ type: 'identity' });
    assert.equal(ids.length, 1);
    // unknown type 99 falls through to 'note' default in kindFromItem
    const all = await sdk.searchItems({});
    assert.equal(all.length, 3);
  });

  test('readSingleFileAsBase64 throws when dir has multiple files', async () => {
    // getAttachment calls readSingleFileAsBase64 internally.
    // If bw writes multiple files, it should throw.
    const { mock } = createMockBw({
      runResponses: new Map([['get attachment', { stdout: '', stderr: '' }]]),
      sideEffect: async (args) => {
        const outputIdx = args.indexOf('--output');
        if (outputIdx >= 0) {
          const dir = args[outputIdx + 1];
          if (dir) {
            await writeFile(join(dir, 'file1.txt'), 'a');
            await writeFile(join(dir, 'file2.txt'), 'b');
          }
        }
      },
    });

    const sdk = new KeychainSdk(mock);
    await assert.rejects(
      () => sdk.getAttachment({ itemId: '1', attachmentId: 'a1' }),
      /Expected exactly 1 downloaded file/,
    );
  });

  test('createCard with collectionIds calls item-collections edit', async () => {
    const card = { id: 'card-col2', type: 3 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(card), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createCard({
      name: 'Card Cols',
      organizationId: 'org1',
      collectionIds: ['c1'],
    });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });

  test('syncOnWrite=false skips sync call', async () => {
    const saved = process.env.KEYCHAIN_SYNC_ON_WRITE;
    process.env.KEYCHAIN_SYNC_ON_WRITE = 'false';
    try {
      const folder = { id: 'f1', name: 'test' };
      const { mock, calls } = createMockBw({
        runResponses: new Map([
          ['create folder', { stdout: JSON.stringify(folder), stderr: '' }],
        ]),
      });

      const sdk = new KeychainSdk(mock);
      await sdk.createFolder({ name: 'test' });
      assert.ok(!calls.some((c) => c.args.includes('sync')));
    } finally {
      if (saved === undefined) delete process.env.KEYCHAIN_SYNC_ON_WRITE;
      else process.env.KEYCHAIN_SYNC_ON_WRITE = saved;
    }
  });

  test('createNote with collectionIds calls item-collections edit', async () => {
    const note = { id: 'note-col', type: 2 };
    const { mock, calls } = createMockBw({
      runResponses: new Map([
        ['create item', { stdout: JSON.stringify(note), stderr: '' }],
        ['edit item-collections', { stdout: '{}', stderr: '' }],
        ['sync', { stdout: '', stderr: '' }],
      ]),
    });

    const sdk = new KeychainSdk(mock);
    await sdk.createNote({
      name: 'Note with cols',
      organizationId: 'org1',
      collectionIds: ['c1'],
    });

    assert.ok(
      calls.some(
        (c) => c.args.includes('edit') && c.args.includes('item-collections'),
      ),
    );
  });
});

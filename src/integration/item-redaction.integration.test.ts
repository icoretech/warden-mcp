import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

import { BwSessionPool } from '../bw/bwPool.js';
import { readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';
import { REDACTED } from '../sdk/redact.js';

type Item = Record<string, unknown>;

function structuredContent(result: Record<string, unknown>): Item {
  assert.ok(
    result.structuredContent && typeof result.structuredContent === 'object',
  );
  return result.structuredContent as Item;
}

test('mcp stdio: native SSH keys and notes respect reveal and NOREVEAL against Vaultwarden', {
  timeout: 180_000,
}, async (t) => {
  if (!process.env.BW_HOST) {
    t.skip('BW_HOST not set (requires the compose-backed vault)');
    return;
  }

  const bwEnv = readBwEnv();
  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'mcp-item-redaction-'));
  const pool = new BwSessionPool({ rootDir: bwHomeRoot });
  const bw = await pool.getOrCreate(bwEnv);
  const sdk = new KeychainSdk(bw);
  const items: Item[] = [];
  const namePrefix = `item-redaction-${Date.now()}`;
  const keys = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const definitions = [
    {
      type: 5,
      name: `${namePrefix}-native-ssh`,
      notes: 'test-only-ssh-notes',
      sshKey: {
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        keyFingerprint: 'test-only-fingerprint',
      },
    },
    {
      type: 1,
      name: `${namePrefix}-login`,
      notes: 'test-only-login-notes',
      login: { username: 'sample-user', password: 'test-only-password' },
    },
    {
      type: 2,
      name: `${namePrefix}-note`,
      notes: 'test-only-secure-note-body',
      secureNote: { type: 0 },
    },
    {
      type: 2,
      name: `${namePrefix}-legacy-ssh`,
      notes: 'test-only-legacy-ssh-notes',
      secureNote: { type: 0 },
      fields: [
        { name: 'public_key', type: 0, value: keys.publicKey },
        { name: 'private_key', type: 0, value: keys.privateKey },
      ],
    },
  ];

  try {
    // Seed native items through the real CLI, independently of SDK creation.
    await bw.withSession(async (session) => {
      const template = await bw.getTemplateItemForSession(session);
      assert.ok(template && typeof template === 'object');
      for (const definition of definitions) {
        const payload = { ...template, ...definition };
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
        const { stdout } = await bw.runForSession(session, [
          'create',
          'item',
          encoded,
        ]);
        const item = JSON.parse(stdout) as Item;
        items.push(item);
        assert.equal(item.type, definition.type);
        assert.equal(item.notes, definition.notes);
        assert.equal(typeof item.id, 'string');
      }
    });

    for (const guard of ['NOREVEAL', 'KEYCHAIN_NOREVEAL', 'none']) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL('../server.js', import.meta.url)),
          '--stdio',
        ],
        env: {
          ...getDefaultEnvironment(),
          BW_HOST: bwEnv.host,
          BW_PASSWORD: bwEnv.password,
          ...(bwEnv.login.method === 'apikey'
            ? {
                BW_CLIENTID: bwEnv.login.clientId,
                BW_CLIENTSECRET: bwEnv.login.clientSecret,
              }
            : { BW_USER: bwEnv.login.user }),
          KEYCHAIN_BW_HOME_ROOT: bwHomeRoot,
          NODE_TLS_REJECT_UNAUTHORIZED:
            process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '1',
          READONLY: 'true',
          NOREVEAL: guard === 'NOREVEAL' ? 'true' : 'false',
          KEYCHAIN_NOREVEAL: guard === 'KEYCHAIN_NOREVEAL' ? 'true' : 'false',
          KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json',
        },
        stderr: 'pipe',
      });
      const client = new Client(
        { name: 'item-redaction-test', version: '0.0.0' },
        { capabilities: {} },
      );

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.ok(
          !tools.tools.some((tool) => tool.name === 'keychain_create_login'),
        );

        for (const source of items) {
          await t.test(`${guard}: ${source.name}`, async () => {
            const revealRequests =
              guard === 'none'
                ? [undefined, false, true]
                : guard === 'NOREVEAL'
                  ? [undefined, true]
                  : [true];
            for (const reveal of revealRequests) {
              const permitted = guard === 'none' && reveal === true;
              const result = await client.callTool({
                name: 'keychain_get_item',
                arguments: {
                  id: source.id,
                  ...(reveal === undefined ? {} : { reveal }),
                },
              });
              assert.equal(result.isError, undefined);
              const item = structuredContent(result).item as Item;
              assert.ok(item && typeof item === 'object');
              assert.equal(item.id, source.id);
              if (source.type === 5) {
                const sshKey = item.sshKey as Item;
                assert.equal(
                  sshKey.privateKey ===
                    (permitted ? keys.privateKey : REDACTED),
                  true,
                  'native private key must follow the reveal policy',
                );
                assert.equal(sshKey.publicKey, keys.publicKey);
                assert.equal(sshKey.keyFingerprint, 'test-only-fingerprint');
              }
              assert.equal(item.notes, permitted ? source.notes : REDACTED);
              if (source.type === 1) {
                assert.equal(
                  (item.login as Item).password,
                  permitted ? 'test-only-password' : REDACTED,
                );
              }
              if (Array.isArray(source.fields) && source.fields.length > 0) {
                assert.ok(Array.isArray(item.fields));
                const privateField = (item.fields as Item[]).find(
                  (field) => field.name === 'private_key',
                );
                assert.ok(privateField);
                assert.equal(
                  privateField.value ===
                    (permitted ? keys.privateKey : REDACTED),
                  true,
                  'legacy private key must follow the reveal policy',
                );
              }
              const text = (result.content as { type: string; text?: string }[])
                .filter((block) => block.type === 'text')
                .map((block) => block.text ?? '')
                .join('\n');
              assert.deepEqual(JSON.parse(text), { item });
            }

            const notes = await client.callTool({
              name: 'keychain_get_notes',
              arguments: { term: source.id, reveal: true },
            });
            assert.equal(notes.isError, undefined);
            assert.deepEqual(structuredContent(notes).result, {
              kind: 'notes',
              value: guard === 'none' ? source.notes : null,
              revealed: guard === 'none',
            });
          });
        }

        await t.test(
          `${guard}: search classifies native and legacy SSH keys`,
          async () => {
            for (const type of ['ssh_key', 'note']) {
              const found = await client.callTool({
                name: 'keychain_search_items',
                arguments: { text: namePrefix, type },
              });
              assert.equal(found.isError, undefined);
              const results = structuredContent(found).results as Item[];
              const expected =
                type === 'ssh_key' ? [items[0], items[3]] : [items[2]];
              assert.deepEqual(
                results.map((item) => item.id).sort(),
                expected.map((item) => item.id).sort(),
              );
              for (const item of results) assert.equal(item.type, type);
            }
          },
        );
      } finally {
        await client.close();
      }
    }
  } finally {
    if (items.length > 0) {
      await sdk.deleteItems({
        ids: items.map((item) => String(item.id)),
        permanent: true,
      });
    }
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

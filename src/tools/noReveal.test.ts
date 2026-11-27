import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { BwSessionManager } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';
import { type RegisterToolsDeps, registerTools } from './registerTools.js';

const modes = [
  { flag: 'NOREVEAL', jsonText: false },
  { flag: 'KEYCHAIN_NOREVEAL', jsonText: true },
] as const;
const textContent = z.tuple([
  z.object({ type: z.literal('text'), text: z.string() }),
]);

async function connect(
  t: TestContext,
  mode: (typeof modes)[number],
  getSdk: RegisterToolsDeps['getSdk'],
) {
  const server = new McpServer({ name: 'policy-tests', version: '1' });
  const env = process.env;
  try {
    process.env = {
      ...env,
      NOREVEAL: 'false',
      KEYCHAIN_NOREVEAL: 'false',
      READONLY: 'false',
      KEYCHAIN_READONLY: 'false',
      KEYCHAIN_TEXT_COMPAT_MODE: mode.jsonText ? 'structured_json' : '',
      [mode.flag]: 'true',
    };
    registerTools(server, {
      getSdk,
      toolPrefix: 'keychain',
      toolSeparator: '_',
    });
  } finally {
    process.env = env;
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'policy-tests', version: '1' });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const sendId = 'sample-id';
const sendMetadata = { id: sendId, name: 'Sample Send', type: 0 };
const sampleSend = {
  ...sendMetadata,
  notes: 'fixture-only',
  accessUrl: 'https://example.test/fixture-only',
  text: { text: 'fixture-only' },
  extraFromCli: { sample: 'fixture-only' },
};

for (const mode of modes) {
  test(`${mode.flag} refuses content reads before opening a vault session`, async (t) => {
    const getSdk = t.mock.fn(async () => {
      throw new Error('No vault session available');
    });
    const client = await connect(t, mode, getSdk);
    const url = 'https://example.test/sample';
    const calls = [
      {
        name: 'get_attachment',
        arguments: { itemId: 'item', attachmentId: 'file' },
      },
      { name: 'send_get', arguments: { id: sendId, text: true } },
      { name: 'receive', arguments: { url } },
      { name: 'receive', arguments: { url, obj: true } },
      { name: 'receive', arguments: { url, downloadFile: true } },
    ];
    for (const call of calls) {
      const reply = await client.callTool({
        ...call,
        name: `keychain_${call.name}`,
      });
      assert.equal(reply.isError, true, call.name);
      assert.deepEqual(
        reply.structuredContent,
        { ok: false, error: 'NOREVEAL' },
        call.name,
      );
      assert.match(
        textContent.parse(reply.content)[0].text,
        /NOREVEAL/,
        call.name,
      );
    }
    assert.equal(getSdk.mock.callCount(), 0);
  });

  test(`${mode.flag} returns only public Send metadata in both response channels`, async (t) => {
    const sdk = new KeychainSdk(
      new BwSessionManager(
        {
          host: 'https://example.test',
          login: { method: 'userpass', user: 'user@example.test' },
          unlockIntervalSeconds: 0,
        },
        {
          credentialProvider: () => {
            throw new Error('No live vault in this test');
          },
        },
      ),
    );
    const client = await connect(t, mode, async () => sdk);
    t.mock.method(sdk, 'sendList', async () => [
      sampleSend,
      'fixture-only',
      { id: sendId, name: { unexpected: 'fixture-only' } },
    ]);
    t.mock.method(sdk, 'sendGet', async () => sampleSend);
    t.mock.method(sdk, 'sendCreate', async () => sampleSend.accessUrl);
    t.mock.method(sdk, 'sendCreateEncoded', async () => sampleSend);
    t.mock.method(sdk, 'sendEdit', async () => sampleSend);
    t.mock.method(sdk, 'sendRemovePassword', async () => sampleSend);
    t.mock.method(sdk, 'sendDelete', async () => sampleSend);
    const calls = [
      {
        name: 'send_list',
        args: {},
        expected: { sends: [sendMetadata, null, null] },
      },
      {
        name: 'send_get',
        args: { id: sendId },
        expected: { result: sendMetadata },
      },
      {
        name: 'send_create',
        args: { type: 'text', text: 'sample' },
        expected: { send: null },
      },
      {
        name: 'send_create_encoded',
        args: { text: 'sample' },
        expected: { send: sendMetadata },
      },
      {
        name: 'send_edit',
        args: { json: sendMetadata },
        expected: { send: sendMetadata },
      },
      {
        name: 'send_remove_password',
        args: { id: sendId },
        expected: { result: sendMetadata },
      },
      {
        name: 'send_delete',
        args: { id: sendId },
        expected: { result: sendMetadata, id: sendId },
      },
    ];
    for (const { name, args, expected } of calls) {
      const reply = await client.callTool({
        name: `keychain_${name}`,
        arguments: args,
      });
      assert.ok(!reply.isError, name);
      assert.deepEqual(reply.structuredContent, expected, name);
      const [{ text }] = textContent.parse(reply.content);
      if (mode.jsonText) {
        assert.deepEqual(JSON.parse(text), expected, name);
      } else {
        assert.doesNotMatch(text, /fixture-only/, name);
        assert.ok(
          text.includes(name === 'send_create' ? 'null' : sendId),
          name,
        );
      }
    }

    t.mock.method(sdk, 'sendList', async () => ({
      unexpected: 'fixture-only',
    }));
    const malformed = await client.callTool({
      name: 'keychain_send_list',
      arguments: {},
    });
    assert.deepEqual(malformed.structuredContent, { sends: [] });
    assert.doesNotMatch(JSON.stringify(malformed.content), /fixture-only/);
  });
}

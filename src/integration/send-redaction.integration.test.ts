import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { z } from 'zod';

import { BwSessionManager, readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';

function responsePayloads(result: Awaited<ReturnType<Client['callTool']>>) {
  const [block] = z
    .tuple([z.object({ type: z.literal('text'), text: z.string() })])
    .parse(result.content);
  return [result.structuredContent, JSON.parse(block.text) as unknown];
}

test('mcp stdio: no-reveal returns only Send metadata and denies content reads against Vaultwarden', {
  timeout: 180_000,
}, async (t) => {
  if (!process.env.BW_HOST) {
    t.skip('requires the compose-backed vault');
    return;
  }

  const credentials = readBwEnv();
  const root = await mkdtemp(join(tmpdir(), 'mcp-send-policy-'));
  const manager = new BwSessionManager({
    ...credentials,
    homeDir: join(root, 'seed'),
  });
  const sdk = new KeychainSdk(manager);
  const client = new Client({ name: 'send-policy-test', version: '0.0.0' });
  const name = `sample-send-${randomUUID()}`;
  let sendId: string | undefined;
  let itemId: string | undefined;
  t.after(async () => {
    const cleanup = await Promise.allSettled([
      client.close(),
      sendId && sdk.sendDelete({ id: sendId }),
      itemId && sdk.deleteItem({ id: itemId, permanent: true }),
    ]);
    await rm(root, { recursive: true, force: true });
    for (const outcome of cleanup)
      if (outcome.status === 'rejected') throw outcome.reason;
  });
  const createdSend = await sdk.sendCreate({
    type: 'text',
    name,
    text: 'sample message',
    notes: 'sample note',
    deleteInDays: 1,
    fullObject: true,
  });
  sendId = z.object({ id: z.string() }).parse(createdSend).id;
  const send = z
    .object({
      type: z.union([z.string(), z.number()]),
      accessUrl: z.url(),
    })
    .parse(createdSend);
  const createdItem = await sdk.createLogin({
    name,
    attachments: [
      {
        filename: 'sample.txt',
        contentBase64: Buffer.from('sample file').toString('base64'),
      },
    ],
  });
  itemId = z.object({ id: z.string() }).parse(createdItem).id;
  const item = z
    .object({
      attachments: z.array(z.object({ id: z.string() })).nonempty(),
    })
    .parse(createdItem);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../server.js', import.meta.url)), '--stdio'],
    env: {
      ...getDefaultEnvironment(),
      BW_HOST: credentials.host,
      BW_PASSWORD: credentials.password,
      ...(credentials.login.method === 'apikey'
        ? {
            BW_CLIENTID: credentials.login.clientId,
            BW_CLIENTSECRET: credentials.login.clientSecret,
          }
        : { BW_USER: credentials.login.user }),
      NODE_TLS_REJECT_UNAUTHORIZED:
        process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '1',
      KEYCHAIN_BW_HOME_ROOT: join(root, 'read'),
      READONLY: 'true',
      NOREVEAL: 'true',
      KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);

  const metadata = z.strictObject({
    id: z.string(),
    name: z.string(),
    type: z.union([z.string(), z.number()]),
  });
  for (const read of ['list', 'get'] as const) {
    const result = await client.callTool({
      name: `keychain_send_${read}`,
      arguments: read === 'list' ? {} : { id: sendId },
    });
    assert.notEqual(result.isError, true);
    for (const payload of responsePayloads(result)) {
      const actual: z.infer<typeof metadata> | undefined =
        read === 'list'
          ? z
              .strictObject({ sends: z.array(metadata) })
              .parse(payload)
              .sends.find((entry) => entry.id === sendId)
          : z.strictObject({ result: metadata }).parse(payload).result;
      assert.deepEqual(actual, { id: sendId, name, type: send.type });
    }
  }

  const denial = { ok: false, error: 'NOREVEAL' };
  for (const request of [
    {
      name: 'keychain_get_attachment',
      arguments: { itemId, attachmentId: item.attachments[0].id },
    },
    { name: 'keychain_send_get', arguments: { id: sendId, text: true } },
    { name: 'keychain_receive', arguments: { url: send.accessUrl } },
  ]) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
    for (const payload of responsePayloads(result))
      assert.deepEqual(payload, denial);
  }
});

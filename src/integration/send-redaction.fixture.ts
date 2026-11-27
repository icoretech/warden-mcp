import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';

import type { KeychainSdk } from '../sdk/keychainSdk.js';

function responsePayloads(result: Awaited<ReturnType<Client['callTool']>>) {
  const [block] = z
    .tuple([z.object({ type: z.literal('text'), text: z.string() })])
    .parse(result.content);
  return [result.structuredContent, JSON.parse(block.text) as unknown];
}

export async function assertNoRevealSendReads(
  client: Client,
  sdk: KeychainSdk,
  itemId: string,
) {
  const createdItem = await sdk.createAttachment({
    itemId,
    filename: 'sample.txt',
    contentBase64: Buffer.from('sample file').toString('base64'),
  });
  const item = z
    .object({ attachments: z.array(z.object({ id: z.string() })).length(1) })
    .parse(createdItem);
  const name = `sample-send-${randomUUID()}`;
  const createdSend = await sdk.sendCreate({
    type: 'text',
    name,
    text: 'sample message',
    notes: 'sample note',
    deleteInDays: 1,
    fullObject: true,
  });
  const sendId = z.object({ id: z.string() }).parse(createdSend).id;
  try {
    const send = z
      .object({
        type: z.union([z.string(), z.number()]),
        accessUrl: z.url(),
      })
      .parse(createdSend);
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
  } finally {
    await sdk.sendDelete({ id: sendId });
  }
}

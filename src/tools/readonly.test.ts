import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createKeychainApp } from '../transports/http.js';

test('READONLY=true hides and rejects mutating tools before BW headers are required', async () => {
  const prev = process.env.READONLY;
  process.env.READONLY = 'true';

  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-readonly-'));
  const app = createKeychainApp({ bwHomeRoot });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    process.env.READONLY = prev;
    await rm(bwHomeRoot, { recursive: true, force: true });
    httpServer.close();
    throw new Error('Unexpected server address');
  }

  const url = new URL(`http://127.0.0.1:${addr.port}/sse`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client(
    { name: 'keychain-readonly-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((x) => x.name);
    assert.ok(names.includes('keychain_send_list'));
    assert.ok(names.includes('keychain_send_get'));
    assert.ok(names.includes('keychain_receive'));
    assert.ok(names.includes('keychain_get_attachment'));

    assert.ok(!names.includes('keychain_send_create'));
    assert.ok(!names.includes('keychain_send_create_encoded'));
    assert.ok(!names.includes('keychain_send_edit'));
    assert.ok(!names.includes('keychain_send_delete'));
    assert.ok(!names.includes('keychain_create_note'));
    assert.ok(!names.includes('keychain_create_login'));
    assert.ok(!names.includes('keychain_update_item'));
    assert.ok(!names.includes('keychain_delete_item'));
    assert.ok(!names.includes('keychain_create_attachment'));
    assert.ok(!names.includes('keychain_delete_attachment'));

    const blockedCalls: Array<{
      name: string;
      arguments: Record<string, unknown>;
    }> = [
      { name: 'keychain_create_note', arguments: { name: 'x' } },
      { name: 'keychain_create_login', arguments: { name: 'x' } },
      { name: 'keychain_update_item', arguments: { id: 'x', patch: {} } },
      { name: 'keychain_delete_item', arguments: { id: 'x' } },
      { name: 'keychain_delete_items', arguments: { ids: ['x', 'y'] } },
      { name: 'keychain_restore_item', arguments: { id: 'x' } },
      { name: 'keychain_create_folder', arguments: { name: 'x' } },
      { name: 'keychain_edit_folder', arguments: { id: 'x', name: 'x' } },
      { name: 'keychain_delete_folder', arguments: { id: 'x' } },
      {
        name: 'keychain_create_attachment',
        arguments: {
          itemId: 'x',
          filename: 'x.txt',
          contentBase64: 'aGVsbG8=',
        },
      },
      {
        name: 'keychain_delete_attachment',
        arguments: { itemId: 'x', attachmentId: 'x' },
      },
      {
        name: 'keychain_send_create',
        arguments: { type: 'text', text: 'hello', name: 'x' },
      },
      {
        name: 'keychain_send_create_encoded',
        arguments: { text: 'hello' },
      },
      {
        name: 'keychain_send_edit',
        arguments: { json: { id: 'x', type: 0, name: 'x' } },
      },
      {
        name: 'keychain_send_remove_password',
        arguments: { id: 'x' },
      },
      {
        name: 'keychain_send_delete',
        arguments: { id: 'x' },
      },
    ];

    for (const c of blockedCalls) {
      const res = await client.callTool(c);
      assert.equal(res.isError, true, c.name);
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(text.includes('not found'), c.name);
    }
  } finally {
    process.env.READONLY = prev;
    await transport.terminateSession().catch(() => {});
    await transport.close().catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

test('READONLY=true hides and rejects mutating tools even when BW headers are present', async () => {
  const prev = process.env.READONLY;
  process.env.READONLY = 'true';

  const bwHomeRoot = await mkdtemp(
    join(tmpdir(), 'keychain-readonly-headers-'),
  );
  const app = createKeychainApp({ bwHomeRoot });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    process.env.READONLY = prev;
    await rm(bwHomeRoot, { recursive: true, force: true });
    httpServer.close();
    throw new Error('Unexpected server address');
  }

  const url = new URL(`http://127.0.0.1:${addr.port}/sse`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        'X-BW-Host': 'https://example.invalid',
        'X-BW-Password': 'test-only',
        'X-BW-ClientId': 'test-only',
        'X-BW-ClientSecret': 'test-only',
      },
    },
  });
  const client = new Client(
    { name: 'keychain-readonly-headers-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(!names.includes('keychain_create_note'));

    const res = await client.callTool({
      name: 'keychain_create_note',
      arguments: { name: 'x' },
    });
    assert.equal(res.isError, true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
    assert.ok(text.includes('not found'));
  } finally {
    process.env.READONLY = prev;
    await transport.terminateSession().catch(() => {});
    await transport.close().catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

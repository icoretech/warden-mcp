import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createKeychainApp } from '../transports/http.js';

const DEFAULT_TOOL_PREFIX = 'keychain';
const DEFAULT_TOOL_SEPARATOR = '_';

function toolName(name: string, separator: string = DEFAULT_TOOL_SEPARATOR) {
  return `${DEFAULT_TOOL_PREFIX}${separator}${name}`;
}

// ---------------------------------------------------------------------------
// We test tool registration and behavior through an HTTP integration layer
// similar to readonly.test.ts.  This avoids needing to mock the MCP server
// internals and ensures we test the real wiring.
// ---------------------------------------------------------------------------

async function startTestServer(envOverrides?: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envOverrides ?? {})) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }

  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-tools-test-'));
  const app = createKeychainApp({ bwHomeRoot, allowEnvFallback: true });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('Bad address');

  const url = new URL(`http://127.0.0.1:${addr.port}/sse`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client(
    { name: 'tools-test', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    client,
    async cleanup() {
      await client.close();
      httpServer.close();
      await rm(bwHomeRoot, { recursive: true, force: true });
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

describe('registerTools: tool listing', () => {
  test('registers expected tool names with prefix', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);

      // Core read tools
      assert.ok(names.includes(toolName('status')));
      assert.ok(names.includes(toolName('sync')));
      assert.ok(names.includes(toolName('sdk_version')));
      assert.ok(names.includes(toolName('encode')));
      assert.ok(names.includes(toolName('generate')));
      assert.ok(names.includes(toolName('search_items')));
      assert.ok(names.includes(toolName('get_item')));

      // Mutating tools
      assert.ok(names.includes(toolName('create_login')));
      assert.ok(names.includes(toolName('create_note')));
      assert.ok(names.includes(toolName('delete_item')));

      // Should have a non-trivial number of tools
      assert.ok(names.length >= 20, `Expected 20+ tools, got ${names.length}`);
    } finally {
      await cleanup();
    }
  });

  test('all tools have descriptions', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      for (const tool of tools.tools) {
        assert.ok(
          typeof tool.description === 'string' && tool.description.length > 0,
          `Tool ${tool.name} missing description`,
        );
      }
    } finally {
      await cleanup();
    }
  });

  test('TOOL_SEPARATOR can restore legacy dotted names', async () => {
    const { client, cleanup } = await startTestServer({ TOOL_SEPARATOR: '.' });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      assert.ok(names.includes(toolName('status', '.')));
      assert.ok(!names.includes(toolName('status')));
    } finally {
      await cleanup();
    }
  });
});

describe('registerTools: READONLY behavior', () => {
  test('readonly=on blocks create_login', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'on',
    });
    try {
      const result = await client.callTool({
        name: toolName('create_login'),
        arguments: { name: 'test' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(text.includes('READONLY'));
      assert.equal(result.isError, true);
    } finally {
      await cleanup();
    }
  });

  test('readonly=1 blocks delete_item', async () => {
    const { client, cleanup } = await startTestServer({ READONLY: '1' });
    try {
      const result = await client.callTool({
        name: toolName('delete_item'),
        arguments: { id: 'x' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(text.includes('READONLY'));
      assert.equal(result.isError, true);
    } finally {
      await cleanup();
    }
  });
});

describe('registerTools: read-only tools in readonly mode', () => {
  test('encode tool is not blocked by READONLY', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'true',
      // No BW headers needed — encode doesn't need them if we set
      // env vars.  But we can't actually call bw, so we just verify
      // it doesn't return READONLY error.
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      // This will fail because there's no real bw, but it should NOT
      // fail with READONLY error — it should attempt the real operation.
      const result = await client.callTool({
        name: toolName('encode'),
        arguments: { value: 'hello' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      // If READONLY were blocking, we'd see "Blocked: READONLY=true"
      assert.ok(
        !text.includes('READONLY'),
        'encode should not be readonly-blocked',
      );
    } finally {
      await cleanup();
    }
  });

  test('generate_username is not blocked by READONLY and works without bw', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'true',
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('generate_username'),
        arguments: { reveal: false },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(!text.includes('READONLY'));
      assert.equal(text, 'OK');
    } finally {
      await cleanup();
    }
  });

  test('generate with reveal=false returns OK without calling bw', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'true',
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('generate'),
        arguments: { reveal: false },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.equal(text, 'OK');
    } finally {
      await cleanup();
    }
  });

  test('generate_username with reveal=true works without bw', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'true',
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('generate_username'),
        arguments: { reveal: true, type: 'random_word' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.equal(text, 'OK');
      assert.equal(result.isError, undefined);
    } finally {
      await cleanup();
    }
  });

  test('get_password with reveal=false returns early', async () => {
    const { client, cleanup } = await startTestServer({
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_password'),
        arguments: { term: 'test', reveal: false },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.equal(text, 'OK');
    } finally {
      await cleanup();
    }
  });

  test('get_totp with reveal=false returns early', async () => {
    const { client, cleanup } = await startTestServer({
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_totp'),
        arguments: { term: 'test', reveal: false },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.equal(text, 'OK');
    } finally {
      await cleanup();
    }
  });

  test('get_notes with reveal=false returns early', async () => {
    const { client, cleanup } = await startTestServer({
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_notes'),
        arguments: { term: 'test', reveal: false },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.equal(text, 'OK');
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// E2E tool tests with a fake bw binary
// ---------------------------------------------------------------------------

async function createFakeBwScript(dir: string): Promise<string> {
  const scriptPath = join(dir, 'fake-bw');
  // Comprehensive fake bw that handles most commands.
  // Order matters: more specific patterns must come before generic ones.
  const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock'; then printf 'fake-session'; exit 0; fi
if echo "$*" | grep -q -- '--version'; then printf '2026.2.0'; exit 0; fi
if echo "$*" | grep -q 'sdk-version'; then printf "COMMERCIAL-' ()'"; exit 0; fi
if echo "$*" | grep -q 'sync'; then exit 0; fi
if echo "$*" | grep -q 'status'; then printf '{"status":"unlocked","serverUrl":"https://bw.test","userEmail":"test@test.com"}'; exit 0; fi
if echo "$*" | grep -q 'get template item'; then printf '{"type":1,"name":"","notes":"","favorite":false,"fields":[],"login":{"uris":[],"username":null,"password":null,"totp":null},"card":{},"identity":{},"organizationId":null,"collectionIds":[],"folderId":null,"reprompt":0}'; exit 0; fi
if echo "$*" | grep -q 'get username'; then printf 'user@test.com'; exit 0; fi
if echo "$*" | grep -q 'get password'; then printf 'secret-pw'; exit 0; fi
if echo "$*" | grep -q 'get totp'; then printf '123456'; exit 0; fi
if echo "$*" | grep -q 'get uri'; then printf 'https://example.com'; exit 0; fi
if echo "$*" | grep -q 'get notes'; then printf 'my notes'; exit 0; fi
if echo "$*" | grep -q 'get exposed'; then printf '3'; exit 0; fi
if echo "$*" | grep -q 'get attachment'; then
  for arg in "$@"; do
    case "$prev" in --output) outdir="$arg";; esac
    prev="$arg"
  done
  if [ -n "$outdir" ]; then printf 'file-data' > "$outdir/downloaded.bin"; fi
  exit 0
fi
if echo "$*" | grep -q 'get folder'; then printf '{"id":"f1","name":"Folder1"}'; exit 0; fi
if echo "$*" | grep -q 'get collection'; then printf '{"id":"c1","name":"Col1"}'; exit 0; fi
if echo "$*" | grep -q 'get organization'; then printf '{"id":"org1","name":"Org1"}'; exit 0; fi
if echo "$*" | grep -q 'get org-collection'; then printf '{"id":"oc1","name":"OrgCol1"}'; exit 0; fi
if echo "$*" | grep -q 'get item'; then printf '{"id":"1","type":1,"name":"Test","login":{"username":"u","password":"secret","totp":"otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=Test&period=45","uris":[]},"passwordHistory":[{"password":"old","lastUsedDate":"2024-01-01"}]}'; exit 0; fi
if echo "$*" | grep -q 'list items'; then printf '[{"id":"1","type":1,"name":"Test Login","login":{"username":"user","password":"pw","uris":[]}}]'; exit 0; fi
if echo "$*" | grep -q 'list folders'; then printf '[{"id":"f1","name":"Folder1"}]'; exit 0; fi
if echo "$*" | grep -q 'list org-collections'; then printf '[{"id":"oc1","name":"OrgCol1"}]'; exit 0; fi
if echo "$*" | grep -q 'list organizations'; then printf '[{"id":"org1","name":"Org1"}]'; exit 0; fi
if echo "$*" | grep -q 'list collections'; then printf '[]'; exit 0; fi
if echo "$*" | grep -q 'create org-collection'; then printf '{"id":"oc-new","name":"NewCol"}'; exit 0; fi
if echo "$*" | grep -q 'create attachment'; then printf '{}'; exit 0; fi
if echo "$*" | grep -q 'create folder'; then printf '{"id":"f-new","name":"NewFolder"}'; exit 0; fi
if echo "$*" | grep -q 'create item'; then printf '{"id":"new-1","type":1,"name":"Created"}'; exit 0; fi
if echo "$*" | grep -q 'edit item-collections'; then exit 0; fi
if echo "$*" | grep -q 'edit org-collection'; then printf '{"id":"oc1","name":"Edited"}'; exit 0; fi
if echo "$*" | grep -q 'edit folder'; then printf '{"id":"f1","name":"Edited"}'; exit 0; fi
if echo "$*" | grep -q 'edit item'; then printf '{"id":"1","type":1,"name":"Updated"}'; exit 0; fi
if echo "$*" | grep -q 'delete org-collection'; then exit 0; fi
if echo "$*" | grep -q 'delete attachment'; then exit 0; fi
if echo "$*" | grep -q 'delete folder'; then exit 0; fi
if echo "$*" | grep -q 'delete item'; then exit 0; fi
if echo "$*" | grep -q 'restore item'; then exit 0; fi
if echo "$*" | grep -q 'move '; then printf '{"id":"1","type":1,"organizationId":"org1"}'; exit 0; fi
if echo "$*" | grep -q 'send list'; then printf '[]'; exit 0; fi
if echo "$*" | grep -q 'send template'; then printf '{"type":0,"text":{"text":"","hidden":false}}'; exit 0; fi
if echo "$*" | grep -q 'send get'; then printf '{"id":"s1","name":"Send1"}'; exit 0; fi
if echo "$*" | grep -q 'send create'; then printf '{}'; exit 0; fi
if echo "$*" | grep -q 'send edit'; then printf '{}'; exit 0; fi
if echo "$*" | grep -q 'send remove-password'; then printf '{}'; exit 0; fi
if echo "$*" | grep -q 'send delete'; then printf '{}'; exit 0; fi
if echo "$*" | grep -q 'receive'; then printf 'received text'; exit 0; fi
if echo "$*" | grep -q 'generate'; then printf 'xK9mP2vL'; exit 0; fi
if echo "$*" | grep -q 'encode'; then cat | base64; exit 0; fi
printf '{}'; exit 0
`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

describe('registerTools: e2e with fake bw', () => {
  // Shared e2e helper: creates fake bw, starts server, calls tool, cleans up.
  async function callToolE2e(toolName: string, args: Record<string, unknown>) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-e2e-'));
    const fakeBw = await createFakeBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
    });
    try {
      return await client.callTool({
        name: `keychain_${toolName}`,
        arguments: args,
      });
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  function textOf(result: Record<string, unknown>): string {
    const content = result.content;
    if (!Array.isArray(content)) return '';
    return (content as Array<{ text: string }>)[0]?.text ?? '';
  }

  // --- Read tools ---

  test('status', async () => {
    const r = await callToolE2e('status', {});
    assert.ok(textOf(r).includes('Vault access ready'));
  });

  test('sync', async () => {
    const r = await callToolE2e('sync', {});
    assert.equal(r.isError, undefined);
    assert.ok(textOf(r).includes('Synced'));
  });

  test('sdk_version', async () => {
    const r = await callToolE2e('sdk_version', {});
    assert.equal(r.isError, undefined);
    assert.ok(textOf(r).includes('2026.2.0'));
  });

  test('search_items', async () => {
    const r = await callToolE2e('search_items', { text: 'Test' });
    assert.equal(r.isError, undefined);
    assert.ok(textOf(r).includes('1 item'));
  });

  test('get_item', async () => {
    const r = await callToolE2e('get_item', { id: '1' });
    assert.equal(r.isError, undefined);
  });

  test('get_item with reveal', async () => {
    const r = await callToolE2e('get_item', { id: '1', reveal: true });
    assert.equal(r.isError, undefined);
  });

  test('list_folders', async () => {
    const r = await callToolE2e('list_folders', {});
    assert.equal(r.isError, undefined);
  });

  test('list_organizations', async () => {
    const r = await callToolE2e('list_organizations', {});
    assert.equal(r.isError, undefined);
  });

  test('list_collections', async () => {
    const r = await callToolE2e('list_collections', {});
    assert.equal(r.isError, undefined);
  });

  test('list_org_collections', async () => {
    const r = await callToolE2e('list_org_collections', {
      organizationId: 'org1',
    });
    assert.equal(r.isError, undefined);
  });

  test('get_folder', async () => {
    const r = await callToolE2e('get_folder', { id: 'f1' });
    assert.equal(r.isError, undefined);
  });

  test('get_collection', async () => {
    const r = await callToolE2e('get_collection', { id: 'c1' });
    assert.equal(r.isError, undefined);
  });

  test('get_organization', async () => {
    const r = await callToolE2e('get_organization', { id: 'org1' });
    assert.equal(r.isError, undefined);
  });

  test('get_org_collection', async () => {
    const r = await callToolE2e('get_org_collection', { id: 'oc1' });
    assert.equal(r.isError, undefined);
  });

  test('get_username', async () => {
    const r = await callToolE2e('get_username', { term: 'test' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'OK');
  });

  test('get_password with reveal=true', async () => {
    const r = await callToolE2e('get_password', {
      term: 'test',
      reveal: true,
    });
    assert.equal(r.isError, undefined);
  });

  test('get_totp with reveal=true', async () => {
    const originalDateNow = Date.now;
    Date.now = () => 41_000;
    try {
      const r = await callToolE2e('get_totp', { term: 'test', reveal: true });
      assert.equal(r.isError, undefined);
      const structured = r.structuredContent as {
        result?: {
          kind?: unknown;
          value?: unknown;
          revealed?: unknown;
          period?: unknown;
          timeLeft?: unknown;
        };
      };
      assert.equal(structured?.result?.kind, 'totp');
      assert.equal(structured?.result?.revealed, true);
      assert.equal(structured?.result?.value, '123456');
      assert.equal(structured?.result?.period, 45);
      assert.equal(structured?.result?.timeLeft, 4);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('get_uri', async () => {
    const r = await callToolE2e('get_uri', { term: 'test' });
    assert.equal(r.isError, undefined);
  });

  test('get_notes with reveal=true', async () => {
    const r = await callToolE2e('get_notes', { term: 'test', reveal: true });
    assert.equal(r.isError, undefined);
  });

  test('get_exposed', async () => {
    const r = await callToolE2e('get_exposed', { term: 'test' });
    assert.equal(r.isError, undefined);
  });

  test('get_password_history', async () => {
    const r = await callToolE2e('get_password_history', { id: '1' });
    assert.equal(r.isError, undefined);
  });

  test('encode', async () => {
    const r = await callToolE2e('encode', { value: 'hello' });
    assert.equal(r.isError, undefined);
  });

  test('generate with reveal=true', async () => {
    const r = await callToolE2e('generate', { reveal: true, length: 12 });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'OK');
  });

  test('generate_username with reveal=true', async () => {
    const r = await callToolE2e('generate_username', { reveal: true });
    assert.equal(r.isError, undefined);
  });

  // --- Send tools ---

  test('send_list', async () => {
    const r = await callToolE2e('send_list', {});
    assert.equal(r.isError, undefined);
  });

  test('send_template', async () => {
    const r = await callToolE2e('send_template', { object: 'send.text' });
    assert.equal(r.isError, undefined);
  });

  test('send_get', async () => {
    const r = await callToolE2e('send_get', { id: 's1' });
    assert.equal(r.isError, undefined);
  });

  test('send_delete', async () => {
    const r = await callToolE2e('send_delete', { id: 's1' });
    assert.equal(r.isError, undefined);
  });

  test('send_remove_password', async () => {
    const r = await callToolE2e('send_remove_password', { id: 's1' });
    assert.equal(r.isError, undefined);
  });

  // --- Mutating tools ---

  test('create_login', async () => {
    const r = await callToolE2e('create_login', {
      name: 'Test Login',
      username: 'user',
      password: 'pw',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('create_note', async () => {
    const r = await callToolE2e('create_note', { name: 'Test Note' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('create_card', async () => {
    const r = await callToolE2e('create_card', {
      name: 'My Card',
      cardholderName: 'Alice',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('create_identity', async () => {
    const r = await callToolE2e('create_identity', {
      name: 'My Identity',
      identity: { firstName: 'Alice' },
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('delete_item', async () => {
    const r = await callToolE2e('delete_item', { id: '1' });
    assert.equal(r.isError, undefined);
  });

  test('delete_items', async () => {
    const r = await callToolE2e('delete_items', { ids: ['1'] });
    assert.equal(r.isError, undefined);
  });

  test('restore_item', async () => {
    const r = await callToolE2e('restore_item', { id: '1' });
    assert.equal(r.isError, undefined);
  });

  test('update_item', async () => {
    const r = await callToolE2e('update_item', {
      id: '1',
      patch: { name: 'Updated' },
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Updated.');
  });

  test('create_folder', async () => {
    const r = await callToolE2e('create_folder', { name: 'New Folder' });
    assert.equal(r.isError, undefined);
  });

  test('edit_folder', async () => {
    const r = await callToolE2e('edit_folder', { id: 'f1', name: 'Edited' });
    assert.equal(r.isError, undefined);
  });

  test('delete_folder', async () => {
    const r = await callToolE2e('delete_folder', { id: 'f1' });
    assert.equal(r.isError, undefined);
  });

  test('create_org_collection', async () => {
    const r = await callToolE2e('create_org_collection', {
      organizationId: 'org1',
      name: 'New Col',
    });
    assert.equal(r.isError, undefined);
  });

  test('edit_org_collection', async () => {
    const r = await callToolE2e('edit_org_collection', {
      organizationId: 'org1',
      id: 'oc1',
      name: 'Edited',
    });
    assert.equal(r.isError, undefined);
  });

  test('delete_org_collection', async () => {
    const r = await callToolE2e('delete_org_collection', {
      organizationId: 'org1',
      id: 'oc1',
    });
    assert.equal(r.isError, undefined);
  });

  test('move_item_to_organization', async () => {
    const r = await callToolE2e('move_item_to_organization', {
      id: '1',
      organizationId: 'org1',
    });
    assert.equal(r.isError, undefined);
  });

  test('receive', async () => {
    const r = await callToolE2e('receive', {
      url: 'https://send.bw/abc',
    });
    assert.equal(r.isError, undefined);
  });

  test('send_create with text', async () => {
    const r = await callToolE2e('send_create', {
      type: 'text',
      text: 'hello world',
      name: 'test send',
    });
    assert.equal(r.isError, undefined);
  });

  test('send_edit with encodedJson', async () => {
    const r = await callToolE2e('send_edit', {
      encodedJson: Buffer.from('{}').toString('base64'),
    });
    assert.equal(r.isError, undefined);
  });

  test('create_login with uris exercises normalizeUrisInput', async () => {
    const r = await callToolE2e('create_login', {
      name: 'URI Test',
      uris: [
        { uri: 'https://example.com', match: 'domain' },
        { uri: 'https://other.com', match: 0 },
        { uri: 'https://base.com', match: 'base_domain' },
      ],
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('create_logins batch', async () => {
    const r = await callToolE2e('create_logins', {
      items: [{ name: 'Login A' }, { name: 'Login B' }],
    });
    assert.equal(r.isError, undefined);
  });

  test('set_login_uris', async () => {
    const r = await callToolE2e('set_login_uris', {
      id: '1',
      uris: [{ uri: 'https://new.com', match: 'exact' }],
    });
    assert.equal(r.isError, undefined);
  });

  test('create_attachment', async () => {
    const r = await callToolE2e('create_attachment', {
      itemId: '1',
      filename: 'test.txt',
      contentBase64: Buffer.from('hello').toString('base64'),
    });
    assert.equal(r.isError, undefined);
  });

  test('delete_attachment', async () => {
    const r = await callToolE2e('delete_attachment', {
      itemId: '1',
      attachmentId: 'att-1',
    });
    assert.equal(r.isError, undefined);
  });

  test('get_attachment', async () => {
    // This will fail at bw level (no real file output), but exercises the handler
    await callToolE2e('get_attachment', {
      itemId: '1',
      attachmentId: 'att-1',
    });
    // May error since fake bw doesn't write output files, but handler path is exercised
  });

  test('send_create_encoded with text', async () => {
    const r = await callToolE2e('send_create_encoded', { text: 'hello' });
    assert.equal(r.isError, undefined);
  });

  test('create_ssh_key', async () => {
    const r = await callToolE2e('create_ssh_key', {
      name: 'My Key',
      publicKey: 'ssh-ed25519 AAAA',
      privateKey: '-----BEGIN KEY-----',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created.');
  });

  test('create_login with numeric URI match', async () => {
    const r = await callToolE2e('create_login', {
      name: 'Numeric Match',
      uris: [
        { uri: 'https://a.com', match: 1 },
        { uri: 'https://b.com', match: 2 },
        { uri: 'https://c.com', match: 3 },
        { uri: 'https://d.com', match: 4 },
        { uri: 'https://e.com', match: 5 },
      ],
    });
    assert.equal(r.isError, undefined);
  });

  test('update_item with login.uris exercises normalizeUrisInput', async () => {
    const r = await callToolE2e('update_item', {
      id: '1',
      patch: {
        login: {
          uris: [{ uri: 'https://new.com', match: 'baseDomain' }],
        },
      },
    });
    assert.equal(r.isError, undefined);
  });

  test('list_org_collections exercises projection', async () => {
    const r = await callToolE2e('list_org_collections', {
      organizationId: 'org1',
    });
    assert.equal(r.isError, undefined);
  });
});

// ---------------------------------------------------------------------------
// NOREVEAL tests
// ---------------------------------------------------------------------------

describe('registerTools: NOREVEAL behavior', () => {
  test('NOREVEAL=true forces generate reveal to false', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-noreveal-'));
    const fakeBw = await createFakeBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      NOREVEAL: 'true',
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: 'keychain_generate',
        arguments: { reveal: true, length: 12 },
      });
      // With NOREVEAL, the server should downgrade reveal to false,
      // so the result should have value=null
      const structured = result.structuredContent as {
        result?: { value: unknown; revealed: boolean };
      };
      assert.equal(structured?.result?.value, null);
      assert.equal(structured?.result?.revealed, false);
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('NOREVEAL=true forces get_password reveal to false', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-noreveal-'));
    const fakeBw = await createFakeBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      NOREVEAL: 'true',
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'u@test.com',
    });
    try {
      const result = await client.callTool({
        name: 'keychain_get_password',
        arguments: { term: 'test', reveal: true },
      });
      const structured = result.structuredContent as {
        result?: { value: unknown; revealed: boolean };
      };
      assert.equal(structured?.result?.value, null);
      assert.equal(structured?.result?.revealed, false);
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createKeychainApp } from '../transports/http.js';

const INITIAL_STATUS_TIMEOUT_MS = 120_000;
const TOOL_PREFIX = 'keychain';
const TOOL_SEPARATOR = '_';

function toolName(name: string) {
  return `${TOOL_PREFIX}${TOOL_SEPARATOR}${name}`;
}

test('mcp e2e: can initialize, list tools, and call keychain_status over /sse', {
  timeout: 180_000,
}, async (t) => {
  const requireOrgTests = /^true$/i.test(
    process.env.KEYCHAIN_REQUIRE_ORG_TESTS ?? '',
  );
  const bwHost = process.env.BW_HOST;
  const bwPassword = process.env.BW_PASSWORD;
  const bwUser = process.env.BW_USER ?? process.env.BW_USERNAME;
  const bwClientId = process.env.BW_CLIENTID;
  const bwClientSecret = process.env.BW_CLIENTSECRET;
  const hasUserPass = Boolean(bwUser);
  const hasApiKey = Boolean(bwClientId && bwClientSecret);
  if (!bwHost || !bwPassword || (!hasUserPass && !hasApiKey)) {
    t.skip(
      'Missing BW_HOST/BW_PASSWORD and either BW_USER/BW_USERNAME or BW_CLIENTID/BW_CLIENTSECRET',
    );
    return;
  }

  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-mcp-e2e-'));
  const app = createKeychainApp({ bwHomeRoot });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await rm(bwHomeRoot, { recursive: true, force: true });
    httpServer.close();
    throw new Error('Unexpected server address');
  }

  const url = new URL(`http://127.0.0.1:${addr.port}/sse`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        'X-BW-Host': bwHost,
        'X-BW-Password': bwPassword,
        ...(hasUserPass ? { 'X-BW-User': bwUser } : {}),
        ...(hasApiKey
          ? {
              'X-BW-ClientId': bwClientId,
              'X-BW-ClientSecret': bwClientSecret,
            }
          : {}),
      },
    },
  });

  const client = new Client(
    { name: 'keychain-mcp-e2e', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((x) => x.name);
    assert.ok(names.includes(toolName('status')));
    assert.ok(names.includes(toolName('encode')));
    assert.ok(names.includes(toolName('generate')));
    assert.ok(names.includes(toolName('generate_username')));
    assert.ok(names.includes(toolName('list_folders')));
    assert.ok(names.includes(toolName('create_folder')));
    assert.ok(names.includes(toolName('edit_folder')));
    assert.ok(names.includes(toolName('delete_folder')));
    assert.ok(names.includes(toolName('list_organizations')));
    assert.ok(names.includes(toolName('list_collections')));
    assert.ok(names.includes(toolName('list_org_collections')));
    assert.ok(names.includes(toolName('create_org_collection')));
    assert.ok(names.includes(toolName('edit_org_collection')));
    assert.ok(names.includes(toolName('delete_org_collection')));
    assert.ok(names.includes(toolName('move_item_to_organization')));
    assert.ok(names.includes(toolName('search_items')));
    assert.ok(names.includes(toolName('get_item')));
    assert.ok(names.includes(toolName('get_uri')));
    assert.ok(names.includes(toolName('get_notes')));
    assert.ok(names.includes(toolName('get_exposed')));
    assert.ok(names.includes(toolName('get_folder')));
    assert.ok(names.includes(toolName('get_collection')));
    assert.ok(names.includes(toolName('get_organization')));
    assert.ok(names.includes(toolName('get_org_collection')));
    assert.ok(names.includes(toolName('delete_item')));
    assert.ok(names.includes(toolName('delete_items')));
    assert.ok(names.includes(toolName('restore_item')));
    assert.ok(names.includes(toolName('create_attachment')));
    assert.ok(names.includes(toolName('delete_attachment')));
    assert.ok(names.includes(toolName('get_attachment')));
    assert.ok(names.includes(toolName('send_list')));
    assert.ok(names.includes(toolName('send_template')));
    assert.ok(names.includes(toolName('send_get')));
    assert.ok(names.includes(toolName('send_create')));
    assert.ok(names.includes(toolName('send_create_encoded')));
    assert.ok(names.includes(toolName('send_remove_password')));
    assert.ok(names.includes(toolName('send_edit')));
    assert.ok(names.includes(toolName('send_delete')));
    assert.ok(names.includes(toolName('receive')));
    assert.ok(names.includes(toolName('get_username')));
    assert.ok(names.includes(toolName('get_password')));
    assert.ok(names.includes(toolName('get_totp')));
    assert.ok(names.includes(toolName('get_password_history')));
    assert.ok(names.includes(toolName('create_note')));
    assert.ok(names.includes(toolName('create_login')));
    assert.ok(names.includes(toolName('create_logins')));
    assert.ok(names.includes(toolName('set_login_uris')));
    assert.ok(names.includes(toolName('create_ssh_key')));
    assert.ok(names.includes(toolName('create_card')));
    assert.ok(names.includes(toolName('create_identity')));
    assert.ok(names.includes(toolName('update_item')));

    const res = await client.callTool(
      {
        name: toolName('status'),
        arguments: {},
      },
      undefined,
      { timeout: INITIAL_STATUS_TIMEOUT_MS },
    );
    assert.equal(res.isError, undefined);
    assert.ok(
      res.structuredContent && typeof res.structuredContent === 'object',
    );
    assert.ok(
      'status' in res.structuredContent &&
        typeof (res.structuredContent as { status?: unknown }).status ===
          'object',
    );
    {
      const status = (res.structuredContent as { status?: unknown }).status;
      assert.ok(status && typeof status === 'object');
      const rec = status as {
        operational?: unknown;
        summary?: unknown;
        status?: unknown;
      };
      assert.ok(
        rec.status === 'unlocked' ||
          rec.status === 'locked' ||
          rec.status === 'unauthenticated',
      );
      assert.ok(rec.operational && typeof rec.operational === 'object');
      const ready = (rec.operational as { ready?: unknown }).ready;
      if (rec.status === 'unlocked') {
        assert.equal(ready, true);
        assert.ok(
          typeof rec.summary === 'string' &&
            rec.summary.toLowerCase().includes('vault access ready'),
        );
      } else {
        assert.equal(ready, false);
        assert.ok(
          typeof rec.summary === 'string' &&
            rec.summary.toLowerCase().includes('vault access not ready'),
        );
      }
    }
    assert.ok(Array.isArray(res.content));
    assert.ok(
      res.content.some((item) => {
        if (!item || item.type !== 'text') return false;
        return item.text.toLowerCase().includes('vault access ready');
      }),
    );

    const enc = await client.callTool({
      name: toolName('encode'),
      arguments: { value: '{"x":1}' },
    });
    assert.equal(enc.isError, undefined);
    assert.ok(
      enc.structuredContent && typeof enc.structuredContent === 'object',
    );
    assert.ok('encoded' in enc.structuredContent);

    const genNoReveal = await client.callTool({
      name: toolName('generate'),
      arguments: {},
    });
    assert.equal(genNoReveal.isError, undefined);
    assert.ok(
      genNoReveal.structuredContent &&
        typeof genNoReveal.structuredContent === 'object',
    );
    {
      const result = (genNoReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'generated');
      assert.equal(rec.revealed, false);
      assert.equal(rec.value, null);
    }

    const genUserNoReveal = await client.callTool({
      name: toolName('generate_username'),
      arguments: { type: 'random_word' },
    });
    assert.equal(genUserNoReveal.isError, undefined);
    assert.ok(
      genUserNoReveal.structuredContent &&
        typeof genUserNoReveal.structuredContent === 'object',
    );
    {
      const result = (genUserNoReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'generated');
      assert.equal(rec.revealed, false);
      assert.equal(rec.value, null);
    }

    const createLogin = await client.callTool({
      name: toolName('create_login'),
      arguments: {
        name: `keychain-e2e-login-${Date.now()}`,
        username: 'e2e',
        password: 'e2e-password-test-only',
        totp: 'JBSWY3DPEHPK3PXP',
        notes: 'e2e-notes',
        fields: [
          { name: 'visible', value: 'v', hidden: false },
          { name: 'hidden', value: 'h', hidden: true },
        ],
        attachments: [
          {
            filename: 'e2e.txt',
            contentBase64: Buffer.from('hello', 'utf8').toString('base64'),
          },
        ],
      },
    });

    assert.equal(createLogin.isError, undefined);
    const sc = createLogin.structuredContent;
    const created =
      sc && typeof sc === 'object' && 'item' in sc
        ? (sc as { item?: unknown }).item
        : undefined;
    assert.ok(created && typeof created === 'object');
    const createdRec = created as Record<string, unknown>;
    const login = createdRec.login as Record<string, unknown> | undefined;
    assert.equal(login?.password, '[REDACTED]');
    assert.equal(login?.totp, '[REDACTED]');

    const fields = createdRec.fields;
    assert.ok(Array.isArray(fields));
    // Hidden custom fields should be redacted.
    const hiddenField = fields.find((f) => {
      if (!f || typeof f !== 'object') return false;
      return (f as Record<string, unknown>).name === 'hidden';
    });
    assert.ok(hiddenField && typeof hiddenField === 'object');
    assert.equal((hiddenField as Record<string, unknown>).value, '[REDACTED]');

    const attachments = createdRec.attachments;
    assert.ok(Array.isArray(attachments));
    assert.ok(attachments.length >= 1);
    const a0 = attachments[0];
    if (a0 && typeof a0 === 'object') {
      const url = (a0 as Record<string, unknown>).url;
      if (typeof url === 'string') assert.equal(url, '[REDACTED]');
    }

    // Secret helper tools: they must return a consistent shape and not leak values by default.
    const term = createdRec.name as string;

    const pwNoReveal = await client.callTool({
      name: 'keychain_get_password',
      arguments: { term },
    });
    assert.equal(pwNoReveal.isError, undefined);
    {
      const result = (pwNoReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'password');
      assert.equal(rec.revealed, false);
      assert.equal(rec.value, null);
    }

    const pwReveal = await client.callTool({
      name: 'keychain_get_password',
      arguments: { term, reveal: true },
    });
    assert.equal(pwReveal.isError, undefined);
    {
      const result = (pwReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'password');
      assert.equal(rec.revealed, true);
      assert.ok(typeof rec.value === 'string' && rec.value.length > 0);
    }

    const totpNoReveal = await client.callTool({
      name: 'keychain_get_totp',
      arguments: { term },
    });
    assert.equal(totpNoReveal.isError, undefined);
    {
      const result = (totpNoReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'totp');
      assert.equal(rec.revealed, false);
      assert.equal(rec.value, null);
    }

    const totpReveal = await client.callTool({
      name: 'keychain_get_totp',
      arguments: { term, reveal: true },
    });
    assert.equal(totpReveal.isError, undefined);
    {
      const result = (totpReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
        period?: unknown;
        timeLeft?: unknown;
      };
      assert.equal(rec.kind, 'totp');
      assert.equal(rec.revealed, true);
      assert.ok(typeof rec.value === 'string' && rec.value.length >= 6);
      assert.equal(rec.period, 30);
      assert.ok(
        typeof rec.timeLeft === 'number' &&
          rec.timeLeft >= 1 &&
          rec.timeLeft <= 30,
      );
    }

    const listOrgs = await client.callTool({
      name: 'keychain_list_organizations',
      arguments: {},
    });
    assert.equal(listOrgs.isError, undefined);

    const listOrgsPayload =
      listOrgs.structuredContent &&
      typeof listOrgs.structuredContent === 'object'
        ? (listOrgs.structuredContent as { results?: unknown[] })
        : { results: [] };
    const orgs = Array.isArray(listOrgsPayload.results)
      ? listOrgsPayload.results
      : [];
    const targetOrg = orgs.find((o): o is { id: string } => {
      if (!o || typeof o !== 'object') return false;
      return typeof (o as { id?: unknown }).id === 'string';
    });

    if (!targetOrg) {
      if (requireOrgTests) {
        assert.fail(
          'No organizations found (expected org seed to have run, but list_organizations returned empty)',
        );
      }
      console.log(
        '[itest] no organizations found; skipping org collection assertions',
      );
    } else {
      const organizationId = targetOrg.id;
      const orgCollectionName = `keychain-e2e-org-${Date.now()}`;
      let orgCollectionId = '';

      try {
        const createOrgCollection = await client.callTool({
          name: 'keychain_create_org_collection',
          arguments: {
            organizationId,
            name: orgCollectionName,
          },
        });
        assert.equal(createOrgCollection.isError, undefined);

        const created =
          createOrgCollection.structuredContent &&
          typeof createOrgCollection.structuredContent === 'object'
            ? (
                createOrgCollection.structuredContent as {
                  collection?: unknown;
                }
              ).collection
            : undefined;
        assert.ok(created && typeof created === 'object');
        orgCollectionId =
          typeof (created as { id?: unknown }).id === 'string'
            ? String((created as { id?: unknown }).id)
            : '';
        assert.equal(typeof (created as { name?: unknown }).name, 'string');
        assert.equal((created as { name?: unknown }).name, orgCollectionName);
        assert.equal(orgCollectionId.length > 0, true);

        const editOrgCollection = await client.callTool({
          name: 'keychain_edit_org_collection',
          arguments: {
            organizationId,
            id: orgCollectionId,
            name: `${orgCollectionName}-renamed`,
          },
        });
        assert.equal(editOrgCollection.isError, undefined);
        const edited =
          editOrgCollection.structuredContent &&
          typeof editOrgCollection.structuredContent === 'object'
            ? (
                editOrgCollection.structuredContent as {
                  collection?: unknown;
                }
              ).collection
            : undefined;
        assert.ok(edited && typeof edited === 'object');
        assert.equal(
          (edited as { name?: unknown }).name,
          `${orgCollectionName}-renamed`,
        );
      } finally {
        if (orgCollectionId) {
          await client
            .callTool({
              name: 'keychain_delete_org_collection',
              arguments: {
                organizationId,
                id: orgCollectionId,
              },
            })
            .catch(() => {});
        }
      }
    }

    const notesNoReveal = await client.callTool({
      name: 'keychain_get_notes',
      arguments: { term },
    });
    assert.equal(notesNoReveal.isError, undefined);
    {
      const result = (notesNoReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'notes');
      assert.equal(rec.revealed, false);
      assert.equal(rec.value, null);
    }

    const notesReveal = await client.callTool({
      name: 'keychain_get_notes',
      arguments: { term, reveal: true },
    });
    assert.equal(notesReveal.isError, undefined);
    {
      const result = (notesReveal.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'notes');
      assert.equal(rec.revealed, true);
      assert.equal(rec.value, 'e2e-notes');
    }

    const username = await client.callTool({
      name: 'keychain_get_username',
      arguments: { term },
    });
    assert.equal(username.isError, undefined);
    {
      const result = (username.structuredContent as { result?: unknown })
        .result;
      assert.ok(result && typeof result === 'object');
      const rec = result as {
        kind?: unknown;
        value?: unknown;
        revealed?: unknown;
      };
      assert.equal(rec.kind, 'username');
      assert.equal(rec.revealed, true);
      assert.equal(rec.value, 'e2e');
    }
  } finally {
    await transport.terminateSession().catch(() => {});
    await transport.close().catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

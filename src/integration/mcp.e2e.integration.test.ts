import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createKeychainApp } from '../transports/http.js';

test('mcp e2e: can initialize, list tools, and call keychain.status over /sse', {
  timeout: 120_000,
}, async (t) => {
  const requireOrgTests = /^true$/i.test(
    process.env.KEYCHAIN_REQUIRE_ORG_TESTS ?? '',
  );
  const bwHost = process.env.BW_HOST;
  const bwPassword = process.env.BW_PASSWORD;
  const bwUser = process.env.BW_USER ?? process.env.BW_USERNAME;
  if (!bwHost || !bwPassword || !bwUser) {
    t.skip('Missing BW_HOST/BW_USER/BW_PASSWORD (required for MCP e2e test)');
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
        'X-BW-User': bwUser,
        'X-BW-Password': bwPassword,
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
    assert.ok(names.includes('keychain.status'));
    assert.ok(names.includes('keychain.encode'));
    assert.ok(names.includes('keychain.generate'));
    assert.ok(names.includes('keychain.generate_username'));
    assert.ok(names.includes('keychain.list_folders'));
    assert.ok(names.includes('keychain.create_folder'));
    assert.ok(names.includes('keychain.edit_folder'));
    assert.ok(names.includes('keychain.delete_folder'));
    assert.ok(names.includes('keychain.list_organizations'));
    assert.ok(names.includes('keychain.list_collections'));
    assert.ok(names.includes('keychain.list_org_collections'));
    assert.ok(names.includes('keychain.create_org_collection'));
    assert.ok(names.includes('keychain.edit_org_collection'));
    assert.ok(names.includes('keychain.delete_org_collection'));
    assert.ok(names.includes('keychain.move_item_to_organization'));
    assert.ok(names.includes('keychain.search_items'));
    assert.ok(names.includes('keychain.get_item'));
    assert.ok(names.includes('keychain.get_uri'));
    assert.ok(names.includes('keychain.get_notes'));
    assert.ok(names.includes('keychain.get_exposed'));
    assert.ok(names.includes('keychain.get_folder'));
    assert.ok(names.includes('keychain.get_collection'));
    assert.ok(names.includes('keychain.get_organization'));
    assert.ok(names.includes('keychain.get_org_collection'));
    assert.ok(names.includes('keychain.delete_item'));
    assert.ok(names.includes('keychain.delete_items'));
    assert.ok(names.includes('keychain.restore_item'));
    assert.ok(names.includes('keychain.create_attachment'));
    assert.ok(names.includes('keychain.delete_attachment'));
    assert.ok(names.includes('keychain.get_attachment'));
    assert.ok(names.includes('keychain.send_list'));
    assert.ok(names.includes('keychain.send_template'));
    assert.ok(names.includes('keychain.send_get'));
    assert.ok(names.includes('keychain.send_create'));
    assert.ok(names.includes('keychain.send_create_encoded'));
    assert.ok(names.includes('keychain.send_remove_password'));
    assert.ok(names.includes('keychain.send_edit'));
    assert.ok(names.includes('keychain.send_delete'));
    assert.ok(names.includes('keychain.receive'));
    assert.ok(names.includes('keychain.get_username'));
    assert.ok(names.includes('keychain.get_password'));
    assert.ok(names.includes('keychain.get_totp'));
    assert.ok(names.includes('keychain.get_password_history'));
    assert.ok(names.includes('keychain.create_note'));
    assert.ok(names.includes('keychain.create_login'));
    assert.ok(names.includes('keychain.create_logins'));
    assert.ok(names.includes('keychain.set_login_uris'));
    assert.ok(names.includes('keychain.create_ssh_key'));
    assert.ok(names.includes('keychain.create_card'));
    assert.ok(names.includes('keychain.create_identity'));
    assert.ok(names.includes('keychain.update_item'));

    const res = await client.callTool({
      name: 'keychain.status',
      arguments: {},
    });
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
      assert.equal(rec.status, 'unlocked');
      assert.ok(rec.operational && typeof rec.operational === 'object');
      assert.equal((rec.operational as { ready?: unknown }).ready, true);
      assert.ok(
        typeof rec.summary === 'string' &&
          rec.summary.toLowerCase().includes('vault access ready'),
      );
    }
    assert.ok(Array.isArray(res.content));
    assert.ok(
      res.content.some((item) => {
        if (!item || item.type !== 'text') return false;
        return item.text.toLowerCase().includes('vault access ready');
      }),
    );

    const enc = await client.callTool({
      name: 'keychain.encode',
      arguments: { value: '{"x":1}' },
    });
    assert.equal(enc.isError, undefined);
    assert.ok(
      enc.structuredContent && typeof enc.structuredContent === 'object',
    );
    assert.ok('encoded' in enc.structuredContent);

    const genNoReveal = await client.callTool({
      name: 'keychain.generate',
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
      name: 'keychain.generate_username',
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
      name: 'keychain.create_login',
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
      name: 'keychain.get_password',
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
      name: 'keychain.get_password',
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
      name: 'keychain.get_totp',
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
      name: 'keychain.get_totp',
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
      };
      assert.equal(rec.kind, 'totp');
      assert.equal(rec.revealed, true);
      assert.ok(typeof rec.value === 'string' && rec.value.length >= 6);
    }

    const listOrgs = await client.callTool({
      name: 'keychain.list_organizations',
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
          name: 'keychain.create_org_collection',
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
          name: 'keychain.edit_org_collection',
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
              name: 'keychain.delete_org_collection',
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
      name: 'keychain.get_notes',
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
      name: 'keychain.get_notes',
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
      name: 'keychain.get_username',
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

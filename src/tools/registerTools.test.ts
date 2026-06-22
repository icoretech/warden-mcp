import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createKeychainApp } from '../transports/http.js';

const DEFAULT_TOOL_PREFIX = 'keychain';
const DEFAULT_TOOL_SEPARATOR = '_';

function toolName(name: string, separator: string = DEFAULT_TOOL_SEPARATOR) {
  return `${DEFAULT_TOOL_PREFIX}${separator}${name}`;
}

type ToolListEntry = Awaited<ReturnType<Client['listTools']>>['tools'][number];

const BW_SEND_QUICK_OPTION_MAPPINGS = [
  { option: 'file', properties: ['type', 'filename', 'contentBase64'] },
  { option: 'deleteInDays', properties: ['deleteInDays'] },
  { option: 'password', properties: ['password'] },
  { option: 'emails', properties: ['emails'] },
  { option: 'maxAccessCount', properties: ['maxAccessCount'] },
  { option: 'hidden', properties: ['hidden'] },
  { option: 'name', properties: ['name'] },
  { option: 'notes', properties: ['notes'] },
  { option: 'fullObject', properties: ['fullObject'] },
] as const;

function bwSendQuickOptionNames(): string[] {
  const help = execFileSync('./node_modules/.bin/bw', ['send', '--help'], {
    encoding: 'utf8',
  });
  const options = new Set<string>();
  for (const match of help.matchAll(
    /^\s+(?:-[A-Za-z],\s+)?--([A-Za-z][A-Za-z0-9]*)\b/gm,
  )) {
    const optionName = match[1];
    if (optionName && optionName !== 'help') options.add(optionName);
  }
  return [...options].sort();
}

function toolPropertiesForBwSendOption(
  optionName: string,
): readonly string[] | undefined {
  return BW_SEND_QUICK_OPTION_MAPPINGS.find(
    (mapping) => mapping.option === optionName,
  )?.properties;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function toolInputSchemaProperties(
  tool: ToolListEntry,
): Record<string, unknown> {
  const schema = asRecord(tool.inputSchema);
  const properties = asRecord(schema?.properties);
  return properties ?? {};
}

function toolInputSchemaProperty(
  tool: ToolListEntry,
  propertyName: string,
): Record<string, unknown> | undefined {
  return asRecord(toolInputSchemaProperties(tool)[propertyName]);
}

function toolArrayItemProperty(
  tool: ToolListEntry,
  propertyName: string,
  itemPropertyName: string,
): Record<string, unknown> | undefined {
  const property = toolInputSchemaProperty(tool, propertyName);
  const items = asRecord(property?.items);
  const properties = asRecord(items?.properties);
  return asRecord(properties?.[itemPropertyName]);
}

function schemaDescription(
  schema: Record<string, unknown> | undefined,
): string {
  return typeof schema?.description === 'string' ? schema.description : '';
}

async function closeIgnoringErrors(
  label: string,
  closeable: { close: () => Promise<unknown> },
) {
  try {
    await closeable.close();
  } catch (error) {
    // In-memory transports can already be torn down by the paired close, so
    // cleanup ignores close-order races instead of masking them with an empty catch.
    void label;
    void error;
  }
}

function hasDescriptionCue(description: string): boolean {
  const cues = [
    'bitwarden',
    'vault',
    'bw',
    'item',
    'folder',
    'send',
    'attachment',
    'username',
    'password',
    'totp',
    'uri',
    'sync',
    'status',
    'encode',
    'generate',
    'search',
    'receive',
    'list',
    'update',
    'create',
    'edit',
    'delete',
    'move',
    'restore',
    'organization',
    'collection',
  ];
  const lower = description.toLowerCase();
  return cues.some((cue) => lower.includes(cue));
}

const READ_ONLY_TOOL_NAMES = new Set([
  toolName('status'),
  toolName('sync'),
  toolName('sdk_version'),
  toolName('encode'),
  toolName('generate'),
  toolName('generate_username'),
  toolName('list_folders'),
  toolName('list_org_collections'),
  toolName('list_organizations'),
  toolName('list_collections'),
  toolName('search_items'),
  toolName('get_item'),
  toolName('get_uri'),
  toolName('get_notes'),
  toolName('get_exposed'),
  toolName('get_folder'),
  toolName('get_collection'),
  toolName('get_organization'),
  toolName('get_org_collection'),
  toolName('get_attachment'),
  toolName('send_list'),
  toolName('send_template'),
  toolName('send_get'),
  toolName('receive'),
  toolName('get_username'),
  toolName('get_password'),
  toolName('get_totp'),
  toolName('get_password_history'),
]);

const DESTRUCTIVE_TOOL_NAMES = new Set([
  toolName('delete_folder'),
  toolName('delete_org_collection'),
  toolName('delete_item'),
  toolName('delete_items'),
  toolName('delete_attachment'),
  toolName('send_remove_password'),
  toolName('send_delete'),
]);

const OPEN_WORLD_TOOL_NAMES = new Set([
  toolName('send_list'),
  toolName('send_template'),
  toolName('send_get'),
  toolName('send_create'),
  toolName('send_create_encoded'),
  toolName('send_edit'),
  toolName('send_remove_password'),
  toolName('send_delete'),
  toolName('receive'),
]);

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

describe('registerTools: tool listing', { concurrency: 1 }, () => {
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

  test('all tools expose human-readable titles, descriptions, and schema-ready input properties', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      for (const tool of tools.tools) {
        assert.ok(
          typeof tool.title === 'string' &&
            tool.title.trim().length >= 3 &&
            tool.title !== tool.name &&
            (/\s/.test(tool.title) || /[A-Z]/.test(tool.title)),
          `Tool ${tool.name} missing human-readable title`,
        );

        const description = tool.description?.trim() ?? '';
        assert.ok(
          description.length >= 80,
          `Tool ${tool.name} description is too short`,
        );
        assert.ok(
          description.length <= 700,
          `Tool ${tool.name} description is too long`,
        );
        assert.ok(
          hasDescriptionCue(description),
          `Tool ${tool.name} description lacks an expected cue`,
        );

        const properties = toolInputSchemaProperties(tool);
        for (const [propertyName, propertySchemaValue] of Object.entries(
          properties,
        )) {
          const propertySchema = asRecord(propertySchemaValue);
          assert.ok(
            propertySchema,
            `Tool ${tool.name} inputSchema property ${propertyName} is not schema-like`,
          );

          const description = propertySchema.description;
          if (description !== undefined && description !== null) {
            assert.equal(
              typeof description,
              'string',
              `Tool ${tool.name} inputSchema property ${propertyName} description must be a string`,
            );
            if (typeof description === 'string') {
              assert.ok(
                description.trim().length >= 12,
                `Tool ${tool.name} inputSchema property ${propertyName} description must be at least 12 non-blank characters`,
              );
            }
          }
        }
      }
    } finally {
      await cleanup();
    }
  });

  test('all tools use the expected annotation classification', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      for (const tool of tools.tools) {
        const annotations = tool.annotations ?? {};
        assert.equal(
          annotations.readOnlyHint ?? false,
          READ_ONLY_TOOL_NAMES.has(tool.name),
          `Tool ${tool.name} readOnlyHint classification drifted`,
        );
        assert.equal(
          annotations.destructiveHint ?? false,
          DESTRUCTIVE_TOOL_NAMES.has(tool.name),
          `Tool ${tool.name} destructiveHint classification drifted`,
        );
        assert.equal(
          annotations.openWorldHint ?? false,
          OPEN_WORLD_TOOL_NAMES.has(tool.name),
          `Tool ${tool.name} openWorldHint classification drifted`,
        );
      }
    } finally {
      await cleanup();
    }
  });

  test('category-specific metadata checks cover the main tool groups', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      const createLogin = byName.get(toolName('create_login'));
      if (!createLogin) throw new Error('create_login tool missing');
      assert.equal(createLogin.title, 'Create Login');
      assert.ok((createLogin.description ?? '').includes('login'));
      assert.equal(createLogin.annotations?.readOnlyHint ?? false, false);
      assert.equal(createLogin.annotations?.destructiveHint ?? false, false);
      const createLoginProps = toolInputSchemaProperties(createLogin);
      for (const name of [
        'name',
        'username',
        'password',
        'uris',
        'fields',
        'attachments',
      ]) {
        assert.ok(name in createLoginProps, `create_login missing ${name}`);
      }

      const sendCreate = byName.get(toolName('send_create'));
      if (!sendCreate) throw new Error('send_create tool missing');
      assert.equal(sendCreate.title, 'Send Create');
      assert.equal(sendCreate.annotations?.readOnlyHint ?? false, false);
      assert.equal(sendCreate.annotations?.destructiveHint ?? false, false);
      assert.equal(sendCreate.annotations?.openWorldHint, true);
      const sendCreateProps = toolInputSchemaProperties(sendCreate);
      for (const name of [
        'type',
        'text',
        'filename',
        'contentBase64',
        'emails',
      ]) {
        assert.ok(name in sendCreateProps, `send_create missing ${name}`);
      }
      for (const optionName of bwSendQuickOptionNames()) {
        const mappedProperties = toolPropertiesForBwSendOption(optionName);
        assert.ok(
          mappedProperties,
          `bw send --${optionName} has no send_create schema mapping`,
        );
        for (const propertyName of mappedProperties) {
          assert.ok(
            propertyName in sendCreateProps,
            `send_create missing ${propertyName} for bw send --${optionName}`,
          );
        }
      }

      const searchItems = byName.get(toolName('search_items'));
      if (!searchItems) throw new Error('search_items tool missing');
      assert.equal(searchItems.title, 'Search Items');
      assert.equal(searchItems.annotations?.readOnlyHint ?? false, true);
      assert.equal(searchItems.annotations?.destructiveHint ?? false, false);
      const searchItemsProps = toolInputSchemaProperties(searchItems);
      for (const name of ['text', 'type', 'limit']) {
        assert.ok(name in searchItemsProps, `search_items missing ${name}`);
      }
    } finally {
      await cleanup();
    }
  });

  test('send attachment destructive and helper tools expose durable task-7 metadata', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      const requireTool = (name: string): ToolListEntry => {
        const tool = byName.get(toolName(name));
        if (!tool) throw new Error(`${name} tool missing`);
        return tool;
      };
      const descriptionOf = (name: string): string =>
        requireTool(name).description ?? '';
      const propertyDescription = (name: string, property: string): string =>
        schemaDescription(toolInputSchemaProperty(requireTool(name), property));

      assert.match(descriptionOf('send_create'), /Quick-create/);
      assert.match(descriptionOf('send_create'), /deleteInDays/);
      assert.match(descriptionOf('send_create'), /maxAccessCount/);
      assert.match(descriptionOf('send_create'), /password protects/);
      assert.match(descriptionOf('send_create'), /emails grant/);
      assert.match(
        propertyDescription('send_create', 'type'),
        /text uses text/,
      );
      assert.match(
        propertyDescription('send_create', 'contentBase64'),
        /file sends/,
      );
      assert.match(
        propertyDescription('send_create', 'deleteInDays'),
        /1-3650/,
      );
      assert.match(
        propertyDescription('send_create', 'maxAccessCount'),
        /Maximum number/,
      );
      assert.match(
        propertyDescription('send_create', 'emails'),
        /Mutually exclusive with password/,
      );

      assert.match(descriptionOf('send_template'), /text or file template/);
      assert.match(
        propertyDescription('send_template', 'object'),
        /send\.file/,
      );
      assert.match(descriptionOf('send_get'), /receive/);
      assert.equal(
        toolInputSchemaProperty(requireTool('send_get'), 'downloadFile'),
        undefined,
      );
      assert.match(descriptionOf('send_create_encoded'), /advanced/);
      assert.match(descriptionOf('send_create_encoded'), /encodedJson/);
      assert.match(
        propertyDescription('send_create_encoded', 'json'),
        /server encodes/,
      );
      assert.match(
        propertyDescription('send_create_encoded', 'file'),
        /filename and contentBase64/,
      );
      assert.match(descriptionOf('send_edit'), /bw send edit/);
      assert.match(propertyDescription('send_edit', 'itemId'), /--itemid/);
      assert.match(descriptionOf('send_remove_password'), /does not delete/);
      assert.match(descriptionOf('send_delete'), /destructive/);
      assert.match(descriptionOf('receive'), /HTTPS url/);
      assert.match(
        propertyDescription('receive', 'downloadFile'),
        /contentBase64/,
      );

      assert.match(
        descriptionOf('get_attachment'),
        /raw bytes as contentBase64/,
      );
      assert.match(descriptionOf('get_attachment'), /filename selector/);
      assert.match(descriptionOf('get_item'), /use keychain_get_attachment/);
      assert.match(descriptionOf('get_item'), /keychain_sync/);
      assert.match(descriptionOf('get_attachment'), /keychain_sync/);
      assert.match(
        propertyDescription('get_attachment', 'attachmentId'),
        /filename selector/,
      );
      assert.match(descriptionOf('delete_attachment'), /parent item/);
      assert.match(descriptionOf('delete_attachment'), /destructive/);

      assert.match(descriptionOf('move_item_to_organization'), /collectionIds/);
      assert.match(
        descriptionOf('move_item_to_organization'),
        /not personal folders/,
      );
      assert.match(descriptionOf('delete_item'), /soft delete to trash/);
      assert.match(descriptionOf('delete_item'), /permanent=true/);
      assert.match(
        propertyDescription('delete_item', 'permanent'),
        /Hard delete/,
      );
      assert.match(descriptionOf('delete_items'), /per-id ok\/error results/);
      assert.match(
        propertyDescription('delete_items', 'ids'),
        /one result per id/,
      );
      assert.match(descriptionOf('restore_item'), /soft-deleted/);
      assert.match(descriptionOf('restore_item'), /hard-deleted items cannot/);

      assert.match(descriptionOf('get_uri'), /ambiguous/);
      assert.match(propertyDescription('get_uri', 'term'), /exact item id/);
      assert.match(
        descriptionOf('get_notes'),
        /value is null unless reveal=true/,
      );
      assert.match(propertyDescription('get_notes', 'term'), /exact item id/);
      assert.match(descriptionOf('get_exposed'), /Not-found results/);
      assert.match(propertyDescription('get_exposed', 'term'), /exact item id/);
    } finally {
      await cleanup();
    }
  });

  test('score-buffer helper tools spell out reveal and vault behavior', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      const requireTool = (name: string): ToolListEntry => {
        const tool = byName.get(toolName(name));
        if (!tool) throw new Error(`${name} tool missing`);
        return tool;
      };
      const descriptionOf = (name: string): string =>
        requireTool(name).description ?? '';
      const propertyDescription = (name: string, property: string): string =>
        schemaDescription(toolInputSchemaProperty(requireTool(name), property));

      assert.match(descriptionOf('encode'), /never mutates the vault/);
      assert.match(descriptionOf('encode'), /bw encode/);

      assert.match(descriptionOf('generate'), /never mutates the vault/);
      assert.match(descriptionOf('generate'), /reveal=true/);
      assert.match(descriptionOf('generate'), /KEYCHAIN_NOREVEAL/);

      assert.match(
        descriptionOf('generate_username'),
        /never mutates the vault/,
      );
      assert.match(descriptionOf('generate_username'), /reveal=true/);
      assert.match(descriptionOf('generate_username'), /KEYCHAIN_NOREVEAL/);

      assert.match(
        descriptionOf('get_password'),
        /value is null unless reveal=true/,
      );
      assert.match(descriptionOf('get_password'), /KEYCHAIN_NOREVEAL/);

      assert.match(descriptionOf('get_totp'), /current TOTP code/);
      assert.match(
        descriptionOf('get_totp'),
        /value is null unless reveal=true/,
      );
      assert.match(descriptionOf('get_totp'), /KEYCHAIN_NOREVEAL/);

      assert.match(descriptionOf('send_list'), /read-only/);
      assert.match(descriptionOf('send_list'), /does not mutate the vault/);

      assert.match(descriptionOf('set_login_uris'), /URI list on a login item/);
      assert.match(
        descriptionOf('set_login_uris'),
        /mode=replace overwrites the full list/,
      );
      assert.match(
        descriptionOf('set_login_uris'),
        /mode=merge updates existing URIs/,
      );
      assert.match(
        propertyDescription('set_login_uris', 'mode'),
        /merge updates existing URIs/,
      );
      assert.match(
        propertyDescription('set_login_uris', 'uris'),
        /URI entries to store or update/,
      );
      assert.match(
        schemaDescription(
          toolArrayItemProperty(requireTool('set_login_uris'), 'uris', 'uri'),
        ),
        /URI value to store on the login item/,
      );
      assert.match(
        schemaDescription(
          toolArrayItemProperty(requireTool('set_login_uris'), 'uris', 'match'),
        ),
        /URI match semantics/,
      );
    } finally {
      await cleanup();
    }
  });

  test('shared repeated input parameters expose stable descriptions', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      const createAttachment = byName.get(toolName('create_attachment'));
      if (!createAttachment) throw new Error('create_attachment tool missing');
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(createAttachment, 'itemId'),
        ).includes('attachment or item-specific operations'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(createAttachment, 'filename'),
        ).includes('Visible attachment or send filename'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(createAttachment, 'contentBase64'),
        ).includes('Base64-encoded file bytes'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(createAttachment, 'reveal'),
        ).includes('forced false by NOREVEAL'),
      );

      const searchItems = byName.get(toolName('search_items'));
      if (!searchItems) throw new Error('search_items tool missing');
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(searchItems, 'collectionId'),
        ).includes('collection id, not a folder id'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(searchItems, 'folderId'),
        ).includes('organization collection id'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(searchItems, 'limit'),
        ).includes('Maximum returned rows'),
      );

      const listFolders = byName.get(toolName('list_folders'));
      if (!listFolders) throw new Error('list_folders tool missing');
      assert.ok(
        schemaDescription(listFolders).includes('personal Bitwarden folders'),
      );
      assert.ok(schemaDescription(listFolders).includes('folder ids'));

      const editFolder = byName.get(toolName('edit_folder'));
      if (!editFolder) throw new Error('edit_folder tool missing');
      assert.ok(
        schemaDescription(editFolder).includes(
          'Rename an existing personal Bitwarden folder',
        ),
      );
      assert.ok(
        schemaDescription(editFolder).includes('not the items inside it'),
      );

      const getItem = byName.get(toolName('get_item'));
      if (!getItem) throw new Error('get_item tool missing');
      assert.ok(schemaDescription(getItem).includes('Secret fields'));
      assert.ok(schemaDescription(getItem).includes('redacted by default'));
      assert.ok(schemaDescription(getItem).includes('reveal=true'));

      const getFolder = byName.get(toolName('get_folder'));
      if (!getFolder) throw new Error('get_folder tool missing');
      assert.ok(
        schemaDescription(getFolder).includes('personal Bitwarden folder'),
      );
      assert.ok(schemaDescription(getFolder).includes('safe folder metadata'));

      const getOrganization = byName.get(toolName('get_organization'));
      if (!getOrganization) throw new Error('get_organization tool missing');
      assert.ok(
        schemaDescription(getOrganization).includes('Bitwarden organization'),
      );
      assert.ok(
        schemaDescription(getOrganization).includes('list_organizations'),
      );

      const getOrgCollection = byName.get(toolName('get_org_collection'));
      if (!getOrgCollection) throw new Error('get_org_collection tool missing');
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(getOrgCollection, 'organizationId'),
        ).includes(
          'Optional organization id used to disambiguate the org collection lookup.',
        ),
      );
      assert.ok(
        schemaDescription(getOrgCollection).includes(
          'organizationId is optional and narrows the org-scoped lookup when provided.',
        ),
      );

      const setLoginUris = byName.get(toolName('set_login_uris'));
      if (!setLoginUris) throw new Error('set_login_uris tool missing');
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(setLoginUris, 'mode'),
        ).includes('replace overwrites the full list'),
      );
      assert.ok(
        schemaDescription(
          toolInputSchemaProperty(setLoginUris, 'uris'),
        ).includes('URI entries to store or update'),
      );
      assert.ok(
        schemaDescription(
          toolArrayItemProperty(setLoginUris, 'uris', 'uri'),
        ).includes('URI value to store on the login item'),
      );
      assert.ok(
        schemaDescription(
          toolArrayItemProperty(setLoginUris, 'uris', 'match'),
        ).includes('URI match semantics'),
      );
    } finally {
      await cleanup();
    }
  });

  test('zod property descriptions flow through listTools via in-memory transport', async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'schema-description-smoke', version: '0.0.0' },
      { capabilities: {} },
    );
    const server = new McpServer({
      name: 'schema-description-smoke-server',
      version: '0.0.0',
    });

    server.registerTool(
      'described_tool',
      {
        title: 'Described Tool',
        description: 'Proves top-level schema descriptions reach listTools.',
        annotations: { readOnlyHint: true },
        inputSchema: {
          displayName: z.string().describe('Human readable display name'),
          retryCount: z.number().int().optional().describe('Retry budget'),
        },
      },
      async () => ({
        content: [{ type: 'text', text: 'ok' }],
      }),
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'described_tool');
      if (!tool) throw new Error('described_tool missing from listTools');
      const properties = toolInputSchemaProperties(tool);
      const displayName = asRecord(properties.displayName);
      const retryCount = asRecord(properties.retryCount);
      assert.equal(displayName?.description, 'Human readable display name');
      assert.equal(retryCount?.description, 'Retry budget');
    } finally {
      await closeIgnoringErrors('client', client);
      await closeIgnoringErrors('server', server);
      await closeIgnoringErrors('clientTransport', clientTransport);
      await closeIgnoringErrors('serverTransport', serverTransport);
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

  test('mutating tools advertise explicit mutability annotations', async () => {
    const { client, cleanup } = await startTestServer();
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      const destructiveTools = new Set([
        toolName('delete_folder'),
        toolName('delete_org_collection'),
        toolName('delete_item'),
        toolName('delete_items'),
        toolName('delete_attachment'),
        toolName('send_remove_password'),
        toolName('send_delete'),
      ]);
      const mutatingTools = [
        toolName('create_folder'),
        toolName('edit_folder'),
        toolName('delete_folder'),
        toolName('create_org_collection'),
        toolName('edit_org_collection'),
        toolName('delete_org_collection'),
        toolName('move_item_to_organization'),
        toolName('delete_item'),
        toolName('delete_items'),
        toolName('restore_item'),
        toolName('create_attachment'),
        toolName('delete_attachment'),
        toolName('send_create'),
        toolName('send_create_encoded'),
        toolName('send_edit'),
        toolName('send_remove_password'),
        toolName('send_delete'),
        toolName('create_login'),
        toolName('create_logins'),
        toolName('set_login_uris'),
        toolName('create_note'),
        toolName('create_ssh_key'),
        toolName('create_card'),
        toolName('create_identity'),
        toolName('update_item'),
      ];

      for (const name of mutatingTools) {
        const tool = byName.get(name) as
          | {
              annotations?: {
                readOnlyHint?: boolean;
                destructiveHint?: boolean;
              };
            }
          | undefined;
        assert.ok(tool, `Tool ${name} missing from listTools()`);
        assert.equal(
          tool.annotations?.readOnlyHint,
          false,
          `Tool ${name} should declare readOnlyHint=false`,
        );

        const expectedDestructive = destructiveTools.has(name);
        assert.equal(
          tool.annotations?.destructiveHint,
          expectedDestructive,
          `Tool ${name} should declare destructiveHint=${String(expectedDestructive)}`,
        );
      }
    } finally {
      await cleanup();
    }
  });
});

describe('registerTools: READONLY behavior', { concurrency: 1 }, () => {
  test('readonly=on hides and rejects create_login', async () => {
    const { client, cleanup } = await startTestServer({
      READONLY: 'on',
    });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      assert.ok(!names.includes(toolName('create_login')));

      const result = await client.callTool({
        name: toolName('create_login'),
        arguments: { name: 'test' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(text.includes('not found'));
      assert.equal(result.isError, true);
    } finally {
      await cleanup();
    }
  });

  test('readonly=1 hides and rejects delete_item', async () => {
    const { client, cleanup } = await startTestServer({ READONLY: '1' });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      assert.ok(!names.includes(toolName('delete_item')));

      const result = await client.callTool({
        name: toolName('delete_item'),
        arguments: { id: 'x' },
      });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      assert.ok(text.includes('not found'));
      assert.equal(result.isError, true);
    } finally {
      await cleanup();
    }
  });
});

describe('registerTools: read-only tools in readonly mode', {
  concurrency: 1,
}, () => {
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
      assert.equal(text, 'generated: not revealed');
    } finally {
      await cleanup();
    }
  });

  test('generate with reveal=false returns not revealed without calling bw', async () => {
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
      assert.equal(text, 'generated: not revealed');
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
      assert.match(text, /^generated: ".+"$/);
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
      assert.equal(text, 'password: not revealed');
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
      assert.ok(text.includes('totp: not revealed'));
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
      assert.equal(text, 'notes: not revealed');
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
  printf 'file-data'
  exit 0
fi
if echo "$*" | grep -q 'get folder'; then printf '{"id":"f1","name":"Folder1"}'; exit 0; fi
if echo "$*" | grep -q 'get collection'; then printf '{"id":"c1","name":"Col1"}'; exit 0; fi
if echo "$*" | grep -q 'get organization'; then printf '{"id":"org1","name":"Org1"}'; exit 0; fi
if echo "$*" | grep -q 'get org-collection'; then printf '{"id":"oc1","name":"OrgCol1"}'; exit 0; fi
if echo "$*" | grep -q 'get item'; then
  if [ "$FAKE_BW_ITEM_ATTACHMENTS" = "true" ]; then
    printf '{"id":"1","type":1,"name":"Test","login":{"username":"u","password":"secret","totp":"otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=Test&period=45","uris":[]},"attachments":[{"id":"att-1","fileName":"downloaded.bin","size":"9","sizeName":"9 B","url":"https://signed.example/token"}],"passwordHistory":[{"password":"old","lastUsedDate":"2024-01-01"}]}'
  else
    printf '{"id":"1","type":1,"name":"Test","login":{"username":"u","password":"secret","totp":"otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=Test&period=45","uris":[]},"passwordHistory":[{"password":"old","lastUsedDate":"2024-01-01"}]}'
  fi
  exit 0
fi
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

async function createLookupFallbackBwScript(dir: string): Promise<string> {
  const scriptPath = join(dir, 'fake-bw');
  const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then printf 'Vault is unlocked!'; exit 0; fi
if echo "$*" | grep -q 'unlock'; then printf 'fallback-session'; exit 0; fi
if echo "$*" | grep -q 'status'; then printf '{"status":"unlocked","serverUrl":"https://bw.test","userEmail":"test@test.com"}'; exit 0; fi
if echo "$*" | grep -q 'get username'; then printf 'Not found.' >&2; exit 1; fi
if echo "$*" | grep -q 'list items'; then printf '[{"id":"1","type":1,"name":"Sample Login","login":{"username":"fallback@test.com","password":"pw","uris":[]}}]'; exit 0; fi
printf '{}'; exit 0
`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

async function createAmbiguousLookupBwScript(dir: string): Promise<string> {
  const scriptPath = join(dir, 'fake-bw');
  const script = `#!/bin/sh
if echo "$*" | grep -q 'config server'; then exit 0; fi
if echo "$*" | grep -q 'logout'; then exit 0; fi
if echo "$*" | grep -q 'unlock --check'; then printf 'Vault is unlocked!'; exit 0; fi
if echo "$*" | grep -q 'unlock'; then printf 'ambiguous-session'; exit 0; fi
if echo "$*" | grep -q 'status'; then printf '{"status":"unlocked","serverUrl":"https://bw.test","userEmail":"test@test.com"}'; exit 0; fi
if echo "$*" | grep -q 'get username'; then printf 'More than one result was found.' >&2; exit 1; fi
if echo "$*" | grep -q 'get password'; then printf 'More than one result was found.' >&2; exit 1; fi
if echo "$*" | grep -q 'list items'; then printf '[{"id":"one","type":1,"name":"Backoffice Staging","login":{"username":"one@test.com","password":"pw1","uris":[{"uri":"https://backoffice-staging.example.com","match":0}]}},{"id":"two","type":1,"name":"Backoffice Staging Admin","login":{"username":"two@test.com","password":"pw2","uris":[{"uri":"https://backoffice-staging.example.com/admin","match":0}]}}]'; exit 0; fi
printf '{}'; exit 0
`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

describe('registerTools: e2e with fake bw', { concurrency: 1 }, () => {
  // Shared e2e helper: creates fake bw, starts server, calls tool, cleans up.
  async function callToolE2e(
    toolName: string,
    args: Record<string, unknown>,
    envOverrides?: Record<string, string>,
  ) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-e2e-'));
    const fakeBw = await createFakeBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
      ...(envOverrides ?? {}),
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
    assert.ok(textOf(r).includes('id=1'));
    assert.ok(textOf(r).includes('name="Test Login"'));
    assert.ok(textOf(r).includes('username="user"'));
  });

  test('get_item', async () => {
    const r = await callToolE2e('get_item', { id: '1' });
    assert.equal(r.isError, undefined);
  });

  test('get_item with reveal', async () => {
    const r = await callToolE2e('get_item', { id: '1', reveal: true });
    assert.equal(r.isError, undefined);
  });

  test('get_item exposes safe attachment metadata in text', async () => {
    const r = await callToolE2e(
      'get_item',
      { id: '1' },
      { FAKE_BW_ITEM_ATTACHMENTS: 'true' },
    );
    assert.equal(r.isError, undefined);
    assert.match(textOf(r), /attachments=/);
    assert.match(textOf(r), /id=att-1/);
    assert.match(textOf(r), /fileName=\\"downloaded\.bin\\"/);
    assert.match(textOf(r), /attachmentDownload=/);
    assert.match(textOf(r), /keychain_get_attachment/);
    assert.match(textOf(r), /keychain_sync/);
    assert.doesNotMatch(textOf(r), /signed\.example/);
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
    assert.equal(textOf(r), 'username: "user@test.com"');
  });

  test('status, search_items, and get_username fallback stay ready together', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-fallback-'));
    const fakeBw = await createLookupFallbackBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
    });
    try {
      const search = await client.callTool({
        name: toolName('search_items'),
        arguments: { text: 'sample' },
      });
      assert.equal(search.isError, undefined);
      assert.ok(textOf(search).includes('1 item'));

      const username = await client.callTool({
        name: toolName('get_username'),
        arguments: { term: 'sample' },
      });
      assert.equal(username.isError, undefined);
      const structured = username.structuredContent as {
        result?: {
          kind?: unknown;
          value?: unknown;
          revealed?: unknown;
        };
      };
      assert.equal(structured?.result?.kind, 'username');
      assert.equal(structured?.result?.value, 'fallback@test.com');
      assert.equal(structured?.result?.revealed, true);

      const status = await client.callTool({
        name: toolName('status'),
        arguments: {},
      });
      assert.equal(status.isError, undefined);
      assert.ok(textOf(status).includes('Vault access ready'));
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('get_password with reveal=true', async () => {
    const r = await callToolE2e('get_password', {
      term: 'test',
      reveal: true,
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'password: "secret-pw"');
  });

  test('get_totp with reveal=true', async () => {
    const originalDateNow = Date.now;
    Date.now = () => 41_000;
    try {
      const r = await callToolE2e('get_totp', { term: 'test', reveal: true });
      assert.equal(r.isError, undefined);
      assert.ok(textOf(r).includes('totp: "123456"'));
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
    assert.equal(textOf(r), 'uri: "https://example.com"');
  });

  test('get_notes with reveal=true', async () => {
    const r = await callToolE2e('get_notes', { term: 'test', reveal: true });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'notes: "my notes"');
  });

  test('ambiguous get_username returns visible candidates', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-ambiguous-'));
    const fakeBw = await createAmbiguousLookupBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_username'),
        arguments: { term: 'Staging' },
      });
      assert.equal(result.isError, true);
      assert.ok(textOf(result).includes('Retry with term set to an exact id'));
      assert.ok(textOf(result).includes('id=one'));
      assert.ok(textOf(result).includes('username="one@test.com"'));
      assert.ok(textOf(result).includes('id=two'));
      const structured = result.structuredContent as {
        error?: unknown;
        candidates?: unknown[];
      };
      assert.equal(structured.error, 'AMBIGUOUS_LOOKUP');
      assert.equal(structured.candidates?.length, 2);
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('ambiguous get_password returns visible candidates', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-ambiguous-'));
    const fakeBw = await createAmbiguousLookupBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_password'),
        arguments: { term: 'Staging', reveal: true },
      });
      assert.equal(result.isError, true);
      assert.ok(textOf(result).includes('Retry with term set to an exact id'));
      assert.ok(textOf(result).includes('id=one'));
      assert.ok(textOf(result).includes('id=two'));
      assert.ok(!textOf(result).includes('pw1'));
      assert.ok(!textOf(result).includes('pw2'));
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('ambiguous get_password exposes structured error in text when KEYCHAIN_TEXT_COMPAT_MODE=structured_json', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tools-ambiguous-'));
    const fakeBw = await createAmbiguousLookupBwScript(tmpDir);
    const { client, cleanup } = await startTestServer({
      BW_BIN: fakeBw,
      BW_HOST: 'https://bw.test',
      BW_PASSWORD: 'pw',
      BW_USER: 'test@test.com',
      KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json',
    });
    try {
      const result = await client.callTool({
        name: toolName('get_password'),
        arguments: { term: 'Staging', reveal: true },
      });
      assert.equal(result.isError, true);
      assert.equal(textOf(result), JSON.stringify(result.structuredContent));
      const structured = result.structuredContent as {
        error?: unknown;
        candidates?: unknown[];
      };
      assert.equal(structured.error, 'AMBIGUOUS_LOOKUP');
      assert.equal(structured.candidates?.length, 2);
      assert.ok(!textOf(result).includes('pw1'));
      assert.ok(!textOf(result).includes('pw2'));
    } finally {
      await cleanup();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('get_exposed', async () => {
    const r = await callToolE2e('get_exposed', { term: 'test' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'exposed: "3"');
  });

  test('get_password_history', async () => {
    const r = await callToolE2e('get_password_history', { id: '1' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'password_history: not revealed');
  });

  test('encode', async () => {
    const r = await callToolE2e('encode', { value: 'hello' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'encoded: "aGVsbG8K"');
  });

  test('generate with reveal=true', async () => {
    const r = await callToolE2e('generate', { reveal: true, length: 12 });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'generated: "xK9mP2vL"');
  });

  test('generate_username with reveal=true', async () => {
    const r = await callToolE2e('generate_username', { reveal: true });
    assert.equal(r.isError, undefined);
  });

  test('get_username exposes structured result in text when KEYCHAIN_TEXT_COMPAT_MODE=structured_json', async () => {
    const r = await callToolE2e(
      'get_username',
      { term: 'test' },
      { KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json' },
    );
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), JSON.stringify(r.structuredContent));
  });

  test('get_password exposes structured result in text when KEYCHAIN_TEXT_COMPAT_MODE=structured_json', async () => {
    const r = await callToolE2e(
      'get_password',
      { term: 'test', reveal: true },
      { KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json' },
    );
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), JSON.stringify(r.structuredContent));
  });

  test('get_totp exposes structured result in text when KEYCHAIN_TEXT_COMPAT_MODE=structured_json', async () => {
    const originalDateNow = Date.now;
    Date.now = () => 41_000;
    try {
      const r = await callToolE2e(
        'get_totp',
        { term: 'test', reveal: true },
        { KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json' },
      );
      assert.equal(r.isError, undefined);
      assert.equal(textOf(r), JSON.stringify(r.structuredContent));
    } finally {
      Date.now = originalDateNow;
    }
  });

  // --- Send tools ---

  test('send_list', async () => {
    const r = await callToolE2e('send_list', {});
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'sends: []');
  });

  test('send_template', async () => {
    const r = await callToolE2e('send_template', { object: 'send.text' });
    assert.equal(r.isError, undefined);
    assert.equal(
      textOf(r),
      'template: {"type":0,"text":{"text":"","hidden":false}}',
    );
  });

  test('send_get', async () => {
    const r = await callToolE2e('send_get', { id: 's1' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'result: {"id":"s1","name":"Send1"}');
  });

  test('send_delete', async () => {
    const r = await callToolE2e('send_delete', { id: 's1' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Deleted Send id=s1.');
  });

  test('send_remove_password', async () => {
    const r = await callToolE2e('send_remove_password', { id: 's1' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'result: {}');
  });

  // --- Mutating tools ---

  test('create_login', async () => {
    const r = await callToolE2e('create_login', {
      name: 'Test Login',
      username: 'user',
      password: 'pw',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created item:\n- id=1 name="Test" username="u"');
  });

  test('create_note', async () => {
    const r = await callToolE2e('create_note', { name: 'Test Note' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created item:\n- id=new-1 name="Created"');
  });

  test('create_card', async () => {
    const r = await callToolE2e('create_card', {
      name: 'My Card',
      cardholderName: 'Alice',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created item:\n- id=new-1 name="Created"');
  });

  test('create_identity', async () => {
    const r = await callToolE2e('create_identity', {
      name: 'My Identity',
      identity: { firstName: 'Alice' },
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created item:\n- id=new-1 name="Created"');
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
    assert.equal(textOf(r), 'Updated item:\n- id=1 name="Updated"');
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
    assert.equal(textOf(r), 'result: {"text":"received text"}');
  });

  test('send_create with text', async () => {
    const r = await callToolE2e('send_create', {
      type: 'text',
      text: 'hello world',
      name: 'test send',
      emails: ['recipient@example.com'],
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'send: {}');
  });

  test('send_create trims recipient emails at the MCP boundary', async () => {
    const r = await callToolE2e('send_create', {
      type: 'text',
      text: 'hello world',
      emails: [' recipient@example.com '],
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'send: {}');
  });

  test('send_create rejects invalid recipient emails at the MCP boundary', async () => {
    const r = await callToolE2e('send_create', {
      type: 'text',
      text: 'hello world',
      emails: ['not-an-email'],
    });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /email/i);
  });

  test('send_edit with encodedJson', async () => {
    const r = await callToolE2e('send_edit', {
      encodedJson: Buffer.from('{}').toString('base64'),
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'send: {}');
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
    assert.equal(textOf(r), 'Created item:\n- id=1 name="Test" username="u"');
  });

  test('create_logins batch', async () => {
    const r = await callToolE2e('create_logins', {
      items: [
        { name: 'Login A', password: 'batch-secret-a' },
        { name: 'Login B', password: 'batch-secret-b' },
      ],
    });
    assert.equal(r.isError, undefined);
    assert.equal(
      textOf(r),
      [
        'Created 2 login(s):',
        '- id=1 name="Test" username="u"',
        '- id=1 name="Test" username="u"',
      ].join('\n'),
    );
    assert.ok(!textOf(r).includes('batch-secret-a'));
    assert.ok(!textOf(r).includes('batch-secret-b'));
    assert.ok(!textOf(r).includes('"ok":true'));
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
    const r = await callToolE2e(
      'get_attachment',
      {
        itemId: '1',
        attachmentId: 'att-1',
      },
      { FAKE_BW_ITEM_ATTACHMENTS: 'true' },
    );
    assert.equal(r.isError, undefined);
    assert.equal(
      textOf(r),
      'Downloaded attachment: filename="downloaded.bin" bytes=9',
    );
  });

  test('get_attachment missing filename points to sync and refreshed metadata', async () => {
    const r = await callToolE2e(
      'get_attachment',
      {
        itemId: '1',
        attachmentId: 'key-cert-giu2026.zip',
      },
      { FAKE_BW_ITEM_ATTACHMENTS: 'true' },
    );
    assert.equal(r.isError, true);
    assert.match(textOf(r), /key-cert-giu2026\.zip/);
    assert.match(textOf(r), /downloaded\.bin/);
    assert.match(textOf(r), /keychain_sync/);
    assert.match(textOf(r), /keychain_get_item/);
    assert.match(textOf(r), /keychain_get_attachment/);
  });

  test('send_create_encoded with text', async () => {
    const r = await callToolE2e('send_create_encoded', { text: 'hello' });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'send: {}');
  });

  test('create_ssh_key', async () => {
    const r = await callToolE2e('create_ssh_key', {
      name: 'My Key',
      publicKey: 'ssh-ed25519 AAAA',
      privateKey: '-----BEGIN KEY-----',
    });
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), 'Created item:\n- id=new-1 name="Created"');
  });

  test('create_login exposes created item in text when KEYCHAIN_TEXT_COMPAT_MODE=structured_json', async () => {
    const r = await callToolE2e(
      'create_login',
      {
        name: 'Structured Login',
        username: 'user',
        password: 'pw',
      },
      { KEYCHAIN_TEXT_COMPAT_MODE: 'structured_json' },
    );
    assert.equal(r.isError, undefined);
    assert.equal(textOf(r), JSON.stringify(r.structuredContent));
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

describe('registerTools: NOREVEAL behavior', { concurrency: 1 }, () => {
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

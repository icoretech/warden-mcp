// src/tools/registerTools.ts

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KeychainSdk } from '../sdk/keychainSdk.js';
import type { UpdatePatch } from '../sdk/patch.js';
import type { UriInput, UriMatch } from '../sdk/types.js';

export interface RegisterToolsDeps {
  getSdk: (authInfo?: AuthInfo) => Promise<KeychainSdk>;
  toolPrefix: string;
  toolSeparator: string;
}

export function registerTools(server: McpServer, deps: RegisterToolsDeps) {
  const toolMeta = {};
  const rawRegisterTool = server.registerTool.bind(server) as (
    name: string,
    ...args: unknown[]
  ) => unknown;
  const legacyPrefix = `${deps.toolPrefix}.`;
  const publicPrefix = `${deps.toolPrefix}${deps.toolSeparator}`;
  const registerTool: McpServer['registerTool'] = ((name, ...args) => {
    const publicName = name.startsWith(legacyPrefix)
      ? `${publicPrefix}${name.slice(legacyPrefix.length)}`
      : name;
    return rawRegisterTool(publicName, ...args);
  }) as McpServer['registerTool'];
  function parseBoolEnv(...names: string[]): boolean {
    for (const name of names) {
      const v = process.env[name];
      if (v !== undefined) {
        const lower = v.trim().toLowerCase();
        if (
          lower === '1' ||
          lower === 'true' ||
          lower === 'yes' ||
          lower === 'on'
        )
          return true;
      }
    }
    return false;
  }

  const isReadOnly = parseBoolEnv('READONLY', 'KEYCHAIN_READONLY');
  const isNoReveal = parseBoolEnv('NOREVEAL', 'KEYCHAIN_NOREVEAL');

  function readonlyBlocked() {
    return {
      structuredContent: { ok: false, error: 'READONLY' },
      content: [{ type: 'text' as const, text: 'Blocked: READONLY=true' }],
      isError: true,
    };
  }

  /** Strip reveal from input when NOREVEAL is set. */
  function clampReveal<T extends { reveal?: boolean }>(input: T): T {
    if (isNoReveal && input.reveal) {
      return { ...input, reveal: false };
    }
    return input;
  }

  function effectiveReveal(input: { reveal?: boolean }): boolean {
    return isNoReveal ? false : (input.reveal ?? false);
  }

  function toolResult<
    T,
    E extends Record<string, unknown> = Record<never, never>,
  >(kind: string, value: T, revealed: boolean, extra?: E) {
    return { result: { kind, value, revealed, ...(extra ?? {}) } };
  }

  const uriMatchSchema = z.enum([
    'domain',
    'host',
    'startsWith',
    'exact',
    'regex',
    'never',
  ]);
  const uriMatchInputSchema = z.union([
    uriMatchSchema,
    // Common alias from other clients/LLMs; normalize to "domain".
    z.literal('base_domain'),
    z.literal('baseDomain'),
    // bw uses numeric match values internally (0..5)
    z.number().int().min(0).max(5),
  ]);

  type UriMatchInput = z.infer<typeof uriMatchInputSchema>;

  function normalizeUriMatchInput(match?: UriMatchInput): UriMatch | undefined {
    if (match === 'base_domain' || match === 'baseDomain') return 'domain';
    if (typeof match === 'number') {
      if (match === 0) return 'domain';
      if (match === 1) return 'host';
      if (match === 2) return 'startsWith';
      if (match === 3) return 'exact';
      if (match === 4) return 'regex';
      if (match === 5) return 'never';
      return undefined;
    }
    return match;
  }

  function normalizeUrisInput(
    uris?: { uri: string; match?: UriMatchInput }[],
  ): UriInput[] | undefined {
    if (!uris) return undefined;
    return uris.map((u) => ({
      ...u,
      match: normalizeUriMatchInput(u.match),
    }));
  }

  registerTool(
    `${deps.toolPrefix}.status`,
    {
      title: 'Vault Status',
      description:
        'Returns Bitwarden CLI status (locked/unlocked, server, user).',
      annotations: { readOnlyHint: true },
      inputSchema: {},
      _meta: toolMeta,
    },
    async (_input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const status = await sdk.status();
      const summary =
        status &&
        typeof status === 'object' &&
        typeof (status as { summary?: unknown }).summary === 'string'
          ? String((status as { summary?: unknown }).summary)
          : 'Vault access ready.';
      return {
        structuredContent: { status },
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.encode`,
    {
      title: 'Encode',
      description: 'Base64-encode a string (bw encode).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        value: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const encoded = await sdk.encode(input);
      return {
        structuredContent: encoded,
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.generate`,
    {
      title: 'Generate',
      description:
        'Generate a password/passphrase (bw generate). Returning the value requires reveal=true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        uppercase: z.boolean().optional(),
        lowercase: z.boolean().optional(),
        number: z.boolean().optional(),
        special: z.boolean().optional(),
        passphrase: z.boolean().optional(),
        length: z.number().int().min(5).max(256).optional(),
        words: z.number().int().min(3).max(50).optional(),
        minNumber: z.number().int().min(0).max(50).optional(),
        minSpecial: z.number().int().min(0).max(50).optional(),
        separator: z.string().optional(),
        capitalize: z.boolean().optional(),
        includeNumber: z.boolean().optional(),
        ambiguous: z.boolean().optional(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.generate(clampReveal(input));
      return {
        structuredContent: toolResult(
          'generated',
          result.value,
          result.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.generate_username`,
    {
      title: 'Generate Username',
      description:
        'Generate a username like the Bitwarden generator (random word, plus-addressed email, catch-all). Returning the value requires reveal=true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: z
          .enum([
            'random_word',
            'plus_addressed_email',
            'catch_all_email',
            'forwarded_email_alias',
          ])
          .optional(),
        capitalize: z.boolean().optional(),
        includeNumber: z.boolean().optional(),
        email: z.string().optional(),
        domain: z.string().optional(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.generateUsername(clampReveal(input));
      return {
        structuredContent: toolResult(
          'generated',
          result.value,
          result.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_folders`,
    {
      title: 'List Folders',
      description: 'List Bitwarden folders (personal).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const folders = await sdk.listFolders(input);
      const results = folders
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const rec = x as Record<string, unknown>;
          return { id: rec.id, name: rec.name };
        });
      return {
        structuredContent: { results },
        content: [{ type: 'text', text: `Found ${results.length} folder(s).` }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_folder`,
    {
      title: 'Create Folder',
      description: 'Create a Bitwarden folder (personal).',
      inputSchema: {
        name: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.createFolder({ name: input.name });
      return {
        structuredContent: { folder },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.edit_folder`,
    {
      title: 'Edit Folder',
      description: 'Rename a Bitwarden folder (personal).',
      inputSchema: {
        id: z.string(),
        name: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.editFolder(input);
      return {
        structuredContent: { folder },
        content: [{ type: 'text', text: 'Updated.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_folder`,
    {
      title: 'Delete Folder',
      description: 'Delete a Bitwarden folder (personal).',
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteFolder(input);
      return {
        structuredContent: { ok: true },
        content: [{ type: 'text', text: 'Deleted.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_org_collections`,
    {
      title: 'List Org Collections',
      description: 'List organization collections.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        organizationId: z.string(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const cols = await sdk.listOrgCollections(input);
      const results = cols
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const rec = x as Record<string, unknown>;
          return {
            id: rec.id,
            name: rec.name,
            organizationId: rec.organizationId ?? null,
          };
        });
      return {
        structuredContent: { results },
        content: [
          { type: 'text', text: `Found ${results.length} org collection(s).` },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_org_collection`,
    {
      title: 'Create Org Collection',
      description: 'Create an organization collection.',
      inputSchema: {
        organizationId: z.string(),
        name: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.createOrgCollection(input);
      return {
        structuredContent: { collection },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.edit_org_collection`,
    {
      title: 'Edit Org Collection',
      description: 'Rename an organization collection.',
      inputSchema: {
        organizationId: z.string(),
        id: z.string(),
        name: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.editOrgCollection(input);
      return {
        structuredContent: { collection },
        content: [{ type: 'text', text: 'Updated.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_org_collection`,
    {
      title: 'Delete Org Collection',
      description: 'Delete an organization collection.',
      inputSchema: {
        organizationId: z.string(),
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteOrgCollection(input);
      return {
        structuredContent: { ok: true },
        content: [{ type: 'text', text: 'Deleted.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.move_item_to_organization`,
    {
      title: 'Move Item To Organization',
      description:
        'Move an item to an organization (optionally assigning collection ids).',
      inputSchema: {
        id: z.string(),
        organizationId: z.string(),
        collectionIds: z.array(z.string()).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.moveItemToOrganization(input);
      return {
        structuredContent: { item },
        content: [{ type: 'text', text: 'Moved.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_organizations`,
    {
      title: 'List Organizations',
      description:
        'List organizations available to the current Bitwarden user.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const orgs = await sdk.listOrganizations(input);
      const results = orgs
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const rec = x as Record<string, unknown>;
          return { id: rec.id, name: rec.name };
        });
      return {
        structuredContent: { results },
        content: [{ type: 'text', text: `Found ${results.length} org(s).` }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_collections`,
    {
      title: 'List Collections',
      description: 'List collections (optionally filtered by organization).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: z.string().optional(),
        organizationId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const cols = await sdk.listCollections(input);
      const results = cols
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const rec = x as Record<string, unknown>;
          return {
            id: rec.id,
            name: rec.name,
            organizationId: rec.organizationId ?? null,
          };
        });
      return {
        structuredContent: { results },
        content: [
          { type: 'text', text: `Found ${results.length} collection(s).` },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.search_items`,
    {
      title: 'Search Items',
      description:
        'Search vault items by text and filters (org/folder/collection/url).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        text: z.string().optional(),
        type: z
          .enum(['login', 'note', 'ssh_key', 'card', 'identity'])
          .optional(),
        organizationId: z
          .union([z.string(), z.literal('null'), z.literal('notnull')])
          .optional(),
        folderId: z
          .union([z.string(), z.literal('null'), z.literal('notnull')])
          .optional(),
        collectionId: z.string().optional(),
        url: z.string().optional(),
        trash: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const items = await sdk.searchItems(input);
      const minimal = items.map((i) => sdk.minimalSummary(i));
      return {
        structuredContent: { results: minimal },
        content: [{ type: 'text', text: `Found ${minimal.length} item(s).` }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_item`,
    {
      title: 'Get Item',
      description: 'Get a vault item by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.getItem(input.id, {
        reveal: effectiveReveal(input),
      });
      return {
        structuredContent: { item },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_uri`,
    {
      title: 'Get URI',
      description: 'Get a login URI by search term (bw get uri).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const uri = await sdk.getUri(input);
      return {
        structuredContent: toolResult('uri', uri.value, uri.revealed),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_notes`,
    {
      title: 'Get Notes',
      description: 'Get item notes by search term (bw get notes).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const notes = await sdk.getNotes(
        { term: input.term },
        { reveal: effectiveReveal(input) },
      );
      return {
        structuredContent: toolResult('notes', notes.value, notes.revealed),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_exposed`,
    {
      title: 'Get Exposed',
      description: 'Check exposed status by search term (bw get exposed).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const exposed = await sdk.getExposed(input);
      return {
        structuredContent: toolResult(
          'exposed',
          exposed.value,
          exposed.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_folder`,
    {
      title: 'Get Folder',
      description: 'Get a folder by id (bw get folder).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.getFolder(input);
      return {
        structuredContent: { folder },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_collection`,
    {
      title: 'Get Collection',
      description: 'Get a collection by id (bw get collection).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
        organizationId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.getCollection(input);
      return {
        structuredContent: { collection },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_organization`,
    {
      title: 'Get Organization',
      description: 'Get an organization by id (bw get organization).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const organization = await sdk.getOrganization(input);
      return {
        structuredContent: { organization },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_org_collection`,
    {
      title: 'Get Org Collection',
      description: 'Get an org collection by id (bw get org-collection).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
        organizationId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.getOrgCollection(input);
      return {
        structuredContent: { collection },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_item`,
    {
      title: 'Delete Item',
      description:
        'Delete an item by id (soft-delete by default; set permanent=true to hard delete).',
      inputSchema: {
        id: z.string(),
        permanent: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteItem(input);
      return {
        structuredContent: { ok: true },
        content: [{ type: 'text', text: 'Deleted.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_items`,
    {
      title: 'Delete Items',
      description:
        'Delete multiple items by id. Returns per-id results (soft-delete by default; set permanent=true to hard delete).',
      inputSchema: {
        ids: z.array(z.string()).min(1).max(200),
        permanent: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const results = await sdk.deleteItems(input);
      const okCount = results.filter((r) => r.ok).length;
      return {
        structuredContent: { results, okCount, total: results.length },
        content: [
          { type: 'text', text: `Deleted ${okCount}/${results.length}.` },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.restore_item`,
    {
      title: 'Restore Item',
      description: 'Restore an item from trash by id.',
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.restoreItem(input);
      return {
        structuredContent: { item },
        content: [{ type: 'text', text: 'Restored.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_attachment`,
    {
      title: 'Create Attachment',
      description:
        'Attach a file (base64) to an existing item. Returns the updated (redacted) item.',
      inputSchema: {
        itemId: z.string(),
        filename: z.string(),
        contentBase64: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.createAttachment(clampReveal(input));
      return {
        structuredContent: { item },
        content: [{ type: 'text', text: 'Attached.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_attachment`,
    {
      title: 'Delete Attachment',
      description:
        'Delete an attachment from an item. Returns the updated (redacted) item.',
      inputSchema: {
        itemId: z.string(),
        attachmentId: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.deleteAttachment(clampReveal(input));
      return {
        structuredContent: { item },
        content: [{ type: 'text', text: 'Deleted.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_attachment`,
    {
      title: 'Get Attachment',
      description:
        'Download an attachment from an item and return it as base64 (bw get attachment).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        itemId: z.string(),
        attachmentId: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const attachment = await sdk.getAttachment(input);
      return {
        structuredContent: { attachment },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_list`,
    {
      title: 'Send List',
      description: 'List all the Sends owned by you (bw send list).',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {},
      _meta: toolMeta,
    },
    async (_input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const sends = await sdk.sendList();
      return {
        structuredContent: { sends },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_template`,
    {
      title: 'Send Template',
      description: 'Get json templates for send objects (bw send template).',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        object: z.enum(['send.text', 'text', 'send.file', 'file']),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const template = await sdk.sendTemplate(input);
      return {
        structuredContent: { template },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_get`,
    {
      title: 'Send Get',
      description:
        'Get Sends owned by you. Use text=true to return text content; downloadFile=true to download a file send (bw send get).',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        id: z.string(),
        text: z.boolean().optional(),
        downloadFile: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendGet(input);
      return {
        structuredContent: { result },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_create`,
    {
      title: 'Send Create',
      description:
        'Create a Bitwarden Send. For file sends, pass filename+contentBase64. (bw send).',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: z.enum(['text', 'file']),
        text: z.string().optional(),
        filename: z.string().optional(),
        contentBase64: z.string().optional(),
        deleteInDays: z.number().int().min(1).max(3650).optional(),
        password: z.string().optional(),
        maxAccessCount: z.number().int().min(1).max(1_000_000).optional(),
        hidden: z.boolean().optional(),
        name: z.string().optional(),
        notes: z.string().optional(),
        fullObject: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendCreate(input);
      return {
        structuredContent: { send },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_create_encoded`,
    {
      title: 'Send Create (Encoded JSON)',
      description:
        'Create a Send via `bw send create`. Provide `encodedJson` (base64) or `json` (will be bw-encoded). Optional: `text`, `hidden`, or `file` (filename+contentBase64).',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        encodedJson: z.string().optional(),
        json: z.unknown().optional(),
        text: z.string().optional(),
        hidden: z.boolean().optional(),
        file: z
          .object({
            filename: z.string(),
            contentBase64: z.string(),
          })
          .optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendCreateEncoded(input);
      return {
        structuredContent: { send },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_edit`,
    {
      title: 'Send Edit (Encoded JSON)',
      description:
        'Edit a Send via `bw send edit`. Provide `encodedJson` (base64) or `json` (will be bw-encoded). Optional: `itemId` (maps to --itemid).',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        encodedJson: z.string().optional(),
        json: z.unknown().optional(),
        itemId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendEdit(input);
      return {
        structuredContent: { send },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_remove_password`,
    {
      title: 'Send Remove Password',
      description: "Remove a Send's saved password (bw send remove-password).",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendRemovePassword(input);
      return {
        structuredContent: { result },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_delete`,
    {
      title: 'Send Delete',
      description: 'Delete a Send (bw send delete).',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        id: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendDelete(input);
      return {
        structuredContent: { result },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.receive`,
    {
      title: 'Receive',
      description:
        'Access a Bitwarden Send from a url. Use obj=true for JSON object; downloadFile=true for file content. (bw receive)',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: z.string(),
        password: z.string().optional(),
        obj: z.boolean().optional(),
        downloadFile: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.receive(input);
      return {
        structuredContent: { result },
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_username`,
    {
      title: 'Get Username',
      description: 'Get a login username by search term (bw get username).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const username = await sdk.getUsername(input);
      return {
        structuredContent: toolResult(
          'username',
          username.value,
          username.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_password`,
    {
      title: 'Get Password',
      description:
        'Get a login password by search term (bw get password). Returning a password requires reveal=true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const password = await sdk.getPassword(
        { term: input.term },
        { reveal: effectiveReveal(input) },
      );
      return {
        structuredContent: toolResult(
          'password',
          password.value,
          password.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_totp`,
    {
      title: 'Get TOTP',
      description:
        'Get a TOTP code/seed by search term (bw get totp). Returning a TOTP requires reveal=true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const totp = await sdk.getTotp(
        { term: input.term },
        { reveal: effectiveReveal(input) },
      );
      return {
        structuredContent: toolResult('totp', totp.value, totp.revealed, {
          period: totp.period,
          timeLeft: totp.timeLeft,
        }),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_password_history`,
    {
      title: 'Get Password History',
      description:
        'Get an item password history (if any). Returning passwords requires reveal=true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const history = await sdk.getPasswordHistory(input.id, {
        reveal: effectiveReveal(input),
      });
      return {
        structuredContent: toolResult(
          'password_history',
          history.value,
          history.revealed,
        ),
        content: [{ type: 'text', text: 'OK' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_login`,
    {
      title: 'Create Login',
      description: 'Create a login item.',
      inputSchema: {
        name: z.string(),
        username: z.string().optional(),
        password: z.string().optional(),
        uris: z
          .array(
            z.object({
              uri: z.string(),
              match: uriMatchInputSchema.optional(),
            }),
          )
          .optional(),
        totp: z.string().optional(),
        notes: z.string().optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              hidden: z.boolean().optional(),
            }),
          )
          .optional(),
        attachments: z
          .array(
            z.object({
              filename: z.string(),
              contentBase64: z.string(),
            }),
          )
          .optional(),
        favorite: z.boolean().optional(),
        organizationId: z.string().optional(),
        collectionIds: z.array(z.string()).optional(),
        folderId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createLogin({
        ...input,
        uris: normalizeUrisInput(input.uris),
      });
      return {
        structuredContent: { item: created },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_logins`,
    {
      title: 'Create Logins',
      description: 'Create multiple login items in a single call.',
      inputSchema: {
        items: z.array(
          z.object({
            name: z.string(),
            username: z.string().optional(),
            password: z.string().optional(),
            uris: z
              .array(
                z.object({
                  uri: z.string(),
                  match: uriMatchInputSchema.optional(),
                }),
              )
              .optional(),
            totp: z.string().optional(),
            notes: z.string().optional(),
            fields: z
              .array(
                z.object({
                  name: z.string(),
                  value: z.string(),
                  hidden: z.boolean().optional(),
                }),
              )
              .optional(),
            attachments: z
              .array(
                z.object({
                  filename: z.string(),
                  contentBase64: z.string(),
                }),
              )
              .optional(),
            favorite: z.boolean().optional(),
            organizationId: z.string().optional(),
            collectionIds: z.array(z.string()).optional(),
            folderId: z.string().optional(),
          }),
        ),
        continueOnError: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const results = await sdk.createLogins({
        items: input.items.map((it) => ({
          ...it,
          uris: normalizeUrisInput(it.uris),
        })),
        continueOnError: input.continueOnError,
      });
      return {
        structuredContent: { results },
        content: [
          { type: 'text', text: `Created ${results.length} login(s).` },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.set_login_uris`,
    {
      title: 'Set Login URIs',
      description:
        'Set or update the URIs (and per-URI match types) for a login item. mode=replace overwrites; mode=merge updates/adds by uri.',
      inputSchema: {
        id: z.string(),
        mode: z.enum(['replace', 'merge']).optional(),
        uris: z.array(
          z.object({
            uri: z.string(),
            match: uriMatchInputSchema.optional(),
          }),
        ),
        reveal: z.boolean().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const updated = await sdk.setLoginUris({
        id: input.id,
        mode: input.mode,
        uris: normalizeUrisInput(input.uris) ?? [],
        reveal: effectiveReveal(input),
      });
      return {
        structuredContent: { item: updated },
        content: [{ type: 'text', text: 'Updated.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_note`,
    {
      title: 'Create Note',
      description: 'Create a secure note item.',
      inputSchema: {
        name: z.string(),
        notes: z.string().optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              hidden: z.boolean().optional(),
            }),
          )
          .optional(),
        favorite: z.boolean().optional(),
        organizationId: z.string().optional(),
        collectionIds: z.array(z.string()).optional(),
        folderId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createNote(input);
      return {
        structuredContent: { item: created },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_ssh_key`,
    {
      title: 'Create SSH Key',
      description:
        'Create an SSH key object (stored as secure note with fields).',
      inputSchema: {
        name: z.string(),
        publicKey: z.string(),
        privateKey: z.string(),
        fingerprint: z.string().optional(),
        comment: z.string().optional(),
        notes: z.string().optional(),
        favorite: z.boolean().optional(),
        organizationId: z.string().optional(),
        collectionIds: z.array(z.string()).optional(),
        folderId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createSshKey(input);
      return {
        structuredContent: { item: created },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_card`,
    {
      title: 'Create Card',
      description: 'Create a payment card item.',
      inputSchema: {
        name: z.string(),
        cardholderName: z.string().optional(),
        brand: z.string().optional(),
        number: z.string().optional(),
        expMonth: z.string().optional(),
        expYear: z.string().optional(),
        code: z.string().optional(),
        notes: z.string().optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              hidden: z.boolean().optional(),
            }),
          )
          .optional(),
        favorite: z.boolean().optional(),
        organizationId: z.string().optional(),
        collectionIds: z.array(z.string()).optional(),
        folderId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createCard(input);
      return {
        structuredContent: { item: created },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_identity`,
    {
      title: 'Create Identity',
      description: 'Create an identity item.',
      inputSchema: {
        name: z.string(),
        identity: z
          .object({
            title: z.string().optional(),
            firstName: z.string().optional(),
            middleName: z.string().optional(),
            lastName: z.string().optional(),
            address1: z.string().optional(),
            address2: z.string().optional(),
            address3: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            company: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            ssn: z.string().optional(),
            username: z.string().optional(),
            passportNumber: z.string().optional(),
            licenseNumber: z.string().optional(),
          })
          .optional(),
        notes: z.string().optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              hidden: z.boolean().optional(),
            }),
          )
          .optional(),
        favorite: z.boolean().optional(),
        organizationId: z.string().optional(),
        collectionIds: z.array(z.string()).optional(),
        folderId: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createIdentity(input);
      return {
        structuredContent: { item: created },
        content: [{ type: 'text', text: 'Created.' }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.update_item`,
    {
      title: 'Update Item',
      description: 'Update selected fields of an item by id.',
      inputSchema: {
        id: z.string(),
        patch: z.object({
          name: z.string().optional(),
          notes: z.string().optional(),
          favorite: z.boolean().optional(),
          folderId: z.union([z.string(), z.null()]).optional(),
          collectionIds: z.array(z.string()).optional(),
          login: z
            .object({
              username: z.string().optional(),
              password: z.string().optional(),
              totp: z.string().optional(),
              uris: z
                .array(
                  z.object({
                    uri: z.string(),
                    match: uriMatchInputSchema.optional(),
                  }),
                )
                .optional(),
            })
            .optional(),
          fields: z
            .array(
              z.object({
                name: z.string(),
                value: z.string(),
                hidden: z.boolean().optional(),
              }),
            )
            .optional(),
        }),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const patch = input.patch as UpdatePatch;
      if (patch.login && Array.isArray(patch.login.uris)) {
        // Accept a couple of common match aliases at the MCP boundary.
        patch.login.uris = normalizeUrisInput(
          patch.login.uris as unknown as {
            uri: string;
            match?: UriMatchInput;
          }[],
        ) as typeof patch.login.uris;
      }
      const updated = await sdk.updateItem(input.id, patch);
      return {
        structuredContent: { item: updated },
        content: [{ type: 'text', text: 'Updated.' }],
      };
    },
  );
}

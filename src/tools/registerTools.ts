// src/tools/registerTools.ts

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AmbiguousLoginLookupError,
  type KeychainSdk,
} from '../sdk/keychainSdk.js';
import type { UpdatePatch } from '../sdk/patch.js';
import type { UriInput, UriMatch } from '../sdk/types.js';

export interface RegisterToolsDeps {
  getSdk: (authInfo?: AuthInfo) => Promise<KeychainSdk>;
  toolPrefix: string;
  toolSeparator: string;
}

export function registerTools(server: McpServer, deps: RegisterToolsDeps) {
  const toolMeta = {};
  const mutatingToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
  } as const;
  const destructiveToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
  } as const;
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
  const textCompatMode =
    process.env.KEYCHAIN_TEXT_COMPAT_MODE?.trim().toLowerCase();

  function readonlyBlocked() {
    const structuredContent = { ok: false, error: 'READONLY' };
    return {
      structuredContent,
      content: toolTextContent(structuredContent, 'Blocked: READONLY=true'),
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

  function valueResultOutputSchema(kind: string) {
    return {
      result: z.object({
        kind: z.literal(kind),
        value: z.string().nullable(),
        revealed: z.boolean(),
      }),
    };
  }

  const statusOutputSchema = { status: z.unknown() };
  const sdkVersionOutputSchema = { version: z.string() };
  const encodeOutputSchema = { encoded: z.string() };
  const generatedResultOutputSchema = valueResultOutputSchema('generated');
  const usernameResultOutputSchema = valueResultOutputSchema('username');
  const passwordResultOutputSchema = valueResultOutputSchema('password');
  const notesResultOutputSchema = valueResultOutputSchema('notes');
  const uriResultOutputSchema = valueResultOutputSchema('uri');
  const exposedResultOutputSchema = valueResultOutputSchema('exposed');
  const totpResultOutputSchema = {
    result: z.object({
      kind: z.literal('totp'),
      value: z.string().nullable(),
      revealed: z.boolean(),
      period: z.number().nullable(),
      timeLeft: z.number().nullable(),
    }),
  };
  const passwordHistoryResultOutputSchema = {
    result: z.object({
      kind: z.literal('password_history'),
      value: z.array(z.unknown()),
      revealed: z.boolean(),
    }),
  };

  function toolTextContent(
    structuredContent: Record<string, unknown>,
    fallbackText: string,
  ) {
    const text =
      textCompatMode === 'structured_json'
        ? JSON.stringify(structuredContent)
        : fallbackText;
    return [{ type: 'text' as const, text }];
  }

  function quoteText(value: string): string {
    return JSON.stringify(value);
  }

  function stringifyScalar(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return quoteText(value);
    return JSON.stringify(value) ?? String(value);
  }

  function formatItemSummary(item: unknown): string {
    if (!item || typeof item !== 'object') return `- ${stringifyScalar(item)}`;
    const rec = item as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof rec.id === 'string') parts.push(`id=${rec.id}`);
    if (typeof rec.name === 'string') parts.push(`name=${quoteText(rec.name)}`);
    if (typeof rec.type === 'string') parts.push(`type=${rec.type}`);
    if (typeof rec.username === 'string') {
      parts.push(`username=${quoteText(rec.username)}`);
    }
    if (Array.isArray(rec.uris) && rec.uris.length > 0) {
      const uris = rec.uris
        .map((uri) => {
          if (!uri || typeof uri !== 'object') return null;
          const value = (uri as Record<string, unknown>).uri;
          return typeof value === 'string' ? value : null;
        })
        .filter((uri): uri is string => uri !== null);
      if (uris.length > 0) parts.push(`uris=${quoteText(uris.join(', '))}`);
    }
    if (typeof rec.organizationId === 'string') {
      parts.push(`organizationId=${rec.organizationId}`);
    }
    if (typeof rec.folderId === 'string')
      parts.push(`folderId=${rec.folderId}`);
    if (Array.isArray(rec.collectionIds) && rec.collectionIds.length > 0) {
      parts.push(`collectionIds=${quoteText(rec.collectionIds.join(', '))}`);
    }
    if (Array.isArray(rec.attachments) && rec.attachments.length > 0) {
      const attachments = rec.attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== 'object') return null;
          const att = attachment as Record<string, unknown>;
          const attParts: string[] = [];
          if (typeof att.id === 'string') attParts.push(`id=${att.id}`);
          if (typeof att.fileName === 'string') {
            attParts.push(`fileName=${quoteText(att.fileName)}`);
          }
          if (typeof att.size === 'string' || typeof att.size === 'number') {
            attParts.push(`size=${att.size}`);
          }
          if (typeof att.sizeName === 'string') {
            attParts.push(`sizeName=${quoteText(att.sizeName)}`);
          }
          return attParts.length > 0 ? `{${attParts.join(' ')}}` : null;
        })
        .filter((attachment): attachment is string => attachment !== null);
      if (attachments.length > 0) {
        parts.push(`attachments=${quoteText(attachments.join(', '))}`);
      }
    }
    if (typeof rec.favorite === 'boolean')
      parts.push(`favorite=${rec.favorite}`);
    return `- ${parts.length > 0 ? parts.join(' ') : stringifyScalar(rec)}`;
  }

  function formatResultsText(label: string, results: unknown[]): string {
    if (textCompatMode === 'structured_json') {
      return JSON.stringify({ results });
    }
    if (results.length === 0) return `Found 0 ${label}.`;
    return [
      `Found ${results.length} ${label}:`,
      ...results.map(formatItemSummary),
    ].join('\n');
  }

  function structuredTextContent(
    structuredContent: Record<string, unknown>,
    fallbackText: string,
  ) {
    return toolTextContent(structuredContent, fallbackText);
  }

  function entityTextContent(
    structuredContent: Record<string, unknown>,
    heading: string,
    entity: unknown,
  ) {
    if (textCompatMode === 'structured_json') {
      return [
        { type: 'text' as const, text: JSON.stringify(structuredContent) },
      ];
    }
    return [
      {
        type: 'text' as const,
        text: [heading, formatItemSummary(entity)].join('\n'),
      },
    ];
  }

  function idTextContent(
    structuredContent: Record<string, unknown>,
    action: string,
    id: string,
  ) {
    return structuredTextContent(structuredContent, `${action} id=${id}.`);
  }

  function formatBatchCreateResult(result: {
    ok: boolean;
    item?: unknown;
    error?: string;
  }): string {
    if (result.ok) return formatItemSummary(result.item);
    return `- error=${quoteText(result.error ?? 'unknown')}`;
  }

  function toolValueContent(
    structuredContent: Record<string, unknown>,
    kind: string,
    value: unknown,
    revealed: boolean,
    extraLines: string[] = [],
  ) {
    if (textCompatMode === 'structured_json') {
      return [
        { type: 'text' as const, text: JSON.stringify(structuredContent) },
      ];
    }
    const lines = [
      `${kind}: ${revealed ? stringifyScalar(value) : 'not revealed'}`,
      ...extraLines,
    ];
    return [{ type: 'text' as const, text: lines.join('\n') }];
  }

  function toolScalarContent(
    structuredContent: Record<string, unknown>,
    label: string,
    value: unknown,
  ) {
    if (textCompatMode === 'structured_json') {
      return [
        { type: 'text' as const, text: JSON.stringify(structuredContent) },
      ];
    }
    return [
      { type: 'text' as const, text: `${label}: ${stringifyScalar(value)}` },
    ];
  }

  function ambiguousLookupResult(error: AmbiguousLoginLookupError) {
    const structuredContent = {
      ok: false,
      error: 'AMBIGUOUS_LOOKUP',
      message: error.message,
      candidates: error.candidates,
    };
    return {
      structuredContent,
      content: structuredTextContent(
        structuredContent,
        [
          `${error.message}. Retry with term set to an exact id.`,
          ...error.candidates.map(formatItemSummary),
        ].join('\n'),
      ),
      isError: true,
    };
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

  const stableObjectIdSchema = z
    .string()
    .describe(
      'Stable Bitwarden object id returned by list/search/get/create tools.',
    );
  const itemIdSchema = z
    .string()
    .describe(
      'Parent Bitwarden item id for attachment or item-specific operations.',
    );
  const attachmentIdSchema = z
    .string()
    .describe(
      'Attachment id returned by item metadata, or an unambiguous filename selector for downloads.',
    );
  const organizationIdSchema = z
    .string()
    .describe(
      'Bitwarden organization id; required for org-scoped collection operations.',
    );
  const optionalOrganizationIdSchema = z
    .string()
    .optional()
    .describe(
      'Bitwarden organization id; used for org-scoped collection operations.',
    );
  const collectionIdSchema = z
    .string()
    .optional()
    .describe('Bitwarden collection id, not a folder id.');
  const collectionIdsSchema = z
    .array(z.string())
    .optional()
    .describe('Bitwarden collection ids, not folder ids.');
  const folderIdSchema = z
    .string()
    .optional()
    .describe('Personal folder id, not an organization collection id.');
  const searchSchema = z
    .string()
    .optional()
    .describe('Optional text filter; empty means no text filter.');
  const limitSchema = z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Maximum returned rows (1-500).');
  const revealSchema = z
    .boolean()
    .optional()
    .describe(
      'Whether secret values are returned; default false and can be forced false by NOREVEAL.',
    );
  const uriSchema = z
    .string()
    .describe('URI value to store on the login item.');
  const uriMatchInputDescription =
    'URI match semantics: domain, host, startsWith, exact, regex, or never; aliases and numeric values are normalized.';
  const optionalUriMatchSchema = uriMatchInputSchema
    .optional()
    .describe(uriMatchInputDescription);
  const uriEntrySchema = z
    .object({
      uri: uriSchema,
      match: optionalUriMatchSchema,
    })
    .describe('URI entry with match semantics for a login item.');
  const urisSchema = z
    .array(uriEntrySchema)
    .optional()
    .describe('URI entries to store or update on the login item.');
  const optionalModeSchema = z
    .enum(['replace', 'merge'])
    .optional()
    .describe(
      'URI merge behavior: replace overwrites the full list; merge updates existing URIs and adds new ones by URI.',
    );
  const contentBase64Schema = z
    .string()
    .describe('Base64-encoded file bytes, not a filesystem path.');
  const optionalContentBase64Schema = z
    .string()
    .optional()
    .describe(
      'Base64-encoded file bytes for file sends, not a filesystem path.',
    );
  const filenameSchema = z
    .string()
    .describe(
      'Visible attachment or send filename stored in Bitwarden metadata.',
    );
  const optionalFilenameSchema = z
    .string()
    .optional()
    .describe('Visible filename required with contentBase64 for file sends.');
  const itemFieldSchema = z
    .object({
      name: z.string().describe('Custom field name stored on the item.'),
      value: z.string().describe('Custom field value stored on the item.'),
      hidden: z
        .boolean()
        .optional()
        .describe('Hide the field value in summaries when true.'),
    })
    .describe('Custom field stored on the item.');
  const itemFieldsSchema = z
    .array(itemFieldSchema)
    .optional()
    .describe(
      'Custom fields to store on the item. Hidden fields are redacted in summaries.',
    );
  const itemAttachmentSchema = z
    .object({
      filename: filenameSchema,
      contentBase64: contentBase64Schema,
    })
    .describe('Attachment file payload to add to the item.');
  const itemAttachmentsSchema = z
    .array(itemAttachmentSchema)
    .optional()
    .describe('Attachments to add to the item.');
  const identitySchema = z
    .object({
      title: z
        .string()
        .optional()
        .describe('Honorific or title for the identity.'),
      firstName: z.string().optional().describe('Given name for the identity.'),
      middleName: z
        .string()
        .optional()
        .describe('Middle name for the identity.'),
      lastName: z.string().optional().describe('Family name for the identity.'),
      address1: z.string().optional().describe('Primary street address line.'),
      address2: z
        .string()
        .optional()
        .describe('Secondary street address line.'),
      address3: z.string().optional().describe('Tertiary street address line.'),
      city: z.string().optional().describe('City for the identity.'),
      state: z
        .string()
        .optional()
        .describe('State, province, or region for the identity.'),
      postalCode: z
        .string()
        .optional()
        .describe('Postal or ZIP code for the identity.'),
      country: z.string().optional().describe('Country for the identity.'),
      company: z.string().optional().describe('Company or organization name.'),
      email: z.string().optional().describe('Email address for the identity.'),
      phone: z.string().optional().describe('Phone number for the identity.'),
      ssn: z
        .string()
        .optional()
        .describe('Social security number or equivalent national id.'),
      username: z
        .string()
        .optional()
        .describe('Username associated with the identity.'),
      passportNumber: z
        .string()
        .optional()
        .describe('Passport number associated with the identity.'),
      licenseNumber: z
        .string()
        .optional()
        .describe('Driver license or similar id number for the identity.'),
    })
    .optional()
    .describe('Structured identity profile data to store on the item.');
  const updateLoginSchema = z
    .object({
      username: z.string().optional().describe('Login username to update.'),
      password: z.string().optional().describe('Login password to update.'),
      totp: z
        .string()
        .optional()
        .describe('TOTP secret or otpauth value to update.'),
      uris: urisSchema.describe('Login URIs to replace on the existing item.'),
    })
    .optional()
    .describe('Login-specific fields to patch on the item.');
  const patchSchema = z
    .object({
      name: z.string().optional().describe('New item name.'),
      notes: z.string().optional().describe('New notes text for the item.'),
      favorite: z
        .boolean()
        .optional()
        .describe('Mark the item as a favorite when true.'),
      folderId: z
        .union([z.string(), z.null()])
        .optional()
        .describe('Personal folder id, not an organization collection id.'),
      collectionIds: collectionIdsSchema.describe(
        'Collection ids to replace on the item.',
      ),
      login: updateLoginSchema,
      fields: itemFieldsSchema.describe(
        'Custom fields to replace on the item.',
      ),
    })
    .describe('Partial item fields to update on the current item.');

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
        'Returns Bitwarden CLI status (locked/unlocked, server, user). This is a lazy check: not-ready status does not mean later keychain tool calls cannot unlock or recover on demand.',
      annotations: { readOnlyHint: true },
      inputSchema: {},
      outputSchema: statusOutputSchema,
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
    `${deps.toolPrefix}.sync`,
    {
      title: 'Sync Vault',
      description:
        'Pull the latest vault data from the server (bw sync). Returns the last sync timestamp.',
      annotations: { readOnlyHint: true },
      inputSchema: {},
      _meta: toolMeta,
    },
    async (_input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sync();
      return {
        structuredContent: result,
        content: [
          {
            type: 'text',
            text: result.lastSync
              ? `Synced. Last sync: ${result.lastSync}`
              : 'Synced.',
          },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.sdk_version`,
    {
      title: 'SDK Version',
      description:
        'Return the Bitwarden SDK version reported by the bundled bw CLI. Use this read-only check when diagnosing CLI/runtime compatibility without touching vault data.',
      annotations: { readOnlyHint: true },
      inputSchema: {},
      outputSchema: sdkVersionOutputSchema,
      _meta: toolMeta,
    },
    async (_input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sdkVersion();
      return {
        structuredContent: result,
        content: [{ type: 'text', text: result.version }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.encode`,
    {
      title: 'Encode',
      description:
        'Base64-encode a string with bw encode. This never mutates the vault; it only returns encoded text.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        value: z.string().describe('Plain text value to base64-encode.'),
      },
      outputSchema: encodeOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const encoded = await sdk.encode(input);
      return {
        structuredContent: encoded,
        content: toolScalarContent(encoded, 'encoded', encoded.encoded),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.generate`,
    {
      title: 'Generate',
      description:
        'Generate a password or passphrase with bw generate. This never mutates the vault; pass reveal=true to return the value, and NOREVEAL or KEYCHAIN_NOREVEAL force redaction.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        uppercase: z
          .boolean()
          .optional()
          .describe('Include uppercase letters when generating a password.'),
        lowercase: z
          .boolean()
          .optional()
          .describe('Include lowercase letters when generating a password.'),
        number: z
          .boolean()
          .optional()
          .describe('Include numeric digits when generating a password.'),
        special: z
          .boolean()
          .optional()
          .describe('Include special characters when generating a password.'),
        passphrase: z
          .boolean()
          .optional()
          .describe('Generate a word-based passphrase instead of a password.'),
        length: z
          .number()
          .int()
          .min(5)
          .max(256)
          .optional()
          .describe('Password length in characters, between 5 and 256.'),
        words: z
          .number()
          .int()
          .min(3)
          .max(50)
          .optional()
          .describe('Passphrase word count, between 3 and 50.'),
        minNumber: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('Minimum number of digits to include.'),
        minSpecial: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('Minimum number of special characters to include.'),
        separator: z
          .string()
          .optional()
          .describe('Separator to use between words in passphrase mode.'),
        capitalize: z
          .boolean()
          .optional()
          .describe('Capitalize passphrase words when supported by bw.'),
        includeNumber: z
          .boolean()
          .optional()
          .describe(
            'Include a number in passphrase mode when supported by bw.',
          ),
        ambiguous: z
          .boolean()
          .optional()
          .describe('Allow ambiguous characters in generated passwords.'),
        reveal: revealSchema,
      },
      outputSchema: generatedResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.generate(clampReveal(input));
      const structuredContent = toolResult(
        'generated',
        result.value,
        result.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'generated',
          result.value,
          result.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.generate_username`,
    {
      title: 'Generate Username',
      description:
        'Generate a username like the Bitwarden generator (random word, plus-addressed email, catch-all, forwarded alias). This never mutates the vault; pass reveal=true to return the value, and NOREVEAL or KEYCHAIN_NOREVEAL force redaction.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: z
          .enum([
            'random_word',
            'plus_addressed_email',
            'catch_all_email',
            'forwarded_email_alias',
          ])
          .optional()
          .describe(
            'Username generation strategy: random word, plus-addressed email, catch-all email, or forwarded alias.',
          ),
        capitalize: z
          .boolean()
          .optional()
          .describe('Capitalize the generated random word when supported.'),
        includeNumber: z
          .boolean()
          .optional()
          .describe('Append a number to generated usernames when supported.'),
        email: z
          .string()
          .optional()
          .describe(
            'Base email address for plus-addressed username generation.',
          ),
        domain: z
          .string()
          .optional()
          .describe('Domain for catch-all email username generation.'),
        reveal: revealSchema,
      },
      outputSchema: generatedResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.generateUsername(clampReveal(input));
      const structuredContent = toolResult(
        'generated',
        result.value,
        result.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'generated',
          result.value,
          result.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_folders`,
    {
      title: 'List Folders',
      description:
        'List personal Bitwarden folders visible to the current user. Use this to discover folder ids for item organization; returns safe folder id/name summaries only.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: searchSchema,
        limit: limitSchema,
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
        content: [
          { type: 'text', text: formatResultsText('folder(s)', results) },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_folder`,
    {
      title: 'Create Folder',
      description:
        'Create a personal Bitwarden folder. Use this to organize items outside organization collections.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the personal folder.'),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.createFolder({ name: input.name });
      return {
        structuredContent: { folder },
        content: entityTextContent({ folder }, 'Created folder:', folder),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.edit_folder`,
    {
      title: 'Edit Folder',
      description:
        'Rename an existing personal Bitwarden folder by id. This mutates only folder metadata, not the items inside it, and returns the updated folder id/name summary.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
        name: z.string().describe('New display name for the personal folder.'),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.editFolder(input);
      return {
        structuredContent: { folder },
        content: entityTextContent({ folder }, 'Updated folder:', folder),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_folder`,
    {
      title: 'Delete Folder',
      description:
        'Delete a personal Bitwarden folder. Destructive: there is no restore helper in this server.',
      annotations: destructiveToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteFolder(input);
      const structuredContent = { ok: true, id: input.id };
      return {
        structuredContent,
        content: idTextContent(structuredContent, 'Deleted folder', input.id),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_org_collections`,
    {
      title: 'List Org Collections',
      description:
        'List organization-scoped collections for the required organizationId. Use this after discovering an organization to find collection ids; returns safe id/name summaries.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        organizationId: organizationIdSchema,
        search: searchSchema,
        limit: limitSchema,
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
          {
            type: 'text',
            text: formatResultsText('org collection(s)', results),
          },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_org_collection`,
    {
      title: 'Create Org Collection',
      description:
        'Create a new organization-scoped collection inside the required organizationId. Use this for shared vault grouping; returns the created collection summary.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        organizationId: organizationIdSchema,
        name: z
          .string()
          .describe('Display name for the organization collection.'),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.createOrgCollection(input);
      return {
        structuredContent: { collection },
        content: entityTextContent(
          { collection },
          'Created org collection:',
          collection,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.edit_org_collection`,
    {
      title: 'Edit Org Collection',
      description:
        'Rename an existing organization-scoped collection inside the required organizationId. This mutates collection metadata only and returns the updated collection summary.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        organizationId: organizationIdSchema,
        id: stableObjectIdSchema,
        name: z
          .string()
          .describe('New display name for the organization collection.'),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.editOrgCollection(input);
      return {
        structuredContent: { collection },
        content: entityTextContent(
          { collection },
          'Updated org collection:',
          collection,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_org_collection`,
    {
      title: 'Delete Org Collection',
      description:
        'Delete an organization collection. Destructive: there is no restore helper in this server.',
      annotations: destructiveToolAnnotations,
      inputSchema: {
        organizationId: organizationIdSchema,
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteOrgCollection(input);
      const structuredContent = {
        ok: true,
        id: input.id,
        organizationId: input.organizationId ?? null,
      };
      return {
        structuredContent,
        content: idTextContent(
          structuredContent,
          'Deleted org collection',
          input.id,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.move_item_to_organization`,
    {
      title: 'Move Item To Organization',
      description:
        'Move an existing vault item into the required organizationId. Optionally pass collectionIds to assign organization collections during the move; collection ids are organization collections, not personal folders. Returns the moved item summary with normal redaction rules.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
        organizationId: organizationIdSchema,
        collectionIds: collectionIdsSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.moveItemToOrganization(input);
      return {
        structuredContent: { item },
        content: entityTextContent({ item }, 'Moved item:', item),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_organizations`,
    {
      title: 'List Organizations',
      description:
        'List organizations available to the current Bitwarden user so you can discover the organizationId required for org-scoped tools.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: searchSchema,
        limit: limitSchema,
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
        content: [{ type: 'text', text: formatResultsText('org(s)', results) }],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.list_collections`,
    {
      title: 'List Collections',
      description:
        'List collections in the current vault, optionally filtered by organizationId. Use list_org_collections when you already know the organization and only want organization-scoped collections.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        search: searchSchema,
        organizationId: z
          .string()
          .optional()
          .describe('Optional organization id filter for collections.'),
        limit: limitSchema,
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
          { type: 'text', text: formatResultsText('collection(s)', results) },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.search_items`,
    {
      title: 'Search Items',
      description:
        'Search vault items by text and filters (org/folder/collection/url). This wraps bw list items --search, which does not reliably search custom field values.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        text: z
          .string()
          .optional()
          .describe(
            'Optional text filter for item names, usernames, URIs, and other indexed fields. Custom field values are not reliably searched.',
          ),
        type: z
          .enum(['login', 'note', 'ssh_key', 'card', 'identity'])
          .optional()
          .describe(
            'Optional item type filter: login, note, ssh_key, card, or identity.',
          ),
        organizationId: z
          .union([z.string(), z.literal('null'), z.literal('notnull')])
          .optional()
          .describe(
            'Bitwarden organization id filter for org-scoped item search.',
          ),
        folderId: z
          .union([z.string(), z.literal('null'), z.literal('notnull')])
          .optional()
          .describe('Personal folder id, not an organization collection id.'),
        collectionId: collectionIdSchema,
        url: z
          .string()
          .optional()
          .describe('Optional URL filter for item lookup.'),
        trash: z
          .boolean()
          .optional()
          .describe('Search items in trash when true.'),
        limit: limitSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const items = await sdk.searchItems(input);
      const minimal = items.map((i) => sdk.minimalSummary(i));
      return {
        structuredContent: { results: minimal },
        content: [
          { type: 'text', text: formatResultsText('item(s)', minimal) },
        ],
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_item`,
    {
      title: 'Get Item',
      description:
        'Get the full vault item by stable item id. Secret fields and signed attachment URLs are redacted by default; pass reveal=true only when the caller is allowed to receive secrets.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: stableObjectIdSchema,
        reveal: revealSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.getItem(input.id, {
        reveal: effectiveReveal(input),
      });
      const structuredContent = { item };
      return {
        structuredContent,
        content: entityTextContent(structuredContent, 'Item:', item),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_uri`,
    {
      title: 'Get URI',
      description:
        'Get the first login URI matched by bw get uri for a search term. Terms can be names, ids, or other bw-supported selectors and may be ambiguous, so use an exact item id when possible. URI values are returned as non-secret scalar results.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe(
            'Search term or exact item id; exact ids avoid ambiguous bw lookups.',
          ),
      },
      outputSchema: uriResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const uri = await sdk.getUri(input);
      const structuredContent = toolResult('uri', uri.value, uri.revealed);
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'uri',
          uri.value,
          uri.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_notes`,
    {
      title: 'Get Notes',
      description:
        'Get item notes matched by bw get notes for a search term. Notes are treated as secret output here: value is null unless reveal=true and NOREVEAL is not active. Terms can be ambiguous, so prefer an exact item id when possible.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe(
            'Search term or exact item id; exact ids avoid ambiguous bw lookups.',
          ),
        reveal: revealSchema,
      },
      outputSchema: notesResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const notes = await sdk.getNotes(
        { term: input.term },
        { reveal: effectiveReveal(input) },
      );
      const structuredContent = toolResult(
        'notes',
        notes.value,
        notes.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'notes',
          notes.value,
          notes.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_exposed`,
    {
      title: 'Get Exposed',
      description:
        'Check the exposed-password count returned by bw get exposed for a search term. Terms follow bw lookup behavior and may be ambiguous; use an exact item id or precise selector when possible. Not-found results return a null scalar value instead of a thrown not-found error.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe(
            'Search term or exact item id; exact ids avoid ambiguous bw lookups.',
          ),
      },
      outputSchema: exposedResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const exposed = await sdk.getExposed(input);
      const structuredContent = toolResult(
        'exposed',
        exposed.value,
        exposed.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'exposed',
          exposed.value,
          exposed.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_folder`,
    {
      title: 'Get Folder',
      description:
        'Get one personal Bitwarden folder by stable folder id via bw get folder. Use this to verify a folder id before item updates; returns safe folder metadata only.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const folder = await sdk.getFolder(input);
      const structuredContent = { folder };
      return {
        structuredContent,
        content: entityTextContent(structuredContent, 'Folder:', folder),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_collection`,
    {
      title: 'Get Collection',
      description:
        'Get a collection by id (bw get collection). Use organizationId when you need to disambiguate an organization-scoped lookup.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: stableObjectIdSchema,
        organizationId: z
          .string()
          .optional()
          .describe(
            'Optional organization id used to disambiguate the lookup.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.getCollection(input);
      const structuredContent = { collection };
      return {
        structuredContent,
        content: entityTextContent(
          structuredContent,
          'Collection:',
          collection,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_organization`,
    {
      title: 'Get Organization',
      description:
        'Get one Bitwarden organization by stable organization id via bw get organization. Use list_organizations first when the id is unknown; returns organization metadata only.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const organization = await sdk.getOrganization(input);
      const structuredContent = { organization };
      return {
        structuredContent,
        content: entityTextContent(
          structuredContent,
          'Organization:',
          organization,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_org_collection`,
    {
      title: 'Get Org Collection',
      description:
        'Get an organization collection by id (bw get org-collection). organizationId is optional and narrows the org-scoped lookup when provided.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: stableObjectIdSchema,
        organizationId: z
          .string()
          .optional()
          .describe(
            'Optional organization id used to disambiguate the org collection lookup.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const collection = await sdk.getOrgCollection(input);
      const structuredContent = { collection };
      return {
        structuredContent,
        content: entityTextContent(
          structuredContent,
          'Org collection:',
          collection,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_item`,
    {
      title: 'Delete Item',
      description:
        'Delete a vault item by id. By default this is a soft delete to trash and can be restored with restore_item; set permanent=true to hard delete through bw. Returns only the requested id, not the deleted item contents.',
      annotations: destructiveToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
        permanent: z
          .boolean()
          .optional()
          .describe(
            'Hard delete immediately when true; omit or false to soft-delete to trash.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      await sdk.deleteItem(input);
      const structuredContent = { ok: true, id: input.id };
      return {
        structuredContent,
        content: idTextContent(structuredContent, 'Deleted item', input.id),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_items`,
    {
      title: 'Delete Items',
      description:
        'Delete multiple vault items by id in one session. Soft-deletes to trash by default; set permanent=true to hard delete every id. Returns per-id ok/error results so partial failures are visible.',
      annotations: destructiveToolAnnotations,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .max(200)
          .describe('Vault item ids to delete; returns one result per id.'),
        permanent: z
          .boolean()
          .optional()
          .describe(
            'Hard delete each id immediately when true; omit or false to soft-delete to trash.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const results = await sdk.deleteItems(input);
      const okCount = results.filter((r) => r.ok).length;
      const structuredContent = { results, okCount, total: results.length };
      return {
        structuredContent,
        content: structuredTextContent(
          structuredContent,
          `Deleted ${okCount}/${results.length}: ${input.ids.join(', ')}`,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.restore_item`,
    {
      title: 'Restore Item',
      description:
        'Restore a soft-deleted vault item from trash by id. Use this after delete_item or delete_items when permanent was omitted or false; hard-deleted items cannot be restored. Returns the restored item summary with normal redaction rules.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.restoreItem(input);
      return {
        structuredContent: { item },
        content: entityTextContent({ item }, 'Restored item:', item),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_attachment`,
    {
      title: 'Create Attachment',
      description:
        'Attach base64-encoded file bytes to an existing item. Returns the updated item summary with normal redaction rules, so secrets stay hidden unless reveal is allowed.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        itemId: itemIdSchema,
        filename: filenameSchema,
        contentBase64: contentBase64Schema,
        reveal: revealSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.createAttachment(clampReveal(input));
      return {
        structuredContent: { item },
        content: entityTextContent({ item }, 'Attached to item:', item),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.delete_attachment`,
    {
      title: 'Delete Attachment',
      description:
        'Delete an attachment from its parent item using itemId plus attachmentId. The attachment id comes from item attachment metadata; this is destructive for that attachment and then refetches the parent item. Returns the updated item summary with normal redaction rules.',
      annotations: destructiveToolAnnotations,
      inputSchema: {
        itemId: itemIdSchema,
        attachmentId: attachmentIdSchema,
        reveal: revealSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const item = await sdk.deleteAttachment(clampReveal(input));
      return {
        structuredContent: { item },
        content: entityTextContent(
          { item },
          'Deleted attachment from item:',
          item,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_attachment`,
    {
      title: 'Get Attachment',
      description:
        'Download an attachment from a parent item and return raw bytes as contentBase64. Pass itemId plus an attachment id, or an unambiguous filename selector resolved from the item metadata before calling bw get attachment. The response includes filename, byte count, and base64 content for local decoding.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        itemId: itemIdSchema,
        attachmentId: attachmentIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const attachment = await sdk.getAttachment(input);
      const structuredContent = { attachment };
      return {
        structuredContent,
        content: toolTextContent(
          structuredContent,
          `Downloaded attachment: filename=${quoteText(attachment.filename)} bytes=${attachment.bytes}`,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_list`,
    {
      title: 'Send List',
      description:
        'List all the Sends owned by you (bw send list). This is read-only and does not mutate the vault.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {},
      _meta: toolMeta,
    },
    async (_input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const sends = await sdk.sendList();
      const structuredContent = { sends };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'sends', sends),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_template`,
    {
      title: 'Send Template',
      description:
        'Get a Bitwarden Send JSON template from bw send template. Choose a text or file template with object values send.text/text or send.file/file before using encoded create/edit flows. This is read-only and does not create a Send.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        object: z
          .enum(['send.text', 'text', 'send.file', 'file'])
          .describe(
            'Template object to fetch: text/send.text for text Sends or file/send.file for file Sends.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const template = await sdk.sendTemplate(input);
      const structuredContent = { template };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'template', template),
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
        id: stableObjectIdSchema,
        text: z
          .boolean()
          .optional()
          .describe('Return the Send text content instead of JSON metadata.'),
        downloadFile: z
          .boolean()
          .optional()
          .describe('Download a file Send and return its file bytes.'),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendGet(input);
      const structuredContent = { result };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'result', result),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_create`,
    {
      title: 'Send Create',
      description:
        'Quick-create a Bitwarden Send through bw send. Use type=text with text, or type=file with filename plus contentBase64; deleteInDays controls expiration deletion, maxAccessCount limits accesses, and password protects the Send. For advanced JSON templates or edits, use send_create_encoded and send_edit instead.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: z
          .enum(['text', 'file'])
          .describe(
            'Send payload type: text uses text; file uses filename plus contentBase64.',
          ),
        text: z
          .string()
          .optional()
          .describe('Text content for type=text Sends.'),
        filename: optionalFilenameSchema,
        contentBase64: optionalContentBase64Schema,
        deleteInDays: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .optional()
          .describe(
            'Days until Bitwarden automatically deletes the Send (1-3650).',
          ),
        password: z
          .string()
          .optional()
          .describe('Optional Send access password required by recipients.'),
        maxAccessCount: z
          .number()
          .int()
          .min(1)
          .max(1_000_000)
          .optional()
          .describe(
            'Maximum number of Send accesses before it becomes unavailable.',
          ),
        hidden: z
          .boolean()
          .optional()
          .describe(
            'Hide text Send content by default when recipients open it.',
          ),
        name: z.string().optional().describe('Optional Send display name.'),
        notes: z
          .string()
          .optional()
          .describe('Optional private notes on the Send.'),
        fullObject: z
          .boolean()
          .optional()
          .describe(
            'Ask bw send to return the full Send object when supported.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendCreate(input);
      const structuredContent = { send };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'send', send),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_create_encoded`,
    {
      title: 'Send Create (Encoded JSON)',
      description:
        'Create a Send with the advanced bw send create flow. Provide an encodedJson template or raw json to encode, or create directly from text/file fields; file uses filename plus contentBase64 and hidden only affects text Sends. Use this when you need template-level fields beyond the quick send_create options.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        encodedJson: z
          .string()
          .optional()
          .describe(
            'Base64-encoded Send JSON template passed to bw send create.',
          ),
        json: z
          .unknown()
          .optional()
          .describe(
            'Raw Send JSON template; the server encodes it before bw send create.',
          ),
        text: z
          .string()
          .optional()
          .describe('Direct text payload alternative to encodedJson/json.'),
        hidden: z
          .boolean()
          .optional()
          .describe('Hide direct text Send content by default when true.'),
        file: z
          .object({
            filename: filenameSchema,
            contentBase64: contentBase64Schema,
          })
          .optional()
          .describe(
            'Direct file payload alternative using filename and contentBase64.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendCreateEncoded(input);
      const structuredContent = { send };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'send', send),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_edit`,
    {
      title: 'Send Edit (Encoded JSON)',
      description:
        'Edit an existing Send with the advanced bw send edit flow. Provide encodedJson or raw json containing the Send edit payload; raw json is encoded before invoking bw. Optional itemId maps to --itemid for item-linked Send edits.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        encodedJson: z
          .string()
          .optional()
          .describe(
            'Base64-encoded Send edit JSON payload passed to bw send edit.',
          ),
        json: z
          .unknown()
          .optional()
          .describe(
            'Raw Send edit JSON payload; the server encodes it before bw send edit.',
          ),
        itemId: itemIdSchema
          .optional()
          .describe(
            'Optional parent item id passed to bw send edit as --itemid.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const send = await sdk.sendEdit(input);
      const structuredContent = { send };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'send', send),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_remove_password`,
    {
      title: 'Send Remove Password',
      description:
        "Remove a Send's saved password so recipients no longer need that password. This is destructive for the Send password only; it does not delete the Send content. Use send_delete when the entire Send should be removed.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendRemovePassword(input);
      const structuredContent = { result };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'result', result),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.send_delete`,
    {
      title: 'Send Delete',
      description:
        'Delete a Bitwarden Send by id through bw send delete. This is destructive for the Send and its shared content; it does not delete any vault item that may have been used to create it. Returns the bw result payload when available.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        id: stableObjectIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.sendDelete(input);
      const structuredContent = { result };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'result', result),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.receive`,
    {
      title: 'Receive',
      description:
        'Receive a Bitwarden Send from an HTTPS url. Provide password when the Send is protected; obj=true returns the parsed JSON object, downloadFile=true downloads file bytes as base64, and the default returns received text. This reads a shared Send and does not create or modify vault items.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: z.string().describe('HTTPS Bitwarden Send URL to receive.'),
        password: z
          .string()
          .optional()
          .describe('Password required by the Send, when one was configured.'),
        obj: z
          .boolean()
          .optional()
          .describe(
            'Return the full parsed Send JSON object instead of raw text.',
          ),
        downloadFile: z
          .boolean()
          .optional()
          .describe(
            'Download a file Send and return filename, bytes, and contentBase64.',
          ),
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const result = await sdk.receive(input);
      const structuredContent = { result };
      return {
        structuredContent,
        content: toolScalarContent(structuredContent, 'result', result),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_username`,
    {
      title: 'Get Username',
      description:
        'Get a login username matched by bw get username for a search term. Usernames are treated as non-secret scalar output, but exact item ids are safest for ambiguous names.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe('Search term or exact item id used for bw get username.'),
      },
      outputSchema: usernameResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      let username: Awaited<ReturnType<KeychainSdk['getUsername']>>;
      try {
        username = await sdk.getUsername(input);
      } catch (error) {
        if (error instanceof AmbiguousLoginLookupError) {
          return ambiguousLookupResult(error);
        }
        throw error;
      }
      const structuredContent = toolResult(
        'username',
        username.value,
        username.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'username',
          username.value,
          username.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_password`,
    {
      title: 'Get Password',
      description:
        'Get a login password by search term (bw get password). The value is null unless reveal=true, and NOREVEAL or KEYCHAIN_NOREVEAL can still force redaction.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe('Search term or exact item id used for bw get password.'),
        reveal: revealSchema,
      },
      outputSchema: passwordResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      let password: Awaited<ReturnType<KeychainSdk['getPassword']>>;
      try {
        password = await sdk.getPassword(
          { term: input.term },
          { reveal: effectiveReveal(input) },
        );
      } catch (error) {
        if (error instanceof AmbiguousLoginLookupError) {
          return ambiguousLookupResult(error);
        }
        throw error;
      }
      const structuredContent = toolResult(
        'password',
        password.value,
        password.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'password',
          password.value,
          password.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.get_totp`,
    {
      title: 'Get TOTP',
      description:
        'Get the current TOTP code by search term (bw get totp). The value is null unless reveal=true, and NOREVEAL or KEYCHAIN_NOREVEAL can still force redaction.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        term: z
          .string()
          .describe('Search term or exact item id used for bw get totp.'),
        reveal: revealSchema,
      },
      outputSchema: totpResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const totp = await sdk.getTotp(
        { term: input.term },
        { reveal: effectiveReveal(input) },
      );
      const structuredContent = toolResult('totp', totp.value, totp.revealed, {
        period: totp.period,
        timeLeft: totp.timeLeft,
      });
      const extraLines = [
        `period: ${stringifyScalar(totp.period)}`,
        `timeLeft: ${stringifyScalar(totp.timeLeft)}`,
      ];
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'totp',
          totp.value,
          totp.revealed,
          extraLines,
        ),
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
        id: stableObjectIdSchema,
        reveal: revealSchema,
      },
      outputSchema: passwordHistoryResultOutputSchema,
      _meta: toolMeta,
    },
    async (input, extra) => {
      const sdk = await deps.getSdk(extra.authInfo);
      const history = await sdk.getPasswordHistory(input.id, {
        reveal: effectiveReveal(input),
      });
      const structuredContent = toolResult(
        'password_history',
        history.value,
        history.revealed,
      );
      return {
        structuredContent,
        content: toolValueContent(
          structuredContent,
          'password_history',
          history.value,
          history.revealed,
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_login`,
    {
      title: 'Create Login',
      description:
        'Create a login item with username/password/TOTP/URI data. Use this for website or app credentials instead of a secure note, card, or identity. Accepts custom fields and attachments, supports folder/organization/collection scoping, and returns a redacted item summary by default.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the login item.'),
        username: z
          .string()
          .optional()
          .describe('Login username or email address.'),
        password: z
          .string()
          .optional()
          .describe('Password to store on the login item.'),
        uris: urisSchema,
        totp: z
          .string()
          .optional()
          .describe('TOTP secret or otpauth value for the login item.'),
        notes: z
          .string()
          .optional()
          .describe('Optional free-form notes for the login item.'),
        fields: itemFieldsSchema,
        attachments: itemAttachmentsSchema,
        favorite: z
          .boolean()
          .optional()
          .describe('Mark the item as a favorite when true.'),
        organizationId: optionalOrganizationIdSchema,
        collectionIds: collectionIdsSchema,
        folderId: folderIdSchema,
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
        content: entityTextContent({ item: created }, 'Created item:', created),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_logins`,
    {
      title: 'Create Logins',
      description:
        'Create multiple login items in one call. Use this when you need several independent credentials at once, with the same login-item behavior as create_login. Set continueOnError to keep going after a failure and receive per-item ok/error results; returned items are redacted by default.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        items: z
          .array(
            z.object({
              name: z.string().describe('Display name for the login item.'),
              username: z
                .string()
                .optional()
                .describe('Login username or email address.'),
              password: z
                .string()
                .optional()
                .describe('Password to store on the login item.'),
              uris: urisSchema,
              totp: z
                .string()
                .optional()
                .describe('TOTP secret or otpauth value for the login item.'),
              notes: z
                .string()
                .optional()
                .describe('Optional free-form notes for the login item.'),
              fields: itemFieldsSchema,
              attachments: itemAttachmentsSchema,
              favorite: z
                .boolean()
                .optional()
                .describe('Mark the item as a favorite when true.'),
              organizationId: optionalOrganizationIdSchema,
              collectionIds: collectionIdsSchema,
              folderId: folderIdSchema,
            }),
          )
          .describe(
            'Login item payloads to create; each item follows create_login fields and returns its own ok/error result.',
          ),
        continueOnError: z
          .boolean()
          .optional()
          .describe(
            'Continue after failures and return per-item ok/error results when true.',
          ),
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
      const structuredContent = { results };
      return {
        structuredContent,
        content: structuredTextContent(
          structuredContent,
          [
            `Created ${results.length} login(s):`,
            ...results.map(formatBatchCreateResult),
          ].join('\n'),
        ),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.set_login_uris`,
    {
      title: 'Set Login URIs',
      description:
        'Set or update the URI list on a login item. mode=replace overwrites the full list; mode=merge updates existing URIs and adds new ones by URI. Match values can be domain, host, startsWith, exact, regex, or never.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
        mode: optionalModeSchema,
        uris: z
          .array(uriEntrySchema)
          .describe('URI entries to store or update on the login item.'),
        reveal: revealSchema,
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
        content: entityTextContent({ item: updated }, 'Updated item:', updated),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_note`,
    {
      title: 'Create Note',
      description:
        'Create a secure note item. Use this for free-form text or secrets that do not belong in a login, card, identity, or SSH key item. Accepts custom fields plus folder/organization/collection scoping, and returns a redacted item summary by default.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the secure note item.'),
        notes: z
          .string()
          .optional()
          .describe('Optional note text stored on the item.'),
        fields: itemFieldsSchema,
        favorite: z
          .boolean()
          .optional()
          .describe('Mark the item as a favorite when true.'),
        organizationId: optionalOrganizationIdSchema,
        collectionIds: collectionIdsSchema,
        folderId: folderIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createNote(input);
      return {
        structuredContent: { item: created },
        content: entityTextContent({ item: created }, 'Created item:', created),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_ssh_key`,
    {
      title: 'Create SSH Key',
      description:
        'Create an SSH key object stored as a secure note with standard fields. Use this when you need a public/private key pair plus optional fingerprint or comment, not a login or payment card. The private key is stored in a hidden field and redacted in returned summaries; folder, organization, and collection scoping is supported.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the SSH key item.'),
        publicKey: z
          .string()
          .describe('SSH public key material to store on the item.'),
        privateKey: z
          .string()
          .describe('SSH private key material to store on the item.'),
        fingerprint: z
          .string()
          .optional()
          .describe('Optional SSH key fingerprint.'),
        comment: z
          .string()
          .optional()
          .describe('Optional SSH key comment or label.'),
        notes: z
          .string()
          .optional()
          .describe('Optional note text stored on the item.'),
        favorite: z
          .boolean()
          .optional()
          .describe('Mark the item as a favorite when true.'),
        organizationId: optionalOrganizationIdSchema,
        collectionIds: collectionIdsSchema,
        folderId: folderIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createSshKey(input);
      return {
        structuredContent: { item: created },
        content: entityTextContent({ item: created }, 'Created item:', created),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_card`,
    {
      title: 'Create Card',
      description:
        'Create a payment card item. Use this for cardholder name, brand, number, expiry, and code, not for login credentials or notes. Accepts custom fields plus folder/organization/collection scoping, and returned summaries redact the card number, code, and hidden fields.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the payment card item.'),
        cardholderName: z
          .string()
          .optional()
          .describe('Cardholder name to store on the card.'),
        brand: z
          .string()
          .optional()
          .describe('Card brand, such as visa or mastercard.'),
        number: z
          .string()
          .optional()
          .describe('Primary card number to store on the card.'),
        expMonth: z.string().optional().describe('Card expiration month.'),
        expYear: z.string().optional().describe('Card expiration year.'),
        code: z.string().optional().describe('Card security code or CVV.'),
        notes: z
          .string()
          .optional()
          .describe('Optional note text stored on the item.'),
        fields: itemFieldsSchema,
        favorite: z
          .boolean()
          .optional()
          .describe('Mark the item as a favorite when true.'),
        organizationId: optionalOrganizationIdSchema,
        collectionIds: collectionIdsSchema,
        folderId: folderIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createCard(input);
      return {
        structuredContent: { item: created },
        content: entityTextContent({ item: created }, 'Created item:', created),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.create_identity`,
    {
      title: 'Create Identity',
      description:
        'Create an identity item. Use this for personal, contact, and address data instead of a login or card. Accepts structured identity fields plus custom fields and scoping, and returned summaries redact sensitive identity fields and hidden custom fields.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        name: z.string().describe('Display name for the identity item.'),
        identity: identitySchema,
        notes: z
          .string()
          .optional()
          .describe('Optional note text stored on the item.'),
        fields: itemFieldsSchema,
        favorite: z
          .boolean()
          .optional()
          .describe('Mark the item as a favorite when true.'),
        organizationId: optionalOrganizationIdSchema,
        collectionIds: collectionIdsSchema,
        folderId: folderIdSchema,
      },
      _meta: toolMeta,
    },
    async (input, extra) => {
      if (isReadOnly) return readonlyBlocked();
      const sdk = await deps.getSdk(extra.authInfo);
      const created = await sdk.createIdentity(input);
      return {
        structuredContent: { item: created },
        content: entityTextContent({ item: created }, 'Created item:', created),
      };
    },
  );

  registerTool(
    `${deps.toolPrefix}.update_item`,
    {
      title: 'Update Item',
      description:
        'Update selected fields of an item by id. The patch is applied to the current item, so omitted fields stay unchanged while explicit nulls and empty arrays overwrite the stored folder, collection, login URI, or custom-field values. Use this for partial edits instead of reconstructing the full item.',
      annotations: mutatingToolAnnotations,
      inputSchema: {
        id: stableObjectIdSchema,
        patch: patchSchema,
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
        content: entityTextContent({ item: updated }, 'Updated item:', updated),
      };
    },
  );
}

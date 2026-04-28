// src/sdk/keychainSdk.ts

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BwCliError, isBwAuthSessionInvalidError } from '../bw/bwCli.js';
import type { BwSessionManager } from '../bw/bwSession.js';
import { deepClone } from './clone.js';
import { buildBwGenerateArgs, type GenerateInput } from './generateArgs.js';
import { applyItemPatch, type UpdatePatch } from './patch.js';
import { redactItem } from './redact.js';
import type { ItemFieldInput, ItemKind, UriInput, UriMatch } from './types.js';
import {
  generateUsername,
  type UsernameGeneratorType,
} from './usernameGenerator.js';

type AnyRecord = Record<string, unknown>;
type TotpMetadata = { period: number | null; timeLeft: number | null };

const ITEM_TYPE = {
  login: 1,
  note: 2,
  card: 3,
  identity: 4,
} as const;

const URI_MATCH: Record<UriMatch, number> = {
  domain: 0,
  host: 1,
  startsWith: 2,
  exact: 3,
  regex: 4,
  never: 5,
};

const URI_MATCH_REVERSE: Record<number, UriMatch> = {
  0: 'domain',
  1: 'host',
  2: 'startsWith',
  3: 'exact',
  4: 'regex',
  5: 'never',
};

function encodeJsonForBw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function normalizeFields(fields?: ItemFieldInput[]): AnyRecord[] | undefined {
  if (!fields) return undefined;
  return fields.map((f) => ({
    name: f.name,
    value: f.value,
    // Bitwarden uses numeric "type" for custom fields:
    // 0 = text, 1 = hidden.
    type: f.hidden ? 1 : 0,
  }));
}

function normalizeUris(uris?: UriInput[]): AnyRecord[] | undefined {
  if (!uris) return undefined;
  return uris.map((u) => ({
    uri: u.uri,
    match: u.match ? URI_MATCH[u.match] : null,
  }));
}

function denormalizeUris(raw: unknown): UriInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UriInput[] = [];
  for (const u of raw) {
    if (!u || typeof u !== 'object') continue;
    const rec = u as AnyRecord;
    const uri = rec.uri;
    if (typeof uri !== 'string' || uri.length === 0) continue;
    const match =
      typeof rec.match === 'number' ? URI_MATCH_REVERSE[rec.match] : undefined;
    out.push({ uri, match });
  }
  return out;
}

function isUsernameLookupFailure(error: BwCliError): boolean {
  const combined = [error.stderr, error.stdout, error.message]
    .join('\n')
    .toLowerCase();

  if (
    /could not connect/.test(combined) ||
    /connection/.test(combined) ||
    /network/.test(combined) ||
    /timeout/.test(combined) ||
    /timed out/.test(combined) ||
    /server error/.test(combined) ||
    /internal server error/.test(combined) ||
    /bad gateway/.test(combined) ||
    /service unavailable/.test(combined)
  ) {
    return false;
  }

  return (
    /not found/.test(combined) ||
    /no item/.test(combined) ||
    /no matching/.test(combined) ||
    /more than one result/.test(combined) ||
    /multiple results/.test(combined) ||
    /ambiguous/.test(combined) ||
    /invalid search/.test(combined) ||
    /invalid lookup/.test(combined)
  );
}

function kindFromItem(item: AnyRecord): ItemKind {
  const type = item.type;
  if (type === ITEM_TYPE.login) return 'login';
  if (type === ITEM_TYPE.card) return 'card';
  if (type === ITEM_TYPE.identity) return 'identity';
  if (type === ITEM_TYPE.note) return isSshKeyItem(item) ? 'ssh_key' : 'note';
  return 'note';
}

function isSshKeyItem(item: AnyRecord): boolean {
  if (item.type !== ITEM_TYPE.note) return false;
  const fields = item.fields;
  if (!Array.isArray(fields)) return false;
  const names = new Set(
    fields
      .map((f) => (f && typeof f === 'object' ? (f as AnyRecord).name : null))
      .filter((n): n is string => typeof n === 'string'),
  );
  return names.has('public_key') && names.has('private_key');
}

export interface SearchItemsInput {
  text?: string;
  type?: ItemKind;
  organizationId?: string | 'null' | 'notnull';
  folderId?: string | 'null' | 'notnull';
  collectionId?: string;
  url?: string;
  trash?: boolean;
  limit?: number;
}

export interface LoginCandidateSummary {
  id?: string;
  name?: string;
  type: ItemKind;
  username?: string;
  uris?: UriInput[];
  organizationId: string | null;
  folderId: string | null;
  collectionIds?: unknown[];
  favorite?: boolean;
}

export class AmbiguousLoginLookupError extends Error {
  readonly candidates: LoginCandidateSummary[];

  constructor(message: string, candidates: LoginCandidateSummary[]) {
    super(message);
    this.name = 'AmbiguousLoginLookupError';
    this.candidates = candidates;
  }
}

export interface ListFoldersInput {
  search?: string;
  limit?: number;
}

export interface ListCollectionsInput {
  search?: string;
  organizationId?: string;
  limit?: number;
}

export interface ListOrganizationsInput {
  search?: string;
  limit?: number;
}

export class KeychainSdk {
  constructor(private readonly bw: BwSessionManager) {}

  private async createLoginForSession(
    session: string,
    input: {
      name: string;
      username?: string;
      password?: string;
      uris?: UriInput[];
      totp?: string;
      notes?: string;
      fields?: ItemFieldInput[];
      attachments?: { filename: string; contentBase64: string }[];
      reveal?: boolean;
      favorite?: boolean;
      organizationId?: string;
      collectionIds?: string[];
      folderId?: string;
    },
  ): Promise<unknown> {
    const tpl = (await this.bw.getTemplateItemForSession(session)) as AnyRecord;
    const item = deepClone(tpl);
    item.type = ITEM_TYPE.login;
    item.name = input.name;
    item.notes = input.notes ?? '';
    item.favorite = input.favorite ?? false;
    if (input.organizationId) item.organizationId = input.organizationId;
    if (input.folderId) item.folderId = input.folderId;

    item.fields = normalizeFields(input.fields) ?? [];

    const login = (
      item.login && typeof item.login === 'object'
        ? (item.login as AnyRecord)
        : {}
    ) as AnyRecord;
    if (input.username !== undefined) login.username = input.username;
    if (input.password !== undefined) login.password = input.password;
    if (input.totp !== undefined) login.totp = input.totp;
    if (input.uris !== undefined) login.uris = normalizeUris(input.uris);
    item.login = login;

    // Set collectionIds optimistically; we'll also enforce with item-collections edit.
    if (input.collectionIds) item.collectionIds = input.collectionIds;

    const encoded = encodeJsonForBw(item);
    const { stdout } = await this.bw.runForSession(
      session,
      ['create', 'item', encoded],
      { timeoutMs: 120_000 },
    );
    const created = this.parseBwJson<AnyRecord>(stdout);

    if (input.attachments?.length) {
      const dir = await mkdtemp(join(tmpdir(), 'keychain-attach-'));
      try {
        for (const att of input.attachments) {
          const safeBase = basename(att.filename || 'attachment.bin').replace(
            /[^A-Za-z0-9._-]+/g,
            '_',
          );
          const safeName = safeBase.length > 0 ? safeBase : 'attachment.bin';
          const p = join(dir, safeName);
          await writeFile(p, Buffer.from(att.contentBase64, 'base64'));
          const { stdout: attOut } = await this.bw.runForSession(
            session,
            [
              'create',
              'attachment',
              '--file',
              p,
              '--itemid',
              String(created.id),
            ],
            { timeoutMs: 120_000 },
          );
          // IMPORTANT: bw may return the full item JSON (including secrets) here.
          // Never parse or include it in our response.
          void attOut;
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    if (input.collectionIds?.length) {
      const encodedCols = encodeJsonForBw(input.collectionIds);
      await this.bw
        .runForSession(
          session,
          ['edit', 'item-collections', String(created.id), encodedCols],
          { timeoutMs: 120_000 },
        )
        .catch(() => {});
    }

    // Refetch so attachments metadata is accurate, but redact secrets by default.
    const { stdout: gotOut } = await this.bw.runForSession(
      session,
      ['get', 'item', String(created.id)],
      { timeoutMs: 60_000 },
    );
    const got = JSON.parse(gotOut) as AnyRecord;
    return this.maybeRedact(got, input.reveal);
  }

  private syncOnWrite(): boolean {
    return (
      (process.env.KEYCHAIN_SYNC_ON_WRITE ?? 'true').toLowerCase() === 'true'
    );
  }

  private maybeRedact<T>(value: T, reveal?: boolean): T {
    return (reveal ? value : (redactItem(value) as T)) as T;
  }

  private valueResult<T extends Record<string, unknown> = Record<never, never>>(
    value: string | null,
    revealed: boolean,
    extra?: T,
  ) {
    return { value, revealed, ...(extra ?? {}) };
  }

  private extractLoginTotp(item: unknown): string | null {
    if (!item || typeof item !== 'object') return null;
    const login = (item as AnyRecord).login;
    if (!login || typeof login !== 'object') return null;
    const totp = (login as AnyRecord).totp;
    return typeof totp === 'string' && totp.trim().length > 0 ? totp : null;
  }

  private computeTotpMetadata(
    rawTotp: string | null,
    nowMs: number = Date.now(),
  ): TotpMetadata {
    if (!rawTotp) return { period: null, timeLeft: null };

    let period = 30;

    if (rawTotp.startsWith('otpauth://')) {
      try {
        const parsed = new URL(rawTotp);
        const candidate = Number.parseInt(
          parsed.searchParams.get('period') ?? '',
          10,
        );
        if (Number.isFinite(candidate) && candidate > 0) {
          period = candidate;
        }
      } catch {
        return { period: null, timeLeft: null };
      }
    }

    const elapsed = Math.floor(nowMs / 1000) % period;
    return {
      period,
      timeLeft: elapsed === 0 ? period : period - elapsed,
    };
  }

  private candidateMatchesTerm(item: AnyRecord, terms: string[]): boolean {
    const id = item.id;
    const name = item.name;
    const login =
      item.login && typeof item.login === 'object'
        ? (item.login as AnyRecord)
        : null;
    const username = login?.username;

    return terms.some(
      (term) => id === term || name === term || username === term,
    );
  }

  private loginCandidateSummary(item: AnyRecord): LoginCandidateSummary {
    const login =
      item.login && typeof item.login === 'object'
        ? (item.login as AnyRecord)
        : null;
    const username = login?.username;
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      type: kindFromItem(item),
      username: typeof username === 'string' ? username : undefined,
      uris: denormalizeUris(login?.uris),
      organizationId:
        typeof item.organizationId === 'string' ? item.organizationId : null,
      folderId: typeof item.folderId === 'string' ? item.folderId : null,
      collectionIds: Array.isArray(item.collectionIds)
        ? item.collectionIds
        : undefined,
      favorite: typeof item.favorite === 'boolean' ? item.favorite : undefined,
    };
  }

  private async searchLoginCandidatesForSession(
    session: string,
    term: string,
  ): Promise<{ terms: string[]; candidates: AnyRecord[] }> {
    const tokens = term
      .split('|')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const terms = tokens.length ? tokens : [term];
    const byId = new Map<string, AnyRecord>();

    for (const searchTerm of terms) {
      const { stdout } = await this.bw.runForSession(
        session,
        ['list', 'items', '--search', searchTerm],
        { timeoutMs: 120_000 },
      );
      const results = this.parseBwJson<unknown[]>(stdout);
      for (const raw of results) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as AnyRecord;
        if (item.type !== ITEM_TYPE.login) continue;
        const id = item.id;
        if (typeof id === 'string' && id.length > 0) byId.set(id, item);
      }
    }

    return { terms, candidates: [...byId.values()] };
  }

  private narrowLoginCandidates(
    candidates: AnyRecord[],
    terms: string[],
  ): AnyRecord[] {
    const exactCandidates = candidates.filter((item) =>
      this.candidateMatchesTerm(item, terms),
    );
    return exactCandidates.length > 0 ? exactCandidates : candidates;
  }

  private async resolveUniqueLoginCandidateForSession(
    session: string,
    term: string,
    kind: string,
  ): Promise<AnyRecord> {
    if (!term.trim()) throw new Error(`${kind} lookup term is empty`);

    const { terms, candidates } = await this.searchLoginCandidatesForSession(
      session,
      term,
    );

    if (candidates.length === 0) {
      throw new Error(`${kind} lookup failed: no login item found`);
    }

    const narrowed = this.narrowLoginCandidates(candidates, terms);
    if (narrowed.length !== 1) {
      throw new AmbiguousLoginLookupError(
        `${kind} lookup failed: multiple matching login items found`,
        narrowed.map((item) => this.loginCandidateSummary(item)),
      );
    }

    return narrowed[0] as AnyRecord;
  }

  private async resolveTotpConfigForSession(
    session: string,
    term: string,
  ): Promise<string | null> {
    const direct = await this.bw
      .runForSession(session, ['get', 'item', term], { timeoutMs: 60_000 })
      .then(({ stdout }) => this.parseBwJson(stdout))
      .catch(() => null);
    const directTotp = this.extractLoginTotp(direct);
    if (directTotp) return directTotp;

    const tokens = term
      .split('|')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const terms = tokens.length ? tokens : [term];
    const byId = new Map<string, AnyRecord>();

    for (const searchTerm of terms) {
      const { stdout } = await this.bw.runForSession(
        session,
        ['list', 'items', '--search', searchTerm],
        { timeoutMs: 120_000 },
      );
      const results = this.parseBwJson<unknown[]>(stdout);
      for (const raw of results) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as AnyRecord;
        if (item.type !== ITEM_TYPE.login) continue;
        const id = item.id;
        if (typeof id === 'string' && id.length > 0) byId.set(id, item);
      }
    }

    const candidates = [...byId.values()];
    const candidate =
      candidates.find((item) => this.candidateMatchesTerm(item, terms)) ??
      candidates[0];
    if (!candidate || typeof candidate.id !== 'string') return null;

    const { stdout } = await this.bw.runForSession(
      session,
      ['get', 'item', candidate.id],
      { timeoutMs: 60_000 },
    );
    const item = this.parseBwJson(stdout);
    return this.extractLoginTotp(item);
  }

  private parseBwJson<T = unknown>(stdout: string): T {
    try {
      return JSON.parse(stdout) as T;
    } catch (err) {
      // Do not include raw stdout — it may contain unredacted secrets.
      const length = stdout.length;
      const preview = stdout.startsWith('{')
        ? '{...}'
        : stdout.slice(0, 8).replace(/[^\x20-\x7E]/g, '?');
      throw new Error(
        `Failed to parse bw CLI output (${length} bytes, starts with: ${preview})`,
        { cause: err },
      );
    }
  }

  private tryParseJson(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) return '';
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }

  private async readSingleFileAsBase64(dir: string): Promise<{
    filename: string;
    bytes: number;
    contentBase64: string;
  }> {
    const files = await readdir(dir);
    if (files.length !== 1) {
      throw new Error(
        `Expected exactly 1 downloaded file, found ${files.length}`,
      );
    }
    const filename = files[0] ?? '';
    const buf = await readFile(join(dir, filename));
    return {
      filename,
      bytes: buf.byteLength,
      contentBase64: buf.toString('base64'),
    };
  }

  private redactPasswordHistoryForTool(history: unknown[]): unknown[] {
    // For secret-returning tools we avoid returning sentinel strings like "[REDACTED]"
    // because downstream utilities might accidentally pass them through.
    return history.map((h) => {
      if (!h || typeof h !== 'object') return h;
      const rec = { ...(h as AnyRecord) };
      if (typeof rec.password === 'string') rec.password = null;
      return rec;
    });
  }

  async status(): Promise<unknown> {
    return this.bw.status();
  }

  async sync(): Promise<{ success: true; lastSync: string | null }> {
    await this.bw.withSession(async (session) => {
      await this.bw.runForSession(session, ['sync'], { timeoutMs: 120_000 });
    });
    // After sync, fetch status to get the lastSync timestamp.
    const status = (await this.bw.status()) as Record<string, unknown>;
    const lastSync =
      typeof status.lastSync === 'string' ? status.lastSync : null;
    return { success: true, lastSync };
  }

  async sdkVersion(): Promise<{ version: string }> {
    const { stdout } = await this.bw.withSession(async (session) => {
      return this.bw.runForSession(session, ['--version'], {
        timeoutMs: 30_000,
      });
    });
    return { version: stdout.trim() };
  }

  async encode(input: { value: string }): Promise<{ encoded: string }> {
    // `bw encode` base64-encodes stdin.
    const { stdout } = await this.bw.withSession(async (session) => {
      return this.bw.runForSession(session, ['encode'], {
        stdin: `${input.value}\n`,
        timeoutMs: 30_000,
      });
    });
    return { encoded: stdout.trim() };
  }

  async generate(
    input: GenerateInput & { reveal?: boolean } = {},
  ): Promise<{ value: string | null; revealed: boolean }> {
    if (!input.reveal) return this.valueResult(null, false);

    const args = buildBwGenerateArgs(input);
    const { stdout } = await this.bw.withSession(async (session) =>
      this.bw.runForSession(session, args, { timeoutMs: 30_000 }),
    );
    return this.valueResult(stdout.trim(), true);
  }

  async generateUsername(
    input: {
      type?: UsernameGeneratorType;
      capitalize?: boolean;
      includeNumber?: boolean;
      email?: string;
      domain?: string;
      reveal?: boolean;
    } = {},
  ): Promise<{ value: string | null; revealed: boolean }> {
    if (!input.reveal) return this.valueResult(null, false);
    const value = generateUsername(input);
    return this.valueResult(value, true);
  }

  async getAttachment(input: {
    itemId: string;
    attachmentId: string;
  }): Promise<{ filename: string; bytes: number; contentBase64: string }> {
    return this.bw.withSession(async (session) => {
      const dir = await mkdtemp(join(tmpdir(), 'keychain-attachment-'));
      try {
        await this.bw.runForSession(
          session,
          [
            'get',
            'attachment',
            input.attachmentId,
            '--itemid',
            input.itemId,
            '--output',
            dir,
          ],
          { timeoutMs: 120_000 },
        );
        return await this.readSingleFileAsBase64(dir);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  async sendList(): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['send', 'list'],
        {
          timeoutMs: 60_000,
        },
      );
      return this.tryParseJson(stdout);
    });
  }

  async sendTemplate(input: {
    object: 'send.text' | 'text' | 'send.file' | 'file';
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['send', 'template', input.object],
        { timeoutMs: 60_000 },
      );
      return this.tryParseJson(stdout);
    });
  }

  async sendGet(input: {
    id: string;
    text?: boolean;
    downloadFile?: boolean;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (input.text) {
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', 'send', 'get', input.id, '--text'],
          { timeoutMs: 60_000 },
        );
        return { text: stdout.trim() };
      }

      if (input.downloadFile) {
        const dir = await mkdtemp(join(tmpdir(), 'keychain-sendfile-'));
        try {
          await this.bw.runForSession(
            session,
            ['send', 'get', input.id, '--output', dir],
            { timeoutMs: 120_000 },
          );
          const file = await this.readSingleFileAsBase64(dir);
          return { file };
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }

      const { stdout } = await this.bw.runForSession(
        session,
        ['send', 'get', input.id],
        {
          timeoutMs: 60_000,
        },
      );
      return this.tryParseJson(stdout);
    });
  }

  async sendRemovePassword(input: { id: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['send', 'remove-password', input.id],
        { timeoutMs: 60_000 },
      );
      return this.tryParseJson(stdout);
    });
  }

  async sendDelete(input: { id: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['send', 'delete', input.id],
        {
          timeoutMs: 60_000,
        },
      );
      return this.tryParseJson(stdout);
    });
  }

  async sendCreate(input: {
    type: 'text' | 'file';
    text?: string;
    filename?: string;
    contentBase64?: string;
    deleteInDays?: number;
    password?: string;
    maxAccessCount?: number;
    hidden?: boolean;
    name?: string;
    notes?: string;
    fullObject?: boolean;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const args: string[] = ['send'];
      if (input.type === 'file') args.push('--file');
      if (typeof input.deleteInDays === 'number')
        args.push('--deleteInDays', String(input.deleteInDays));
      if (typeof input.password === 'string')
        args.push('--password', input.password);
      if (typeof input.maxAccessCount === 'number')
        args.push('--maxAccessCount', String(input.maxAccessCount));
      if (input.hidden) args.push('--hidden');
      if (typeof input.name === 'string') args.push('--name', input.name);
      if (typeof input.notes === 'string') args.push('--notes', input.notes);
      if (input.fullObject) args.push('--fullObject');

      if (input.type === 'text') {
        if (typeof input.text !== 'string')
          throw new Error('Missing text for text send');
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', ...args, '--', input.text],
          { timeoutMs: 60_000 },
        );
        return this.tryParseJson(stdout);
      }

      if (
        typeof input.filename !== 'string' ||
        typeof input.contentBase64 !== 'string'
      ) {
        throw new Error('Missing filename/contentBase64 for file send');
      }

      const dir = await mkdtemp(join(tmpdir(), 'keychain-send-create-'));
      const filePath = join(dir, basename(input.filename));
      try {
        await writeFile(filePath, Buffer.from(input.contentBase64, 'base64'));
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', ...args, '--', filePath],
          { timeoutMs: 120_000 },
        );
        return this.tryParseJson(stdout);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  async sendCreateEncoded(input: {
    encodedJson?: string;
    json?: unknown;
    text?: string;
    hidden?: boolean;
    file?: { filename: string; contentBase64: string };
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      let encodedJson = input.encodedJson;
      if (!encodedJson && typeof input.json !== 'undefined') {
        const enc = await this.encode({ value: JSON.stringify(input.json) });
        encodedJson = enc.encoded;
      }

      if (
        typeof encodedJson !== 'string' &&
        typeof input.text !== 'string' &&
        typeof input.file === 'undefined'
      ) {
        throw new Error(
          'sendCreateEncoded requires one of: encodedJson, json, text, or file',
        );
      }

      const args: string[] = ['send', 'create'];
      if (typeof input.text === 'string') args.push('--text', input.text);
      if (input.hidden) args.push('--hidden');

      let dir: string | null = null;
      try {
        if (input.file) {
          dir = await mkdtemp(join(tmpdir(), 'keychain-send-create-'));
          const filePath = join(dir, basename(input.file.filename));
          await writeFile(
            filePath,
            Buffer.from(input.file.contentBase64, 'base64'),
          );
          args.push('--file', filePath);
        }

        if (typeof encodedJson === 'string') {
          args.push('--', encodedJson);
        }
        const { stdout } = await this.bw.runForSession(session, args, {
          timeoutMs: 120_000,
        });
        return this.tryParseJson(stdout);
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    });
  }

  async sendEdit(input: {
    encodedJson?: string;
    json?: unknown;
    itemId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      let encodedJson = input.encodedJson;
      if (!encodedJson && typeof input.json !== 'undefined') {
        const enc = await this.encode({ value: JSON.stringify(input.json) });
        encodedJson = enc.encoded;
      }
      if (typeof encodedJson !== 'string') {
        throw new Error('sendEdit requires encodedJson or json');
      }

      const args: string[] = ['send', 'edit'];
      if (typeof input.itemId === 'string') args.push('--itemid', input.itemId);
      args.push('--', encodedJson);

      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 120_000,
      });
      return this.tryParseJson(stdout);
    });
  }

  async receive(input: {
    url: string;
    password?: string;
    /** Pass --obj to return the full parsed JSON object instead of raw text. */
    obj?: boolean;
    downloadFile?: boolean;
  }): Promise<unknown> {
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'https:') {
      throw new Error('receive URL must use HTTPS');
    }

    return this.bw.withSession(async (session) => {
      const opts: string[] = ['receive'];
      if (typeof input.password === 'string')
        opts.push('--password', input.password);

      if (input.obj) {
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', ...opts, '--obj', '--', input.url],
          { timeoutMs: 60_000 },
        );
        return this.tryParseJson(stdout);
      }

      if (input.downloadFile) {
        const dir = await mkdtemp(join(tmpdir(), 'keychain-receive-'));
        const outPath = join(dir, 'received');
        try {
          await this.bw.runForSession(
            session,
            [...opts, '--output', outPath, '--', input.url],
            { timeoutMs: 120_000 },
          );
          const buf = await readFile(outPath);
          return {
            file: {
              filename: basename(outPath),
              bytes: buf.byteLength,
              contentBase64: buf.toString('base64'),
            },
          };
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }

      const { stdout } = await this.bw.runForSession(
        session,
        ['--raw', ...opts, '--', input.url],
        {
          timeoutMs: 60_000,
        },
      );
      return { text: stdout.trim() };
    });
  }

  async searchItems(input: SearchItemsInput): Promise<unknown[]> {
    const { limit } = input;
    const rawText = (input.text ?? '').trim();
    const tokens = rawText.includes('|')
      ? rawText
          .split('|')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : rawText.length > 0
        ? [rawText]
        : [];

    const orgFilter = input.organizationId;
    const orgId =
      orgFilter && orgFilter !== 'null' && orgFilter !== 'notnull'
        ? orgFilter
        : undefined;

    const folderFilter = input.folderId;
    const folderId =
      folderFilter && folderFilter !== 'null' && folderFilter !== 'notnull'
        ? folderFilter
        : undefined;

    const items = await this.bw.withSession(async (session) => {
      const baseArgs: string[] = ['list', 'items'];
      if (input.url) baseArgs.push('--url', input.url);
      if (folderId) baseArgs.push('--folderid', folderId);
      if (input.collectionId)
        baseArgs.push('--collectionid', input.collectionId);
      if (orgId) baseArgs.push('--organizationid', orgId);
      if (input.trash) baseArgs.push('--trash');

      // NOTE: bw's `--search` does not treat "a | b" as "a OR b". If callers pass
      // a pipe-delimited string (common when combining name + username), we split
      // and union the results.
      const terms = tokens.length ? tokens : [undefined];
      const byId = new Map<string, unknown>();

      for (const term of terms) {
        const args = [...baseArgs];
        if (term) args.push('--search', term);
        const { stdout } = await this.bw.runForSession(session, args, {
          timeoutMs: 120_000,
        });
        const results = this.parseBwJson<unknown[]>(stdout);
        for (const raw of results) {
          if (!raw || typeof raw !== 'object') continue;
          const id = (raw as { id?: unknown }).id;
          if (typeof id === 'string' && id.length > 0) byId.set(id, raw);
        }
      }

      return [...byId.values()];
    });

    const orgFiltered = items.filter((raw) => {
      if (!raw || typeof raw !== 'object') return false;
      const item = raw as AnyRecord;

      if (orgFilter === 'null') {
        return item.organizationId == null;
      }
      if (orgFilter === 'notnull') {
        return typeof item.organizationId === 'string' && item.organizationId;
      }
      return true;
    });

    const folderFiltered = orgFiltered.filter((raw) => {
      if (!raw || typeof raw !== 'object') return false;
      const item = raw as AnyRecord;

      if (folderFilter === 'null') {
        return item.folderId == null;
      }
      if (folderFilter === 'notnull') {
        return typeof item.folderId === 'string' && item.folderId;
      }
      return true;
    });

    const filtered = folderFiltered.filter((raw) => {
      if (!raw || typeof raw !== 'object') return false;
      const item = raw as AnyRecord;
      if (!input.type) return true;
      if (input.type === 'ssh_key') return isSshKeyItem(item);
      if (input.type === 'login') return item.type === ITEM_TYPE.login;
      if (input.type === 'card') return item.type === ITEM_TYPE.card;
      if (input.type === 'identity') return item.type === ITEM_TYPE.identity;
      if (input.type === 'note')
        return item.type === ITEM_TYPE.note && !isSshKeyItem(item);
      return true;
    });

    return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
  }

  async listFolders(input: ListFoldersInput = {}): Promise<unknown[]> {
    const { limit } = input;
    const folders = await this.bw.withSession(async (session) => {
      const args: string[] = ['list', 'folders'];
      if (input.search) args.push('--search', input.search);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson<unknown[]>(stdout);
    });
    return typeof limit === 'number' ? folders.slice(0, limit) : folders;
  }

  async listCollections(input: ListCollectionsInput = {}): Promise<unknown[]> {
    const { limit } = input;
    const collections = await this.bw.withSession(async (session) => {
      const args: string[] = ['list', 'collections'];
      if (input.search) args.push('--search', input.search);
      if (input.organizationId)
        args.push('--organizationid', input.organizationId);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson<unknown[]>(stdout);
    });
    return typeof limit === 'number'
      ? collections.slice(0, limit)
      : collections;
  }

  async listOrganizations(
    input: ListOrganizationsInput = {},
  ): Promise<unknown[]> {
    const { limit } = input;
    const orgs = await this.bw.withSession(async (session) => {
      const args: string[] = ['list', 'organizations'];
      if (input.search) args.push('--search', input.search);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson<unknown[]>(stdout);
    });
    return typeof limit === 'number' ? orgs.slice(0, limit) : orgs;
  }

  async createFolder(input: { name: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const encoded = encodeJsonForBw({ name: input.name });
      const { stdout } = await this.bw.runForSession(
        session,
        ['create', 'folder', encoded],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async editFolder(input: { id: string; name: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const encoded = encodeJsonForBw({ name: input.name });
      const { stdout } = await this.bw.runForSession(
        session,
        ['edit', 'folder', input.id, encoded],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async deleteFolder(input: { id: string }): Promise<void> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      await this.bw.runForSession(session, ['delete', 'folder', input.id], {
        timeoutMs: 60_000,
      });
    });
  }

  async listOrgCollections(input: {
    organizationId: string;
    search?: string;
    limit?: number;
  }): Promise<unknown[]> {
    const { limit } = input;
    const cols = await this.bw.withSession(async (session) => {
      const args: string[] = [
        'list',
        'org-collections',
        '--organizationid',
        input.organizationId,
      ];
      if (input.search) args.push('--search', input.search);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson<unknown[]>(stdout);
    });
    return typeof limit === 'number' ? cols.slice(0, limit) : cols;
  }

  async createOrgCollection(input: {
    organizationId: string;
    name: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      // Newer bw CLI versions validate that --organizationid matches the request payload.
      const encoded = encodeJsonForBw({
        name: input.name,
        organizationId: input.organizationId,
      });
      const { stdout } = await this.bw.runForSession(
        session,
        [
          'create',
          'org-collection',
          '--organizationid',
          input.organizationId,
          encoded,
        ],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async editOrgCollection(input: {
    organizationId: string;
    id: string;
    name: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      // Newer bw CLI versions validate that --organizationid matches the request payload.
      const encoded = encodeJsonForBw({
        id: input.id,
        name: input.name,
        organizationId: input.organizationId,
      });
      const { stdout } = await this.bw.runForSession(
        session,
        [
          'edit',
          'org-collection',
          input.id,
          encoded,
          '--organizationid',
          input.organizationId,
        ],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async deleteOrgCollection(input: {
    organizationId: string;
    id: string;
  }): Promise<void> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      await this.bw.runForSession(
        session,
        [
          'delete',
          'org-collection',
          input.id,
          '--organizationid',
          input.organizationId,
        ],
        { timeoutMs: 60_000 },
      );
    });
  }

  async moveItemToOrganization(input: {
    id: string;
    organizationId: string;
    collectionIds?: string[];
    reveal?: boolean;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const args: string[] = ['move', input.id, input.organizationId];
      if (input.collectionIds) {
        args.push(encodeJsonForBw(input.collectionIds));
      }
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 120_000,
      });
      const moved = this.parseBwJson<AnyRecord>(stdout);
      return this.maybeRedact(moved, input.reveal);
    });
  }

  async getItem(id: string, opts: { reveal?: boolean } = {}): Promise<unknown> {
    const item = await this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'item', id],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });

    return this.maybeRedact(item, opts.reveal);
  }

  async deleteItem(input: { id: string; permanent?: boolean }): Promise<void> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const args = ['delete', 'item', input.id];
      if (input.permanent) args.push('--permanent');
      await this.bw.runForSession(session, args, { timeoutMs: 60_000 });
    });
  }

  async deleteItems(input: {
    ids: string[];
    permanent?: boolean;
  }): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
    if (input.ids.length === 0) return [];
    if (input.ids.length > 200) throw new Error('Too many ids (max 200)');

    // Run inside a single session lock to avoid re-syncing/unlocking per item.
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of input.ids) {
        try {
          const args = ['delete', 'item', id];
          if (input.permanent) args.push('--permanent');
          await this.bw.runForSession(session, args, { timeoutMs: 60_000 });
          results.push({ id, ok: true });
        } catch (e) {
          results.push({
            id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return results;
    });
  }

  async restoreItem(input: { id: string; reveal?: boolean }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const { stdout } = await this.bw.runForSession(
        session,
        ['restore', 'item', input.id],
        { timeoutMs: 60_000 },
      );
      // restore may not return JSON; ignore stdout and refetch.
      void stdout;

      const { stdout: gotOut } = await this.bw.runForSession(
        session,
        ['get', 'item', input.id],
        { timeoutMs: 60_000 },
      );
      return this.maybeRedact(JSON.parse(gotOut) as AnyRecord, input.reveal);
    });
  }

  async createAttachment(input: {
    itemId: string;
    filename: string;
    contentBase64: string;
    reveal?: boolean;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const dir = await mkdtemp(join(tmpdir(), 'keychain-attach-'));
      try {
        const safeBase = basename(input.filename || 'attachment.bin').replace(
          /[^A-Za-z0-9._-]+/g,
          '_',
        );
        const safeName = safeBase.length > 0 ? safeBase : 'attachment.bin';
        const p = join(dir, safeName);
        await writeFile(p, Buffer.from(input.contentBase64, 'base64'));
        const { stdout: out } = await this.bw.runForSession(
          session,
          ['create', 'attachment', '--file', p, '--itemid', input.itemId],
          { timeoutMs: 120_000 },
        );
        // bw may return a full item JSON; ignore it and refetch the item.
        void out;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }

      const { stdout: gotOut } = await this.bw.runForSession(
        session,
        ['get', 'item', input.itemId],
        { timeoutMs: 60_000 },
      );
      return this.maybeRedact(JSON.parse(gotOut) as AnyRecord, input.reveal);
    });
  }

  async deleteAttachment(input: {
    itemId: string;
    attachmentId: string;
    reveal?: boolean;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      await this.bw.runForSession(
        session,
        ['delete', 'attachment', input.attachmentId, '--itemid', input.itemId],
        { timeoutMs: 60_000 },
      );

      const { stdout: gotOut } = await this.bw.runForSession(
        session,
        ['get', 'item', input.itemId],
        { timeoutMs: 60_000 },
      );
      return this.maybeRedact(JSON.parse(gotOut) as AnyRecord, input.reveal);
    });
  }

  /** Always reveals — username is not considered a secret by Bitwarden. */
  async getUsername(input: {
    term: string;
  }): Promise<{ value: string | null; revealed: boolean }> {
    const term = input.term.trim();
    if (!term) throw new Error('Username lookup term is empty');

    return this.bw.withSession(async (session) => {
      try {
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', 'get', 'username', term],
          { timeoutMs: 60_000 },
        );
        const username = stdout.trim();
        if (!username)
          throw new Error('Username lookup found an empty username');
        return this.valueResult(username, true);
      } catch (error) {
        if (isBwAuthSessionInvalidError(error)) throw error;
        if (!(error instanceof BwCliError) || error.exitCode !== 1) throw error;
        if (!isUsernameLookupFailure(error)) throw error;

        const candidate = await this.resolveUniqueLoginCandidateForSession(
          session,
          term,
          'Username',
        );

        const login =
          candidate.login && typeof candidate.login === 'object'
            ? (candidate.login as AnyRecord)
            : null;
        const username = login?.username;
        if (typeof username !== 'string' || username.trim().length === 0) {
          throw new Error('Username lookup found an empty username');
        }

        return this.valueResult(username.trim(), true);
      }
    });
  }

  /** Requires opts.reveal=true; returns {value: null, revealed: false} when ungated. */
  async getPassword(
    input: { term: string },
    opts: { reveal?: boolean } = {},
  ): Promise<{ value: string | null; revealed: boolean }> {
    if (!opts.reveal) return this.valueResult(null, false);
    const term = input.term.trim();
    if (!term) throw new Error('Password lookup term is empty');

    return this.bw.withSession(async (session) => {
      try {
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', 'get', 'password', term],
          { timeoutMs: 60_000 },
        );
        return this.valueResult(stdout.trim(), true);
      } catch (error) {
        if (isBwAuthSessionInvalidError(error)) throw error;
        if (!(error instanceof BwCliError) || error.exitCode !== 1) throw error;
        if (!isUsernameLookupFailure(error)) throw error;

        const candidate = await this.resolveUniqueLoginCandidateForSession(
          session,
          term,
          'Password',
        );
        const login =
          candidate.login && typeof candidate.login === 'object'
            ? (candidate.login as AnyRecord)
            : null;
        const password = login?.password;
        if (typeof password !== 'string') {
          throw new Error('Password lookup found an empty password');
        }
        return this.valueResult(password, true);
      }
    });
  }

  async getTotp(
    input: { term: string },
    opts: { reveal?: boolean } = {},
  ): Promise<{
    value: string | null;
    revealed: boolean;
    period: number | null;
    timeLeft: number | null;
  }> {
    if (!opts.reveal) {
      return {
        ...this.valueResult(null, false),
        period: null,
        timeLeft: null,
      };
    }

    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['--raw', 'get', 'totp', input.term],
        { timeoutMs: 60_000 },
      );
      const rawTotp = await this.resolveTotpConfigForSession(
        session,
        input.term,
      ).catch(() => null);
      return {
        ...this.valueResult(stdout.trim(), true),
        ...this.computeTotpMetadata(rawTotp),
      };
    });
  }

  /** Always reveals — URIs are not considered secrets by Bitwarden. */
  async getUri(input: {
    term: string;
  }): Promise<{ value: string | null; revealed: boolean }> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['--raw', 'get', 'uri', input.term],
        { timeoutMs: 60_000 },
      );
      return this.valueResult(stdout.trim(), true);
    });
  }

  async getNotes(
    input: { term: string },
    opts: { reveal?: boolean } = {},
  ): Promise<{ value: string | null; revealed: boolean }> {
    if (!opts.reveal) return this.valueResult(null, false);

    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['--raw', 'get', 'notes', input.term],
        { timeoutMs: 60_000 },
      );
      return this.valueResult(stdout.trim(), true);
    });
  }

  /** Always reveals — exposure count is public information from haveibeenpwned. */
  async getExposed(input: {
    term: string;
  }): Promise<{ value: string | null; revealed: boolean }> {
    const isNotFoundError = (err: BwCliError): boolean => {
      const combined = `${err.stderr}\n${err.stdout}`.trim().toLowerCase();

      if (/more than one result/.test(combined)) {
        return false;
      }

      if (
        /could not connect/.test(combined) ||
        /connection/.test(combined) ||
        /network/.test(combined) ||
        /timeout/.test(combined) ||
        /unauthorized|forbidden|not logged|authentication|permission/.test(
          combined,
        )
      ) {
        return false;
      }

      return true;
    };

    return this.bw.withSession(async (session) => {
      try {
        const { stdout } = await this.bw.runForSession(
          session,
          ['--raw', 'get', 'exposed', input.term],
          { timeoutMs: 60_000 },
        );
        return this.valueResult(stdout.trim(), true);
      } catch (err) {
        if (
          (err instanceof BwCliError &&
            err.exitCode === 1 &&
            isNotFoundError(err)) ||
          (err instanceof Error &&
            /exit code 1/.test(err.message.toLowerCase()))
        ) {
          return this.valueResult(null, false);
        }
        throw err;
      }
    });
  }

  async getFolder(input: { id: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'folder', input.id],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async getCollection(input: {
    id: string;
    organizationId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const args: string[] = ['get', 'collection', input.id];
      if (input.organizationId)
        args.push('--organizationid', input.organizationId);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson(stdout);
    });
  }

  async getOrganization(input: { id: string }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'organization', input.id],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson(stdout);
    });
  }

  async getOrgCollection(input: {
    id: string;
    organizationId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      const args: string[] = ['get', 'org-collection', input.id];
      if (input.organizationId)
        args.push('--organizationid', input.organizationId);
      const { stdout } = await this.bw.runForSession(session, args, {
        timeoutMs: 60_000,
      });
      return this.parseBwJson(stdout);
    });
  }

  async getPasswordHistory(
    id: string,
    opts: { reveal?: boolean } = {},
  ): Promise<{ value: unknown[]; revealed: boolean }> {
    const item = await this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'item', id],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson<AnyRecord>(stdout);
    });

    const history = Array.isArray(item.passwordHistory)
      ? (item.passwordHistory as unknown[])
      : [];

    if (opts.reveal) return { value: history, revealed: true };
    return {
      value: this.redactPasswordHistoryForTool(history),
      revealed: false,
    };
  }

  async createLogin(input: {
    name: string;
    username?: string;
    password?: string;
    uris?: UriInput[];
    totp?: string;
    notes?: string;
    fields?: ItemFieldInput[];
    attachments?: { filename: string; contentBase64: string }[];
    reveal?: boolean;
    favorite?: boolean;
    organizationId?: string;
    collectionIds?: string[];
    folderId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], {
            timeoutMs: 120_000,
          })
          .catch(() => {});
      }

      return this.createLoginForSession(session, input);
    });
  }

  async createLogins(input: {
    items: {
      name: string;
      username?: string;
      password?: string;
      uris?: UriInput[];
      totp?: string;
      notes?: string;
      fields?: ItemFieldInput[];
      attachments?: { filename: string; contentBase64: string }[];
      reveal?: boolean;
      favorite?: boolean;
      organizationId?: string;
      collectionIds?: string[];
      folderId?: string;
    }[];
    continueOnError?: boolean;
  }): Promise<{ ok: boolean; item?: unknown; error?: string }[]> {
    const continueOnError = input.continueOnError ?? true;
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const results: { ok: boolean; item?: unknown; error?: string }[] = [];
      for (const it of input.items) {
        try {
          const created = await this.createLoginForSession(session, it);
          results.push({ ok: true, item: created });
        } catch (err) {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message?: unknown }).message)
              : String(err);
          results.push({ ok: false, error: msg });
          if (!continueOnError) break;
        }
      }
      return results;
    });
  }

  async createNote(input: {
    name: string;
    notes?: string;
    fields?: ItemFieldInput[];
    reveal?: boolean;
    favorite?: boolean;
    organizationId?: string;
    collectionIds?: string[];
    folderId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], {
            timeoutMs: 120_000,
          })
          .catch(() => {});
      }

      const tpl = (await this.bw.getTemplateItemForSession(
        session,
      )) as AnyRecord;
      const item = deepClone(tpl);
      item.type = ITEM_TYPE.note;
      item.name = input.name;
      item.notes = input.notes ?? '';
      item.favorite = input.favorite ?? false;
      if (input.organizationId) item.organizationId = input.organizationId;
      if (input.folderId) item.folderId = input.folderId;
      if (!item.secureNote || typeof item.secureNote !== 'object') {
        item.secureNote = { type: 0 };
      }
      item.fields = normalizeFields(input.fields) ?? [];
      if (input.collectionIds) item.collectionIds = input.collectionIds;

      const encoded = encodeJsonForBw(item);
      const { stdout } = await this.bw.runForSession(
        session,
        ['create', 'item', encoded],
        { timeoutMs: 120_000 },
      );
      const created = this.parseBwJson<AnyRecord>(stdout);

      if (input.collectionIds?.length) {
        const encodedCols = encodeJsonForBw(input.collectionIds);
        await this.bw
          .runForSession(
            session,
            ['edit', 'item-collections', String(created.id), encodedCols],
            { timeoutMs: 120_000 },
          )
          .catch(() => {});
      }

      return this.maybeRedact(created, input.reveal);
    });
  }

  async createSshKey(input: {
    name: string;
    publicKey: string;
    privateKey: string;
    fingerprint?: string;
    comment?: string;
    notes?: string;
    reveal?: boolean;
    favorite?: boolean;
    organizationId?: string;
    collectionIds?: string[];
    folderId?: string;
  }): Promise<unknown> {
    const fields: ItemFieldInput[] = [
      { name: 'public_key', value: input.publicKey, hidden: false },
      { name: 'private_key', value: input.privateKey, hidden: true },
    ];
    if (input.fingerprint)
      fields.push({
        name: 'fingerprint',
        value: input.fingerprint,
        hidden: false,
      });
    if (input.comment)
      fields.push({ name: 'comment', value: input.comment, hidden: false });

    return this.createNote({
      name: input.name,
      notes: input.notes,
      reveal: input.reveal,
      favorite: input.favorite,
      organizationId: input.organizationId,
      collectionIds: input.collectionIds,
      folderId: input.folderId,
      fields,
    });
  }

  async createCard(input: {
    name: string;
    cardholderName?: string;
    brand?: string;
    number?: string;
    expMonth?: string;
    expYear?: string;
    code?: string;
    notes?: string;
    fields?: ItemFieldInput[];
    reveal?: boolean;
    favorite?: boolean;
    organizationId?: string;
    collectionIds?: string[];
    folderId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const tpl = (await this.bw.getTemplateItemForSession(
        session,
      )) as AnyRecord;
      const item = deepClone(tpl);
      item.type = ITEM_TYPE.card;
      item.name = input.name;
      item.notes = input.notes ?? '';
      item.favorite = input.favorite ?? false;
      if (input.organizationId) item.organizationId = input.organizationId;
      if (input.folderId) item.folderId = input.folderId;

      item.fields = normalizeFields(input.fields) ?? [];

      const card = (
        item.card && typeof item.card === 'object'
          ? (item.card as AnyRecord)
          : {}
      ) as AnyRecord;
      if (input.cardholderName !== undefined)
        card.cardholderName = input.cardholderName;
      if (input.brand !== undefined) card.brand = input.brand;
      if (input.number !== undefined) card.number = input.number;
      if (input.expMonth !== undefined) card.expMonth = input.expMonth;
      if (input.expYear !== undefined) card.expYear = input.expYear;
      if (input.code !== undefined) card.code = input.code;
      item.card = card;

      if (input.collectionIds) item.collectionIds = input.collectionIds;

      const encoded = encodeJsonForBw(item);
      const { stdout } = await this.bw.runForSession(
        session,
        ['create', 'item', encoded],
        { timeoutMs: 120_000 },
      );
      const created = this.parseBwJson<AnyRecord>(stdout);

      if (input.collectionIds?.length) {
        const encodedCols = encodeJsonForBw(input.collectionIds);
        await this.bw
          .runForSession(
            session,
            ['edit', 'item-collections', String(created.id), encodedCols],
            { timeoutMs: 120_000 },
          )
          .catch(() => {});
      }

      return this.maybeRedact(created, input.reveal);
    });
  }

  async createIdentity(input: {
    name: string;
    identity?: {
      title?: string;
      firstName?: string;
      middleName?: string;
      lastName?: string;
      address1?: string;
      address2?: string;
      address3?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      company?: string;
      email?: string;
      phone?: string;
      ssn?: string;
      username?: string;
      passportNumber?: string;
      licenseNumber?: string;
    };
    notes?: string;
    fields?: ItemFieldInput[];
    reveal?: boolean;
    favorite?: boolean;
    organizationId?: string;
    collectionIds?: string[];
    folderId?: string;
  }): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], { timeoutMs: 120_000 })
          .catch(() => {});
      }

      const tpl = (await this.bw.getTemplateItemForSession(
        session,
      )) as AnyRecord;
      const item = deepClone(tpl);
      item.type = ITEM_TYPE.identity;
      item.name = input.name;
      item.notes = input.notes ?? '';
      item.favorite = input.favorite ?? false;
      if (input.organizationId) item.organizationId = input.organizationId;
      if (input.folderId) item.folderId = input.folderId;

      item.fields = normalizeFields(input.fields) ?? [];

      const identity = (
        item.identity && typeof item.identity === 'object'
          ? (item.identity as AnyRecord)
          : {}
      ) as AnyRecord;

      if (input.identity) {
        for (const [k, v] of Object.entries(input.identity)) {
          if (v !== undefined) identity[k] = v;
        }
      }
      item.identity = identity;

      if (input.collectionIds) item.collectionIds = input.collectionIds;

      const encoded = encodeJsonForBw(item);
      const { stdout } = await this.bw.runForSession(
        session,
        ['create', 'item', encoded],
        { timeoutMs: 120_000 },
      );
      const created = this.parseBwJson<AnyRecord>(stdout);

      if (input.collectionIds?.length) {
        const encodedCols = encodeJsonForBw(input.collectionIds);
        await this.bw
          .runForSession(
            session,
            ['edit', 'item-collections', String(created.id), encodedCols],
            { timeoutMs: 120_000 },
          )
          .catch(() => {});
      }

      return this.maybeRedact(created, input.reveal);
    });
  }

  async updateItem(
    id: string,
    patch: UpdatePatch,
    opts: { reveal?: boolean } = {},
  ): Promise<unknown> {
    return this.bw.withSession(async (session) => {
      if (this.syncOnWrite()) {
        await this.bw
          .runForSession(session, ['sync'], {
            timeoutMs: 120_000,
          })
          .catch(() => {});
      }

      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'item', id],
        { timeoutMs: 60_000 },
      );
      const current = this.parseBwJson<AnyRecord>(stdout);

      const next = applyItemPatch(current, deepClone(patch));

      // If uris were provided, convert match strings to bw enum numbers.
      if (patch.login?.uris) {
        const login = (
          next.login && typeof next.login === 'object'
            ? (next.login as AnyRecord)
            : {}
        ) as AnyRecord;
        login.uris = normalizeUris(patch.login.uris);
        next.login = login;
      }

      const encoded = encodeJsonForBw(next);
      const { stdout: out } = await this.bw.runForSession(
        session,
        ['edit', 'item', id, encoded],
        { timeoutMs: 120_000 },
      );
      const updated = JSON.parse(out) as AnyRecord;

      if (patch.collectionIds !== undefined) {
        const encodedCols = encodeJsonForBw(patch.collectionIds);
        await this.bw
          .runForSession(
            session,
            ['edit', 'item-collections', id, encodedCols],
            { timeoutMs: 120_000 },
          )
          .catch(() => {});
      }

      return this.maybeRedact(updated, opts.reveal);
    });
  }

  async setLoginUris(input: {
    id: string;
    uris: UriInput[];
    mode?: 'replace' | 'merge';
    reveal?: boolean;
  }): Promise<unknown> {
    const mode = input.mode ?? 'replace';
    if (mode !== 'replace' && mode !== 'merge') {
      throw new Error(`Invalid mode: ${String(mode)}`);
    }

    // IMPORTANT: do not call updateItem from inside a bw.withSession callback.
    // BwSessionManager can serialize session access; nesting can deadlock.
    const current = await this.bw.withSession(async (session) => {
      const { stdout } = await this.bw.runForSession(
        session,
        ['get', 'item', input.id],
        { timeoutMs: 60_000 },
      );
      return this.parseBwJson<AnyRecord>(stdout);
    });

    const currentLogin =
      current.login && typeof current.login === 'object'
        ? (current.login as AnyRecord)
        : null;
    const existing = denormalizeUris(currentLogin?.uris) ?? [];

    let nextUris: UriInput[] = input.uris;
    if (mode === 'merge') {
      const byUri = new Map<string, UriInput>();
      for (const u of existing) byUri.set(u.uri, u);
      for (const u of input.uris) byUri.set(u.uri, u);

      const seen = new Set<string>();
      const merged: UriInput[] = [];

      // Existing order first (updated in place if overridden)
      for (const u of existing) {
        const v = byUri.get(u.uri);
        if (!v || seen.has(v.uri)) continue;
        seen.add(v.uri);
        merged.push(v);
      }
      // Append new entries
      for (const u of input.uris) {
        if (seen.has(u.uri)) continue;
        seen.add(u.uri);
        merged.push(u);
      }

      nextUris = merged;
    }

    return this.updateItem(
      input.id,
      { login: { uris: nextUris } },
      { reveal: input.reveal },
    );
  }

  minimalSummary(item: unknown): unknown {
    if (!item || typeof item !== 'object') return item;
    const rec = item as AnyRecord;
    const login =
      rec.login && typeof rec.login === 'object'
        ? (rec.login as AnyRecord)
        : null;
    const username = login?.username;
    const summary: LoginCandidateSummary = {
      id: typeof rec.id === 'string' ? rec.id : undefined,
      name: typeof rec.name === 'string' ? rec.name : undefined,
      type: kindFromItem(rec),
      username: typeof username === 'string' ? username : undefined,
      uris: denormalizeUris(login?.uris),
      organizationId:
        typeof rec.organizationId === 'string' ? rec.organizationId : null,
      folderId: typeof rec.folderId === 'string' ? rec.folderId : null,
      collectionIds: Array.isArray(rec.collectionIds)
        ? rec.collectionIds
        : undefined,
      favorite: typeof rec.favorite === 'boolean' ? rec.favorite : undefined,
    };
    return summary;
  }
}

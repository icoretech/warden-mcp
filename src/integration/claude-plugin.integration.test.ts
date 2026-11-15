import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

import { BwSessionPool } from '../bw/bwPool.js';
import { type BwSessionManager, readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';

test('Claude plugin launcher applies default restrictions and explicit reveal opt-in', {
  timeout: 300_000,
}, async (t) => {
  if (
    !process.env.BW_HOST ||
    !process.env.BW_PASSWORD ||
    !process.env.BW_CLIENTID ||
    !process.env.BW_CLIENTSECRET
  ) {
    t.skip('requires the compose-backed API-key fixture');
    return;
  }

  const credentials = readBwEnv();
  assert.ok(credentials.login.method === 'apikey');
  const pluginUrl = new URL('../../plugins/warden-mcp/', import.meta.url);
  const pluginRoot = fileURLToPath(pluginUrl);
  const server = z
    .object({
      mcpServers: z.object({
        warden: z.object({
          command: z.string(),
          args: z.array(z.string()),
          env: z.record(z.string(), z.string()),
        }),
      }),
    })
    .parse(JSON.parse(await readFile(new URL('.mcp.json', pluginUrl), 'utf8')))
    .mcpServers.warden;
  const { userConfig } = z
    .object({
      userConfig: z.object({
        read_only: z.object({ default: z.boolean() }),
        no_reveal: z.object({ default: z.boolean() }),
      }),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL('.claude-plugin/plugin.json', pluginUrl),
          'utf8',
        ),
      ),
    );
  const rootDir = await mkdtemp(join(tmpdir(), 'claude-plugin-integration-'));
  const source = {
    name: `plugin-login-${randomUUID()}`,
    username: 'sample-user',
    password: 'test-only-password',
  };
  let seedManager: BwSessionManager | undefined;

  try {
    const pool = new BwSessionPool({ rootDir: join(rootDir, 'seed-profile') });
    seedManager = await pool.getOrCreate(credentials);
    const sdk = new KeychainSdk(seedManager);
    const item = z
      .object({ id: z.string() })
      .parse(await sdk.createLogin(source));

    try {
      for (const policy of [
        {
          readOnly: userConfig.read_only.default,
          noReveal: userConfig.no_reveal.default,
          permitsSecrets: false,
        },
        { readOnly: false, noReveal: false, permitsSecrets: true },
      ]) {
        const options = new Map(
          Object.entries({
            vault_url: credentials.host,
            client_id: credentials.login.clientId,
            client_secret: credentials.login.clientSecret,
            master_password: credentials.password,
            read_only: String(policy.readOnly),
            no_reveal: String(policy.noReveal),
          }),
        );
        const interpolate = (value: string): string =>
          value
            .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
            .replace(/\$\{user_config\.([a-z_]+)\}/g, (_, name: string) => {
              const configured = options.get(name);
              assert.ok(configured !== undefined, `unknown option: ${name}`);
              return configured;
            });
        const transport = new StdioClientTransport({
          command: interpolate(server.command),
          args: server.args.map(interpolate),
          // Outside the checkout, npx resolves the published package rather
          // than the private source package with the same name and version.
          cwd: rootDir,
          env: {
            ...getDefaultEnvironment(),
            ...Object.fromEntries(
              Object.entries(server.env).map(([key, value]) => [
                key,
                interpolate(value),
              ]),
            ),
            HOME: rootDir,
            CLAUDE_PLUGIN_DATA: join(rootDir, 'plugin-data'),
            NODE_TLS_REJECT_UNAUTHORIZED:
              process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '1',
            ...(process.env.NODE_EXTRA_CA_CERTS
              ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
              : {}),
            NPM_CONFIG_UPDATE_NOTIFIER: 'false',
          },
          stderr: 'ignore',
        });
        const client = new Client({
          name: 'plugin-contract',
          version: '0.0.0',
        });

        try {
          await client.connect(transport, { timeout: 180_000 });
          const tools = await client.listTools();
          assert.equal(
            tools.tools.some((tool) => tool.name === 'keychain_create_login'),
            policy.permitsSecrets,
          );
          const fetched = await client.callTool(
            { name: 'keychain_get_item', arguments: { id: item.id } },
            undefined,
            { timeout: 120_000 },
          );
          assert.notEqual(fetched.isError, true);
          const metadata = z
            .object({ item: z.object({ id: z.string(), name: z.string() }) })
            .parse(fetched.structuredContent).item;
          assert.deepEqual(metadata, { id: item.id, name: source.name });

          const password = await client.callTool({
            name: 'keychain_get_password',
            arguments: { term: item.id, reveal: true },
          });
          assert.notEqual(password.isError, true);
          const result = z
            .object({
              result: z.object({
                value: z.string().nullable(),
                revealed: z.boolean(),
              }),
            })
            .parse(password.structuredContent).result;
          assert.deepEqual(result, {
            value: policy.permitsSecrets ? source.password : null,
            revealed: policy.permitsSecrets,
          });
        } finally {
          await client.close();
        }
      }
    } finally {
      await sdk.deleteItem({ id: item.id, permanent: true });
    }
  } finally {
    try {
      // Stop and await the seed profile's keepalive before deleting its files.
      await seedManager?.revoke();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});

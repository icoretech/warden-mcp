// src/transports/stdio.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BwSessionPool } from '../bw/bwPool.js';
import { readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';
import { registerTools } from '../tools/registerTools.js';
import { SERVER_VERSION } from '../version.js';

export async function runStdioTransport(): Promise<void> {
  const TOOL_PREFIX = process.env.TOOL_PREFIX ?? 'keychain';
  const TOOL_SEPARATOR = process.env.TOOL_SEPARATOR ?? '_';
  const APP_NAME = process.env.MCP_APP_NAME ?? `${TOOL_PREFIX}-mcp`;

  // Credentials must be present at startup for stdio mode.
  const bwEnv = readBwEnv();

  const pool = new BwSessionPool({
    rootDir:
      process.env.KEYCHAIN_BW_HOME_ROOT ??
      `${process.env.HOME ?? '/data'}/bw-profiles`,
  });

  const bw = await pool.getOrCreate(bwEnv);

  const server = new McpServer({ name: APP_NAME, version: SERVER_VERSION });

  registerTools(server, {
    getSdk: async () => {
      return new KeychainSdk(bw);
    },
    toolPrefix: TOOL_PREFIX,
    toolSeparator: TOOL_SEPARATOR,
  });

  const transport = new StdioServerTransport();

  // Assign onclose BEFORE connect() to avoid a race where stdin is already
  // EOF when the process starts (connect() calls transport.start() internally).
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  await server.connect(transport);

  await closed;
}

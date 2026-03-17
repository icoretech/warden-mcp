// src/transports/stdio.ts

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BwSessionPool } from '../bw/bwPool.js';
import { readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';
import { registerTools } from '../tools/registerTools.js';

export async function runStdioTransport(): Promise<void> {
  const TOOL_PREFIX = process.env.TOOL_PREFIX ?? 'keychain';
  const APP_NAME = process.env.MCP_APP_NAME ?? `${TOOL_PREFIX}-mcp`;

  // Credentials must be present at startup for stdio mode.
  const bwEnv = readBwEnv();

  const pool = new BwSessionPool({
    rootDir:
      process.env.KEYCHAIN_BW_HOME_ROOT ??
      `${process.env.HOME ?? '/data'}/bw-profiles`,
  });

  const server = new McpServer({ name: APP_NAME, version: '0.1.0' });

  registerTools(server, {
    getSdk: async () => {
      const bw = await pool.getOrCreate(bwEnv);
      return new KeychainSdk(bw);
    },
    toolPrefix: TOOL_PREFIX,
  });

  const transport = new StdioServerTransport();

  // Assign onclose BEFORE connect() to avoid a race where stdin is already
  // EOF when the process starts (connect() calls transport.start() internally).
  await new Promise<void>(async (resolve) => {
    transport.onclose = resolve;
    await server.connect(transport);
  });
}

#!/usr/bin/env node

// bin/warden-mcp.js — CLI entry for @icoretech/warden-mcp

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const startupPath = resolve(__dirname, '../dist/startup/bwStartup.js');
  if (!existsSync(startupPath)) {
    console.error(
      '[warden-mcp] ERROR: dist/startup/bwStartup.js not found. Run `npm run build` first.',
    );
    process.exit(1);
  }
  const { prepareBwStartup } = await import(startupPath);
  prepareBwStartup(process.env);

  // Delegate to the compiled server entry, forwarding all arguments.
  const serverPath = resolve(__dirname, '../dist/server.js');
  if (!existsSync(serverPath)) {
    console.error(
      '[warden-mcp] ERROR: dist/server.js not found. Run `npm run build` first.',
    );
    process.exit(1);
  }

  await import(serverPath);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

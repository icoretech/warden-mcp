#!/usr/bin/env node

// bin/warden-mcp.js — CLI entry for @icoretech/warden-mcp

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve bw binary: optional dep → system PATH
if (!process.env.BW_BIN) {
  try {
    const { resolveBundledBwBin } = await import(
      resolve(__dirname, '../dist/bw/resolveBwBin.js')
    );
    const candidate = resolveBundledBwBin();
    if (candidate) {
      process.env.BW_BIN = candidate;
    }
  } catch {
    // @bitwarden/cli optional dep not installed — fall through to system bw
  }
}

// Verify bw is available (either from optional dep or system PATH)
if (!process.env.BW_BIN) {
  const probe = spawnSync('bw', ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    console.error(
      '[warden-mcp] ERROR: bw CLI not found.\n' +
        'Install it with:  npm install -g @bitwarden/cli\n' +
        'Or set the BW_BIN environment variable to the path of the bw binary.',
    );
    process.exit(1);
  }
  // System bw is available — bwCli.ts will find it via PATH
}

// Delegate to the compiled server entry, forwarding all arguments.
const serverPath = resolve(__dirname, '../dist/server.js');
if (!existsSync(serverPath)) {
  console.error(
    '[warden-mcp] ERROR: dist/server.js not found. Run `npm run build` first.',
  );
  process.exit(1);
}

// Use dynamic import to run the server module (it has top-level await).
await import(serverPath);

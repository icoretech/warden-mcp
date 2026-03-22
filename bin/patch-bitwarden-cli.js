#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const cliPackageDir = resolve(__dirname, '../node_modules/@bitwarden/cli');

if (!existsSync(cliPackageDir)) {
  process.exit(0);
}

const patchPackageEntrypoint = require.resolve('patch-package/dist/index.js');
const result = spawnSync(process.execPath, [patchPackageEntrypoint], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error(
    `[warden-mcp] failed to execute patch-package: ${result.error.message}`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);

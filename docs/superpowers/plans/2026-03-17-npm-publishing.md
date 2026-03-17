# warden-mcp npm Publishing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `warden-mcp` as `@icoretech/warden-mcp` on GitHub Packages with stdio + HTTP transports, automated release via release-please.

**Architecture:** Extract the HTTP transport from `app.ts` into `src/transports/http.ts`, add a new `src/transports/stdio.ts` that reads credentials from env vars via the existing `readBwEnv()`. A thin `bin/warden-mcp.js` entry resolves the optional `@bitwarden/cli` dep before delegating to `server.ts`. Release-please drives version bumps; a single workflow handles release creation + npm publish.

**Tech Stack:** Node 24, TypeScript 5.9, Biome, `@modelcontextprotocol/sdk`, Express 5, release-please-action v4, GitHub Packages.

---

## Chunk 1: Repo Setup & Open Source Readiness

### Task 1: Create GitHub repo and push

**Files:**
- No code changes — git + gh operations only

- [ ] **Step 1: Create the private repo under icoretech**

```bash
cd /Users/kain/src/warden-mcp
gh repo create icoretech/warden-mcp --private --source=. --remote=origin --push
```

Expected: repo created at `https://github.com/icoretech/warden-mcp`, code pushed.

- [ ] **Step 2: Verify**

```bash
gh repo view icoretech/warden-mcp
```

Expected: shows repo info, visibility: private.

---

### Task 2: Add LICENSE, CHANGELOG.md, SECURITY.md

**Files:**
- Create: `LICENSE`
- Create: `CHANGELOG.md`
- Create: `SECURITY.md`

- [ ] **Step 1: Add MIT license**

Create `LICENSE`:
```
MIT License

Copyright (c) 2026 icoretech

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add empty CHANGELOG.md**

Create `CHANGELOG.md`:
```markdown
# Changelog
```

- [ ] **Step 3: Add SECURITY.md**

Create `SECURITY.md`:
```markdown
# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report security issues privately via GitHub's security advisory feature:
https://github.com/icoretech/warden-mcp/security/advisories/new

We will respond within 72 hours and coordinate a fix and disclosure timeline with you.
```

- [ ] **Step 4: Commit**

```bash
git add LICENSE CHANGELOG.md SECURITY.md
git commit -m "chore: add LICENSE, CHANGELOG, and SECURITY policy"
```

---

### Task 3: Update package.json and add .npmrc

**Files:**
- Modify: `package.json`
- Create: `.npmrc`

- [ ] **Step 1: Update package.json**

Change the following fields in `package.json`:
- `"name"`: `"keychain-mcp"` → `"@icoretech/warden-mcp"`
- Remove `"private": true`
- Add `"bin"`, `"files"`, `"publishConfig"`, `"optionalDependencies"` fields

Full updated `package.json`:
```json
{
  "name": "@icoretech/warden-mcp",
  "version": "0.1.0",
  "type": "module",
  "description": "Vaultwarden/Bitwarden MCP server backed by Bitwarden CLI (bw).",
  "bin": {
    "warden-mcp": "bin/warden-mcp.js"
  },
  "files": [
    "dist/",
    "bin/",
    "!dist/**/*.test.js",
    "!dist/integration/"
  ],
  "scripts": {
    "dev": "tsx watch --clear-screen=false src/server.ts",
    "build": "tsc -p .",
    "start": "node dist/server.js",
    "test": "npm run build && node --test \"dist/**/*.test.js\"",
    "test:integration": "npm run build && node --test --test-timeout=45000 \"dist/integration/**/*.test.js\"",
    "test:session-regression": "node scripts/session-flood-regression.mjs",
    "lint": "biome check --write --assist-enabled=true . && tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "express": "^5.2.1",
    "jose": "^6.1.3",
    "zod": "^4.3.6"
  },
  "optionalDependencies": {
    "@bitwarden/cli": "2026.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.15",
    "@types/express": "^5.0.6",
    "@types/node": "^25.2.3",
    "playwright": "1.58.2",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "public"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

- [ ] **Step 2: Create .npmrc**

Create `.npmrc`:
```
@icoretech:registry=https://npm.pkg.github.com
```

- [ ] **Step 3: Install to update package-lock.json**

```bash
cd /Users/kain/src/warden-mcp
npm install
```

Expected: `package-lock.json` updated with `@bitwarden/cli` optional dep.

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: `dist/` compiles cleanly, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .npmrc
git commit -m "chore: rename package to @icoretech/warden-mcp, add publishConfig and bin"
```

---

## Chunk 2: Transport Refactor

### Task 4: Extract HTTP transport from app.ts

**Files:**
- Create: `src/transports/http.ts` (content from `src/app.ts`)
- Modify: `src/app.ts` (becomes thin re-export for backward compat)

The goal: move all logic in `src/app.ts` into `src/transports/http.ts` keeping the same exported names (`createKeychainApp`, `CreateKeychainAppOptions`). Keep `src/app.ts` as a re-export so existing test imports don't break.

- [ ] **Step 1: Create src/transports/http.ts**

Create directory and file:
```bash
mkdir -p /Users/kain/src/warden-mcp/src/transports
```

Create `src/transports/http.ts` with the full content of the current `src/app.ts` — copy it verbatim, only updating the import path for `bwHeaders`:

The only import path that changes is `bwHeaders` (one level deeper now):
```ts
// Change this import at the top:
import { bwEnvFromHeadersOrEnv } from '../bw/bwHeaders.js';
// (was: import { bwEnvFromExpressHeaders } from './bw/bwHeaders.js';)
```

And the call inside `withBwHeaders` on line 90:
```ts
// Change:
const bwEnv = bwEnvFromExpressHeaders(req);
// To:
const bwEnv = bwEnvFromHeadersOrEnv(req);
```

All other paths (`bwPool`, `keychainSdk`, `registerTools`) also get a `../` prefix:
```ts
import { BwSessionPool } from '../bw/bwPool.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';
import { registerTools } from '../tools/registerTools.js';
```

- [ ] **Step 2: Replace src/app.ts with a thin re-export**

Replace the entire content of `src/app.ts` with:
```ts
// src/app.ts
// Re-export HTTP transport for backward compatibility with existing imports.
export { createKeychainApp, type CreateKeychainAppOptions } from './transports/http.js';
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/kain/src/warden-mcp && npm run build
```

Expected: compiles cleanly. No errors.

- [ ] **Step 4: Run unit tests**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/transports/http.ts src/app.ts
git commit -m "refactor: extract HTTP transport to src/transports/http.ts"
```

---

### Task 5: Add env var fallback to bwHeaders.ts

**Files:**
- Modify: `src/bw/bwHeaders.ts`

Add a new exported function `bwEnvFromHeadersOrEnv()` that tries headers first, then falls back to `readBwEnv()` from env vars. The existing `bwEnvFromExpressHeaders()` is unchanged.

- [ ] **Step 1: Add the test**

Add to `src/bw/bwHeaders.test.ts` (create it if it doesn't exist):
```ts
// src/bw/bwHeaders.test.ts
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { bwEnvFromHeadersOrEnv } from './bwHeaders.js';

// Minimal Express-like request mock
function mockReq(headers: Record<string, string>) {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    headers,
  } as unknown as import('express').Request;
}

describe('bwEnvFromHeadersOrEnv', () => {
  it('returns null when no headers and no env vars', () => {
    const saved = { ...process.env };
    delete process.env.BW_HOST;
    delete process.env.BW_PASSWORD;
    delete process.env.BW_CLIENTID;
    delete process.env.BW_CLIENTSECRET;
    delete process.env.BW_USER;
    delete process.env.BW_USERNAME;

    const result = bwEnvFromHeadersOrEnv(mockReq({}));
    assert.equal(result, null);

    Object.assign(process.env, saved);
  });

  it('returns BwEnv from env vars when headers absent', () => {
    const saved = { ...process.env };
    process.env.BW_HOST = 'https://vault.example.com';
    process.env.BW_PASSWORD = 'secret';
    process.env.BW_CLIENTID = 'user.abc';
    process.env.BW_CLIENTSECRET = 'clientsecret';
    delete process.env.BW_USER;
    delete process.env.BW_USERNAME;

    const result = bwEnvFromHeadersOrEnv(mockReq({}));
    assert.ok(result);
    assert.equal(result.host, 'https://vault.example.com');
    assert.equal(result.login.method, 'apikey');

    Object.assign(process.env, saved);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kain/src/warden-mcp && npm run build && node --test "dist/bw/bwHeaders.test.js"
```

Expected: FAIL — `bwEnvFromHeadersOrEnv` not exported.

- [ ] **Step 3: Add bwEnvFromHeadersOrEnv to bwHeaders.ts**

Two edits to `src/bw/bwHeaders.ts`:

**Edit 1** — Add import at the top, alongside the existing `import type { BwEnv }` line:
```ts
import { readBwEnv } from './bwSession.js';
```

**Edit 2** — Append the new function at the end of the file:
```ts
/**
 * Resolve BwEnv from Express request headers (X-BW-*) first.
 * Falls back to environment variables (BW_HOST, BW_PASSWORD, etc.) if no
 * BW headers are present. Returns null if neither source provides credentials.
 */
export function bwEnvFromHeadersOrEnv(req: express.Request): BwEnv | null {
  const fromHeaders = bwEnvFromExpressHeaders(req);
  if (fromHeaders) return fromHeaders;

  try {
    return readBwEnv();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && node --test "dist/bw/bwHeaders.test.js"
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/bw/bwHeaders.ts src/bw/bwHeaders.test.ts
git commit -m "feat: add env var fallback to bwEnvFromHeadersOrEnv"
```

---

### Task 6: Add stdio transport

**Files:**
- Create: `src/transports/stdio.ts`

The stdio transport creates a single `McpServer` connected via `StdioServerTransport`. It reads credentials once from `readBwEnv()` and uses a single-session `BwSessionPool`.

- [ ] **Step 1: Create src/transports/stdio.ts**

```ts
// src/transports/stdio.ts

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/index.js';
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/kain/src/warden-mcp && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/transports/stdio.ts
git commit -m "feat: add stdio transport"
```

---

### Task 7: Update server.ts with parseArgs flag handling

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Replace server.ts**

Replace the entire content of `src/server.ts` with:
```ts
// src/server.ts

import { parseArgs } from 'node:util';
import { createKeychainApp } from './app.js';
import { runStdioTransport } from './transports/stdio.js';

const { values } = parseArgs({
  options: {
    stdio: { type: 'boolean', default: false },
    http: { type: 'boolean', default: false },
  },
  strict: false,
});

const useStdio =
  values.stdio === true || process.env.WARDEN_MCP_STDIO === 'true';

if (useStdio) {
  await runStdioTransport();
} else {
  const PORT = Number.parseInt(process.env.PORT ?? '3005', 10);
  const app = createKeychainApp();
  app.listen(PORT, () => {
    console.log(`[warden-mcp] listening on http://localhost:${PORT}/sse`);
  });
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/kain/src/warden-mcp && npm run build
```

Expected: compiles cleanly.

- [ ] **Step 3: Smoke-test HTTP mode**

```bash
node dist/server.js &
sleep 1
curl -s http://localhost:3005/healthz
kill %1
```

Expected: `ok`

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add --stdio flag and WARDEN_MCP_STDIO env var to server entry"
```

---

## Chunk 3: CLI Entry Point

### Task 8: Add bin/warden-mcp.js

**Files:**
- Create: `bin/warden-mcp.js`

This is the npm binary entry point. It:
1. Tries to resolve `@bitwarden/cli`'s binary from the optional dep in `node_modules`
2. Sets `BW_BIN` if found
3. Fails fast with a clear message if neither optional dep nor system `bw` is found
4. Spawns `dist/server.js` with the original argv (forwarding `--stdio`, `--http`, etc.)

- [ ] **Step 1: Create bin/warden-mcp.js**

```bash
mkdir -p /Users/kain/src/warden-mcp/bin
```

Create `bin/warden-mcp.js`:
```js
#!/usr/bin/env node
// bin/warden-mcp.js — CLI entry for @icoretech/warden-mcp

import { createRequire } from 'node:module';
import { existsSync, accessSync, constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve bw binary: optional dep → system PATH
if (!process.env.BW_BIN) {
  try {
    const require = createRequire(import.meta.url);
    // @bitwarden/cli installs the binary at <pkg>/dist/bw (the npm bin shim
    // lives at node_modules/.bin/bw, but we resolve to the actual package).
    const pkgManifest = require.resolve('@bitwarden/cli/package.json');
    const pkgDir = dirname(pkgManifest);
    // The CLI binary is published as `bw` (no extension) inside the package.
    const candidate = join(pkgDir, 'dist', 'bw');
    if (existsSync(candidate)) {
      try {
        accessSync(candidate, constants.X_OK);
        process.env.BW_BIN = candidate;
      } catch {
        // Not executable — fall through to system bw
      }
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /Users/kain/src/warden-mcp/bin/warden-mcp.js
```

- [ ] **Step 3: Verify it works locally**

```bash
cd /Users/kain/src/warden-mcp
npm run build
node bin/warden-mcp.js &
sleep 1
curl -s http://localhost:3005/healthz
kill %1
```

Expected: `ok`

- [ ] **Step 4: Verify --stdio flag is forwarded**

```bash
node bin/warden-mcp.js --stdio 2>&1 | head -3
```

Expected: process starts then exits quickly (no BW_HOST set), printing a missing env var error — confirms stdio mode was reached.

- [ ] **Step 5: Commit**

```bash
git add bin/warden-mcp.js
git commit -m "feat: add bin/warden-mcp.js CLI entry with @bitwarden/cli resolution"
```

---

## Chunk 4: CI/CD Workflows

### Task 9: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Lint
        run: npx biome check .

      - name: Build
        run: npm run build

      - name: Unit tests
        run: node --test "dist/**/*.test.js"

      - name: Lint workflows
        uses: rhysd/actionlint-action@v1
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow with typecheck, lint, build, test, actionlint"
```

---

### Task 10: Add release-please workflow and config

**Files:**
- Create: `.github/workflows/release-please.yml`
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1: Create release-please-config.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-v-in-tag": true
    }
  }
}
```

- [ ] **Step 2: Create .release-please-manifest.json**

```json
{ ".": "0.1.0" }
```

- [ ] **Step 3: Create .github/workflows/release-please.yml**

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  packages: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish:
    runs-on: ubuntu-latest
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          registry-url: https://npm.pkg.github.com
          scope: '@icoretech'

      - run: npm ci

      - run: npm run build

      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-please.yml release-please-config.json .release-please-manifest.json
git commit -m "ci: add release-please workflow and npm publish to GitHub Packages"
```

---

### Task 11: Verify and push

- [ ] **Step 1: Final local build and test**

```bash
cd /Users/kain/src/warden-mcp
npm run build && npm test
```

Expected: clean build, all tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Push all commits**

```bash
git push origin main
```

- [ ] **Step 4: Verify CI passes on GitHub**

```bash
gh run list --repo icoretech/warden-mcp --limit 5
```

Wait for the CI run to complete. Expected: all jobs green.

- [ ] **Step 5: Check release-please created a PR**

After CI passes, release-please will open a "chore: release 0.1.0" PR. Check for it:

```bash
gh pr list --repo icoretech/warden-mcp
```

Expected: a release PR opened by the release-please bot. Merge it to trigger the publish job.

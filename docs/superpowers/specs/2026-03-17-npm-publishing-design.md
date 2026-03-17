# warden-mcp npm Publishing Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Package `warden-mcp` as `@icoretech/warden-mcp` published to GitHub Packages, startable via `npx`. Supports both HTTP/SSE transport (existing multi-tenant behavior) and stdio transport (single-vault, npx use case). Credentials always come from the client — HTTP headers for HTTP mode, env vars for stdio mode — with a shared fallback chain in the credential resolver.

## Goals

- Publish `@icoretech/warden-mcp` to GitHub Packages (`npm.pkg.github.com`)
- Enable `npx @icoretech/warden-mcp` to start the HTTP server (default) or stdio server (`--stdio`)
- Keep credential model client-owned: no server-side credential config
- Automated releases via release-please; npm publish via GitHub Actions on release
- Repo under `icoretech` GitHub org, private now, open-source later

## Non-Goals

- Publishing to npmjs.org
- Bundling or shipping Docker images via this workflow
- stdio multi-vault support (one stdio process = one vault by design)
- Programmatic API — CLI-only package, no `main`/`exports` entry point

---

## Architecture

### Transport Modes

**HTTP mode** (default when running as a server, or `--http` flag):
- Existing Express/SSE server, unchanged behavior
- Credentials via `X-BW-*` request headers per connection
- Multi-tenant: one server, many vaults

**stdio mode** (`--stdio` flag or `WARDEN_MCP_STDIO=true`):
- Uses MCP SDK's `StdioServerTransport`
- Single-session: one process, one vault
- Credentials via env vars (see below)
- Suitable for `npx` with Claude Code, Codex, Claude desktop

### Credential Resolution

`bwHeaders.ts` gains a fallback using the **existing** `readBwEnv()` function already defined in `bwSession.ts`. This function already reads `BW_HOST`, `BW_PASSWORD`, `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_USER`/`BW_USERNAME` from `process.env`. No new env var scheme is introduced.

Resolution order:
```
1. X-BW-* HTTP headers       (HTTP mode, per-request)
2. readBwEnv()               (stdio fallback via BW_* env vars, or headerless HTTP)
```

Env vars (already defined in `bwSession.ts`, no changes needed):
```
BW_HOST             → host
BW_PASSWORD         → password
BW_CLIENTID         → clientId
BW_CLIENTSECRET     → clientSecret
BW_USER             → user (alternative to client id/secret)
BW_USERNAME         → alias for BW_USER
BW_UNLOCK_INTERVAL  → optional, seconds between keepalive unlock; default 300
```

### Source Changes

```
src/
  transports/
    http.ts       ← Express/SSE server extracted from app.ts
    stdio.ts      ← new: StdioServerTransport, single-session
  app.ts          ← thin: imports transport, registers tools
  server.ts       ← reads --stdio flag via node:util parseArgs, picks transport
  bw/
    bwHeaders.ts  ← add readBwEnv() fallback when headers absent

bin/
  warden-mcp.js   ← CLI entry point (ESM, #!/usr/bin/env node shebang)
```

**Flag parsing in `server.ts`** uses `node:util` `parseArgs` (Node 24+ built-in):
```ts
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { stdio: { type: 'boolean', default: false } } });
const useStdio = values.stdio || process.env.WARDEN_MCP_STDIO === 'true';
```

### bw CLI Dependency

`@bitwarden/cli` added as `optionalDependencies`. `bwCli.ts` already resolves via `process.env.BW_BIN ?? 'bw'`.

`bin/warden-mcp.js` bridges the optional dep to `BW_BIN` before starting the server:

```js
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

if (!process.env.BW_BIN) {
  try {
    const require = createRequire(import.meta.url);
    const bwPkg = require.resolve('@bitwarden/cli/package.json');
    const candidate = new URL('../node_modules/@bitwarden/cli/dist/bw.js',
      import.meta.url).pathname;
    if (existsSync(candidate)) process.env.BW_BIN = candidate;
  } catch { /* optional dep not installed, fall back to system bw */ }
}
```

If neither the optional dep nor system `bw` is found, the server fails fast with a clear error message ("bw CLI not found — install @bitwarden/cli or set BW_BIN") rather than an opaque `ENOENT`.

---

## Package Configuration

**`package.json` changes:**
```json
{
  "name": "@icoretech/warden-mcp",
  "private": false,
  "bin": { "warden-mcp": "bin/warden-mcp.js" },
  "files": ["dist/", "bin/", "!dist/**/*.test.js", "!dist/integration/"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "public"
  },
  "optionalDependencies": {
    "@bitwarden/cli": "2026.1.0"
  }
}
```

Note: pin `@bitwarden/cli` version to the same version used in `Dockerfile` — update when upgrading the Dockerfile.

**`.npmrc`:**
```
@icoretech:registry=https://npm.pkg.github.com
```

Users installing the package add to their `.npmrc`:
```
@icoretech:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

---

## Client Configuration Examples

**Codex (`~/.codex/config.toml`) — stdio:**
```toml
[mcp_servers.keychain-bsmart]
command = "npx"
args = ["-y", "@icoretech/warden-mcp", "--stdio"]

[mcp_servers.keychain-bsmart.env]
BW_HOST = "https://bitwarden.bsmart.it"
BW_PASSWORD = "..."
BW_CLIENTID = "user.c71..."
BW_CLIENTSECRET = "..."
# Alternative: BW_USER + BW_PASSWORD without client id/secret
```

**Codex — HTTP (existing):**
```toml
[mcp_servers.keychain-bsmart]
url = "http://localhost:3005/sse?v=2"

[mcp_servers.keychain-bsmart.http_headers]
X-BW-Host = "https://bitwarden.bsmart.it"
X-BW-Password = "..."
```

---

## Open Source Readiness

**Before going public:**
- Confirm `.env.icoretech` is not tracked (gitignored via `.env.*` ✓)
- `rotations/` and `scripts/` already gitignored ✓
- Add `LICENSE` (MIT, copyright icoretech)
- Add `CHANGELOG.md` (empty file — must exist before first release-please run)
- Add `SECURITY.md` with private vulnerability disclosure instructions
- Remove `"private": true` from `package.json`

**Keep as-is:**
- `AGENTS.md`, `agent-instructions/` — valuable for contributors
- `Dockerfile`, `docker-compose.yml` — self-hosted deployment docs
- `biome.json`, `tsconfig.json` — standard tooling

---

## CI/CD Workflows

### `.github/workflows/ci.yml`

Trigger: push to main, pull requests.

Steps:
1. Checkout
2. Setup Node 24, npm cache
3. `npm ci`
4. `tsc --noEmit` (typecheck)
5. `biome check` (lint)
6. `npm run build`
7. `node --test "dist/**/*.test.js"` (unit tests)
8. `rhysd/actionlint@v1` action (lints all workflow files — no manual install needed)

### `.github/workflows/release-please.yml`

Trigger: push to main.

Combines release detection and publish in one workflow to avoid `workflow_call` / `workflow_run` complexity:

```yaml
permissions:
  contents: write
  pull-requests: write
  packages: write

jobs:
  release-please:
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
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://npm.pkg.github.com
          scope: '@icoretech'
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### `release-please-config.json`

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

### `.release-please-manifest.json`

Initial content (must match `package.json` version):
```json
{ ".": "0.1.0" }
```

---

## GitHub Repository

- **Org:** `icoretech`
- **Name:** `warden-mcp`
- **Visibility:** private initially, public when first version published
- **Created via:** `gh repo create icoretech/warden-mcp --private`

---

## Implementation Order

1. Create GitHub repo `icoretech/warden-mcp`, push current code
2. Open source readiness: `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, package.json cleanup, `.npmrc`
3. Refactor transports: extract `src/transports/http.ts`, add `src/transports/stdio.ts`
4. Update `bwHeaders.ts` with `readBwEnv()` fallback
5. Update `server.ts` with `parseArgs` flag handling
6. Add `bin/warden-mcp.js` CLI entry
7. Add `@bitwarden/cli` to `optionalDependencies`
8. Add `ci.yml` with actionlint via `rhysd/actionlint@v1`
9. Add `release-please.yml` (combined release + publish), `release-please-config.json`, `.release-please-manifest.json`
10. Verify build, lint, tests pass locally
11. Push, confirm CI green, trigger first release

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

---

## Architecture

### Transport Modes

**HTTP mode** (default when running as a server):
- Existing Express/SSE server, unchanged behavior
- Credentials via `X-BW-*` request headers per connection
- Multi-tenant: one server, many vaults

**stdio mode** (`--stdio` flag or `WARDEN_MCP_STDIO=true`):
- Uses MCP SDK's `StdioServerTransport`
- Single-session: one process, one vault
- Credentials via env vars (see below)
- Suitable for `npx` with Claude Code, Codex, Claude desktop

### Credential Resolution

`bwHeaders.ts` gains a fallback: if `X-BW-*` headers are absent, read from env vars. Same `BwEnv` type throughout — no new credential types.

```
1. X-BW-* HTTP headers       (HTTP mode, per-request)
2. process.env X_BW_*        (stdio mode fallback, or headerless HTTP)
```

Env var mapping:
```
X_BW_HOST            → X-BW-Host
X_BW_PASSWORD        → X-BW-Password
X_BW_CLIENT_ID       → X-BW-ClientId
X_BW_CLIENT_SECRET   → X-BW-ClientSecret
X_BW_USER            → X-BW-User
```

### Source Changes

```
src/
  transports/
    http.ts       ← Express/SSE server extracted from app.ts
    stdio.ts      ← new: StdioServerTransport, single-session
  app.ts          ← thin: imports transport, registers tools
  server.ts       ← reads --stdio / WARDEN_MCP_STDIO, picks transport
  bw/
    bwHeaders.ts  ← add env var fallback (small addition)

bin/
  warden-mcp.js   ← CLI entry point (ESM, #!/usr/bin/env node shebang)
```

### bw CLI Dependency

`@bitwarden/cli` added as `optionalDependencies`. The `bwCli.ts` resolver checks:
1. `node_modules/@bitwarden/cli/...` (bundled optional dep)
2. System `bw` in PATH

Fallback ensures the server works whether or not the optional dep installed successfully.

---

## Package Configuration

**`package.json` changes:**
```json
{
  "name": "@icoretech/warden-mcp",
  "private": false,
  "bin": { "warden-mcp": "bin/warden-mcp.js" },
  "files": ["dist/", "bin/"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "public"
  },
  "optionalDependencies": {
    "@bitwarden/cli": "2026.1.0"
  }
}
```

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
X_BW_HOST = "https://bitwarden.bsmart.it"
X_BW_PASSWORD = "..."
X_BW_CLIENT_ID = "user.c71..."
X_BW_CLIENT_SECRET = "..."
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
- Add `CHANGELOG.md` (empty, release-please populates)
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
8. `actionlint` (lint the workflow itself)

### `.github/workflows/release-please.yml`

Trigger: push to main.

```yaml
permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
        outputs:
          release_created, tag_name
```

### `.github/workflows/npm-publish.yml`

Trigger: `workflow_call` from release-please when `release_created == true`.

```yaml
permissions:
  contents: read
  packages: write

steps:
  - checkout at tag
  - setup Node 24 with registry-url: https://npm.pkg.github.com
  - npm ci
  - npm run build
  - npm publish
    env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

No extra secrets required — `GITHUB_TOKEN` with `packages: write` is sufficient.

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

---

## GitHub Repository

- **Org:** `icoretech`
- **Name:** `warden-mcp`
- **Visibility:** private initially, public when first version published
- **Created via:** `gh repo create icoretech/warden-mcp --private`

---

## Implementation Order

1. Create GitHub repo `icoretech/warden-mcp`, push current code
2. Open source readiness: LICENSE, CHANGELOG, package.json cleanup, `.npmrc`
3. Refactor transports: extract `http.ts`, add `stdio.ts`
4. Update `bwHeaders.ts` with env var fallback
5. Add `bin/warden-mcp.js` CLI entry
6. Add `@bitwarden/cli` optional dep + resolver update in `bwCli.ts`
7. Add CI workflow (ci.yml) with actionlint
8. Add release-please workflow + config + manifest
9. Add npm-publish workflow
10. Verify build, lint, tests pass
11. Trigger first release

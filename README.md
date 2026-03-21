# warden-mcp

[![npm version](https://img.shields.io/npm/v/%40icoretech%2Fwarden-mcp?logo=npm)](https://www.npmjs.com/package/@icoretech/warden-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/icoretech/warden-mcp/ci.yml?branch=main&label=ci)](https://github.com/icoretech/warden-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/icoretech/warden-mcp)](LICENSE)

Programmatic Vaultwarden/Bitwarden vault management over MCP (Model Context Protocol), backed by the official Bitwarden CLI (`bw`).

This project exists to let agents and automation **create/search/read/update/move** vault items without re-implementing Bitwarden’s client-side crypto.

Published package: [`@icoretech/warden-mcp`](https://www.npmjs.com/package/@icoretech/warden-mcp)

## Highlights

- MCP Streamable HTTP (SSE) endpoint at `POST /sse` + health check at `GET /healthz`
- Runtime guardrail metrics at `GET /metricsz`
- Item types: **login**, **secure note**, **card**, **identity**, plus an **SSH key** convention (secure note + standard fields)
- Attachments: create/delete/download
- Organization + collection helpers (list + org-collection CRUD)
- Safe-by-default: item reads are **redacted** unless explicitly revealed; secret helper tools return `null` unless `reveal: true`

## Runtime Requirement

This package shells out to the official Bitwarden CLI, `bw`.

Runtime resolution order:

- `BW_BIN` if you set it explicitly
- bundled `@bitwarden/cli` optional dependency if it is present
- system `bw` from `PATH`

That means package installation can succeed even when the optional dependency is skipped by the environment. In that case you must install `bw` separately or point `BW_BIN` to it.

Explicit fallback install:

```bash
npm install -g @bitwarden/cli
```

Or run with an explicit binary path:

```bash
BW_BIN=/absolute/path/to/bw npx -y @icoretech/warden-mcp
```

## Install And Run

### Choose a transport

- Use `--stdio` when you want a local MCP host to spawn `warden-mcp` directly with one fixed Bitwarden profile
- Use default HTTP mode when you want one running `warden-mcp` service to serve multiple clients or multiple Bitwarden profiles via per-request `X-BW-*` headers

### Local stdio mode

```bash
npx -y @icoretech/warden-mcp --stdio
```

For stdio mode, you must provide Bitwarden credentials up front via env vars:

```bash
BW_HOST=https://vaultwarden.example.com \
BW_USER=user@example.com \
BW_PASSWORD='your-master-password' \
npx -y @icoretech/warden-mcp --stdio
```

API key login works too:

```bash
BW_HOST=https://vaultwarden.example.com \
BW_CLIENTID=user.xxxxx \
BW_CLIENTSECRET=xxxxx \
BW_PASSWORD='your-master-password' \
npx -y @icoretech/warden-mcp --stdio
```

### Shared HTTP mode

Start one long-lived MCP server:

```bash
npx -y @icoretech/warden-mcp
```

Verify it is up:

```bash
curl -fsS http://localhost:3005/healthz
```

This mode is what makes `warden-mcp` different from a simple local wrapper:

- the server stays stateless at the HTTP boundary
- Bitwarden/Vaultwarden credentials are sent per request via `X-BW-*` headers
- one running server can front different vault hosts or different identities without restarting
- it fits shared-agent and gateway setups much better than per-client local processes

### Global install

```bash
npm install -g @icoretech/warden-mcp
warden-mcp
```

## Connect From MCP Hosts

For local MCP hosts, stdio is the most portable option.

```bash
npx -y @icoretech/warden-mcp --stdio
```

The examples below use Bitwarden API-key auth. If you prefer username/password login, replace `BW_CLIENTID` + `BW_CLIENTSECRET` with `BW_USER`.

### CLI-based hosts

These hosts let you register `warden-mcp` directly from the command line:

```bash
# Codex
codex mcp add warden \
  --env BW_HOST=https://vaultwarden.example.com \
  --env BW_CLIENTID=user.xxxxx \
  --env BW_CLIENTSECRET=xxxxx \
  --env BW_PASSWORD='your-master-password' \
  -- npx -y @icoretech/warden-mcp --stdio

# Claude Code
claude mcp add-json warden '{"command":"npx","args":["-y","@icoretech/warden-mcp","--stdio"],"env":{"BW_HOST":"https://vaultwarden.example.com","BW_CLIENTID":"user.xxxxx","BW_CLIENTSECRET":"xxxxx","BW_PASSWORD":"your-master-password"}}'

# Qwen Code
qwen mcp add warden \
  -e BW_HOST=https://vaultwarden.example.com \
  -e BW_CLIENTID=user.xxxxx \
  -e BW_CLIENTSECRET=xxxxx \
  -e BW_PASSWORD=your-master-password \
  npx -y @icoretech/warden-mcp --stdio
```

### JSON config hosts

These hosts all use the same stdio payload shape. Only the config file location changes:

- Codex: `~/.codex/config.toml`
- Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Qwen Code: `~/.qwen/settings.json` or `.qwen/settings.json`

Shared JSON shape:

```json
{
  "mcpServers": {
    "warden": {
      "command": "npx",
      "args": ["-y", "@icoretech/warden-mcp", "--stdio"],
      "env": {
        "BW_HOST": "https://vaultwarden.example.com",
        "BW_CLIENTID": "user.xxxxx",
        "BW_CLIENTSECRET": "xxxxx",
        "BW_PASSWORD": "your-master-password"
      }
    }
  }
}
```

Codex uses TOML instead of JSON:

```toml
[mcp_servers.warden]
command = "npx"
args = ["-y", "@icoretech/warden-mcp", "--stdio"]

[mcp_servers.warden.env]
BW_HOST = "https://vaultwarden.example.com"
BW_CLIENTID = "user.xxxxx"
BW_CLIENTSECRET = "xxxxx"
BW_PASSWORD = "your-master-password"
```

### Windsurf

Windsurf uses the same stdio idea but stores it in `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "warden": {
      "command": "npx",
      "args": ["-y", "@icoretech/warden-mcp", "--stdio"],
      "env": {
        "BW_HOST": "https://vaultwarden.example.com",
        "BW_CLIENTID": "user.xxxxx",
        "BW_CLIENTSECRET": "xxxxx",
        "BW_PASSWORD": "your-master-password"
      }
    }
  }
}
```

### Shared HTTP connections

If your MCP host supports Streamable HTTP with custom headers, you can connect to one long-lived `warden-mcp` service instead of spawning a local stdio process.

Start the shared server:

```bash
npx -y @icoretech/warden-mcp
```

Every MCP request must include:

- `X-BW-Host`
- `X-BW-Password`
- either `X-BW-ClientId` + `X-BW-ClientSecret`, or `X-BW-User`

Example health check:

```bash
curl -fsS \
  -H 'X-BW-Host: https://vaultwarden.example.com' \
  -H 'X-BW-ClientId: user.xxxxx' \
  -H 'X-BW-ClientSecret: xxxxx' \
  -H 'X-BW-Password: your-master-password' \
  http://localhost:3005/healthz
```

Example MCP endpoint:

```text
http://localhost:3005/sse?v=2
```

This shared-server mode is useful when:

- one MCP gateway needs to front multiple Bitwarden profiles
- you want to rotate vault credentials per request instead of per process
- you are integrating from a custom client or agent host that can attach HTTP headers
- you want one always-on service instead of each editor spawning its own `bw`-backed subprocess

Client examples for shared HTTP mode:

```bash
# Claude Code
claude mcp add-json warden '{"type":"http","url":"http://localhost:3005/sse?v=2","headers":{"X-BW-Host":"https://vaultwarden.example.com","X-BW-ClientId":"user.xxxxx","X-BW-ClientSecret":"xxxxx","X-BW-Password":"your-master-password"}}'
```

```json
// Cursor (~/.cursor/mcp.json)
{
  "mcpServers": {
    "warden": {
      "url": "http://localhost:3005/sse?v=2",
      "headers": {
        "X-BW-Host": "https://vaultwarden.example.com",
        "X-BW-ClientId": "user.xxxxx",
        "X-BW-ClientSecret": "xxxxx",
        "X-BW-Password": "your-master-password"
      }
    }
  }
}
```

```json
// Qwen Code (~/.qwen/settings.json)
{
  "mcpServers": {
    "warden": {
      "httpUrl": "http://localhost:3005/sse?v=2",
      "headers": {
        "X-BW-Host": "https://vaultwarden.example.com",
        "X-BW-ClientId": "user.xxxxx",
        "X-BW-ClientSecret": "xxxxx",
        "X-BW-Password": "your-master-password"
      }
    }
  }
}
```

```json
// Windsurf (~/.codeium/windsurf/mcp_config.json)
{
  "mcpServers": {
    "warden": {
      "serverUrl": "http://localhost:3005/sse?v=2",
      "headers": {
        "X-BW-Host": "https://vaultwarden.example.com",
        "X-BW-ClientId": "user.xxxxx",
        "X-BW-ClientSecret": "xxxxx",
        "X-BW-Password": "your-master-password"
      }
    }
  }
}
```

Codex currently fits better with stdio here, because its MCP config supports a bearer token env var for remote servers but not arbitrary custom `X-BW-*` header injection.

### Verify bw is available

```bash
bw --version
```

If that fails after install, your environment likely skipped the optional `@bitwarden/cli` dependency. Install it explicitly:

```bash
npm install -g @bitwarden/cli
```

## How It Works

The server executes `bw` commands on your behalf:

- In HTTP mode, Bitwarden/Vaultwarden connection + credentials are provided via **HTTP headers** per request.
- In stdio mode, Bitwarden/Vaultwarden credentials are loaded once from `BW_*` env vars at startup.
- The server maintains per-profile `bw` state under `KEYCHAIN_BW_HOME_ROOT` to avoid session/config clashes.
- Writes can optionally call `bw sync` (internal; not exposed as an MCP tool).

### Required Headers

- `X-BW-Host` (must be an HTTPS origin, for example `https://vaultwarden.example.com`)
- `X-BW-Password` (master password; required to unlock)
- Either:
  - `X-BW-ClientId` + `X-BW-ClientSecret` (API key login), or
  - `X-BW-User` (email for user/pass login; still uses `X-BW-Password`)
- Optional:
  - `X-BW-Unlock-Interval` (seconds)

## Security Model

There is **no built-in auth** layer in v1. Run it only on a trusted network boundary (localhost, private subnet, VPN, etc.).

Mutation control:

- Set `READONLY=true` to block all write operations (create/edit/delete/move/restore/attachments).
- Session guardrails:
  - `KEYCHAIN_SESSION_MAX_COUNT` (default `32`)
  - `KEYCHAIN_SESSION_TTL_MS` (default `900000`)
  - `KEYCHAIN_SESSION_SWEEP_INTERVAL_MS` (default `60000`)
  - `KEYCHAIN_MAX_HEAP_USED_MB` (default `1536`, set `0` to disable memory fuse)
  - `KEYCHAIN_METRICS_LOG_INTERVAL_MS` (default `0`, disabled)

Redaction defaults (item reads):

- Login: `password`, `totp`
- Card: `number`, `code`
- Identity: `ssn`, `passportNumber`, `licenseNumber`
- Custom fields: hidden fields (Bitwarden `type: 1`)
- Attachments: `attachments[].url` (signed download URL token)
- Password history: `passwordHistory[].password`

Reveal rules:

- Tools accept `reveal: true` where applicable (default is `false`).
- Secret helper tools (`get_password`, `get_totp`, `get_notes`, `generate`, `get_password_history`) return `structuredContent.result = { kind, value, revealed }`.
  - When `reveal` is omitted/false, `value` is `null` (or historic passwords are `null`) and `revealed: false`.

## Quick Start

### Minimal local run

Run the published package in HTTP mode and verify the server is up:

```bash
npx -y @icoretech/warden-mcp
curl -fsS http://localhost:3005/healthz
```

## Local Development

### Docker Compose

Starts a local Vaultwarden + HTTPS proxy (for `bw`), bootstraps a test user, and runs the MCP server.

```bash
cp .env.example .env
make up
curl -fsS http://localhost:3005/healthz
```

Run integration tests:

```bash
make test
```

Run session flood regression locally (guardrail sanity):

```bash
npm run test:session-regression
```

### Local dev (host)

```bash
npm install
cp .env.example .env
npm run dev
```

## Tool Reference (v1)

Vault/session:

- `keychain.status`
- `keychain.encode` (base64-encode a string via `bw encode`)
- `keychain.generate` (returns a generated secret only when `reveal: true`)

Items:

- `keychain.search_items`, `keychain.get_item`, `keychain.update_item`
- `keychain.create_login`, `keychain.create_note`, `keychain.create_card`, `keychain.create_identity`, `keychain.create_ssh_key`
- `keychain.delete_item`, `keychain.restore_item`

Folders:

- `keychain.list_folders`, `keychain.create_folder`, `keychain.edit_folder`, `keychain.delete_folder`

Orgs/collections:

- `keychain.list_organizations`, `keychain.list_collections`
- `keychain.list_org_collections`, `keychain.create_org_collection`, `keychain.edit_org_collection`, `keychain.delete_org_collection`
- `keychain.move_item_to_organization`

Attachments:

- `keychain.create_attachment`, `keychain.delete_attachment`, `keychain.get_attachment`

Sends:

- `keychain.send_list`, `keychain.send_template`, `keychain.send_get`
- `keychain.send_create` (quick create via `bw send`)
- `keychain.send_create_encoded`, `keychain.send_edit` (advanced create/edit via `bw send create|edit`)
- `keychain.send_remove_password`, `keychain.send_delete`
- `keychain.receive`

Direct “bw get …” helpers:

- `keychain.get_username` (returns `{ kind:"username", value, revealed:true }`)
- `keychain.get_password` / `keychain.get_totp` / `keychain.get_notes` (only return real values when `reveal: true`)
- `keychain.get_uri`, `keychain.get_exposed`
- `keychain.get_folder`, `keychain.get_collection`, `keychain.get_organization`, `keychain.get_org_collection`
- `keychain.get_password_history` (only returns historic passwords when `reveal: true`)

## Known Limitations

- `bw list items --search` (and thus `keychain.search_items`) does not reliably search inside **custom field values**.
- SSH keys are stored as secure notes in v1 (until `bw` supports native SSH key item creation).
- High-risk CLI features are intentionally not exposed yet (export/import).

## Contributing

See `AGENTS.md` for repo guidelines, dev commands, and testing conventions.

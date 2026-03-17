# Keychain MCP

Programmatic Vaultwarden/Bitwarden vault management over MCP (Model Context Protocol), backed by the official Bitwarden CLI (`bw`).

This project exists to let agents and automation **create/search/read/update/move** vault items without re-implementing Bitwarden’s client-side crypto.

## Highlights

- MCP Streamable HTTP (SSE) endpoint at `POST /sse` + health check at `GET /healthz`
- Runtime guardrail metrics at `GET /metricsz`
- Item types: **login**, **secure note**, **card**, **identity**, plus an **SSH key** convention (secure note + standard fields)
- Attachments: create/delete/download
- Organization + collection helpers (list + org-collection CRUD)
- Safe-by-default: item reads are **redacted** unless explicitly revealed; secret helper tools return `null` unless `reveal: true`

## How It Works

The server executes `bw` commands on your behalf:

- Bitwarden/Vaultwarden connection + credentials are provided via **HTTP headers** per request.
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

### Docker Compose (recommended)

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

### Local Dev (host)

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

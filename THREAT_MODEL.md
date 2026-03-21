# Threat Model

> Last updated: 2026-03-21 — reflects codebase at v0.1.8+

## 1. Overview

warden-mcp is a Node/TypeScript MCP (Model Context Protocol) server that gives automation and LLM agents programmatic access to Bitwarden/Vaultwarden vaults. It delegates all cryptography and authentication to the official Bitwarden CLI (`bw`), invoked via `spawn`. Two transports are supported:

- **HTTP SSE** (`/sse`) — a shared, long-lived service. Bitwarden credentials arrive per-request via `X-BW-*` headers. Env-var credential fallback is disabled by default and must be explicitly opted in with `KEYCHAIN_ALLOW_ENV_FALLBACK=true`.
- **stdio** (`--stdio`) — a local, single-tenant process. Credentials are read once from `BW_*` environment variables at startup.

Auxiliary endpoints: `GET /healthz` (liveness probe), `GET /metricsz` (operational metrics — intentionally unauthenticated).

The server registers ~50 MCP tools covering item CRUD, attachments, folders, organizations/collections, Bitwarden Send, and credential/TOTP retrieval. Security defaults are conservative:

- Item reads are **redacted** unless the caller passes `reveal: true`.
- `NOREVEAL=true` forces all `reveal` parameters to `false` server-side, regardless of what the client requests — a hard kill switch for prompt-injection exfiltration.
- `READONLY=true` blocks all mutating tools at the MCP layer.
- CLI arguments use `--` end-of-options terminators before all user-controlled positional values.
- JSON parse errors do not include raw CLI output (which may contain unredacted secrets).

OAuth2/SSO is not implemented by design. Authentication to Bitwarden is via `bw login`/`bw unlock` using credentials supplied by the operator or caller.

## 2. Trust Boundaries

### Network boundary

`/sse` accepts MCP JSON-RPC over HTTP/SSE. There is **no built-in authentication layer**. The server trusts that network-level controls (TLS, reverse proxy, VPN, localhost binding) restrict who can reach the endpoint. In HTTP mode, credentials are provided per-request via `X-BW-*` headers; without them, tools return an error (unless `KEYCHAIN_ALLOW_ENV_FALLBACK=true`).

### Process boundary

warden-mcp invokes `bw` via `spawn` (`src/bw/bwCli.ts`). The CLI binary performs all authentication, decryption, and outbound network I/O against Bitwarden/Vaultwarden servers. Its stdout is parsed as JSON; stderr is used for diagnostics. The binary path is resolved from `BW_BIN` (env var), the bundled optional `@bitwarden/cli` dependency, or `PATH`. `BW_BIN` is operator-controlled and not validated — it has the same trust level as any other PATH binary.

### File system boundary

The `bw` CLI stores encrypted state under its HOME directory. warden-mcp isolates per-credential profiles under `KEYCHAIN_BW_HOME_ROOT/<sha256-hash>` (default: `/data/bw-profiles`). Temporary directories are created for attachment and Send file operations, and are cleaned up in `finally` blocks. The Dockerfile runs as non-root with HOME confined to `/data`.

### Agent boundary

MCP tools are callable by any connected MCP host. When the host is an LLM agent, tool invocations can be influenced by prompt injection. The `NOREVEAL` and `READONLY` guardrails operate at the server level, independent of the agent's intent.

## 3. Attacker-Controlled Inputs

| Input | Source | Validation |
|-------|--------|------------|
| HTTP JSON body | Remote client | 4 MB body limit, Zod schema per tool |
| `X-BW-Host` | HTTP header | Must be HTTPS origin, no path/query/credentials/fragments (`src/bw/bwHeaders.ts`) |
| `X-BW-Password`, `X-BW-ClientId`, `X-BW-ClientSecret`, `X-BW-User` | HTTP headers | String presence checks only — these are Bitwarden credentials, not server credentials |
| `mcp-session-id` | HTTP header | Accepted as-is for session reuse; client-supplied IDs accepted for Codex compatibility |
| Tool parameters (item names, URIs, attachment content, Send text/URLs) | MCP JSON-RPC | Zod schema validation; `--` terminators before CLI positional args |
| `receive` URL | Tool parameter | Must be `https://` — rejects `http://`, `file://`, and other schemes |
| stdio input | Local MCP host | Trusted operator, but may be influenced by prompt injection |

## 4. Operator-Controlled Inputs

| Input | Purpose |
|-------|---------|
| `BW_HOST`, `BW_PASSWORD`, `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_USER` | Bitwarden credentials for stdio mode |
| `BW_BIN` | Path to `bw` binary (same trust as PATH) |
| `READONLY` / `KEYCHAIN_READONLY` | Disable all mutating tools |
| `NOREVEAL` / `KEYCHAIN_NOREVEAL` | Force all `reveal` to false server-side |
| `KEYCHAIN_ALLOW_ENV_FALLBACK` | Allow HTTP mode to fall back to env credentials (default: `false`) |
| `KEYCHAIN_SESSION_MAX_COUNT`, `KEYCHAIN_SESSION_TTL_MS`, `KEYCHAIN_MAX_HEAP_USED_MB` | Resource limits |
| `KEYCHAIN_DEBUG_HTTP`, `KEYCHAIN_DEBUG_BW` | Debug logging (redacts session tokens and long args) |

## 5. Security Controls

| Control | File | Description |
|---------|------|-------------|
| Zod input schemas | `src/tools/registerTools.ts` | Every tool parameter is schema-validated with type and bounds checks |
| HTTPS-only host validation | `src/bw/bwHeaders.ts` | `X-BW-Host` must be an HTTPS origin with no embedded credentials, path, or query |
| `receive` URL validation | `src/sdk/keychainSdk.ts` | `receive()` rejects non-HTTPS URLs before passing to `bw` |
| `--` end-of-options | `src/sdk/keychainSdk.ts` | All user-controlled positional args in `sendCreate`, `sendCreateEncoded`, `sendEdit`, `receive` are preceded by `--` |
| Safe-by-default redaction | `src/sdk/redact.ts` | Passwords, TOTP, card numbers, SSN, hidden fields, attachment URLs, password history redacted unless `reveal: true` |
| READONLY mode | `src/tools/registerTools.ts` | Blocks create/edit/delete/move/restore/attachment tools |
| NOREVEAL mode | `src/tools/registerTools.ts` | Forces all `reveal` to `false`, preventing prompt-injection exfiltration |
| Env fallback disabled by default | `src/bw/bwHeaders.ts`, `src/transports/http.ts` | HTTP mode requires `X-BW-*` headers; env fallback requires explicit `KEYCHAIN_ALLOW_ENV_FALLBACK=true` |
| Error message sanitization | `src/sdk/keychainSdk.ts`, `src/bw/bwSession.ts` | JSON parse errors include byte count only, never raw CLI output |
| CLI debug log redaction | `src/bw/bwCli.ts` | Session tokens and args >80 chars are redacted in debug logs |
| Session resource limits | `src/transports/http.ts` | Max sessions (32), TTL (15 min), heap fuse (1.5 GB), sweep interval |
| CLI mutex | `src/bw/mutex.ts`, `src/bw/bwSession.ts` | Serializes concurrent CLI invocations per session to prevent state corruption |
| Per-credential isolation | `src/bw/bwPool.ts` | Separate HOME directories keyed by SHA-256 hash of credentials |
| Temp file cleanup | `src/sdk/keychainSdk.ts` | All `mkdtemp` calls paired with `rm` in `finally` blocks |
| Least-privilege container | `Dockerfile` | Non-root user, HOME confined to `/data` |
| CI permissions scoping | `.github/workflows/` | `contents: read` on CI; per-job scoped permissions on release workflow |

## 6. Attack Scenarios and Residual Risk

### Mitigated

| Scenario | Mitigation | Residual risk |
|----------|------------|---------------|
| **Env credential bypass in HTTP mode** | Disabled by default; requires `KEYCHAIN_ALLOW_ENV_FALLBACK=true` | Operators who enable it on shared networks expose their vault |
| **CLI option injection** | `--` terminators before all user positional args | None — `bw` treats everything after `--` as data |
| **Prompt-injection exfiltration** | `NOREVEAL=true` forces `reveal: false` server-side | Operators must enable it; without it, an LLM can be tricked into revealing secrets |
| **Secret leakage in error messages** | `parseBwJson` includes byte count only, not raw output | None |
| **SSRF via receive URL** | `receive()` rejects non-HTTPS URLs | `bw` still makes the outbound request; HTTPS-only limits but doesn't eliminate SSRF to internal HTTPS services |

### Accepted / by design

| Scenario | Rationale |
|----------|-----------|
| **No built-in authn/authz** | By design for v1. Deployment must provide network-level isolation or a reverse proxy. Documented in README. |
| **Client-supplied session IDs** | Required for Codex compatibility. Auth is bound to `bwEnv` credentials, not session ID. Session cannot access a different credential set. |
| **`/metricsz` unauthenticated** | Exposes operational metrics only (heap, session counts). No secrets. Documented as requiring network-level isolation if sensitive. |
| **`BW_BIN` not validated** | Operator-controlled env var with same trust as PATH. If an attacker controls env vars, they already have arbitrary code execution. |

### Residual / partially mitigated

| Scenario | Current state | Recommendation |
|----------|---------------|----------------|
| **SSRF to internal HTTPS services** | `X-BW-Host` validated as HTTPS origin; `receive()` requires HTTPS. No private-IP or allowlist enforcement. | For high-security deployments, use network egress rules to restrict which hosts the server/container can reach. |
| **Resource exhaustion** | Session cap (32), heap fuse (1.5 GB), 4 MB JSON body limit, CLI timeouts (30-120s). | Sufficient for most deployments. In adversarial environments, add rate limiting at the reverse proxy layer. |
| **Multi-tenant directory enumeration** | Profile dirs are SHA-256 hashes of credentials under `KEYCHAIN_BW_HOME_ROOT`. | Restrict filesystem listing permissions on the profiles directory. Container default (non-root) helps. |
| **Debug log exposure** | Disabled by default. When enabled, session tokens and long args are redacted but request metadata is logged. | Never enable `KEYCHAIN_DEBUG_*` in production without secured log pipelines. |

## 7. Criticality Calibration

| Level | Definition | Examples |
|-------|------------|----------|
| **Critical** | Direct unauthorized vault access or secret exfiltration without any preconditions | Bypassing `reveal` gating; unauthenticated vault access via env fallback on a public network; RCE through CLI invocation |
| **High** | Unauthorized data modification, persistent secret leakage, or network pivoting | Bypassing READONLY; SSRF reaching internal services; unredacted secrets in logs or on disk |
| **Medium** | Availability impact or data exposure requiring additional conditions | DoS via session flooding; unbounded downloads; session fixation where traffic is observable; metrics endpoint exposure |
| **Low** | Minor correctness or information disclosure with limited impact | Verbose error messages; cosmetic input validation gaps; debug-only log details |

Severity is deployment-dependent: in local stdio mode with a trusted operator, most network threats are out of scope. In shared HTTP mode, TLS and network isolation are mandatory for any meaningful security posture.

## 8. Out of Scope

- **CSRF/XSS/session cookies**: the service is not browser-facing and uses header-based JSON-RPC.
- **OAuth2/SSO**: not implemented by design; authentication is delegated to `bw login`.
- **Bitwarden CLI vulnerabilities**: the `bw` binary is treated as a trusted dependency. Vulnerabilities in `bw` itself are upstream concerns.
- **Build/CI supply chain** (beyond action permissions): CI workflow permissions are scoped to least privilege. Action SHA pinning is not enforced.

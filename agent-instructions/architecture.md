# Architecture & Layout

## Overview

Use this file when you need to locate behavior quickly or decide where new code
belongs.

## Project Structure

- `src/app.ts`: Express app and `/sse` transport/session handling
- `src/bw/`: `bw` CLI runner plus session/unlock management
- `src/sdk/`: high-level vault operations and redaction behavior
- `src/tools/registerTools.ts`: MCP tool definitions and tool metadata
- `src/integration/`: compose-backed integration and end-to-end tests
- `scripts/vaultwarden-bootstrap.mjs`: Playwright bootstrap for the local test
  account

## Placement Rules

- Put transport/session behavior in `src/app.ts` or `src/bw/`
- Put Bitwarden business behavior in `src/sdk/`
- Keep tool registration and user-facing tool contracts in
  `src/tools/registerTools.ts`
- Add integration coverage under `src/integration/` when behavior depends on a
  real Vaultwarden or `bw` runtime

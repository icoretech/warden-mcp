# Testing

## Overview

Use this file when adding or updating tests.

## Framework

- Test runner: Node built-in `node:test`

## Test Locations

- `src/sdk/*.test.ts`: unit coverage
- `src/integration/bw.cli.integration.test.ts`: direct `bw` auth/session
  contract against local Vaultwarden
- `src/integration/*.integration.test.ts`: compose-backed integration and e2e

## Commands

- `npm run test`: build plus the full test suite
- `npm run test:integration`: build plus integration-only coverage, forced to
  run one integration file at a time because the compose-backed suite shares a
  single Vaultwarden/`bw` runtime
- `make test`: compose-backed integration path

## Quick Local Smoke

Use this when you need a fast live check of one or two tools against the local
Vaultwarden stack before cutting a release.

### Bring up the local stack

```bash
docker compose up -d vaultwarden vaultwarden-https
docker compose run --rm bootstrap
npm run build
```

### Start the server with fixed local credentials

Use the committed `.env.test` user and allow HTTP/SSE requests without
`X-BW-*` headers to inherit the server-side `BW_*` env:

```bash
set -a && . ./.env.test && set +a
KEYCHAIN_ALLOW_ENV_FALLBACK=true \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
BW_HOST=https://localhost:8443 \
node dist/server.js
```

In another shell, verify the server is up:

```bash
curl -fsS http://127.0.0.1:3005/healthz
```

### Call tools over real MCP `/sse`

This probe exercises the live MCP transport and a few representative tools:

```bash
node --input-type=module <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client(
  { name: 'local-smoke', version: '0.0.0' },
  { capabilities: {} },
);
const transport = new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:3005/sse?v=2'),
);

await client.connect(transport);

for (const name of ['keychain_status', 'keychain_sync', 'keychain_sdk_version']) {
  const res = await client.callTool(
    { name, arguments: {} },
    undefined,
    { timeout: 120000 },
  );
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(res.structuredContent ?? res.content, null, 2));
}

await client.close();
EOF
```

Swap the tool names for whatever new method you want to smoke-test.

### Clean up

Stop the local server you started, then tear down the compose stack:

```bash
docker compose down
```

## Expectations

- Add or update tests for behavior changes
- Prefer the compose-backed path when the behavior depends on real `bw` or
  Vaultwarden interaction
- Keep the Playwright bootstrap flow idempotent so clean reruns stay reliable
- Keep the Playwright Docker image tag in `docker-compose*.yml` aligned with
  `package.json` when bumping the npm package

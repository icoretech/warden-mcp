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
- `npm run test:integration`: build plus integration-only coverage
- `make test`: compose-backed integration path

## Expectations

- Add or update tests for behavior changes
- Prefer the compose-backed path when the behavior depends on real `bw` or
  Vaultwarden interaction
- Keep the Playwright bootstrap flow idempotent so clean reruns stay reliable

# Testing

## Overview

Use this file when adding or updating tests.

## Framework

- Test runner: Node built-in `node:test`

## Test Locations

- `src/sdk/*.test.ts`: unit coverage
- `src/integration/*.integration.test.ts`: compose-backed integration and e2e

## Commands

- `npm run test`: build plus the full test suite
- `make test`: compose-backed integration path

## Expectations

- Add or update tests for behavior changes
- Prefer the compose-backed path when the behavior depends on real `bw` or
  Vaultwarden interaction

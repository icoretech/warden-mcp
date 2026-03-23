# TypeScript & Naming

## Overview

Use these rules for any TypeScript implementation in this repository.

## Rules

- TypeScript uses ESM
- Keep 2-space indentation and 80-column wrapping consistent with Biome
- Avoid `any` and non-null assertions
- Keep tool names stable via `TOOL_PREFIX` (default `keychain`) and `TOOL_SEPARATOR` (default `_`)

## Naming

- Match existing `keychain_*` tool naming in `registerTools.ts`
- Prefer descriptive input and result shapes over opaque tuples or positional
  arrays

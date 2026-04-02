# Compatibility & Releases

## Overview

Use this file when touching `@bitwarden/cli`, auth/session behavior, or release
automation.

## Current Support Boundary

- Vaultwarden is the continuously-proven compatibility target in CI
- Official Bitwarden compatibility is intended, but not continuously proven
  without a real tenant
- Keep the bundled `@bitwarden/cli` version vetted instead of blindly matching
  the newest upstream release

## Upgrade Rules

- Treat `package.json` and the bundled CLI version as a compatibility decision,
  not a routine dependency bump
- A CLI bump must survive the compose-backed Vaultwarden suite before merge
- Keep the postinstall Vaultwarden compat rewrite healthy when `@bitwarden/cli`
  moves, instead of relying on a version-stamped vendor patch file
- The Playwright npm package and the compose bootstrap image must move together
  or the browser bootstrap step will fail before tests start
- Keep the raw `bw` auth contract green in
  `src/integration/bw.cli.integration.test.ts`
- Keep the MCP and SDK integration coverage green in `src/integration/`

## Release Notes

- Document any intentional support-boundary changes in the README
- Call out auth, session, or bootstrap behavior changes in PRs and release notes

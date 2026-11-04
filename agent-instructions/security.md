# Security & Runtime

## Overview

Use this file for secrets handling, runtime safety, and request-contract work.

## Rules

- Bitwarden/Vaultwarden connection comes from `X-BW-*` HTTP headers
- Tools must not accept connection credentials as normal tool arguments
- Secrets are redacted by default
- Any feature that reveals secrets must require `reveal: true`
- Do not log secrets
- Keep `KEYCHAIN_DEBUG_HTTP=false` unless debugging transport issues

## Runtime Notes

- Treat `X-BW-Host` as an HTTPS origin, not an arbitrary URL
- Preserve the distinction between raw CLI state and operational readiness in
  agent-facing responses
- Authenticated child processes receive `BW_SESSION` in their own environment;
  do not put session keys in command arguments or mutate the parent environment
- SDK credential providers and memory-only sessions are opt-in; preserve default
  persistent profiles and follow the ownership and revocation limits in
  [Session Management](../SESSION_MANAGEMENT.md)

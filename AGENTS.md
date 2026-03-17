# Repository Guidelines

Streamable HTTP MCP server for Vaultwarden/Bitwarden, backed by the official
Bitwarden CLI (`bw`).

## Quick Reference

- `npm run dev`: watch-mode server
- `npm run lint`: Biome + `tsc --noEmit`
- `npm run test`: build + all tests
- `make up`: boot local Vaultwarden stack and MCP server
- `make test`: run compose-backed integration tests
- `make down`: stop the local stack

Endpoints: `http://localhost:3005/healthz`, `http://localhost:3005/sse`

## Detailed Instructions

- [Architecture & Layout](agent-instructions/architecture.md)
- [TypeScript & Naming](agent-instructions/typescript.md)
- [Testing](agent-instructions/testing.md)
- [Security & Runtime](agent-instructions/security.md)
- [Git & PRs](agent-instructions/git-workflow.md)

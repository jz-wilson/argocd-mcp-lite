# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

argocd-mcp-lite is a token-efficient MCP (Model Context Protocol) server for Argo CD, optimized for AI agents. It's a fork of mcp-for-argocd that reduces token consumption by ~85% while maintaining full read/write capability through smart defaults (compact mode, client-side filtering, event/log limiting).

## Common Commands

```bash
pnpm install              # Install dependencies
pnpm build                # Build with tsup (output: dist/)
pnpm lint                 # ESLint + Prettier check
pnpm lint:fix             # Auto-fix lint/format issues
pnpm test                 # Run all tests with vitest
pnpm test:watch           # Watch mode tests
pnpm test:coverage        # Tests with v8 coverage
pnpm dev                  # Dev server (HTTP transport, port 3000)
pnpm dev-sse              # Dev server (SSE transport)
pnpm generate-types       # Regenerate ArgoCD types from swagger.json
```

Run a single test file: `pnpm vitest run tests/client.test.ts`
Run tests matching a pattern: `pnpm vitest run -t "compact mode"`

## Architecture

**Three-layer design:**

1. **Transport** (`src/server/transport.ts`) — stdio (CLI/IDE agents), HTTP (Docker/remote), SSE (legacy). Selected via CLI arg in `src/cmd/cmd.ts`.

2. **Server/Tools** (`src/server/server.ts`) — Extends `McpServer` from `@modelcontextprotocol/sdk`. Registers 17 MCP tools via `addJsonOutputTool` helper. All tool params use Zod schemas from `src/shared/models/schema.ts`. Write tools (create/update/delete/sync) are conditionally registered based on `MCP_READ_ONLY` env var.

3. **Client** (`src/argocd/client.ts`) — `ArgoCDClient` wraps the ArgoCD REST API. Core optimization: `compact=true` (default) strips managedFields, operation history, heavy annotations, networking info. Filtering by kind/health/namespace on resource trees. Uses `HttpClient` (`src/argocd/http.ts`) for fetch with auth headers and streaming support.

**Entry point flow:** `src/index.ts` → `src/cmd/cmd.ts` (yargs CLI) → creates `ArgoCDClient` + `ArgocdMcpServer` → starts selected transport.

## Key Conventions

- **Compact mode is opt-out**: All tools default to `compact=true`. Users pass `compact=false` for full responses.
- **Drop-in compatible**: Tool names and required params match upstream mcp-for-argocd exactly.
- **Environment variables for config**: `ARGOCD_BASE_URL`, `ARGOCD_API_TOKEN`, `MCP_READ_ONLY`, `NODE_TLS_REJECT_UNAUTHORIZED`. No source-code config files.
- **Tool error pattern**: Errors return `{ isError: true, content: [{ type: 'text', text: message }] }`.
- **Commit messages**: Conventional Commits format (`feat:`, `fix:`, `docs:`, `ci:`, `test:`).
- **Code style**: Single quotes, no trailing commas, 100 char print width, 2-space indent (enforced by Prettier).

## Types

`src/types/argocd.d.ts` (7400+ lines) is auto-generated from the ArgoCD Swagger spec — do not edit manually. Key types are re-exported from `src/types/argocd-types.ts`.

## Testing

Tests live in `tests/` and use vitest with globals enabled (no need to import `describe`/`it`/`expect`). Tests mock `HttpClient` for isolation. Coverage excludes `src/types/**` and `src/index.ts`.

## CI

GitHub Actions runs lint → build → test → audit across Node.js 18/20/22. Pre-PR checklist: `pnpm lint && pnpm build && pnpm test`.

## Skill Maintenance

The ArgoCD skill at `.claude/skills/argocd/SKILL.md` teaches Claude how to use this MCP server effectively. **When making changes to the server, review and update the skill to stay in sync.** Specifically:

- **Tool changes** (`src/server/server.ts`): Update the tool quick reference table and workflow steps in the skill if tools are added, removed, renamed, or have parameter changes.
- **Schema changes** (`src/shared/models/schema.ts`): Update the ResourceRef shape and Application object shape sections in the skill.
- **Default changes**: If compact mode defaults, pagination defaults, or log tail defaults change, update the token efficiency rules section.

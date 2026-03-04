# Contributing to argocd-mcp-lite

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/jz-wilson/argocd-mcp-lite.git
cd argocd-mcp-lite
pnpm install
pnpm build
```

## Running Tests

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
```

## Code Quality

Before submitting a PR, ensure:

```bash
pnpm lint          # ESLint + Prettier
pnpm build         # TypeScript compilation
pnpm test          # All tests pass
pnpm audit         # No high/critical vulnerabilities
```

## Pull Request Guidelines

1. **Fork the repo** and create your branch from `main`.
2. **Add tests** for any new functionality or bug fixes.
3. **Run the full check suite** (`lint`, `build`, `test`, `audit`) before submitting.
4. **Keep PRs focused** — one feature or fix per PR.
5. **Write clear commit messages** following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `ci:` for CI/CD changes
   - `test:` for test additions/changes

## Architecture

- `src/argocd/client.ts` — ArgoCD API client with compact mode and filtering
- `src/argocd/http.ts` — HTTP client wrapper
- `src/server/server.ts` — MCP server with tool registration
- `src/server/transport.ts` — Transport layer (stdio/http/sse)
- `src/shared/models/schema.ts` — Zod schemas for input validation
- `tests/` — Unit tests (vitest)

## Design Principles

- **Token efficiency first** — every response should be as small as possible by default
- **Drop-in compatible** — same tool names and required parameters as upstream
- **Opt-out, not opt-in** — optimizations are on by default, disable explicitly when needed
- **No source code changes for config** — all behavior controlled via parameters or environment variables

## Questions?

Open an issue or start a discussion on GitHub.

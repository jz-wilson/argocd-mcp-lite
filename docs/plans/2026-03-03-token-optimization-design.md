# argocd-mcp-lite: Token Optimization Design

## Goal
Refactor mcp-for-argocd into argocd-mcp-lite — a token-efficient fork optimized for AI agent usage.

## Architecture Decision
All compact/filtering logic goes in `client.ts` (matching the existing `listApplications` pattern). `server.ts` passes new optional parameters through.

## Changes

### 1. get_application — compact mode
- New param: `compact` (boolean, default: true)
- When compact=true, strip: managedFields, operation history, status.conditions (keep last 3), status.operationState (keep phase+message only), metadata.annotations (keep argocd.argoproj.io/* only), spec.source (keep repoURL+path+chart only)
- When compact=false, return full response

### 2. get_application_resource_tree — filters + compact
- New params: `kind` (string), `health` (string), `namespace` (string), `compact` (boolean, default: true)
- Filters applied client-side after API fetch
- When compact=true, strip networkingInfo and images from nodes; keep: group, kind, name, namespace, health, status, parentRefs

### 3. get_resources — remove "fetch all if empty" behavior
- If resourceRefs is empty/not provided, return error message
- No longer fetches resource tree as fallback

### 4. Events — limit and sinceMinutes
- get_application_events: add `limit` (int, default 20), `sinceMinutes` (int, optional)
- get_resource_events: same treatment
- Sort by lastTimestamp desc, apply limit after time filter

### 5. Logs — configurable tailLines + sinceSeconds
- get_application_workload_logs: `tailLines` param (default 50), `sinceSeconds` (optional)

### 6. Package identity
- name: "argocd-mcp-lite", version: "0.1.0", updated description

### 7. README update
- Fork rationale, new parameters, before/after token savings

## Files Modified
- `src/argocd/client.ts` — compact logic, event filtering, log params
- `src/server/server.ts` — new Zod schemas for optional params, pass-through
- `package.json` — identity update
- `README.md` — documentation update

## Constraints
- All existing tool names and required params preserved (drop-in replacement)
- All new params are optional with sensible defaults
- Transport layer unchanged
- MCP_READ_ONLY support preserved
- TypeScript strict mode must pass

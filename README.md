# argocd-mcp-lite

A token-efficient fork of [mcp-for-argocd](https://github.com/argoproj-labs/mcp-for-argocd), optimized for AI agent usage. Drop-in replacement — same tool names, same required parameters, dramatically fewer tokens.

## Why this fork?

Raw ArgoCD API responses are massive. A single `get_application` call returns ~15KB, `list_applications` can exceed 300KB, and `get_resources` without filters can blow past 100KB. For AI agents operating within context windows, this is wasteful — most of that payload is `managedFields`, networking metadata, and operation history that agents never need.

**argocd-mcp-lite** adds smart defaults that strip unnecessary fields while keeping full read/write capability:

| Tool | Before | After (default) | Savings |
|------|--------|-----------------|---------|
| `get_application` | ~15KB raw | ~2KB compact | ~85% |
| `get_application_resource_tree` | ~8KB raw | ~2KB compact | ~75% |
| `get_resources` (empty refs) | ~100KB+ (fetched everything) | Error with guidance | 100% waste prevented |
| `get_application_events` | All events, unsorted | Last 20, sorted desc | ~80% |
| `get_application_workload_logs` | 100 lines | 50 lines | ~50% |

Every optimization is optional — pass `compact=false` or adjust limits to get the full response when you need it.

## New Parameters

All new parameters are **optional** with sensible defaults. Existing required parameters are unchanged.

### `get_application`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `compact` | boolean | `true` | Strips managedFields, operation history, verbose annotations. Keeps sync/health status, ArgoCD annotations, source URL/path/chart. Set `false` for full response. |

### `get_application_resource_tree`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `kind` | string | — | Filter nodes by K8s kind (e.g., `"Deployment"`, `"Pod"`) |
| `health` | enum | — | Filter by health: `Healthy`, `Degraded`, `Progressing`, `Missing`, `Unknown`, `Suspended` |
| `namespace` | string | — | Filter nodes by namespace |
| `compact` | boolean | `true` | Strips networkingInfo and images. Keeps group, kind, name, namespace, health, status, parentRefs. |

### `get_resources`

**Breaking change**: `resourceRefs` is now required and must not be empty. Use `get_application_resource_tree` first to discover resource references, then pass specific refs. This prevents accidental 100KB+ responses from fetching all resources.

### `get_application_events` / `get_resource_events`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | int | `20` | Maximum events to return |
| `sinceMinutes` | int | — | Only events from the last N minutes |

Events are sorted by `lastTimestamp` descending (most recent first).

### `get_application_workload_logs`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tailLines` | int | `50` | Number of log lines from the end |
| `sinceSeconds` | int | — | Only logs from the last N seconds |

## All Available Tools

### Application Management
- `list_applications` — List and filter applications (already optimized with field stripping + pagination)
- `get_application` — Get application details (compact mode)
- `create_application` — Create a new application
- `update_application` — Update an existing application
- `delete_application` — Delete an application
- `sync_application` — Trigger a sync operation

### Resource Management
- `get_application_resource_tree` — Resource tree with filters and compact mode
- `get_application_managed_resources` — Managed resources with server-side filtering
- `get_resources` — Fetch specific resource manifests by ref
- `get_application_workload_logs` — Logs with configurable tail and time window
- `get_application_events` — Application events with limit and time filter
- `get_resource_events` — Resource events with limit and time filter
- `get_resource_actions` — Available resource actions
- `run_resource_action` — Execute a resource action

## Installation

### Prerequisites

- Node.js (v18 or higher)
- Argo CD instance with API access
- Argo CD API token ([docs](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/#authorization))

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "argocd-mcp": {
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "<argocd_url>",
        "ARGOCD_API_TOKEN": "<argocd_token>"
      }
    }
  }
}
```

### VS Code

```json
{
  "servers": {
    "argocd-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "<argocd_url>",
        "ARGOCD_API_TOKEN": "<argocd_token>"
      }
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "argocd-mcp": {
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "<argocd_url>",
        "ARGOCD_API_TOKEN": "<argocd_token>"
      }
    }
  }
}
```

## Configuration

### Read-Only Mode

Set `MCP_READ_ONLY=true` to disable write tools (`create_application`, `update_application`, `delete_application`, `sync_application`, `run_resource_action`).

### Self-Signed Certificates

For ArgoCD instances with self-signed certs:
```
"NODE_TLS_REJECT_UNAUTHORIZED": "0"
```

> **Warning**: Only use in development environments or when you understand the security implications.

## Development

```bash
git clone https://github.com/YOUR_ORG/argocd-mcp-lite.git
cd argocd-mcp-lite
pnpm install
pnpm build
```

Transport modes: `stdio` (default), `sse`, `http`

## Credits

Fork of [argoproj-labs/mcp-for-argocd](https://github.com/argoproj-labs/mcp-for-argocd), originally created by [@jiachengxu](https://github.com/jiachengxu), [@imwithye](https://github.com/imwithye), [@hwwn](https://github.com/hwwn), and [@alexmt](https://github.com/alexmt) from [Akuity](https://akuity.io/).

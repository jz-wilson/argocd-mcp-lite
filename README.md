# argocd-mcp-lite

[![npm version](https://img.shields.io/npm/v/argocd-mcp-lite)](https://www.npmjs.com/package/argocd-mcp-lite)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io/)

A **token-efficient** MCP server for Argo CD, built for AI agents. Drop-in replacement for [mcp-for-argocd](https://github.com/argoproj-labs/mcp-for-argocd) — same tools, same parameters, **~85% fewer tokens**.

---

## The Problem

Raw Argo CD API responses are massive. A single `get_application` call returns ~15KB. `list_applications` can exceed 300KB. `get_resources` without filters can blow past 100KB. For AI agents working within context windows, most of that payload is noise — `managedFields`, networking metadata, and operation history that agents never need.

## The Solution

**argocd-mcp-lite** adds smart defaults that strip unnecessary fields while preserving full read/write capability:

| Tool | Before | After | Savings |
|------|--------|-------|---------|
| `get_application` | ~15 KB | ~2 KB | **~85%** |
| `get_application_resource_tree` | ~8 KB | ~2 KB | **~75%** |
| `get_resources` (empty refs) | 100 KB+ (fetched everything) | Error + guidance | **100%** waste prevented |
| `get_application_events` | All events, unsorted | Last 20, newest first | **~80%** |
| `get_application_workload_logs` | 100 lines | 50 lines | **~50%** |

Every optimization is optional — pass `compact=false` or adjust limits to get the full response when you need it.

---

## Quick Start

### Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "argocd": {
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "https://argocd.example.com",
        "ARGOCD_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "argocd": {
      "type": "stdio",
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "https://argocd.example.com",
        "ARGOCD_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Cursor

Add to your MCP config:

```json
{
  "mcpServers": {
    "argocd": {
      "command": "npx",
      "args": ["argocd-mcp-lite@latest", "stdio"],
      "env": {
        "ARGOCD_BASE_URL": "https://argocd.example.com",
        "ARGOCD_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Docker

```bash
docker run -e ARGOCD_BASE_URL=https://argocd.example.com \
           -e ARGOCD_API_TOKEN=your-token-here \
           -p 3000:3000 \
           ghcr.io/jz-wilson/argocd-mcp-lite:latest
```

> The Docker image runs in HTTP transport mode on port 3000 by default.

---

## Tools

### Application Management

| Tool | Description |
|------|-------------|
| `list_applications` | List and filter applications (field stripping + pagination) |
| `get_application` | Get application details with compact mode |
| `create_application` | Create a new application |
| `update_application` | Update an existing application |
| `delete_application` | Delete an application |
| `sync_application` | Trigger a sync operation |

### Resource Inspection

| Tool | Description |
|------|-------------|
| `get_application_resource_tree` | Resource tree with kind/health/namespace filters |
| `get_application_managed_resources` | Managed resources with server-side filtering |
| `get_resources` | Fetch specific resource manifests by ref |
| `get_application_workload_logs` | Logs with configurable tail and time window |
| `get_application_events` | Application events with limit and time filter |
| `get_resource_events` | Resource events with limit and time filter |
| `get_resource_actions` | Available resource actions |
| `run_resource_action` | Execute a resource action |

---

## New Parameters

All new parameters are **optional** with sensible defaults. Existing required parameters are unchanged — it's a drop-in replacement.

### `get_application`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `compact` | boolean | `true` | Strips `managedFields`, operation history, verbose annotations. Keeps sync/health status, Argo CD annotations, source config. |

### `get_application_resource_tree`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `kind` | string | — | Filter by K8s kind (e.g. `"Deployment"`, `"Pod"`) |
| `health` | enum | — | Filter by health: `Healthy` · `Degraded` · `Progressing` · `Missing` · `Unknown` · `Suspended` |
| `namespace` | string | — | Filter by namespace |
| `compact` | boolean | `true` | Strips `networkingInfo` and `images`. Keeps group, kind, name, namespace, health, status, parentRefs. |

### `get_resources`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resourceRefs` | array | **required** | Must not be empty. Use `get_application_resource_tree` first to discover refs. Prevents accidental 100KB+ responses. |

> ⚠️ **Breaking change from upstream**: `resourceRefs` is now required and must contain at least one ref.

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

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARGOCD_BASE_URL` | ✅ | Your Argo CD server URL |
| `ARGOCD_API_TOKEN` | ✅ | API token ([how to generate](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/#authorization)) |
| `MCP_READ_ONLY` | — | Set `true` to disable all write operations |
| `NODE_TLS_REJECT_UNAUTHORIZED` | — | Set `0` for self-signed certs (dev only) |

### Transport Modes

| Mode | Command | Use Case |
|------|---------|----------|
| `stdio` | `npx argocd-mcp-lite stdio` | Claude Desktop, VS Code, Cursor, CLI agents |
| `http` | `npx argocd-mcp-lite http` | Docker, remote servers, shared access |
| `sse` | `npx argocd-mcp-lite sse` | Server-sent events (legacy) |

---

## Development

```bash
git clone https://github.com/jz-wilson/argocd-mcp-lite.git
cd argocd-mcp-lite
pnpm install
pnpm build
```

Run locally:

```bash
ARGOCD_BASE_URL=https://argocd.example.com \
ARGOCD_API_TOKEN=your-token \
node dist/index.js stdio
```

---

## Credits

Fork of [argoproj-labs/mcp-for-argocd](https://github.com/argoproj-labs/mcp-for-argocd), originally created by [@jiachengxu](https://github.com/jiachengxu), [@imwithye](https://github.com/imwithye), [@hwwn](https://github.com/hwwn), and [@alexmt](https://github.com/alexmt) from [Akuity](https://akuity.io/).

## License

[Apache-2.0](LICENSE)

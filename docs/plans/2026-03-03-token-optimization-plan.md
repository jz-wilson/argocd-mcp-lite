# argocd-mcp-lite Token Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor mcp-for-argocd into argocd-mcp-lite — a token-efficient fork that reduces AI agent token consumption by 60-90% while keeping full ArgoCD read/write capability.

**Architecture:** All compact/filtering logic lives in `client.ts`, matching the existing `listApplications` field-stripping pattern. `server.ts` adds new optional Zod schema parameters and passes them through. No changes to the transport layer, MCP SDK integration, or existing required parameters.

**Tech Stack:** TypeScript (strict mode), Zod validation, MCP SDK, pnpm build via tsup

**Testing note:** This project has no unit test framework. Verification is via `pnpm build` (TypeScript strict mode compilation) and `source .env && node dist/index.js stdio` (runtime startup check).

---

### Task 1: Update package identity

**Files:**
- Modify: `package.json`

**Step 1: Update package.json fields**

Change these fields in `package.json`:
- `"name"` → `"argocd-mcp-lite"`
- `"version"` → `"0.1.0"`
- `"description"` → `"Token-efficient ArgoCD MCP server for AI agents"`

Keep everything else (dependencies, scripts, bin, etc.) unchanged.

**Step 2: Verify build still works**

Run: `pnpm build`
Expected: Successful build with no errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: rename to argocd-mcp-lite v0.1.0"
```

---

### Task 2: Add compact mode to get_application

**Files:**
- Modify: `src/argocd/client.ts` (method `getApplication`, lines 68-75)
- Modify: `src/server/server.ts` (tool `get_application`, lines 68-77)

**Step 1: Add compact stripping logic to client.ts**

Update the `getApplication` method to accept a `compact` boolean parameter (default: `true`). When compact is true, strip the response to essential fields only:

```typescript
public async getApplication(applicationName: string, appNamespace?: string, compact: boolean = true) {
  const queryParams = appNamespace ? { appNamespace } : undefined;
  const { body } = await this.client.get<V1alpha1Application>(
    `/api/v1/applications/${applicationName}`,
    queryParams
  );
  if (!compact) return body;

  return {
    metadata: {
      name: body.metadata?.name,
      namespace: body.metadata?.namespace,
      labels: body.metadata?.labels,
      creationTimestamp: body.metadata?.creationTimestamp,
      // Keep only argocd.argoproj.io/* annotations
      annotations: body.metadata?.annotations
        ? Object.fromEntries(
            Object.entries(body.metadata.annotations).filter(([k]) =>
              k.startsWith('argocd.argoproj.io/')
            )
          )
        : undefined,
    },
    spec: {
      project: body.spec?.project,
      source: body.spec?.source
        ? {
            repoURL: body.spec.source.repoURL,
            path: body.spec.source.path,
            chart: body.spec.source.chart,
          }
        : undefined,
      sources: body.spec?.sources?.map((s) => ({
        repoURL: s.repoURL,
        path: s.path,
        chart: s.chart,
      })),
      destination: body.spec?.destination,
      syncPolicy: body.spec?.syncPolicy,
    },
    status: {
      sync: body.status?.sync,
      health: body.status?.health,
      summary: body.status?.summary,
      // Keep only phase + message from operationState
      operationState: body.status?.operationState
        ? {
            phase: body.status.operationState.phase,
            message: body.status.operationState.message,
          }
        : undefined,
      // Keep last 3 conditions
      conditions: body.status?.conditions?.slice(-3),
    },
  };
}
```

**Step 2: Update server.ts tool schema for get_application**

Add optional `compact` parameter to the Zod schema:

```typescript
this.addJsonOutputTool(
  'get_application',
  'get_application returns application by application name. Uses compact mode by default to reduce token usage — set compact=false for the full unfiltered response.',
  {
    applicationName: z.string(),
    applicationNamespace: ApplicationNamespaceSchema.optional(),
    compact: z.boolean().optional().default(true).describe(
      'When true (default), strips heavy fields like managedFields, full operation history, and verbose annotations to reduce token usage. Set to false for the full unfiltered response.'
    ),
  },
  async ({ applicationName, applicationNamespace, compact }) =>
    await this.argocdClient.getApplication(applicationName, applicationNamespace, compact)
);
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: Successful build, no TypeScript errors

**Step 4: Commit**

```bash
git add src/argocd/client.ts src/server/server.ts
git commit -m "feat: add compact mode to get_application"
```

---

### Task 3: Add filters and compact mode to get_application_resource_tree

**Files:**
- Modify: `src/argocd/client.ts` (method `getApplicationResourceTree`, lines 158-163)
- Modify: `src/server/server.ts` (tool `get_application_resource_tree`, lines 78-84)

**Step 1: Add filtering and compact logic to client.ts**

Update `getApplicationResourceTree` to accept filter and compact parameters:

```typescript
public async getApplicationResourceTree(
  applicationName: string,
  options?: {
    kind?: string;
    health?: string;
    namespace?: string;
    compact?: boolean;
  }
) {
  const { body } = await this.client.get<V1alpha1ApplicationTree>(
    `/api/v1/applications/${applicationName}/resource-tree`
  );

  const compact = options?.compact ?? true;
  let nodes = body.nodes || [];

  // Apply filters
  if (options?.kind) {
    nodes = nodes.filter((n) => n.kind === options.kind);
  }
  if (options?.health) {
    nodes = nodes.filter((n) => n.health?.status === options.health);
  }
  if (options?.namespace) {
    nodes = nodes.filter((n) => n.namespace === options.namespace);
  }

  if (compact) {
    return {
      ...body,
      nodes: nodes.map((n) => ({
        group: n.group,
        kind: n.kind,
        name: n.name,
        namespace: n.namespace,
        health: n.health,
        status: n.status,
        parentRefs: n.parentRefs,
      })),
    };
  }

  return { ...body, nodes };
}
```

**Step 2: Update server.ts tool schema for get_application_resource_tree**

```typescript
this.addJsonOutputTool(
  'get_application_resource_tree',
  'get_application_resource_tree returns resource tree for application. Supports filtering by kind, health status, and namespace. Uses compact mode by default.',
  {
    applicationName: z.string(),
    kind: z.string().optional().describe('Filter nodes by Kubernetes resource kind (e.g., "Deployment", "Service", "Pod")'),
    health: z.enum(['Healthy', 'Degraded', 'Progressing', 'Missing', 'Unknown', 'Suspended']).optional().describe('Filter nodes by health status'),
    namespace: z.string().optional().describe('Filter nodes by namespace'),
    compact: z.boolean().optional().default(true).describe('When true (default), strips networkingInfo and images from nodes. Set to false for full node details.'),
  },
  async ({ applicationName, kind, health, namespace, compact }) =>
    await this.argocdClient.getApplicationResourceTree(applicationName, { kind, health, namespace, compact })
);
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: Successful build, no TypeScript errors

**Step 4: Commit**

```bash
git add src/argocd/client.ts src/server/server.ts
git commit -m "feat: add filters and compact mode to get_application_resource_tree"
```

---

### Task 4: Remove "fetch all if empty" behavior from get_resources

**Files:**
- Modify: `src/server/server.ts` (tool `get_resources`, lines 167-195)

**Step 1: Replace fallback with error message**

Replace the current get_resources tool handler. When `resourceRefs` is empty or not provided, return an error message instead of fetching all resources:

```typescript
this.addJsonOutputTool(
  'get_resources',
  'get_resources returns manifests for resources specified by resourceRefs. You must specify resourceRefs explicitly — use get_application_resource_tree first to discover resource references.',
  {
    applicationName: z.string(),
    applicationNamespace: ApplicationNamespaceSchema,
    resourceRefs: ResourceRefSchema.array().describe(
      'Array of resource references to fetch. Required — use get_application_resource_tree to discover refs first.'
    ),
  },
  async ({ applicationName, applicationNamespace, resourceRefs }) => {
    if (!resourceRefs || resourceRefs.length === 0) {
      throw new Error(
        'resourceRefs is required and must not be empty. Use get_application_resource_tree first to discover resource references, then pass specific refs here.'
      );
    }
    return Promise.all(
      resourceRefs.map((ref) =>
        this.argocdClient.getResource(applicationName, applicationNamespace, ref)
      )
    );
  }
);
```

Note: `resourceRefs` changes from `.optional()` to required, and the `.optional()` is removed. The description is updated to guide AI agents.

**Step 2: Verify build**

Run: `pnpm build`
Expected: Successful build, no TypeScript errors

**Step 3: Commit**

```bash
git add src/server/server.ts
git commit -m "feat: require explicit resourceRefs in get_resources"
```

---

### Task 5: Add limit and sinceMinutes to events

**Files:**
- Modify: `src/argocd/client.ts` (methods `getApplicationEvents` line 235, `getResourceEvents` line 261)
- Modify: `src/server/server.ts` (tools `get_application_events` line 136, `get_resource_events` line 142)

**Step 1: Add event filtering logic to client.ts**

Add a private helper method and update both event methods:

```typescript
private filterEvents(
  events: V1EventList,
  options?: { limit?: number; sinceMinutes?: number }
): V1EventList {
  const limit = options?.limit ?? 20;
  let items = events.items || [];

  // Filter by time if sinceMinutes is provided
  if (options?.sinceMinutes) {
    const cutoff = new Date(Date.now() - options.sinceMinutes * 60 * 1000);
    items = items.filter((e) => {
      const ts = e.lastTimestamp || e.eventTime;
      return ts ? new Date(ts) >= cutoff : true;
    });
  }

  // Sort by lastTimestamp desc (most recent first)
  items.sort((a, b) => {
    const tsA = new Date(a.lastTimestamp || a.eventTime || 0).getTime();
    const tsB = new Date(b.lastTimestamp || b.eventTime || 0).getTime();
    return tsB - tsA;
  });

  // Apply limit
  items = items.slice(0, limit);

  return { ...events, items };
}

public async getApplicationEvents(
  applicationName: string,
  options?: { limit?: number; sinceMinutes?: number }
) {
  const { body } = await this.client.get<V1EventList>(
    `/api/v1/applications/${applicationName}/events`
  );
  return this.filterEvents(body, options);
}

public async getResourceEvents(
  applicationName: string,
  applicationNamespace: string,
  resourceUID: string,
  resourceNamespace: string,
  resourceName: string,
  options?: { limit?: number; sinceMinutes?: number }
) {
  const { body } = await this.client.get<V1EventList>(
    `/api/v1/applications/${applicationName}/events`,
    {
      appNamespace: applicationNamespace,
      resourceNamespace,
      resourceUID,
      resourceName,
    }
  );
  return this.filterEvents(body, options);
}
```

**Step 2: Update server.ts tool schemas for events**

Update `get_application_events`:

```typescript
this.addJsonOutputTool(
  'get_application_events',
  'get_application_events returns events for application, sorted by most recent first. Returns last 20 events by default.',
  {
    applicationName: z.string(),
    limit: z.number().int().positive().optional().default(20).describe('Maximum number of events to return (default: 20)'),
    sinceMinutes: z.number().int().positive().optional().describe('Only return events from the last N minutes'),
  },
  async ({ applicationName, limit, sinceMinutes }) =>
    await this.argocdClient.getApplicationEvents(applicationName, { limit, sinceMinutes })
);
```

Update `get_resource_events`:

```typescript
this.addJsonOutputTool(
  'get_resource_events',
  'get_resource_events returns events for a resource managed by an application, sorted by most recent first. Returns last 20 events by default.',
  {
    applicationName: z.string(),
    applicationNamespace: ApplicationNamespaceSchema,
    resourceUID: z.string(),
    resourceNamespace: z.string(),
    resourceName: z.string(),
    limit: z.number().int().positive().optional().default(20).describe('Maximum number of events to return (default: 20)'),
    sinceMinutes: z.number().int().positive().optional().describe('Only return events from the last N minutes'),
  },
  async ({
    applicationName,
    applicationNamespace,
    resourceUID,
    resourceNamespace,
    resourceName,
    limit,
    sinceMinutes,
  }) =>
    await this.argocdClient.getResourceEvents(
      applicationName,
      applicationNamespace,
      resourceUID,
      resourceNamespace,
      resourceName,
      { limit, sinceMinutes }
    )
);
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: Successful build, no TypeScript errors

**Step 4: Commit**

```bash
git add src/argocd/client.ts src/server/server.ts
git commit -m "feat: add limit and sinceMinutes to event tools"
```

---

### Task 6: Make tailLines configurable and add sinceSeconds to logs

**Files:**
- Modify: `src/argocd/client.ts` (method `getWorkloadLogs`, lines 197-220)
- Modify: `src/server/server.ts` (tool `get_application_workload_logs`, lines 119-135)

**Step 1: Update client.ts getWorkloadLogs**

Add `tailLines` and `sinceSeconds` parameters:

```typescript
public async getWorkloadLogs(
  applicationName: string,
  applicationNamespace: string,
  resourceRef: V1alpha1ResourceResult,
  container: string,
  options?: { tailLines?: number; sinceSeconds?: number }
) {
  const logs: ApplicationLogEntry[] = [];
  await this.client.getStream<ApplicationLogEntry>(
    `/api/v1/applications/${applicationName}/logs`,
    {
      appNamespace: applicationNamespace,
      namespace: resourceRef.namespace,
      resourceName: resourceRef.name,
      group: resourceRef.group,
      kind: resourceRef.kind,
      version: resourceRef.version,
      follow: false,
      tailLines: options?.tailLines ?? 50,
      container: container,
      ...(options?.sinceSeconds && { sinceSeconds: options.sinceSeconds }),
    },
    (chunk) => logs.push(chunk)
  );
  return logs;
}
```

**Step 2: Update server.ts tool schema for get_application_workload_logs**

```typescript
this.addJsonOutputTool(
  'get_application_workload_logs',
  'get_application_workload_logs returns logs for application workload (Deployment, StatefulSet, Pod, etc.)',
  {
    applicationName: z.string(),
    applicationNamespace: ApplicationNamespaceSchema,
    resourceRef: ResourceRefSchema,
    container: z.string(),
    tailLines: z.number().int().positive().optional().default(50).describe('Number of log lines to return from the end (default: 50)'),
    sinceSeconds: z.number().int().positive().optional().describe('Only return logs from the last N seconds'),
  },
  async ({ applicationName, applicationNamespace, resourceRef, container, tailLines, sinceSeconds }) =>
    await this.argocdClient.getWorkloadLogs(
      applicationName,
      applicationNamespace,
      resourceRef as V1alpha1ResourceResult,
      container,
      { tailLines, sinceSeconds }
    )
);
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: Successful build, no TypeScript errors

**Step 4: Commit**

```bash
git add src/argocd/client.ts src/server/server.ts
git commit -m "feat: make tailLines configurable and add sinceSeconds to logs"
```

---

### Task 7: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Rewrite README.md**

Replace the content with fork-specific documentation. Key sections:
1. **Header**: argocd-mcp-lite name with fork rationale (token efficiency)
2. **What's different**: Table of before/after token savings per tool
3. **New parameters**: Document all new optional parameters for each tool
4. **Installation**: Same as upstream but with `argocd-mcp-lite` package name
5. **Configuration**: Keep MCP_READ_ONLY, self-signed cert docs
6. **Credits**: Acknowledge upstream project

Before/after estimates for the README:
- `get_application`: ~15KB → ~2KB (compact mode)
- `get_application_resource_tree`: ~8KB → ~2KB (compact + filters)
- `get_resources` (empty refs): ~100KB+ → error message (prevented)
- Events: ~5KB → ~1KB (limit 20)
- Logs: 100 lines → 50 lines default

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for argocd-mcp-lite fork"
```

---

### Task 8: Final verification

**Step 1: Full build**

Run: `pnpm build`
Expected: Successful build, zero TypeScript errors

**Step 2: Runtime startup test**

Run: `source .env && timeout 5 node dist/index.js stdio || true`
Expected: Process starts without errors (may timeout waiting for stdio input — that's fine)

**Step 3: Verify all tool names preserved**

Grep the built output to confirm all original tool names exist:
```bash
grep -o '"list_applications\|"get_application"\|"get_application_resource_tree"\|"get_application_managed_resources"\|"get_application_workload_logs"\|"get_application_events"\|"get_resource_events"\|"get_resources"\|"get_resource_actions"' dist/index.js | sort -u
```

**Step 4: Run notification command**

```bash
openclaw system event --text "Done: argocd-mcp-lite refactored with compact modes, filters, and token optimizations" --mode now
```

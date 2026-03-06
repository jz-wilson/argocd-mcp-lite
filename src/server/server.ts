import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';

import packageJSON from '../../package.json' with { type: 'json' };
import { ArgoCDClient } from '../argocd/client.js';
import { logger } from '../logging/logging.js';
import { z, ZodRawShape } from 'zod';
import { V1alpha1Application, V1alpha1ResourceResult } from '../types/argocd-types.js';
import {
  ApplicationNamespaceSchema,
  ApplicationSchema,
  ResourceRefSchema
} from '../shared/models/schema.js';

type ServerInfo = {
  argocdBaseUrl: string;
  argocdApiToken: string;
};

export class Server extends McpServer {
  private argocdClient: ArgoCDClient;

  constructor(serverInfo: ServerInfo) {
    super({
      name: packageJSON.name,
      version: packageJSON.version
    });
    this.argocdClient = new ArgoCDClient(serverInfo.argocdBaseUrl, serverInfo.argocdApiToken);

    // Fire-and-forget connection check (non-blocking, warns on failure)
    this.argocdClient.checkConnection();

    const isReadOnly =
      String(process.env.MCP_READ_ONLY ?? '')
        .trim()
        .toLowerCase() === 'true';

    // Always register read/query tools
    this.addJsonOutputTool(
      'list_applications',
      'list_applications returns list of applications',
      {
        search: z
          .string()
          .optional()
          .describe(
            'Search applications by name. This is a partial match on the application name and does not support glob patterns (e.g. "*"). Optional.'
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Maximum number of applications to return. Use this to reduce token usage when there are many applications. Optional.'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Number of applications to skip before returning results. Use with limit for pagination. Optional.'
          )
      },
      async ({ search, limit, offset }) =>
        await this.argocdClient.listApplications({
          search: search ?? undefined,
          limit,
          offset
        })
    );
    this.addJsonOutputTool(
      'get_application',
      'get_application returns application by application name. Uses compact mode by default to reduce token usage — set compact=false for the full unfiltered response.',
      {
        applicationName: z.string(),
        applicationNamespace: ApplicationNamespaceSchema.optional(),
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true (default), strips heavy fields like managedFields, full operation history, and verbose annotations to reduce token usage. Set to false for the full unfiltered response.'
          )
      },
      async ({ applicationName, applicationNamespace, compact }) =>
        await this.argocdClient.getApplication(applicationName, applicationNamespace, compact)
    );
    this.addJsonOutputTool(
      'get_application_resource_tree',
      'get_application_resource_tree returns resource tree for application. Supports filtering by kind, health status, and namespace. Uses compact mode by default to reduce token usage.',
      {
        applicationName: z.string(),
        kind: z
          .string()
          .optional()
          .describe(
            'Filter nodes by Kubernetes resource kind (e.g., "Deployment", "Service", "Pod")'
          ),
        health: z
          .enum(['Healthy', 'Degraded', 'Progressing', 'Missing', 'Unknown', 'Suspended'])
          .optional()
          .describe('Filter nodes by health status'),
        namespace: z.string().optional().describe('Filter nodes by namespace'),
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true (default), strips networkingInfo and images from nodes. Set to false for full node details.'
          )
      },
      async ({ applicationName, kind, health, namespace, compact }) =>
        await this.argocdClient.getApplicationResourceTree(applicationName, {
          kind,
          health,
          namespace,
          compact
        })
    );
    this.addJsonOutputTool(
      'get_application_managed_resources',
      'get_application_managed_resources returns managed resources for application by application name with optional filtering. Use filters to avoid token limits with large applications. Examples: kind="ConfigMap" for config maps only, namespace="production" for specific namespace, or combine multiple filters.',
      {
        applicationName: z.string(),
        kind: z
          .string()
          .optional()
          .describe(
            'Filter by Kubernetes resource kind (e.g., "ConfigMap", "Secret", "Deployment")'
          ),
        namespace: z.string().optional().describe('Filter by Kubernetes namespace'),
        name: z.string().optional().describe('Filter by resource name'),
        version: z.string().optional().describe('Filter by resource API version'),
        group: z.string().optional().describe('Filter by API group'),
        appNamespace: z.string().optional().describe('Filter by Argo CD application namespace'),
        project: z.string().optional().describe('Filter by Argo CD project'),
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true (default), strips liveState, targetState, normalizedLiveState, predictedLiveState, and diff fields to reduce token usage. Set to false for full resource diffs.'
          )
      },
      async ({
        applicationName,
        kind,
        namespace,
        name,
        version,
        group,
        appNamespace,
        project,
        compact
      }) => {
        const filters = {
          ...(kind && { kind }),
          ...(namespace && { namespace }),
          ...(name && { name }),
          ...(version && { version }),
          ...(group && { group }),
          ...(appNamespace && { appNamespace }),
          ...(project && { project })
        };
        return await this.argocdClient.getApplicationManagedResources(
          applicationName,
          Object.keys(filters).length > 0 ? filters : undefined,
          compact
        );
      }
    );
    this.addJsonOutputTool(
      'get_application_workload_logs',
      'get_application_workload_logs returns logs for application workload (Deployment, StatefulSet, Pod, etc.) by application name and resource ref and optionally container name',
      {
        applicationName: z.string(),
        applicationNamespace: ApplicationNamespaceSchema,
        resourceRef: ResourceRefSchema,
        container: z.string(),
        tailLines: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe('Number of log lines to return from the end (default: 50)'),
        sinceSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only return logs from the last N seconds')
      },
      async ({
        applicationName,
        applicationNamespace,
        resourceRef,
        container,
        tailLines,
        sinceSeconds
      }) =>
        await this.argocdClient.getWorkloadLogs(
          applicationName,
          applicationNamespace,
          resourceRef as V1alpha1ResourceResult,
          container,
          { tailLines, sinceSeconds }
        )
    );
    this.addJsonOutputTool(
      'get_application_events',
      'get_application_events returns events for application, sorted by most recent first. Returns last 20 events by default.',
      {
        applicationName: z.string(),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(20)
          .describe('Maximum number of events to return (default: 20)'),
        sinceMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only return events from the last N minutes')
      },
      async ({ applicationName, limit, sinceMinutes }) =>
        await this.argocdClient.getApplicationEvents(applicationName, { limit, sinceMinutes })
    );
    this.addJsonOutputTool(
      'get_resource_events',
      'get_resource_events returns events for a resource managed by an application, sorted by most recent first. Returns last 20 events by default.',
      {
        applicationName: z.string(),
        applicationNamespace: ApplicationNamespaceSchema,
        resourceUID: z.string(),
        resourceNamespace: z.string(),
        resourceName: z.string(),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(20)
          .describe('Maximum number of events to return (default: 20)'),
        sinceMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only return events from the last N minutes')
      },
      async ({
        applicationName,
        applicationNamespace,
        resourceUID,
        resourceNamespace,
        resourceName,
        limit,
        sinceMinutes
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
    this.addJsonOutputTool(
      'get_resources',
      'get_resources returns manifests for resources specified by resourceRefs. You must specify resourceRefs explicitly — use get_application_resource_tree first to discover resource references.',
      {
        applicationName: z.string(),
        applicationNamespace: ApplicationNamespaceSchema,
        resourceRefs: ResourceRefSchema.array().describe(
          'Array of resource references to fetch. Required — use get_application_resource_tree to discover refs first.'
        )
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
    this.addJsonOutputTool(
      'get_resource_actions',
      'get_resource_actions returns actions for a resource that is managed by an application',
      {
        applicationName: z.string(),
        applicationNamespace: ApplicationNamespaceSchema,
        resourceRef: ResourceRefSchema
      },
      async ({ applicationName, applicationNamespace, resourceRef }) =>
        await this.argocdClient.getResourceActions(
          applicationName,
          applicationNamespace,
          resourceRef as V1alpha1ResourceResult
        )
    );

    // Only register modification tools if not in read-only mode
    if (!isReadOnly) {
      this.addJsonOutputTool(
        'create_application',
        'create_application creates a new ArgoCD application in the specified namespace. The application.metadata.namespace field determines where the Application resource will be created (e.g., "argocd", "argocd-apps", or any custom namespace).',
        { application: ApplicationSchema },
        async ({ application }) =>
          await this.argocdClient.createApplication(application as V1alpha1Application)
      );
      this.addJsonOutputTool(
        'update_application',
        'update_application updates application',
        { applicationName: z.string(), application: ApplicationSchema },
        async ({ applicationName, application }) =>
          await this.argocdClient.updateApplication(
            applicationName,
            application as V1alpha1Application
          )
      );
      this.addJsonOutputTool(
        'delete_application',
        'delete_application deletes application. Specify applicationNamespace if the application is in a non-default namespace to avoid permission errors.',
        {
          applicationName: z.string(),
          applicationNamespace: ApplicationNamespaceSchema.optional().describe(
            'The namespace where the application is located. Required if application is not in the default namespace.'
          ),
          cascade: z
            .boolean()
            .optional()
            .describe('Whether to cascade the deletion to child resources'),
          propagationPolicy: z
            .string()
            .optional()
            .describe('Deletion propagation policy (e.g., "Foreground", "Background", "Orphan")')
        },
        async ({ applicationName, applicationNamespace, cascade, propagationPolicy }) => {
          const options: Record<string, string | boolean> = {};
          if (applicationNamespace) options.appNamespace = applicationNamespace;
          if (cascade !== undefined) options.cascade = cascade;
          if (propagationPolicy) options.propagationPolicy = propagationPolicy;

          return await this.argocdClient.deleteApplication(
            applicationName,
            Object.keys(options).length > 0 ? options : undefined
          );
        }
      );
      this.addJsonOutputTool(
        'sync_application',
        'sync_application syncs application. Specify applicationNamespace if the application is in a non-default namespace to avoid permission errors.',
        {
          applicationName: z.string(),
          applicationNamespace: ApplicationNamespaceSchema.optional().describe(
            'The namespace where the application is located. Required if application is not in the default namespace.'
          ),
          dryRun: z
            .boolean()
            .optional()
            .describe('Perform a dry run sync without applying changes'),
          prune: z
            .boolean()
            .optional()
            .describe('Remove resources that are no longer defined in the source'),
          revision: z
            .string()
            .optional()
            .describe('Sync to a specific revision instead of the latest'),
          syncOptions: z
            .array(z.string())
            .optional()
            .describe(
              'Additional sync options (e.g., ["CreateNamespace=true", "PrunePropagationPolicy=foreground"])'
            )
        },
        async ({ applicationName, applicationNamespace, dryRun, prune, revision, syncOptions }) => {
          const options: Record<string, string | boolean | string[]> = {};
          if (applicationNamespace) options.appNamespace = applicationNamespace;
          if (dryRun !== undefined) options.dryRun = dryRun;
          if (prune !== undefined) options.prune = prune;
          if (revision) options.revision = revision;
          if (syncOptions) options.syncOptions = syncOptions;

          return await this.argocdClient.syncApplication(
            applicationName,
            Object.keys(options).length > 0 ? options : undefined
          );
        }
      );
      this.addJsonOutputTool(
        'run_resource_action',
        'run_resource_action runs an action on a resource',
        {
          applicationName: z.string(),
          applicationNamespace: ApplicationNamespaceSchema,
          resourceRef: ResourceRefSchema,
          action: z.string()
        },
        async ({ applicationName, applicationNamespace, resourceRef, action }) =>
          await this.argocdClient.runResourceAction(
            applicationName,
            applicationNamespace,
            resourceRef as V1alpha1ResourceResult,
            action
          )
      );
    }

    // Register workflow prompts
    this.prompt(
      'debug-application',
      'Step-by-step workflow for debugging a failing ArgoCD application',
      { applicationName: z.string().describe('The application name to debug') },
      ({ applicationName }) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Debug the ArgoCD application "${applicationName}" by following these steps:`,
                '',
                '1. **Get application status:** Call `get_application` to check sync and health status.',
                '2. **Check events:** Call `get_application_events` with `sinceMinutes=30` to see recent events.',
                '3. **Inspect resource tree:** Call `get_application_resource_tree` with `health="Degraded"` to find unhealthy resources.',
                '4. **Get resource details:** For any degraded resources found, call `get_resources` with the specific resource refs.',
                '5. **Check logs:** For failing pods/deployments, call `get_application_workload_logs` with `sinceSeconds=1800`.',
                '',
                'Summarize findings and suggest remediation steps.'
              ].join('\n')
            }
          }
        ]
      })
    );
  }

  private addJsonOutputTool<Args extends ZodRawShape, T>(
    name: string,
    description: string,
    paramsSchema: Args,
    cb: (...cbArgs: Parameters<ToolCallback<Args>>) => T
  ) {
    this.tool(name, description, paramsSchema as ZodRawShape, async (...args) => {
      logger.info({ tool: name }, 'tool invoked');
      try {
        const result = await cb.apply(this, args as Parameters<ToolCallback<Args>>);
        logger.info({ tool: name }, 'tool completed successfully');
        return {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      } catch (error) {
        logger.error(
          { tool: name, error: error instanceof Error ? error.message : String(error) },
          'tool failed'
        );
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    });
  }
}

export const createServer = (serverInfo: ServerInfo) => {
  return new Server(serverInfo);
};

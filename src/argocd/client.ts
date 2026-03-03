import {
  ApplicationLogEntry,
  V1alpha1Application,
  V1alpha1ApplicationList,
  V1alpha1ApplicationTree,
  V1EventList,
  V1alpha1ResourceAction,
  V1alpha1ResourceDiff,
  V1alpha1ResourceResult,
  V1alpha1ApplicationResourceResult
} from '../types/argocd-types.js';
import { HttpClient } from './http.js';

export class ArgoCDClient {
  private baseUrl: string;
  private apiToken: string;
  private client: HttpClient;

  constructor(baseUrl: string, apiToken: string) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.client = new HttpClient(this.baseUrl, this.apiToken);
  }

  public async listApplications(params?: { search?: string; limit?: number; offset?: number }) {
    const { body } = await this.client.get<V1alpha1ApplicationList>(
      `/api/v1/applications`,
      params?.search ? { search: params.search } : undefined
    );

    // Strip heavy fields to reduce token usage
    const strippedItems =
      body.items?.map((app) => ({
        metadata: {
          name: app.metadata?.name,
          namespace: app.metadata?.namespace,
          labels: app.metadata?.labels,
          creationTimestamp: app.metadata?.creationTimestamp
        },
        spec: {
          project: app.spec?.project,
          source: app.spec?.source,
          destination: app.spec?.destination
        },
        status: {
          sync: app.status?.sync,
          health: app.status?.health,
          summary: app.status?.summary
        }
      })) ?? [];

    // Apply pagination
    const start = params?.offset ?? 0;
    const end = params?.limit ? start + params.limit : strippedItems.length;
    const items = strippedItems.slice(start, end);

    return {
      items,
      metadata: {
        resourceVersion: body.metadata?.resourceVersion,
        totalItems: strippedItems.length,
        returnedItems: items.length,
        hasMore: end < strippedItems.length
      }
    };
  }

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
        operationState: body.status?.operationState
          ? {
              phase: body.status.operationState.phase,
              message: body.status.operationState.message,
            }
          : undefined,
        conditions: body.status?.conditions?.slice(-3),
      },
    };
  }

  public async createApplication(application: V1alpha1Application) {
    const { body } = await this.client.post<V1alpha1Application, V1alpha1Application>(
      `/api/v1/applications`,
      null,
      application
    );
    return body;
  }

  public async updateApplication(applicationName: string, application: V1alpha1Application) {
    const { body } = await this.client.put<V1alpha1Application, V1alpha1Application>(
      `/api/v1/applications/${applicationName}`,
      null,
      application
    );
    return body;
  }

  public async deleteApplication(
    applicationName: string,
    options?: {
      appNamespace?: string;
      cascade?: boolean;
      propagationPolicy?: string;
    }
  ) {
    const queryParams: Record<string, string | boolean> = {};

    if (options?.appNamespace) {
      queryParams.appNamespace = options.appNamespace;
    }
    if (options?.cascade !== undefined) {
      queryParams.cascade = options.cascade;
    }
    if (options?.propagationPolicy) {
      queryParams.propagationPolicy = options.propagationPolicy;
    }

    const { body } = await this.client.delete<V1alpha1Application>(
      `/api/v1/applications/${applicationName}`,
      Object.keys(queryParams).length > 0 ? queryParams : undefined
    );
    return body;
  }

  public async syncApplication(
    applicationName: string,
    options?: {
      appNamespace?: string;
      dryRun?: boolean;
      prune?: boolean;
      revision?: string;
      syncOptions?: string[];
    }
  ) {
    const syncRequest: Record<string, string | boolean | string[]> = {};

    if (options?.appNamespace) {
      syncRequest.appNamespace = options.appNamespace;
    }
    if (options?.dryRun !== undefined) {
      syncRequest.dryRun = options.dryRun;
    }
    if (options?.prune !== undefined) {
      syncRequest.prune = options.prune;
    }
    if (options?.revision) {
      syncRequest.revision = options.revision;
    }
    if (options?.syncOptions) {
      syncRequest.syncOptions = options.syncOptions;
    }

    const { body } = await this.client.post<V1alpha1Application, V1alpha1Application>(
      `/api/v1/applications/${applicationName}/sync`,
      null,
      Object.keys(syncRequest).length > 0 ? syncRequest : undefined
    );
    return body;
  }

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

  public async getApplicationManagedResources(
    applicationName: string,
    filters?: {
      namespace?: string;
      name?: string;
      version?: string;
      group?: string;
      kind?: string;
      appNamespace?: string;
      project?: string;
    }
  ) {
    const { body } = await this.client.get<{ items: V1alpha1ResourceDiff[] }>(
      `/api/v1/applications/${applicationName}/managed-resources`,
      filters
    );
    return body;
  }

  public async getApplicationLogs(applicationName: string) {
    const logs: ApplicationLogEntry[] = [];
    await this.client.getStream<ApplicationLogEntry>(
      `/api/v1/applications/${applicationName}/logs`,
      {
        follow: false,
        tailLines: 100
      },
      (chunk) => logs.push(chunk)
    );
    return logs;
  }

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
        ...(options?.sinceSeconds && { sinceSeconds: options.sinceSeconds })
      },
      (chunk) => logs.push(chunk)
    );
    return logs;
  }

  public async getPodLogs(applicationName: string, podName: string) {
    const logs: ApplicationLogEntry[] = [];
    await this.client.getStream<ApplicationLogEntry>(
      `/api/v1/applications/${applicationName}/pods/${podName}/logs`,
      {
        follow: false,
        tailLines: 100
      },
      (chunk) => logs.push(chunk)
    );
    return logs;
  }

  private filterEvents(
    events: V1EventList,
    options?: { limit?: number; sinceMinutes?: number }
  ): V1EventList {
    const limit = options?.limit ?? 20;
    let items = events.items || [];

    if (options?.sinceMinutes) {
      const cutoff = new Date(Date.now() - options.sinceMinutes * 60 * 1000);
      items = items.filter((e) => {
        const ts = e.lastTimestamp || e.eventTime;
        return ts ? new Date(ts as string) >= cutoff : true;
      });
    }

    items.sort((a, b) => {
      const tsA = new Date((a.lastTimestamp || a.eventTime || 0) as string).getTime();
      const tsB = new Date((b.lastTimestamp || b.eventTime || 0) as string).getTime();
      return tsB - tsA;
    });

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

  public async getResource(
    applicationName: string,
    applicationNamespace: string,
    resourceRef: V1alpha1ResourceResult
  ) {
    const { body } = await this.client.get<V1alpha1ApplicationResourceResult>(
      `/api/v1/applications/${applicationName}/resource`,
      {
        appNamespace: applicationNamespace,
        namespace: resourceRef.namespace,
        resourceName: resourceRef.name,
        group: resourceRef.group,
        kind: resourceRef.kind,
        version: resourceRef.version
      }
    );
    return body.manifest;
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
        resourceName
      }
    );
    return this.filterEvents(body, options);
  }

  public async getResourceActions(
    applicationName: string,
    applicationNamespace: string,
    resourceRef: V1alpha1ResourceResult
  ) {
    const { body } = await this.client.get<{ actions: V1alpha1ResourceAction[] }>(
      `/api/v1/applications/${applicationName}/resource/actions`,
      {
        appNamespace: applicationNamespace,
        namespace: resourceRef.namespace,
        resourceName: resourceRef.name,
        group: resourceRef.group,
        kind: resourceRef.kind,
        version: resourceRef.version
      }
    );
    return body;
  }

  public async runResourceAction(
    applicationName: string,
    applicationNamespace: string,
    resourceRef: V1alpha1ResourceResult,
    action: string
  ) {
    const { body } = await this.client.post<string, V1alpha1Application>(
      `/api/v1/applications/${applicationName}/resource/actions`,
      {
        appNamespace: applicationNamespace,
        namespace: resourceRef.namespace,
        resourceName: resourceRef.name,
        group: resourceRef.group,
        kind: resourceRef.kind,
        version: resourceRef.version
      },
      action
    );
    return body;
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgoCDClient } from '../src/argocd/client.js';

// Create mock methods that persist across instances
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockGetStream = vi.fn();

// Mock the HttpClient with a real class
vi.mock('../src/argocd/http.js', () => {
  return {
    HttpClient: class MockHttpClient {
      baseUrl: string;
      apiToken: string;
      headers: Record<string, string>;
      get = mockGet;
      post = mockPost;
      put = mockPut;
      delete = mockDelete;
      getStream = mockGetStream;
      constructor(baseUrl: string, apiToken: string) {
        this.baseUrl = baseUrl;
        this.apiToken = apiToken;
        this.headers = { Authorization: `Bearer ${apiToken}` };
      }
    }
  };
});

function createClient() {
  // Reset mocks between calls
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
  mockGetStream.mockReset();

  const client = new ArgoCDClient('https://argocd.example.com', 'test-token');
  return {
    client,
    httpClient: {
      get: mockGet,
      post: mockPost,
      put: mockPut,
      delete: mockDelete,
      getStream: mockGetStream
    }
  };
}

// --- Fixtures ---

const fullApplication = {
  metadata: {
    name: 'my-app',
    namespace: 'argocd',
    labels: { team: 'platform' },
    creationTimestamp: '2024-01-01T00:00:00Z',
    annotations: {
      'argocd.argoproj.io/refresh': 'normal',
      'kubectl.kubernetes.io/last-applied-configuration': '{"huge":"blob"}',
      'notified.notifications.argoproj.io': '{}',
      'argocd.argoproj.io/manifest-generate-paths': '/apps/my-app'
    },
    managedFields: [{ manager: 'argocd', operation: 'Apply' }],
    generation: 42,
    resourceVersion: '123456',
    uid: 'abc-123'
  },
  spec: {
    project: 'default',
    source: {
      repoURL: 'https://github.com/example/repo',
      path: 'apps/my-app',
      chart: undefined,
      targetRevision: 'HEAD',
      helm: { values: 'big: blob' }
    },
    sources: [
      {
        repoURL: 'https://github.com/example/repo2',
        path: 'charts/',
        chart: 'my-chart',
        targetRevision: 'v1.0.0'
      }
    ],
    destination: { server: 'https://kubernetes.default.svc', namespace: 'production' },
    syncPolicy: { automated: { prune: true, selfHeal: true } }
  },
  status: {
    sync: { status: 'Synced', revision: 'abc123' },
    health: { status: 'Healthy' },
    summary: { images: ['nginx:latest'] },
    operationState: {
      phase: 'Succeeded',
      message: 'successfully synced',
      startedAt: '2024-01-01T00:00:00Z',
      finishedAt: '2024-01-01T00:01:00Z',
      operation: { sync: { revision: 'abc123' } },
      syncResult: { resources: [{ name: 'deploy', kind: 'Deployment' }] }
    },
    conditions: [
      { type: 'SyncError', message: 'old error' },
      { type: 'SyncError', message: 'another old error' },
      { type: 'ComparisonError', message: 'comparison issue' },
      { type: 'RepeatedResourceWarning', message: 'recent warning' }
    ],
    history: [{ id: 1 }, { id: 2 }, { id: 3 }]
  },
  operation: { sync: { revision: 'abc123' } }
};

const resourceTreeNodes = [
  {
    group: 'apps',
    kind: 'Deployment',
    name: 'web',
    namespace: 'production',
    health: { status: 'Healthy' },
    status: 'Synced',
    parentRefs: [{ kind: 'Application', name: 'my-app' }],
    networkingInfo: { ingress: [{ host: 'example.com' }] },
    images: ['nginx:latest']
  },
  {
    group: '',
    kind: 'Pod',
    name: 'web-abc123',
    namespace: 'production',
    health: { status: 'Healthy' },
    status: 'Synced',
    parentRefs: [{ kind: 'ReplicaSet', name: 'web-abc' }],
    networkingInfo: { targetRefs: [] },
    images: ['nginx:latest']
  },
  {
    group: '',
    kind: 'Service',
    name: 'web-svc',
    namespace: 'staging',
    health: { status: 'Healthy' },
    status: 'Synced',
    parentRefs: [],
    networkingInfo: { ingress: [] },
    images: []
  },
  {
    group: 'apps',
    kind: 'Deployment',
    name: 'worker',
    namespace: 'production',
    health: { status: 'Degraded' },
    status: 'OutOfSync',
    parentRefs: [{ kind: 'Application', name: 'my-app' }],
    networkingInfo: {},
    images: ['worker:v2']
  }
];

const eventItems = [
  { lastTimestamp: '2024-01-01T00:03:00Z', message: 'third', reason: 'Synced' },
  { lastTimestamp: '2024-01-01T00:01:00Z', message: 'first', reason: 'SyncError' },
  { lastTimestamp: '2024-01-01T00:02:00Z', message: 'second', reason: 'Synced' },
  { lastTimestamp: '2024-01-01T00:04:00Z', message: 'fourth', reason: 'Synced' },
  { lastTimestamp: '2024-01-01T00:05:00Z', message: 'fifth', reason: 'OperationCompleted' }
];

// --- Tests ---

describe('ArgoCDClient', () => {
  describe('listApplications', () => {
    it('strips heavy fields from application list', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({
        body: {
          items: [fullApplication],
          metadata: { resourceVersion: '999' }
        }
      });

      const result = await client.listApplications();

      expect(result.items).toHaveLength(1);
      const app = result.items[0];
      // Should keep lightweight fields
      expect(app.metadata.name).toBe('my-app');
      expect(app.spec.project).toBe('default');
      expect(app.status.sync).toEqual({ status: 'Synced', revision: 'abc123' });
      // Should NOT have managedFields or heavy data
      expect((app.metadata as any).managedFields).toBeUndefined();
      expect((app.metadata as any).uid).toBeUndefined();
      expect((app.metadata as any).resourceVersion).toBeUndefined();
    });

    it('applies pagination with offset and limit', async () => {
      const { client, httpClient } = createClient();
      const apps = Array.from({ length: 5 }, (_, i) => ({
        metadata: { name: `app-${i}` },
        spec: { project: 'default' },
        status: { sync: { status: 'Synced' } }
      }));
      httpClient.get.mockResolvedValue({
        body: { items: apps, metadata: { resourceVersion: '1' } }
      });

      const result = await client.listApplications({ offset: 1, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].metadata.name).toBe('app-1');
      expect(result.items[1].metadata.name).toBe('app-2');
      expect(result.metadata.totalItems).toBe(5);
      expect(result.metadata.hasMore).toBe(true);
    });

    it('passes search param to API', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({
        body: { items: [], metadata: {} }
      });

      await client.listApplications({ search: 'my-app' });

      expect(httpClient.get).toHaveBeenCalledWith('/api/v1/applications', { search: 'my-app' });
    });

    it('returns empty array for no items', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({
        body: { items: undefined, metadata: {} }
      });

      const result = await client.listApplications();
      expect(result.items).toEqual([]);
    });
  });

  describe('getApplication', () => {
    it('returns compact response by default', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: fullApplication });

      const result = await client.getApplication('my-app');

      // Should keep ArgoCD annotations only
      expect(result.metadata.annotations).toHaveProperty('argocd.argoproj.io/refresh');
      expect(result.metadata.annotations).toHaveProperty(
        'argocd.argoproj.io/manifest-generate-paths'
      );
      expect(result.metadata.annotations).not.toHaveProperty(
        'kubectl.kubernetes.io/last-applied-configuration'
      );
      expect(result.metadata.annotations).not.toHaveProperty(
        'notified.notifications.argoproj.io'
      );

      // Should strip managedFields
      expect((result.metadata as any).managedFields).toBeUndefined();
      expect((result.metadata as any).uid).toBeUndefined();

      // Should keep source but strip helm values
      expect(result.spec.source?.repoURL).toBe('https://github.com/example/repo');
      expect((result.spec.source as any)?.helm).toBeUndefined();

      // Should compact sources array
      expect(result.spec.sources).toHaveLength(1);
      expect(result.spec.sources![0].chart).toBe('my-chart');

      // Should trim operationState to phase+message only
      expect(result.status.operationState?.phase).toBe('Succeeded');
      expect((result.status.operationState as any)?.syncResult).toBeUndefined();

      // Should keep only last 3 conditions
      expect(result.status.conditions).toHaveLength(3);
    });

    it('returns full response when compact=false', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: fullApplication });

      const result = await client.getApplication('my-app', undefined, false);

      // Should include everything
      expect(result.metadata?.managedFields).toBeDefined();
      expect(result.metadata?.uid).toBe('abc-123');
      expect((result as any).operation).toBeDefined();
    });

    it('passes appNamespace query param', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: fullApplication });

      await client.getApplication('my-app', 'custom-ns');

      expect(httpClient.get).toHaveBeenCalledWith('/api/v1/applications/my-app', {
        appNamespace: 'custom-ns'
      });
    });
  });

  describe('getApplicationResourceTree', () => {
    it('strips networkingInfo and images in compact mode', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app');

      for (const node of result.nodes) {
        expect(node).not.toHaveProperty('networkingInfo');
        expect(node).not.toHaveProperty('images');
        expect(node).toHaveProperty('kind');
        expect(node).toHaveProperty('name');
        expect(node).toHaveProperty('health');
      }
    });

    it('filters by kind', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app', { kind: 'Deployment' });

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.every((n) => n.kind === 'Deployment')).toBe(true);
    });

    it('filters by health status', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app', { health: 'Degraded' });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('worker');
    });

    it('filters by namespace', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app', { namespace: 'staging' });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('web-svc');
    });

    it('combines multiple filters', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app', {
        kind: 'Deployment',
        health: 'Healthy',
        namespace: 'production'
      });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('web');
    });

    it('returns full nodes when compact=false', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { nodes: resourceTreeNodes } });

      const result = await client.getApplicationResourceTree('my-app', { compact: false });

      expect(result.nodes[0]).toHaveProperty('networkingInfo');
      expect(result.nodes[0]).toHaveProperty('images');
    });
  });

  describe('filterEvents (via getApplicationEvents)', () => {
    it('sorts events by lastTimestamp descending', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { items: [...eventItems] } });

      const result = await client.getApplicationEvents('my-app');

      expect(result.items[0].message).toBe('fifth');
      expect(result.items[1].message).toBe('fourth');
      expect(result.items[2].message).toBe('third');
    });

    it('limits events to default of 20', async () => {
      const { client, httpClient } = createClient();
      const manyEvents = Array.from({ length: 30 }, (_, i) => ({
        lastTimestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        message: `event-${i}`
      }));
      httpClient.get.mockResolvedValue({ body: { items: manyEvents } });

      const result = await client.getApplicationEvents('my-app');

      expect(result.items).toHaveLength(20);
    });

    it('respects custom limit', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { items: [...eventItems] } });

      const result = await client.getApplicationEvents('my-app', { limit: 2 });

      expect(result.items).toHaveLength(2);
    });

    it('filters by sinceMinutes', async () => {
      const { client, httpClient } = createClient();
      const now = Date.now();
      const recentEvents = [
        { lastTimestamp: new Date(now - 2 * 60 * 1000).toISOString(), message: 'recent' },
        { lastTimestamp: new Date(now - 30 * 60 * 1000).toISOString(), message: 'old' }
      ];
      httpClient.get.mockResolvedValue({ body: { items: recentEvents } });

      const result = await client.getApplicationEvents('my-app', { sinceMinutes: 5 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].message).toBe('recent');
    });

    it('keeps events without timestamps when filtering by sinceMinutes', async () => {
      const { client, httpClient } = createClient();
      const events = [{ message: 'no-timestamp' }];
      httpClient.get.mockResolvedValue({ body: { items: events } });

      const result = await client.getApplicationEvents('my-app', { sinceMinutes: 5 });

      expect(result.items).toHaveLength(1);
    });
  });

  describe('updateApplication', () => {
    it('puts to correct endpoint with application body', async () => {
      const { client, httpClient } = createClient();
      httpClient.put.mockResolvedValue({ body: fullApplication });

      const app = { metadata: { name: 'my-app' } } as any;
      await client.updateApplication('my-app', app);

      expect(httpClient.put).toHaveBeenCalledWith('/api/v1/applications/my-app', null, app);
    });
  });

  describe('getApplicationManagedResources', () => {
    it('fetches managed resources for an application', async () => {
      const { client, httpClient } = createClient();
      const items = [{ group: 'apps', kind: 'Deployment', name: 'web' }];
      httpClient.get.mockResolvedValue({ body: { items } });

      const result = await client.getApplicationManagedResources('my-app');

      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/managed-resources',
        undefined
      );
      expect(result.items).toEqual(items);
    });

    it('passes filter params to API', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { items: [] } });

      const filters = { namespace: 'prod', kind: 'Deployment', group: 'apps' };
      await client.getApplicationManagedResources('my-app', filters);

      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/managed-resources',
        filters
      );
    });
  });

  describe('getApplicationLogs', () => {
    it('streams logs and collects entries', async () => {
      const { client, httpClient } = createClient();
      mockGetStream.mockImplementation(
        async (_url: string, _params: unknown, cb: (chunk: unknown) => void) => {
          cb({ content: 'line1', timeStamp: '2024-01-01T00:00:00Z' });
          cb({ content: 'line2', timeStamp: '2024-01-01T00:00:01Z' });
        }
      );

      const result = await client.getApplicationLogs('my-app');

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('line1');
      expect(mockGetStream).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/logs',
        { follow: false, tailLines: 100 },
        expect.any(Function)
      );
    });
  });

  describe('getWorkloadLogs', () => {
    it('streams workload logs with resource ref params', async () => {
      const { client } = createClient();
      mockGetStream.mockImplementation(
        async (_url: string, _params: unknown, cb: (chunk: unknown) => void) => {
          cb({ content: 'workload-log' });
        }
      );

      const resourceRef = {
        namespace: 'prod',
        name: 'web',
        group: 'apps',
        kind: 'Deployment',
        version: 'v1'
      };
      const result = await client.getWorkloadLogs('my-app', 'argocd', resourceRef as any, 'main');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('workload-log');
      expect(mockGetStream).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/logs',
        expect.objectContaining({
          appNamespace: 'argocd',
          namespace: 'prod',
          resourceName: 'web',
          container: 'main',
          follow: false,
          tailLines: 50
        }),
        expect.any(Function)
      );
    });

    it('passes sinceSeconds option', async () => {
      const { client } = createClient();
      mockGetStream.mockResolvedValue(undefined);

      const resourceRef = {
        namespace: 'prod',
        name: 'web',
        group: 'apps',
        kind: 'Deployment',
        version: 'v1'
      };
      await client.getWorkloadLogs('my-app', 'argocd', resourceRef as any, 'main', {
        sinceSeconds: 300
      });

      expect(mockGetStream).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/logs',
        expect.objectContaining({ sinceSeconds: 300 }),
        expect.any(Function)
      );
    });
  });

  describe('getResource', () => {
    it('fetches a resource manifest', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({
        body: { manifest: '{"kind":"Deployment","metadata":{"name":"web"}}' }
      });

      const resourceRef = {
        namespace: 'prod',
        name: 'web',
        group: 'apps',
        kind: 'Deployment',
        version: 'v1'
      };
      const result = await client.getResource('my-app', 'argocd', resourceRef as any);

      expect(result).toBe('{"kind":"Deployment","metadata":{"name":"web"}}');
      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/resource',
        expect.objectContaining({
          appNamespace: 'argocd',
          namespace: 'prod',
          resourceName: 'web',
          group: 'apps',
          kind: 'Deployment',
          version: 'v1'
        })
      );
    });
  });

  describe('getResourceEvents', () => {
    it('fetches and filters resource events', async () => {
      const { client, httpClient } = createClient();
      httpClient.get.mockResolvedValue({ body: { items: [...eventItems] } });

      const result = await client.getResourceEvents(
        'my-app',
        'argocd',
        'uid-123',
        'prod',
        'web',
        { limit: 3 }
      );

      expect(result.items).toHaveLength(3);
      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/events',
        expect.objectContaining({
          appNamespace: 'argocd',
          resourceUID: 'uid-123',
          resourceNamespace: 'prod',
          resourceName: 'web'
        })
      );
    });
  });

  describe('getResourceActions', () => {
    it('fetches available actions for a resource', async () => {
      const { client, httpClient } = createClient();
      const actions = [{ name: 'restart', disabled: false }];
      httpClient.get.mockResolvedValue({ body: { actions } });

      const resourceRef = {
        namespace: 'prod',
        name: 'web',
        group: 'apps',
        kind: 'Deployment',
        version: 'v1'
      };
      const result = await client.getResourceActions('my-app', 'argocd', resourceRef as any);

      expect(result.actions).toEqual(actions);
      expect(httpClient.get).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/resource/actions',
        expect.objectContaining({
          appNamespace: 'argocd',
          resourceName: 'web',
          kind: 'Deployment'
        })
      );
    });
  });

  describe('runResourceAction', () => {
    it('posts action to correct endpoint', async () => {
      const { client, httpClient } = createClient();
      httpClient.post.mockResolvedValue({ body: fullApplication });

      const resourceRef = {
        namespace: 'prod',
        name: 'web',
        group: 'apps',
        kind: 'Deployment',
        version: 'v1'
      };
      await client.runResourceAction('my-app', 'argocd', resourceRef as any, 'restart');

      expect(httpClient.post).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/resource/actions',
        expect.objectContaining({
          appNamespace: 'argocd',
          resourceName: 'web',
          kind: 'Deployment'
        }),
        'restart'
      );
    });
  });

  describe('CRUD operations', () => {
    it('createApplication posts to correct endpoint', async () => {
      const { client, httpClient } = createClient();
      httpClient.post.mockResolvedValue({ body: fullApplication });

      const app = { metadata: { name: 'new-app' } } as any;
      await client.createApplication(app);

      expect(httpClient.post).toHaveBeenCalledWith('/api/v1/applications', null, app);
    });

    it('deleteApplication passes cascade and propagationPolicy', async () => {
      const { client, httpClient } = createClient();
      httpClient.delete.mockResolvedValue({ body: {} });

      await client.deleteApplication('my-app', {
        appNamespace: 'argocd',
        cascade: true,
        propagationPolicy: 'Foreground'
      });

      expect(httpClient.delete).toHaveBeenCalledWith('/api/v1/applications/my-app', {
        appNamespace: 'argocd',
        cascade: true,
        propagationPolicy: 'Foreground'
      });
    });

    it('syncApplication posts sync request with options', async () => {
      const { client, httpClient } = createClient();
      httpClient.post.mockResolvedValue({ body: fullApplication });

      await client.syncApplication('my-app', {
        dryRun: true,
        prune: false,
        revision: 'abc123'
      });

      expect(httpClient.post).toHaveBeenCalledWith(
        '/api/v1/applications/my-app/sync',
        null,
        expect.objectContaining({
          dryRun: true,
          prune: false,
          revision: 'abc123'
        })
      );
    });
  });
});

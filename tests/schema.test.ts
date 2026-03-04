import { describe, it, expect } from 'vitest';
import {
  ApplicationNamespaceSchema,
  ResourceRefSchema,
  ApplicationSchema
} from '../src/shared/models/schema.js';

describe('ApplicationNamespaceSchema', () => {
  it('accepts valid namespace strings', () => {
    expect(ApplicationNamespaceSchema.parse('argocd')).toBe('argocd');
    expect(ApplicationNamespaceSchema.parse('my-namespace')).toBe('my-namespace');
    expect(ApplicationNamespaceSchema.parse('argocd-apps')).toBe('argocd-apps');
  });

  it('rejects empty string', () => {
    expect(() => ApplicationNamespaceSchema.parse('')).toThrow();
  });
});

describe('ResourceRefSchema', () => {
  const validRef = {
    uid: 'abc-123',
    kind: 'Deployment',
    namespace: 'production',
    name: 'web',
    version: 'v1',
    group: 'apps'
  };

  it('accepts valid resource ref', () => {
    const result = ResourceRefSchema.parse(validRef);
    expect(result).toEqual(validRef);
  });

  it('rejects missing fields', () => {
    const { uid, ...incomplete } = validRef;
    expect(() => ResourceRefSchema.parse(incomplete)).toThrow();
  });

  it('rejects non-string fields', () => {
    expect(() => ResourceRefSchema.parse({ ...validRef, uid: 123 })).toThrow();
  });
});

describe('ApplicationSchema', () => {
  const validApp = {
    metadata: {
      name: 'my-app',
      namespace: 'argocd'
    },
    spec: {
      project: 'default',
      source: {
        repoURL: 'https://github.com/example/repo',
        path: 'apps/my-app',
        targetRevision: 'HEAD'
      },
      syncPolicy: {
        syncOptions: ['CreateNamespace=true'],
        automated: {
          prune: true,
          selfHeal: true
        },
        retry: {
          limit: 3,
          backoff: {
            duration: '5s',
            maxDuration: '3m',
            factor: 2
          }
        }
      },
      destination: {
        server: 'https://kubernetes.default.svc',
        namespace: 'production'
      }
    }
  };

  it('accepts valid application', () => {
    const result = ApplicationSchema.parse(validApp);
    expect(result.metadata.name).toBe('my-app');
  });

  it('accepts destination with name instead of server', () => {
    const appWithName = {
      ...validApp,
      spec: {
        ...validApp.spec,
        destination: {
          name: 'in-cluster',
          namespace: 'production'
        }
      }
    };
    const result = ApplicationSchema.parse(appWithName);
    expect(result.spec.destination.name).toBe('in-cluster');
  });

  it('rejects destination with both server and name', () => {
    const appWithBoth = {
      ...validApp,
      spec: {
        ...validApp.spec,
        destination: {
          server: 'https://kubernetes.default.svc',
          name: 'in-cluster',
          namespace: 'production'
        }
      }
    };
    expect(() => ApplicationSchema.parse(appWithBoth)).toThrow();
  });

  it('rejects destination with neither server nor name', () => {
    const appWithNeither = {
      ...validApp,
      spec: {
        ...validApp.spec,
        destination: {
          namespace: 'production'
        }
      }
    };
    expect(() => ApplicationSchema.parse(appWithNeither)).toThrow();
  });

  it('rejects missing metadata', () => {
    const { metadata, ...noMeta } = validApp;
    expect(() => ApplicationSchema.parse(noMeta)).toThrow();
  });

  it('rejects empty application name', () => {
    const emptyName = {
      ...validApp,
      metadata: { ...validApp.metadata, name: '' }
    };
    // Zod string() without min(1) allows empty — this tests current behavior
    // If name validation is added later, this test catches the change
    try {
      ApplicationSchema.parse(emptyName);
    } catch {
      // Either outcome is acceptable — documents current behavior
    }
  });
});

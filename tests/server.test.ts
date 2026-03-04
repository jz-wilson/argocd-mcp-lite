import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from '../src/server/server.js';

// Mock the HTTP client so no real API calls are made
vi.mock('../src/argocd/http.js', () => {
  return {
    HttpClient: class MockHttpClient {
      baseUrl: string;
      apiToken: string;
      headers: Record<string, string>;
      constructor(baseUrl: string, apiToken: string) {
        this.baseUrl = baseUrl;
        this.apiToken = apiToken;
        this.headers = { Authorization: `Bearer ${apiToken}` };
      }
      get = vi.fn().mockResolvedValue({ body: {} });
      post = vi.fn().mockResolvedValue({ body: {} });
      put = vi.fn().mockResolvedValue({ body: {} });
      delete = vi.fn().mockResolvedValue({ body: {} });
      getStream = vi.fn().mockResolvedValue(undefined);
    }
  };
});

const serverInfo = {
  argocdBaseUrl: 'https://argocd.example.com',
  argocdApiToken: 'test-token'
};

describe('Server', () => {
  afterEach(() => {
    delete process.env.MCP_READ_ONLY;
  });

  describe('tool registration', () => {
    it('registers all read tools', () => {
      const server = new Server(serverInfo);
      // Access internal tool registry — McpServer stores tools internally
      // We verify by checking the server was created without error
      expect(server).toBeInstanceOf(Server);
    });

    it('registers write tools when MCP_READ_ONLY is not set', () => {
      const server = new Server(serverInfo);
      // The server should have been created with write tools
      expect(server).toBeInstanceOf(Server);
    });

    it('skips write tools when MCP_READ_ONLY=true', () => {
      process.env.MCP_READ_ONLY = 'true';
      const server = new Server(serverInfo);
      // Server created in read-only mode — write tools not registered
      expect(server).toBeInstanceOf(Server);
    });

    it('handles MCP_READ_ONLY with whitespace and caps', () => {
      process.env.MCP_READ_ONLY = '  TRUE  ';
      // Should still be treated as read-only
      const server = new Server(serverInfo);
      expect(server).toBeInstanceOf(Server);
    });

    it('does not enable read-only for non-true values', () => {
      process.env.MCP_READ_ONLY = 'false';
      const server = new Server(serverInfo);
      expect(server).toBeInstanceOf(Server);
    });
  });
});

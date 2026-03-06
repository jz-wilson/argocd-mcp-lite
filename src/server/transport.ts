import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../logging/logging.js';
import { createServer } from './server.js';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

export const connectStdioTransport = () => {
  const argocdBaseUrl = process.env.ARGOCD_BASE_URL || '';
  const argocdApiToken = process.env.ARGOCD_API_TOKEN || '';

  if (!argocdBaseUrl) {
    logger.error('ARGOCD_BASE_URL environment variable is required but not set.');
    process.exit(1);
  }
  if (!argocdApiToken) {
    logger.error('ARGOCD_API_TOKEN environment variable is required but not set.');
    process.exit(1);
  }
  if (!argocdBaseUrl.startsWith('http://') && !argocdBaseUrl.startsWith('https://')) {
    logger.error(`ARGOCD_BASE_URL must start with http:// or https://, got: "${argocdBaseUrl}"`);
    process.exit(1);
  }

  const server = createServer({ argocdBaseUrl, argocdApiToken });

  logger.info('Connecting to stdio transport');
  server.connect(new StdioServerTransport());
};

export const connectSSETransport = (port: number) => {
  const app = express();
  const transports: { [sessionId: string]: SSEServerTransport } = {};

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/sse', async (req, res) => {
    const server = createServer({
      argocdBaseUrl: (req.headers['x-argocd-base-url'] as string) || '',
      argocdApiToken: (req.headers['x-argocd-api-token'] as string) || ''
    });

    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    res.on('close', () => {
      delete transports[transport.sessionId];
    });
    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send(`No transport found for sessionId: ${sessionId}`);
    }
  });

  logger.info(`Connecting to SSE transport on port: ${port}`);
  app.listen(port);
};

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

export const connectHttpTransport = (port: number) => {
  const app = express();
  app.use(express.json());

  const httpSessions: { [sessionId: string]: SessionEntry } = {};

  // Periodic cleanup of expired sessions
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of Object.entries(httpSessions)) {
      if (now - entry.lastActivity > SESSION_TTL_MS) {
        logger.info({ sessionId }, 'expiring idle session');
        entry.transport.close?.();
        delete httpSessions[sessionId];
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS).unref();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/mcp', async (req, res) => {
    const sessionIdFromHeader = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionIdFromHeader && httpSessions[sessionIdFromHeader]) {
      httpSessions[sessionIdFromHeader].lastActivity = Date.now();
      transport = httpSessions[sessionIdFromHeader].transport;
    } else if (!sessionIdFromHeader && isInitializeRequest(req.body)) {
      const argocdBaseUrl =
        (req.headers['x-argocd-base-url'] as string) || process.env.ARGOCD_BASE_URL || '';
      const argocdApiToken =
        (req.headers['x-argocd-api-token'] as string) || process.env.ARGOCD_API_TOKEN || '';

      if (argocdBaseUrl == '' || argocdApiToken == '') {
        res
          .status(400)
          .send('x-argocd-base-url and x-argocd-api-token must be provided in headers.');
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          httpSessions[newSessionId] = { transport, lastActivity: Date.now() };
        }
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete httpSessions[transport.sessionId];
        }
      };

      const server = createServer({
        argocdBaseUrl,
        argocdApiToken
      });

      await server.connect(transport);
    } else {
      const errorMsg = sessionIdFromHeader
        ? `Invalid or expired session ID: ${sessionIdFromHeader}`
        : 'Bad Request: Not an initialization request and no valid session ID provided.';
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: errorMsg
        },
        id: req.body?.id !== undefined ? req.body.id : null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !httpSessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    httpSessions[sessionId].lastActivity = Date.now();
    const transport = httpSessions[sessionId].transport;
    await transport.handleRequest(req, res);
  };

  app.get('/mcp', handleSessionRequest);
  app.delete('/mcp', handleSessionRequest);

  logger.info(`Connecting to Http Stream transport on port: ${port}`);
  app.listen(port);
};

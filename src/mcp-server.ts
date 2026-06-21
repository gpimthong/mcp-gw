import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { ToolAggregator } from './tool-aggregator.js';
import { logger } from './logger.js';
import { VERSION } from './version.js';

const sessions = new Map<string, StreamableHTTPServerTransport>();

function makeServer(aggregator: ToolAggregator): Server {
  const server = new Server(
    { name: 'mcp-gateway', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: aggregator.listAllTools(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<any> => {
    const { name, arguments: args } = req.params;
    try {
      return await aggregator.callTool(name, args as Record<string, unknown>);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}

export function mountMcpRoutes(app: Express, aggregator: ToolAggregator): void {
  const handlePost = async (req: Request, res: Response): Promise<void> => {
    if (req.body?.method === 'initialize') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const server = makeServer(aggregator);

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          logger.system(`MCP session closed: ${transport.sessionId}`);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, transport);
        logger.system(`MCP session opened: ${transport.sessionId} (${sessions.size} active)`);
      }
      return;
    }

    const sid = req.headers['mcp-session-id'] as string | undefined;
    if (!sid) { res.status(400).json({ error: 'Missing mcp-session-id' }); return; }
    const transport = sessions.get(sid);
    if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
    await transport.handleRequest(req, res, req.body);
  };

  const handleGet = (req: Request, res: Response): void => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    if (!sid) { res.status(400).json({ error: 'Missing mcp-session-id' }); return; }
    const transport = sessions.get(sid);
    if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
    transport.handleRequest(req, res).catch((err: unknown) => {
      logger.log({ level: 'error', type: 'system', message: `MCP GET error: ${err instanceof Error ? err.message : String(err)}` });
    });
  };

  const handleDelete = async (req: Request, res: Response): Promise<void> => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    if (!sid) { res.status(400).json({ error: 'Missing mcp-session-id' }); return; }
    const transport = sessions.get(sid);
    if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
    await transport.handleRequest(req, res);
  };

  app.post('/mcp', (req, res) => { void handlePost(req, res); });
  app.get('/mcp', handleGet);
  app.delete('/mcp', (req, res) => { void handleDelete(req, res); });
}

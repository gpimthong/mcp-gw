import { BackendRegistry } from './backend-registry.js';
import { ToolAggregator } from './tool-aggregator.js';
import { createApp } from './dashboard.js';
import { mountMcpRoutes } from './mcp-server.js';
import { loadBackends } from './config.js';
import { logger } from './logger.js';
import { VERSION } from './version.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  logger.system(`MCP Gateway v${VERSION} starting…`);

  const registry = new BackendRegistry();
  const aggregator = new ToolAggregator(registry);
  const app = createApp(registry, aggregator);
  mountMcpRoutes(app, aggregator);

  const saved = loadBackends().filter(b => b.enabled);
  logger.system(`Loading ${saved.length} saved backend(s)`);
  for (const cfg of saved) await registry.connect(cfg);

  const server = app.listen(PORT, () => {
    logger.system(`Listening on :${PORT}`);
    logger.system(`Dashboard  → http://localhost:${PORT}/`);
    logger.system(`MCP HTTP   → http://localhost:${PORT}/mcp`);
  });

  const shutdown = async (): Promise<void> => {
    logger.system('Shutting down…');
    await registry.shutdown();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

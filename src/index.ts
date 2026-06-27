import { BackendRegistry } from './backend-registry.js';
import { ToolAggregator } from './tool-aggregator.js';
import { RagManager } from './rag/manager.js';
import { setCacheDir } from './rag/embedder.js';
import { setDataDir } from './rag/store.js';
import { createApp } from './dashboard.js';
import { mountMcpRoutes } from './mcp-server.js';
import { loadBackends } from './config.js';
import { logger } from './logger.js';
import { VERSION } from './version.js';
import { join } from 'path';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DATA_DIR = process.env.RAG_DATA_DIR ?? join(process.cwd(), 'data');

async function main(): Promise<void> {
  logger.system(`MCP Gateway v${VERSION} starting…`);

  setCacheDir(DATA_DIR);
  setDataDir(join(DATA_DIR, 'rag'));

  const registry = new BackendRegistry();
  const rag = new RagManager();
  await rag.init();

  const aggregator = new ToolAggregator(registry, rag);
  const app = createApp(registry, aggregator, rag);
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

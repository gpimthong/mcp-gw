import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BackendRegistry } from './backend-registry.js';
import type { ToolAggregator } from './tool-aggregator.js';
import { logger } from './logger.js';
import { loadBackends, saveBackends } from './config.js';
import type { BackendConfig, LogEntry } from './types.js';
import { VERSION } from './version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NAME_RE = /^[a-z0-9][a-z0-9\-_]*$/;

export function createApp(registry: BackendRegistry, aggregator: ToolAggregator): express.Express {
  const app = express();
  const startedAt = Date.now();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(join(__dirname, '../public')));

  app.get('/api/health', (_req, res) => {
    const tools = aggregator.listAllTools();
    const backends = registry.getAll();
    res.json({
      status: 'ok',
      version: VERSION,
      uptimeMs: Date.now() - startedAt,
      backendCount: backends.length,
      connectedBackends: backends.filter(b => b.status === 'connected').length,
      toolCount: tools.length,
    });
  });

  app.get('/api/backends', (_req, res) => {
    res.json(registry.getAll());
  });

  app.post('/api/backends', (req, res) => {
    void (async () => {
      const { name, url, transport } = req.body as Partial<BackendConfig>;
      if (!name || !url || !transport) {
        res.status(400).json({ error: 'name, url, transport are required' }); return;
      }
      if (!NAME_RE.test(name)) {
        res.status(400).json({ error: 'name must be lowercase alphanumeric/dash/underscore' }); return;
      }
      if (transport !== 'http' && transport !== 'sse') {
        res.status(400).json({ error: 'transport must be http or sse' }); return;
      }

      const config: BackendConfig = { name, url, transport, enabled: true };
      await registry.connect(config);

      const all = loadBackends();
      const idx = all.findIndex(b => b.name === name);
      if (idx >= 0) all[idx] = config; else all.push(config);
      saveBackends(all);

      res.json({ ok: true, backend: registry.getAll().find(b => b.name === name) });
    })();
  });

  app.delete('/api/backends/:name', (req, res) => {
    void (async () => {
      const { name } = req.params;
      await registry.disconnect(name);
      saveBackends(loadBackends().filter(b => b.name !== name));
      res.json({ ok: true });
    })();
  });

  app.post('/api/backends/:name/reconnect', (req, res) => {
    void (async () => {
      const { name } = req.params;
      const all = loadBackends();
      const config = all.find(b => b.name === name);
      if (!config) { res.status(404).json({ error: 'Backend not found in config' }); return; }
      await registry.connect(config);
      res.json({ ok: true, backend: registry.getAll().find(b => b.name === name) });
    })();
  });

  app.get('/api/logs', (_req, res) => {
    res.json({ entries: logger.getRecent(200) });
  });

  app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const onEntry = (entry: LogEntry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    logger.on('entry', onEntry);
    req.on('close', () => logger.off('entry', onEntry));
  });

  return app;
}

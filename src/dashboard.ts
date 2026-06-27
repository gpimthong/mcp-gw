import express from 'express';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BackendRegistry } from './backend-registry.js';
import type { ToolAggregator } from './tool-aggregator.js';
import type { RagManager } from './rag/manager.js';
import { logger } from './logger.js';
import { loadBackends, saveBackends } from './config.js';
import type { BackendConfig, LogEntry } from './types.js';
import { VERSION } from './version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NAME_RE = /^[a-z0-9][a-z0-9\-_]*$/;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function createApp(registry: BackendRegistry, aggregator: ToolAggregator, rag: RagManager): express.Express {
  const app = express();
  const startedAt = Date.now();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(join(__dirname, '../public')));

  // ── Health ─────────────────────────────────────────────────────────────────

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

  // ── Backends ───────────────────────────────────────────────────────────────

  app.get('/api/backends', (_req, res) => {
    res.json(registry.getAll());
  });

  app.post('/api/backends', (req, res) => {
    void (async () => {
      const { name, url, transport, headers } = req.body as Partial<BackendConfig>;
      if (!name || !url || !transport) {
        res.status(400).json({ error: 'name, url, transport are required' }); return;
      }
      if (!NAME_RE.test(name)) {
        res.status(400).json({ error: 'name must be lowercase alphanumeric/dash/underscore' }); return;
      }
      if (transport !== 'http' && transport !== 'sse') {
        res.status(400).json({ error: 'transport must be http or sse' }); return;
      }

      const config: BackendConfig = { name, url, transport, enabled: true, ...(headers && { headers }) };
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

  // ── Logs ───────────────────────────────────────────────────────────────────

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

  // ── RAG ────────────────────────────────────────────────────────────────────

  app.get('/api/rag/kbs', (_req, res) => {
    res.json(rag.getKbs());
  });

  app.post('/api/rag/kbs', (req, res) => {
    void (async () => {
      const { id, name, description } = req.body as { id?: string; name?: string; description?: string };
      if (!id || !name) { res.status(400).json({ error: 'id and name are required' }); return; }
      if (!NAME_RE.test(id)) { res.status(400).json({ error: 'id must be lowercase alphanumeric/dash/underscore' }); return; }
      try {
        const kb = await rag.createKb(id, name, description ?? '');
        res.json({ ok: true, kb });
      } catch (err) {
        res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  app.delete('/api/rag/kbs/:id', (req, res) => {
    void (async () => {
      await rag.deleteKb(req.params.id);
      res.json({ ok: true });
    })();
  });

  app.get('/api/rag/kbs/:id/docs', (req, res) => {
    const docs = rag.getDocs(req.params.id);
    res.json(docs);
  });

  app.post('/api/rag/kbs/:id/docs', upload.single('file'), (req, res) => {
    void (async () => {
      const kbId = req.params.id;
      const source = req.body.source as string;

      try {
        let doc;
        if (source === 'paste') {
          const { title, text } = req.body as { title?: string; text?: string };
          if (!text) { res.status(400).json({ error: 'text is required' }); return; }
          doc = await rag.addDoc(kbId, { source: 'paste', title: title ?? 'Untitled', text });
        } else if (source === 'url') {
          const { url } = req.body as { url?: string };
          if (!url) { res.status(400).json({ error: 'url is required' }); return; }
          doc = await rag.addDoc(kbId, { source: 'url', url });
        } else if (source === 'upload') {
          if (!req.file) { res.status(400).json({ error: 'file is required' }); return; }
          doc = await rag.addDoc(kbId, {
            source: 'upload',
            title: req.body.title ?? req.file.originalname,
            filename: req.file.originalname,
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
          });
        } else {
          res.status(400).json({ error: 'source must be paste, url, or upload' }); return;
        }
        res.json({ ok: true, doc });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  app.patch('/api/rag/kbs/:id/docs/:docId', upload.single('file'), (req, res) => {
    void (async () => {
      const { id, docId } = req.params;
      const source = req.body.source as string;
      try {
        let doc;
        if (source === 'paste') {
          const { title, text } = req.body as { title?: string; text?: string };
          if (!text) { res.status(400).json({ error: 'text is required' }); return; }
          doc = await rag.replaceDoc(id, docId, { source: 'paste', title: title ?? 'Untitled', text });
        } else if (source === 'url') {
          const { url } = req.body as { url?: string };
          if (!url) { res.status(400).json({ error: 'url is required' }); return; }
          doc = await rag.replaceDoc(id, docId, { source: 'url', url });
        } else if (source === 'upload') {
          if (!req.file) { res.status(400).json({ error: 'file is required' }); return; }
          doc = await rag.replaceDoc(id, docId, {
            source: 'upload',
            title: req.body.title ?? req.file.originalname,
            filename: req.file.originalname,
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
          });
        } else {
          res.status(400).json({ error: 'source must be paste, url, or upload' }); return;
        }
        res.json({ ok: true, doc });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  app.delete('/api/rag/kbs/:id/docs/:docId', (req, res) => {
    void (async () => {
      const { id, docId } = req.params;
      try {
        await rag.removeDoc(id, docId);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  app.post('/api/rag/kbs/:id/query', (req, res) => {
    void (async () => {
      const { query, top_k } = req.body as { query?: string; top_k?: number };
      if (!query) { res.status(400).json({ error: 'query is required' }); return; }
      try {
        const results = await rag.query(req.params.id, query, top_k ?? 5);
        res.json({ results });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  return app;
}

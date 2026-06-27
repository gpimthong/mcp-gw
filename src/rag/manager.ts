import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { embedBatch } from './embedder.js';
import { chunkText } from './chunker.js';
import { scrapeUrl } from './scraper.js';
import { listKbIds, loadKbStore, saveKbStore, deleteKbStore } from './store.js';
import type { KnowledgeBase, RagDocument, RagChunk, KbStore, QueryResult } from './types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger.js';

const require = createRequire(import.meta.url);

const RAG_PREFIX = 'rag__';

export type AddDocOpts =
  | { source: 'paste'; title: string; text: string }
  | { source: 'upload'; title: string; filename: string; buffer: Buffer; mimetype: string }
  | { source: 'url'; url: string };

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function extractText(opts: AddDocOpts): Promise<{ title: string; sourceRef: string; text: string }> {
  if (opts.source === 'paste') {
    return { title: opts.title, sourceRef: 'paste', text: opts.text };
  }
  if (opts.source === 'url') {
    const { title, text } = await scrapeUrl(opts.url);
    return { title, sourceRef: opts.url, text };
  }
  // file upload
  const { title, filename, buffer, mimetype } = opts;
  if (mimetype === 'application/pdf' || filename.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return { title: title || filename, sourceRef: filename, text: data.text };
  }
  return { title: title || filename, sourceRef: filename, text: buffer.toString('utf-8') };
}

export class RagManager {
  private stores = new Map<string, KbStore>();

  async init(): Promise<void> {
    for (const id of listKbIds()) {
      const store = loadKbStore(id);
      if (store) this.stores.set(id, store);
    }
    logger.system(`RAG: loaded ${this.stores.size} knowledge base(s)`);
  }

  getKbs(): KnowledgeBase[] {
    return Array.from(this.stores.values()).map(s => s.kb);
  }

  getKb(id: string): KnowledgeBase | null {
    return this.stores.get(id)?.kb ?? null;
  }

  getDocs(kbId: string): RagDocument[] {
    return this.stores.get(kbId)?.docs ?? [];
  }

  getTools(): Tool[] {
    return this.getKbs().map(kb => ({
      name: `${RAG_PREFIX}${kb.id}`,
      description: `[rag] Search the "${kb.name}" knowledge base. ${kb.description}`.trimEnd(),
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          top_k: { type: 'number', description: 'Max results to return (default: 5)' },
        },
        required: ['query'],
      },
    }));
  }

  isRagTool(name: string): boolean {
    return name.startsWith(RAG_PREFIX);
  }

  async createKb(id: string, name: string, description: string): Promise<KnowledgeBase> {
    if (this.stores.has(id)) throw new Error(`Knowledge base "${id}" already exists`);
    const kb: KnowledgeBase = { id, name, description, createdAt: new Date().toISOString(), docCount: 0, chunkCount: 0 };
    const store: KbStore = { kb, docs: [], chunks: [] };
    this.stores.set(id, store);
    saveKbStore(store);
    logger.system(`RAG: created KB "${id}"`);
    return kb;
  }

  async deleteKb(id: string): Promise<void> {
    this.stores.delete(id);
    deleteKbStore(id);
    logger.system(`RAG: deleted KB "${id}"`);
  }

  async addDoc(kbId: string, opts: AddDocOpts): Promise<RagDocument> {
    const store = this.stores.get(kbId);
    if (!store) throw new Error(`Knowledge base "${kbId}" not found`);

    const { title, sourceRef, text } = await extractText(opts);
    if (!text.trim()) throw new Error('Document has no extractable text');

    const chunks = chunkText(text);
    logger.system(`RAG: embedding ${chunks.length} chunks for "${title}" in KB "${kbId}"…`);
    const embeddings = await embedBatch(chunks);

    const docId = randomUUID();
    const doc: RagDocument = {
      id: docId,
      kbId,
      title,
      source: opts.source,
      sourceRef,
      addedAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };

    const newChunks: RagChunk[] = chunks.map((text, i) => ({
      id: randomUUID(),
      docId,
      text,
      embedding: embeddings[i],
    }));

    store.docs.push(doc);
    store.chunks.push(...newChunks);
    store.kb.docCount = store.docs.length;
    store.kb.chunkCount = store.chunks.length;
    saveKbStore(store);
    logger.system(`RAG: added doc "${title}" (${chunks.length} chunks) to KB "${kbId}"`);
    return doc;
  }

  async removeDoc(kbId: string, docId: string): Promise<void> {
    const store = this.stores.get(kbId);
    if (!store) throw new Error(`Knowledge base "${kbId}" not found`);
    store.chunks = store.chunks.filter(c => c.docId !== docId);
    store.docs = store.docs.filter(d => d.id !== docId);
    store.kb.docCount = store.docs.length;
    store.kb.chunkCount = store.chunks.length;
    saveKbStore(store);
  }

  async replaceDoc(kbId: string, docId: string, opts: AddDocOpts): Promise<RagDocument> {
    const store = this.stores.get(kbId);
    if (!store) throw new Error(`Knowledge base "${kbId}" not found`);

    const existing = store.docs.find(d => d.id === docId);
    if (!existing) throw new Error(`Document "${docId}" not found in KB "${kbId}"`);

    const { title, sourceRef, text } = await extractText(opts);
    if (!text.trim()) throw new Error('Replacement content has no extractable text');

    const chunks = chunkText(text);
    logger.system(`RAG: re-embedding ${chunks.length} chunks for "${title}" in KB "${kbId}"…`);
    const embeddings = await embedBatch(chunks);

    store.chunks = store.chunks.filter(c => c.docId !== docId);
    store.chunks.push(...chunks.map((t, i) => ({ id: randomUUID(), docId, text: t, embedding: embeddings[i] })));

    existing.title = title || existing.title;
    existing.source = opts.source;
    existing.sourceRef = sourceRef;
    existing.chunkCount = chunks.length;

    store.kb.chunkCount = store.chunks.length;
    saveKbStore(store);
    logger.system(`RAG: replaced doc "${existing.title}" (${chunks.length} chunks) in KB "${kbId}"`);
    return existing;
  }

  async query(kbId: string, query: string, topK = 5): Promise<QueryResult[]> {
    const store = this.stores.get(kbId);
    if (!store) throw new Error(`Knowledge base "${kbId}" not found`);
    if (!store.chunks.length) return [];

    const [qEmbed] = await embedBatch([query]);
    const docMap = new Map(store.docs.map(d => [d.id, d]));

    return store.chunks
      .map(c => ({ c, score: cosineSim(qEmbed, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ c, score }) => ({
        text: c.text,
        score,
        docTitle: docMap.get(c.docId)?.title ?? 'Unknown',
        docId: c.docId,
      }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const kbId = name.slice(RAG_PREFIX.length);
    const query = String(args.query ?? '');
    const topK = typeof args.top_k === 'number' ? Math.min(args.top_k, 20) : 5;

    if (!query) throw new Error('query is required');

    const t0 = Date.now();
    logger.log({ level: 'info', type: 'tool_call', backend: 'rag', tool: kbId, message: `→ rag::${kbId} query="${query}"`, data: args });

    const results = await this.query(kbId, query, topK);
    const durationMs = Date.now() - t0;

    logger.log({ level: 'info', type: 'tool_result', backend: 'rag', tool: kbId, durationMs, status: 'ok', message: `← rag::${kbId} OK ${durationMs}ms (${results.length} results)` });

    const text = results.length
      ? results.map((r, i) => `[${i + 1}] ${r.docTitle} (score: ${r.score.toFixed(3)})\n${r.text}`).join('\n\n---\n\n')
      : 'No relevant results found.';

    return { content: [{ type: 'text', text }] };
  }
}

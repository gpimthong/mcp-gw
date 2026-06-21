import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { BackendConfig, BackendState, Tool } from './types.js';
import { logger } from './logger.js';

const HEARTBEAT_MS = 30_000;
const CLIENT_INFO = { name: 'mcp-gateway', version: '1.0.0' };

export class BackendRegistry {
  private backends = new Map<string, BackendState>();
  private timers = new Map<string, NodeJS.Timeout>();

  async connect(config: BackendConfig): Promise<void> {
    if (this.backends.has(config.name)) await this.disconnect(config.name);

    const state: BackendState = {
      ...config,
      client: null,
      tools: [],
      status: 'connecting',
      latencyMs: null,
      lastPingAt: null,
      error: null,
    };
    this.backends.set(config.name, state);
    logger.backendEvent(config.name, `Connecting → ${config.url}`);

    try {
      const client = new Client(CLIENT_INFO, { capabilities: {} });
      const transport = config.transport === 'sse'
        ? new SSEClientTransport(new URL(config.url))
        : new StreamableHTTPClientTransport(new URL(config.url));

      await client.connect(transport);
      state.client = client;

      await this._ping(config.name);

      const timer = setInterval(() => { void this._ping(config.name); }, HEARTBEAT_MS);
      this.timers.set(config.name, timer);

      logger.backendEvent(config.name, `Connected — ${state.tools.length} tools`);
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
      logger.backendEvent(config.name, `Failed: ${state.error}`, 'error');
    }
  }

  private async _ping(name: string): Promise<void> {
    const state = this.backends.get(name);
    if (!state?.client) return;
    const t0 = Date.now();
    try {
      const res = await state.client.listTools();
      state.tools = res.tools as Tool[];
      state.status = 'connected';
      state.latencyMs = Date.now() - t0;
      state.lastPingAt = new Date().toISOString();
      state.error = null;
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
      state.latencyMs = null;
      logger.backendEvent(name, `Heartbeat failed: ${state.error}`, 'warn');
    }
  }

  async disconnect(name: string): Promise<void> {
    const timer = this.timers.get(name);
    if (timer) { clearInterval(timer); this.timers.delete(name); }
    const state = this.backends.get(name);
    if (state?.client) { try { await state.client.close(); } catch { /* ignore */ } }
    this.backends.delete(name);
    logger.backendEvent(name, 'Disconnected');
  }

  getAll(): Omit<BackendState, 'client'>[] {
    return Array.from(this.backends.values()).map(({ client: _c, ...rest }) => rest);
  }

  getClient(name: string): Client | null {
    return this.backends.get(name)?.client ?? null;
  }

  getAllConnected(): { name: string; tools: Tool[] }[] {
    return Array.from(this.backends.values())
      .filter(s => s.status === 'connected')
      .map(s => ({ name: s.name, tools: s.tools }));
  }

  async shutdown(): Promise<void> {
    for (const name of [...this.backends.keys()]) await this.disconnect(name);
  }
}

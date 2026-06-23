import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export type { Tool };

export interface BackendConfig {
  name: string;
  url: string;
  transport: 'http' | 'sse';
  enabled: boolean;
  headers?: Record<string, string>;
}

export interface BackendState extends BackendConfig {
  client: Client | null;
  tools: Tool[];
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  latencyMs: number | null;
  lastPingAt: string | null;
  error: string | null;
}

export interface LogEntry {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  type: 'tool_call' | 'tool_result' | 'backend_event' | 'system';
  backend?: string;
  tool?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  message: string;
  data?: unknown;
}

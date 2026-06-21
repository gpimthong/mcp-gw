import { EventEmitter } from 'events';
import type { LogEntry } from './types.js';

class CircularBuffer<T> {
  private items: T[] = [];
  constructor(private max: number) {}
  push(item: T) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(item);
  }
  getRecent(n: number): T[] { return this.items.slice(-n); }
}

class Logger extends EventEmitter {
  private buf = new CircularBuffer<LogEntry>(1000);
  private counter = 0;

  log(entry: Omit<LogEntry, 'id' | 'ts'>): LogEntry {
    const full: LogEntry = { id: ++this.counter, ts: new Date().toISOString(), ...entry };
    this.buf.push(full);
    this.emit('entry', full);
    return full;
  }

  getRecent(n = 200): LogEntry[] { return this.buf.getRecent(n); }

  system(message: string, data?: unknown) {
    return this.log({ level: 'info', type: 'system', message, data });
  }

  backendEvent(backend: string, message: string, level: LogEntry['level'] = 'info', data?: unknown) {
    return this.log({ level, type: 'backend_event', backend, message, data });
  }
}

export const logger = new Logger();

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { BackendConfig } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH ?? '/app/config/backends.json';

export function loadBackends(): BackendConfig[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as { backends?: BackendConfig[] };
    return data.backends ?? [];
  } catch {
    return [];
  }
}

export function saveBackends(backends: BackendConfig[]): void {
  writeFileSync(CONFIG_PATH, JSON.stringify({ backends }, null, 2));
}

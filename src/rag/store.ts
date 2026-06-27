import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { KbStore } from './types.js';

let DATA_DIR = join(process.cwd(), 'data', 'rag');

export function setDataDir(dir: string): void {
  DATA_DIR = dir;
}

function kbDir(id: string): string {
  return join(DATA_DIR, id);
}

function storePath(id: string): string {
  return join(kbDir(id), 'store.json');
}

export function listKbIds(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

export function loadKbStore(id: string): KbStore | null {
  const p = storePath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as KbStore;
  } catch {
    return null;
  }
}

export function saveKbStore(store: KbStore): void {
  mkdirSync(kbDir(store.kb.id), { recursive: true });
  writeFileSync(storePath(store.kb.id), JSON.stringify(store));
}

export function deleteKbStore(id: string): void {
  const dir = kbDir(id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

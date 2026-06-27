import { pipeline, env } from '@xenova/transformers';
import { join } from 'path';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

env.allowLocalModels = true;
env.allowRemoteModels = true;

let _pipeline: Awaited<ReturnType<typeof pipeline>> | null = null;
let _loading: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null;

export function setCacheDir(dir: string): void {
  env.cacheDir = process.env.MODEL_CACHE_DIR ?? join(dir, 'models');
}

export async function warmup(): Promise<void> {
  await getPipeline();
}

async function getPipeline(): Promise<Awaited<ReturnType<typeof pipeline>>> {
  if (_pipeline) return _pipeline;
  if (_loading) return _loading;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _loading = pipeline('feature-extraction', MODEL, { quantized: true } as any);
  _pipeline = await _loading;
  _loading = null;
  return _pipeline;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = await getPipeline();
  const results: number[][] = [];
  for (const text of texts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await (model as any)(text.slice(0, 2048), { pooling: 'mean', normalize: true });
    results.push(Array.from(out.data as Float32Array));
  }
  return results;
}

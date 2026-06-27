import { pipeline, env } from '@xenova/transformers';
import { join } from 'path';

const cacheDir = process.env.MODEL_CACHE_DIR ?? join(process.cwd(), 'data', 'models');
env.cacheDir = cacheDir;
env.allowLocalModels = true;
env.allowRemoteModels = true;

console.log(`Downloading embedding model to ${cacheDir}…`);
await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
console.log('Model ready.');

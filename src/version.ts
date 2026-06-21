import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dir, '../package.json'), 'utf-8')) as { version: string };
export const VERSION: string = pkg.version;

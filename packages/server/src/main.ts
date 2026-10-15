/**
 * Production/dev entrypoint: `npm start` (or `node --experimental-strip-types
 * src/main.ts`). Configuration comes from the environment so the same artifact
 * runs locally and on the China-hosted box behind Nginx/HTTPS.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFtkServer } from './index.js';

const port = Number(process.env.PORT ?? 8000);

const origins = process.env.ORIGINS
  ? process.env.ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;

function defaultClientDir(): string | undefined {
  // packages/server/src -> packages/client/dist
  const guess = resolve(import.meta.dirname, '../../client/dist');
  return existsSync(guess) ? guess : undefined;
}

const clientDir = process.env.CLIENT_DIR
  ? resolve(process.env.CLIENT_DIR)
  : defaultClientDir();

// exactOptionalPropertyTypes: omit absent options rather than passing undefined.
const server = createFtkServer({
  ...(origins ? { origins } : {}),
  ...(clientDir ? { clientDir } : {}),
});

server.run(port, () => {
  console.log(`Feed the Kraken server listening on http://localhost:${port}`);
  if (clientDir) console.log(`  serving client from ${clientDir}`);
  else console.log('  no client build found (set CLIENT_DIR to serve one)');
});

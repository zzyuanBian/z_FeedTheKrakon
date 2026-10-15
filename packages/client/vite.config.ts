import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The client is served either by Vite (dev) or by @ftk/server (prod, from the
 * built `dist/`). During dev, `/games` and the Socket.IO path are proxied to
 * the game server so a browser session is same-origin — this matches the
 * production Nginx setup and keeps WSS/cookies simple.
 */
const serverTarget = process.env.FTK_SERVER ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ftk/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@ftk/game': fileURLToPath(new URL('../game/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/games': { target: serverTarget, changeOrigin: true, ws: true },
      '/socket.io': { target: serverTarget, changeOrigin: true, ws: true },
      '/ftk': { target: serverTarget, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});

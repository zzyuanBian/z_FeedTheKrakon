/**
 * @ftk/server — the game server.
 *
 * boardgame.io gives us the Lobby API (create/join a match, hand out player
 * credentials) and the Socket.IO transport. We add only the pieces the project
 * needs on top:
 *
 *   - a host "create match" shortcut that seeds the engine deterministically,
 *   - static serving of the built React client (with SPA fallback),
 *   - a single `npm start` entrypoint.
 *
 * Everything here is deliberately thin: rules live in @ftk/engine, the bgio
 * wiring in @ftk/game. This package owns process concerns only.
 */

import Koa from 'koa';
import Router from '@koa/router';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Server, Origins } from 'boardgame.io/server';
import { FtkGame, type FtkSetupData } from '@ftk/game';
import { createRoomCodeUuid } from './room-codes.js';

/** Credentials are bearer secrets — keep them long and random, unrelated to
 *  the human-readable room codes used as matchIDs. */
const generateCredentials = (): string => randomBytes(18).toString('base64url');

export interface FtkServerOptions {
  port?: number;
  /** Additional allowed browser origins. localhost is always allowed in dev. */
  origins?: string[];
  /** Directory of the built client to serve, if any. */
  clientDir?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Prefixes owned by the Lobby API and the socket transport. Static serving must
 * defer on these so the SPA fallback never swallows an API response. bgio adds
 * its routes lazily inside `server.run()`, i.e. after this middleware is
 * installed, so it is on us to stand aside for them.
 */
const RESERVED_PREFIXES = ['/games', '/socket.io', '/ftk'];

function isReserved(pathname: string): boolean {
  return RESERVED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Minimal static-file middleware with SPA fallback. Only files inside `root`
 * are ever served; `..` traversal is rejected by resolving and re-checking.
 */
function serveStatic(root: string) {
  const rootAbs = resolve(root);
  return async (ctx: Koa.Context, next: Koa.Next): Promise<void> => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
    if (isReserved(ctx.path)) return next();
    const urlPath = decodeURIComponent(ctx.path);
    const target = normalize(join(rootAbs, urlPath));
    if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return next();

    const file = resolveFile(target, rootAbs);
    if (file === null) return next();

    ctx.type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    ctx.body = readFileSync(file);
  };
}

/** Resolve to a real file, falling back to index.html for SPA routes. */
function resolveFile(target: string, rootAbs: string): string | null {
  try {
    if (existsSync(target) && statSync(target).isFile()) return target;
  } catch {
    /* fall through to the SPA fallback */
  }
  const index = join(rootAbs, 'index.html');
  return existsSync(index) ? index : null;
}

/** Build the bgio server without starting it. Handy for tests. */
export function createFtkServer(opts: FtkServerOptions = {}): ReturnType<typeof Server> {
  const server = Server({
    games: [FtkGame],
    origins: opts.origins ?? [Origins.LOCALHOST],
    // Match IDs are short, pronounceable 5-letter codes (e.g. `BAKUQ`) so
    // players can read them aloud / text them easily. Credentials stay as
    // long random tokens — they are bearer secrets, not human-readable ids.
    uuid: createRoomCodeUuid(),
    generateCredentials,
    // Keep matches in memory: a friends-only game does not need persistence,
    // and a restart cleanly accepts a new match.
  });

  // bgio types `app` with its own AppCtx (carrying `db`/`auth`); we only need
  // the generic Koa surface to bolt on middleware.
  const app = server.app as unknown as Koa;

  // A tiny lobby convenience: return the seat plan a client should expect.
  const router = new Router();
  router.get('/ftk/info', (ctx) => {
    ctx.body = {
      game: FtkGame.name,
      minPlayers: FtkGame.minPlayers,
      maxPlayers: FtkGame.maxPlayers,
      maps: ['short'],
    };
  });
  app.use(router.routes()).use(router.allowedMethods());

  if (opts.clientDir) {
    app.use(serveStatic(opts.clientDir));
  }

  return server;
}

export { FtkGame };
export type { FtkSetupData };

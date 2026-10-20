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
import koaBody from 'koa-body';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Server, Origins } from 'boardgame.io/server';
import { FtkGame, type FtkSetupData } from '@ftk/game';
import { createRoomCodeUuid } from './room-codes.js';

/** Credentials are bearer secrets — keep them long and random, unrelated to
 *  the human-readable room codes used as matchIDs. */
const generateCredentials = (): string => randomBytes(18).toString('base64url');

/** How many crew portraits the client ships (public/avatars/avatar-0..9.jpg).
 *  The avatar-uniqueness guard lifts once this many seats already hold one —
 *  an 11-seat room at the margin must be allowed to double up. Keep in sync
 *  with AVATARS in packages/client/src/Avatars.tsx. */
const AVATAR_POOL_SIZE = 10;

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
  // (The claim-by-name route is registered after the db wrappers below —
  // it needs the WRAPPED fetch/setMetadata pair.)
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

  // Duplicate-name guard.
  //
  // bgio's join handler (POST /games/:name/:id/join, registered lazily inside
  // server.run) does this:
  //   1. `const { metadata } = await db.fetch(matchID, { metadata: true });`
  //   2. `metadata.players[playerID].name = playerName;`   ← mutates in place
  //   3. `await db.setMetadata(matchID, metadata);`
  //
  // The InMemory connector's `fetch` returns the stored reference directly,
  // so step 2 mutates the "source of truth" even when step 3 never runs
  // (i.e. the join is rejected for any reason — including our own duplicate-
  // name guard). Subsequent joins then see phantom names from failed attempts
  // and get wrongly rejected.
  //
  // We fix this with two cooperating wrappers:
  //   (a) db.fetch returns a DEEP COPY of the metadata, so the handler
  //       mutates only its own local view.
  //   (b) db.setMetadata validates that every non-empty name in the incoming
  //       metadata appears exactly once, then stores that clean snapshot.
  //
  // Together they guarantee: db.metadata always reflects a fully-committed,
  // duplicate-free state, and each handler invocation works on an isolated
  // copy. The in-memory pollution problem goes away entirely.
  const koaApp = server.app as unknown as {
    context: {
      db?: {
        // Both methods on the InMemory adapter are SYNCHRONOUS, and bgio's
        // Master destructures fetch() results without await when the adapter
        // is sync-typed. Our wrappers must therefore stay synchronous too —
        // an `async` fetch would return a Promise, the destructuring would
        // yield `metadata: undefined`, and every sync would explode.
        setMetadata: (id: string, m: MetadataLike) => unknown;
        fetch: (
          id: string,
          opts?: { metadata?: boolean; state?: boolean; log?: boolean; initialState?: boolean },
        ) => { metadata?: MetadataLike; state?: unknown; log?: unknown; initialState?: unknown };
      };
    };
  };
  type MetadataLike = {
    players?: Record<string, {
      name?: string;
      credentials?: string;
      /** bgio's per-seat lobby blob. FTK stores the picked portrait here so
       *  every joiner can see which avatars are already claimed. */
      data?: { avatarId?: number };
    }>;
  };
  const db = koaApp.context.db;
  if (db) {
    const originalFetch = db.fetch.bind(db);
    const originalSetMetadata = db.setMetadata.bind(db);

    db.fetch = (matchID, opts) => {
      const result = originalFetch(matchID, opts);
      if (result?.metadata) {
        // structuredClone gives a value-independent copy that preserves
        // `undefined` slots (a JSON round-trip would drop `name: undefined`
        // on empty seats). Without this clone the InMemory connector hands
        // out its stored reference, and a REJECTED join still mutates the
        // source of truth via the handler's in-place
        // `metadata.players[id].name = playerName` — polluting every
        // subsequent read with phantom names.
        result.metadata = structuredClone(result.metadata) as MetadataLike;
      }
      return result;
    };

    db.setMetadata = (matchID: string, metadata: MetadataLike) => {
      if (metadata?.players) {
        const seen = new Set<string>();
        for (const p of Object.values(metadata.players)) {
          const n = (p?.name ?? '').trim().toLowerCase();
          if (!n) continue;
          if (seen.has(n)) {
            // Sync throw inside the awaited join handler surfaces as a Koa
            // error; `status` makes it a 409 response and `expose` ships the
            // message body instead of Koa's bare "Conflict" default.
            const err = new Error('该昵称已被占用，换一个吧') as Error & { status?: number; expose?: boolean };
            err.status = 409;
            err.expose = true;
            throw err;
          }
          seen.add(n);
        }
        // Same hard guarantee for avatars: a seat may only claim an avatarId
        // that no OTHER seat already holds. The client picker greys taken ids
        // out (via getMatch), this is the race-proof backstop — two players
        // tapping the same portrait at the same moment resolve to one winner.
        // 10 portraits, 11 possible seats: a duplicate is ALLOWED once every
        // portrait is taken (the seat count exceeds the pool), mirroring the
        // client's pickAvatarId fallback.
        const owners = new Map<number, string>();
        for (const [seatId, p] of Object.entries(metadata.players)) {
          const a = p?.data?.avatarId;
          if (typeof a !== 'number' || a < 0) continue;
          const prev = owners.get(a);
          if (prev !== undefined) {
            const distinct = owners.size;
            if (distinct < AVATAR_POOL_SIZE) {
              const err = new Error('该头像已被其他船员选用，换一个吧') as Error & { status?: number; expose?: boolean };
              err.status = 409;
              err.expose = true;
              throw err;
            }
            // Pool exhausted: every portrait is owned, so this duplicate is
            // the only way to seat an 11th player. Keep walking.
          } else {
            owners.set(a, seatId);
          }
        }
      }
      return originalSetMetadata(matchID, metadata);
    };
  }

  // Claim a seat by display name (friends-table reconnect, no PIN): a player
  // who lost their session (new device, cleared storage, 换桌) types the same
  // nickname + room code and gets the ORIGINAL seat back — the credential is
  // re-issued for that seat, so they take over their old body: same role
  // card, guns, resumes, everything. Names are unique per room (the guard
  // above), so the name IS the identity. Registered AFTER the wrappers so it
  // uses the wrapped fetch/setMetadata pair. bgio's auth compares the
  // credential presented on each action against the one stored in metadata,
  // so persisting the new credential here instantly re-arms the seat.
  const claim = new Router();
  // koa-body is mounted per-route by bgio too — the global middleware chain
  // never parses JSON bodies, so /ftk/claim parses its own.
  claim.post('/ftk/claim', koaBody(), (ctx) => {
    // bgio's AppCtx Request type doesn't declare `body` (koa-body adds it at
    // runtime); read it through a loose cast.
    const body = (ctx.request as unknown as {
      body?: { matchID?: string; playerName?: string };
    }).body;
    const matchID = String(body?.matchID ?? '');
    const playerName = String(body?.playerName ?? '').trim();
    if (!matchID || !playerName) {
      ctx.status = 400;
      ctx.body = { error: 'matchID 与昵称必填' };
      return;
    }
    if (!db) {
      ctx.status = 500;
      ctx.body = { error: '服务器存储不可用' };
      return;
    }
    const { metadata } = db.fetch(matchID, { metadata: true });
    const players = metadata?.players ?? {};
    const seatId = Object.keys(players).find(
      (id) => (players[id]?.name ?? '').trim().toLowerCase() === playerName.toLowerCase(),
    );
    if (!seatId) {
      ctx.status = 404;
      ctx.body = { error: '房间里没有这个昵称' };
      return;
    }
    // Re-issue the seat's bearer credential. The setMetadata guard only
    // rejects duplicate NAMES; this write keeps its own name exactly once.
    const credentials = generateCredentials();
    const updated = structuredClone(metadata) as MetadataLike;
    updated.players![seatId] = { ...updated.players![seatId], credentials };
    db.setMetadata(matchID, updated);
    // The portrait travels with the seat: a claimer on a fresh device gets
    // their old avatar back (it stayed in the lobby metadata all along).
    const avatarId = updated.players![seatId]?.data?.avatarId;
    ctx.body = {
      playerID: seatId,
      credentials,
      ...(typeof avatarId === 'number' ? { avatarId } : {}),
    };
  });
  app.use(claim.routes()).use(claim.allowedMethods());

  return server;
}

export { FtkGame };
export type { FtkSetupData };

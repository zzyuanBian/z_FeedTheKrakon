/**
 * Server integration test.
 *
 * Boots a real boardgame.io server on an ephemeral port, creates a match, then
 * connects N Socket.IO clients — one per seat — and plays a full appointment.
 * This is the end-to-end proof of the three things the project depends on:
 *
 *   1. the Lobby API creates a seeded match,
 *   2. every player receives ONLY their own `playerView` (no leaked teams),
 *   3. a move sent by the captain is applied and broadcast to everyone.
 *
 * Skipped on Windows CI when sockets cannot bind; run locally for the real check.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'boardgame.io/client';
import { SocketIO as SocketIOClient } from 'boardgame.io/multiplayer';
import { FtkGame } from '@ftk/game';
import { createFtkServer } from '../src/index.js';

const PORT = 8123;
const ORIGIN = `http://localhost:${PORT}`;
const PLAYERS = 7;

/** A throwaway client build so static-serving (and its route ordering) is exercised. */
const CLIENT_FIXTURE = mkdtempSync(join(tmpdir(), 'ftk-client-'));
writeFileSync(join(CLIENT_FIXTURE, 'index.html'), '<!doctype html><title>ftk-fixture</title>');

interface PlayerViewLite {
  phase: string;
  officers: { captain: string; lieutenant: string | null };
  you: { id: string; team: string; alive: boolean; offDuty: boolean; roleConfirmed?: boolean };
  others: { id: string; alive: boolean; offDuty: boolean }[];
  roleConfirmations?: { confirmed: number; total: number };
}

let server: ReturnType<typeof createFtkServer>;
let servers: Awaited<ReturnType<ReturnType<typeof createFtkServer>['run']>>;
let clients: ReturnType<typeof Client>[] = [];

async function createMatch(): Promise<string> {
  const res = await fetch(`${ORIGIN}/games/feed-the-kraken/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: PLAYERS, setupData: { seed: 5150, playerCount: PLAYERS } }),
  });
  const body = (await res.json()) as { matchID: string };
  return body.matchID;
}

beforeAll(async () => {
  server = createFtkServer({ origins: [ORIGIN], clientDir: CLIENT_FIXTURE });
  servers = await server.run(PORT);
}, 20000);

afterAll(() => {
  for (const c of clients) c.stop();
  server.kill(servers);
});

describe('multiplayer end to end', () => {
  it('does not let static serving shadow the Lobby API', async () => {
    // Regression: bgio registers /games lazily in run(), after our middleware,
    // so a naive SPA fallback swallows it and returns index.html.
    const res = await fetch(`${ORIGIN}/games`);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toContain('feed-the-kraken');

    const spa = await fetch(`${ORIGIN}/some/spa/route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('ftk-fixture');
  });

  it('enforces per-room avatar uniqueness and returns the avatar on claim', async () => {
    const matchID = await createMatch();
    const joinSeat = async (seat: string, name: string, avatarId: number) =>
      fetch(`${ORIGIN}/games/feed-the-kraken/${matchID}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerID: seat, playerName: name, data: { avatarId } }),
      });

    // Two seats, same portrait → the second join must 409 (plain-text body
    // via Koa's expose flag — LobbyClient surfaces it as error.details).
    const first = await joinSeat('0', '阿瓦', 3);
    expect(first.status).toBe(200);
    const dup = await joinSeat('1', '小黑', 3);
    expect(dup.status).toBe(409);
    expect(await dup.text()).toContain('头像');

    // A DIFFERENT portrait joins fine, and getMatch exposes the claimed ids
    // (credentials stripped) so late joiners can grey taken portraits out.
    const second = await joinSeat('1', '小黑', 7);
    expect(second.status).toBe(200);
    const matchRes = await fetch(`${ORIGIN}/games/feed-the-kraken/${matchID}`);
    const match = (await matchRes.json()) as {
      players: { id: number; name?: string; data?: { avatarId?: number } }[];
    };
    const avatars = match.players
      .filter((p) => p.name)
      .map((p) => p.data?.avatarId)
      .sort();
    expect(avatars).toEqual([3, 7]);

    // Claim by name re-issues the seat AND returns its original portrait.
    const claim = await fetch(`${ORIGIN}/ftk/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchID, playerName: '阿瓦' }),
    });
    expect(claim.status).toBe(200);
    const claimed = (await claim.json()) as { playerID: string; avatarId?: number };
    expect(claimed.playerID).toBe('0');
    expect(claimed.avatarId).toBe(3);
  });

  it('filters secrets per player and applies the captain’s appointment', async () => {
    const matchID = await createMatch();

    clients = Array.from({ length: PLAYERS }, (_, i) =>
      Client({
        game: FtkGame,
        multiplayer: SocketIOClient({ server: ORIGIN }),
        matchID,
        playerID: String(i),
      } as never),
    );
    for (const c of clients) c.start();

    // Every client must reach a connected, synced state with a per-player view.
    const views: PlayerViewLite[] = [];
    for (let i = 0; i < 100 && views.length < PLAYERS; i++) {
      views.length = 0;
      for (const c of clients) {
        const st = c.getState();
        if (st?.isConnected && st.G) views.push(st.G as PlayerViewLite);
      }
      if (views.length < PLAYERS) await new Promise((r) => setTimeout(r, 25));
    }
    expect(views).toHaveLength(PLAYERS);

    // Secrecy: each view exposes only the viewer's own team.
    for (const v of views) {
      expect(v.you).toHaveProperty('team');
      for (const o of v.others) expect(o).not.toHaveProperty('team');
    }

    // All views agree on who the captain is.
    const captain = views[0]!.officers.captain;
    expect(views.every((v) => v.officers.captain === captain)).toBe(true);

    // Every seat must acknowledge their role before any in-game move is legal
    // (the Avalon-style role-reveal gate enforced by @ftk/game's move filter).
    // Fire confirms one at a time and wait for the state to advance; bgio
    // rejects moves whose stateID has already been bumped by a peer's move,
    // so firing them in parallel would race and drop some.
    for (let i = 0; i < clients.length; i++) {
      clients[i]!.moves.confirmRole!();
      let acked = false;
      for (let k = 0; k < 100 && !acked; k++) {
        const st = clients[i]!.getState();
        if ((st?.G as PlayerViewLite | undefined)?.you.roleConfirmed === true) {
          acked = true;
        } else {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      expect(acked).toBe(true);
    }
    let allConfirmed = false;
    for (let i = 0; i < 100 && !allConfirmed; i++) {
      const states = clients.map((c) => c.getState()?.G as PlayerViewLite | undefined);
      allConfirmed = states.every((s) => s?.roleConfirmations?.confirmed === PLAYERS);
      if (!allConfirmed) await new Promise((r) => setTimeout(r, 25));
    }
    expect(allConfirmed).toBe(true);

    // The captain appoints a legal team; everyone observes the phase change.
    const capIdx = Number(captain.slice(1)) - 1;
    const capView = views.find((v) => v.you.id === captain)!;
    const team = [capView.you, ...capView.others]
      .filter((p) => p.id !== captain && p.alive && !p.offDuty)
      .map((p) => p.id);
    clients[capIdx]!.moves.appointTeam!(team[0], team[1]);

    let agreed = false;
    for (let i = 0; i < 100 && !agreed; i++) {
      const states = clients.map((c) => c.getState()?.G as PlayerViewLite | undefined);
      agreed = states.every((s) => s?.phase === 'loyalty' && s.officers.lieutenant === team[0]);
      if (!agreed) await new Promise((r) => setTimeout(r, 25));
    }
    expect(agreed).toBe(true);
  }, 30000);
});

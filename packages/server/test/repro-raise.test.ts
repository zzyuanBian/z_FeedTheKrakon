/**
 * Regression repro (temporary): 5-player room, 6 people join, host raises to
 * 6, host clicks 开始游戏 — must work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'boardgame.io/client';
import { SocketIO as SocketIOClient } from 'boardgame.io/multiplayer';
import { FtkGame } from '@ftk/game';
import { createFtkServer } from '../src/index.js';

const PORT = 8124;
const ORIGIN = `http://localhost:${PORT}`;

interface ViewLite {
  phase: string;
  playerCount: number;
  hostStarted: boolean;
  isHost: boolean;
  you: { id: string; name: string; benched?: boolean; roleConfirmed?: boolean };
  others: { id: string; name: string; benched?: boolean }[];
  roleConfirmations?: { confirmed: number; total: number };
}

let server: ReturnType<typeof createFtkServer>;
let servers: Awaited<ReturnType<ReturnType<typeof createFtkServer>['run']>>;
const clients: ReturnType<typeof Client>[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitView(c: ReturnType<typeof Client>, check: (v: ViewLite) => boolean): Promise<ViewLite> {
  for (let i = 0; i < 400; i++) {
    const v = c.getState()?.G as ViewLite | undefined;
    if (v && check(v)) return v;
    await sleep(25);
  }
  throw new Error('waitView timeout');
}

beforeAll(async () => {
  server = createFtkServer({ origins: [ORIGIN] });
  servers = await server.run(PORT);
}, 20000);

afterAll(() => {
  for (const c of clients) c.stop();
  server.kill(servers);
});

describe('repro: 5p room, 6 join, raise to 6, start', () => {
  it('lets the host start after raising the count', async () => {
    // 1. create at 5-player target, 11 seats
    const res = await fetch(`${ORIGIN}/games/feed-the-kraken/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numPlayers: 11,
        setupData: { seed: 7, playerCount: 5, factionCounts: { sailor: 3, pirate: 1, cult: 1 } },
      }),
    });
    const { matchID } = (await res.json()) as { matchID: string };

    // 2. six people join seats 0..5, keep credentials
    const names = ['房主', '张三', '李四', '王五', '赵六', '孙七'];
    const creds: string[] = [];
    for (let seat = 0; seat < 6; seat++) {
      const r = await fetch(`${ORIGIN}/games/feed-the-kraken/${matchID}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerID: String(seat), playerName: names[seat] }),
      });
      if (r.status !== 200) throw new Error(`join seat ${seat} failed: ${r.status} ${await r.text()}`);
      const b = (await r.json()) as { playerCredentials: string };
      creds[seat] = b.playerCredentials;
    }

    // 3. all six open clients (host first) WITH credentials
    for (let seat = 0; seat < 6; seat++) {
      const c = Client({
        game: FtkGame,
        multiplayer: SocketIOClient({ server: ORIGIN }),
        matchID,
        playerID: String(seat),
        credentials: creds[seat],
      } as never);
      c.start();
      clients.push(c);
    }

    // 4. wait for views, then syncName like useGame does
    for (let seat = 0; seat < 6; seat++) {
      await waitView(clients[seat]!, (v) => !!v.you);
      clients[seat]!.moves.syncName!(names[seat]);
      clients[seat]!.moves.syncAvatar!(seat);
    }
    await waitView(clients[0]!, (v) => {
      const all = [v.you, ...v.others];
      return names.every((n) => all.some((p) => p.name === n));
    });

    // 5. host raises the count to 6 with the 6p preset
    clients[0]!.moves.setFactionConfig!({ sailor: 3, pirate: 2, cult: 1 }, 6);
    await waitView(clients[0]!, (v) => v.playerCount === 6);
    console.log('raised to 6 ✓');

    // 6. host clicks 开始游戏
    clients[0]!.moves.hostStartGame!();
    await waitView(clients[0]!, (v) => v.hostStarted === true);
    console.log('hostStarted ✓');

    // 7. everyone confirms
    for (let seat = 0; seat < 6; seat++) {
      clients[seat]!.moves.confirmRole!();
      await waitView(clients[seat]!, (v) => v.you.roleConfirmed === true);
    }
    const v = await waitView(clients[5]!, (vv) => vv.roleConfirmations!.confirmed === 6);
    console.log('all confirmed ✓', v.roleConfirmations);
    expect(v.playerCount).toBe(6);
  }, 40000);

  it('blocks starting while a ghost seat is unclaimed, and the leave handshake frees seats', async () => {
    const res = await fetch(`${ORIGIN}/games/feed-the-kraken/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numPlayers: 11,
        setupData: { seed: 9, playerCount: 6, factionCounts: { sailor: 3, pirate: 2, cult: 1 } },
      }),
    });
    const { matchID } = (await res.json()) as { matchID: string };

    const names = ['房主', '张三', '李四', '王五', '赵六', '孙七'];
    const creds: string[] = [];
    for (let seat = 0; seat < 6; seat++) {
      const r = await fetch(`${ORIGIN}/games/feed-the-kraken/${matchID}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerID: String(seat), playerName: names[seat] }),
      });
      const b = (await r.json()) as { playerCredentials: string };
      creds[seat] = b.playerCredentials;
    }

    // Only seats 0..4 open clients; 孙七 (seat 5) never connects — the ghost.
    // Local array: the module-level `clients` still holds test 1's sockets,
    // and indices there point at the OTHER match.
    const table: ReturnType<typeof Client>[] = [];
    for (let seat = 0; seat < 5; seat++) {
      const c = Client({
        game: FtkGame,
        multiplayer: SocketIOClient({ server: ORIGIN }),
        matchID,
        playerID: String(seat),
        credentials: creds[seat],
      } as never);
      c.start();
      table.push(c);
      clients.push(c); // cleanup only
    }
    for (let seat = 0; seat < 5; seat++) {
      await waitView(table[seat]!, (v) => !!v.you);
      table[seat]!.moves.syncName!(names[seat]);
    }
    // Raise to 6 with a live ghost — the host would see 等人齐 5/6.
    table[0]!.moves.setFactionConfig!({ sailor: 3, pirate: 2, cult: 1 }, 6);
    await waitView(table[0]!, (v) => v.playerCount === 6);

    // hostStartGame must be REJECTED (ghost has no name) — hostStarted stays false.
    table[0]!.moves.hostStartGame!();
    let rejected = false;
    for (let i = 0; i < 100 && !rejected; i++) {
      const v = table[0]!.getState()?.G as ViewLite | undefined;
      // Rejection proof: no state bump happened — the _stateID would have
      // advanced had the move been applied (hostStarted=true is the tell).
      rejected = !!v && v.hostStarted === false && v.playerCount === 6 && i > 8;
      if (!rejected) await sleep(25);
    }
    expect(rejected).toBe(true);
    console.log('ghost blocks start ✓');

    // The host boots the ghost via clearSeat — the engine shrinks the ring to
    // 5 (p6 was the tail), rescales the breakdown and re-deals. Start then
    // goes through against the 5-player ring.
    table[0]!.moves.clearSeat!('p6');
    await waitView(table[0]!, (v) => v.playerCount === 5);
    table[0]!.moves.hostStartGame!();
    await waitView(table[0]!, (v) => v.hostStarted === true);
    console.log('boot + start ✓');

    // The leave handshake: 孙七 (holding creds for seat 5) vacates the lobby
    // seat — the metadata name is gone, so getMatch shows the seat open.
    const leave = await fetch(`${ORIGIN}/ftk/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchID, playerID: '5', credentials: creds[5] }),
    });
    console.log('leave status', leave.status, await leave.text());
    expect(leave.status).toBe(200);
    const match = await (await fetch(`${ORIGIN}/games/feed-the-kraken/${matchID}`)).json() as {
      players: { id: number; name?: string }[];
    };
    console.log('seat5 after leave:', JSON.stringify(match.players.find((p) => p.id === 5)));
    expect(match.players.find((p) => p.id === 5)?.name).toBeUndefined();
    // Wrong credentials are refused.
    const bad = await fetch(`${ORIGIN}/ftk/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchID, playerID: '4', credentials: 'nope' }),
    });
    expect(bad.status).toBe(403);
    console.log('leave handshake ✓');
  }, 40000);
});

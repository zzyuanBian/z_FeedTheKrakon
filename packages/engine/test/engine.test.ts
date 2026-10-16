import { describe, expect, it } from 'vitest';
import {
  ARROW_COLORS, SHORT_MAP, createGame, isAcyclic, loadMap, makeRng,
  navDeckSize, viewFor, type GameState,
} from '../src/index.js';

const loaded = loadMap(SHORT_MAP);

function newGame(playerCount: number, seed = 12345, fivePlayerTwoPirates = false): GameState {
  return createGame({
    seed,
    settings: { playerCount, map: 'short', fivePlayerTwoPirates },
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    map: SHORT_MAP,
  });
}

describe('map_short.json', () => {
  it('has the verified shape', () => {
    expect(loaded.def.spaces).toHaveLength(28);
    expect(loaded.def.arrows).toHaveLength(63);
    expect(loaded.navigable).toHaveLength(21);
    expect(loaded.terminal).toHaveLength(7);
  });

  it('labels the right special spaces', () => {
    const icons = loaded.def.spaces.filter((s) => s.icon !== 'none');
    expect(icons.filter((s) => s.icon === 'magnify').map((s) => s.id)).toEqual([6, 7, 9]);
    expect(icons.filter((s) => s.icon === 'octopus').map((s) => s.id)).toEqual([16, 18]);
    expect(loaded.def.spaces.find((s) => s.kind === 'start')?.id).toBe(1);
  });

  it('builds the movement table faithfully (including mixed colours)', () => {
    expect(loaded.movement[1]).toEqual({ yellow: 3, blue: 4, red: 2 });
    // Space 5 really draws two parallel arrows north; both colours -> #9.
    expect(loaded.movement[5]).toEqual({ yellow: 9, blue: 6, red: 9 });
    // Every navigable space has all three colours.
    for (const id of loaded.navigable) {
      for (const c of ARROW_COLORS) expect(loaded.movement[id]![c]).toBeTypeOf('number');
    }
  });

  it('win regions are terminal and the graph is acyclic', () => {
    const wins = loaded.def.spaces.filter((s) => s.kind.startsWith('win')).map((s) => s.id);
    expect(wins.sort((a, b) => a - b)).toEqual([21, 22, 23, 25, 26, 27, 28]);
    for (const id of wins) expect(loaded.movement[id]).toBeUndefined();
    expect(isAcyclic(loaded.movement)).toBe(true);
  });
});

describe('nav deck', () => {
  it('Quick Journey has 19 cards, Long 23', () => {
    expect(navDeckSize('short')).toBe(19);
    expect(navDeckSize('long')).toBe(23);
  });

  it('builds a Quick deck without Armed', () => {
    const g = newGame(7);
    expect(g.navigation.deck).toHaveLength(19);
    expect(g.navigation.deck).not.toContain('armed');
    const byColor = { yellow: 0, blue: 0, red: 0 };
    for (const c of g.navigation.deck) byColor[NAVCOLOR(c)]++;
    expect(byColor).toEqual({ yellow: 5, blue: 5, red: 9 });
  });
});

function NAVCOLOR(id: string): 'yellow' | 'blue' | 'red' {
  if (id === 'cultUprising') return 'yellow';
  if (id === 'blueDrunk' || id === 'disarmed') return 'blue';
  return 'red';
}

describe('team composition', () => {
  it('7 players -> 4 sailors / 2 pirates / 1 cult', () => {
    const g = newGame(7);
    const t = Object.values(g.players).map((p) => p.team);
    expect(t.filter((x) => x === 'sailor')).toHaveLength(4);
    expect(t.filter((x) => x === 'pirate')).toHaveLength(2);
    expect(t.filter((x) => x === 'cult')).toHaveLength(1);
    expect(Object.values(g.players).every((p) => p.guns === 3)).toBe(true);
    expect(g.gunSupply).toBe(40 - 21);
  });

  it('5 players honours the host setting', () => {
    const a = newGame(5, 7, false);
    expect(Object.values(a.players).filter((p) => p.team === 'pirate')).toHaveLength(1);
    const b = newGame(5, 7, true);
    expect(Object.values(b.players).filter((p) => p.team === 'pirate')).toHaveLength(2);
    expect(Object.values(b.players).filter((p) => p.team === 'sailor')).toHaveLength(2);
  });

  it('is deterministic for a given seed', () => {
    const a = newGame(8, 999);
    const b = newGame(8, 999);
    expect(Object.values(a.players).map((p) => p.team)).toEqual(Object.values(b.players).map((p) => p.team));
    expect(a.navigation.deck).toEqual(b.navigation.deck);
    expect(a.officers.captain).toBe(b.officers.captain);
    const c = newGame(8, 1000);
    expect(a.navigation.deck).not.toEqual(c.navigation.deck);
  });
});

describe('viewFor — the information gate', () => {
  it('exposes your own team but never anyone else’s', () => {
    const g = newGame(7);
    const me = g.seatOrder[0]!;
    const v = viewFor(g, me);
    expect(v.you.team).toBe(g.players[me]!.team);
    for (const o of v.others) {
      expect('team' in o).toBe(false);
      expect('convertedAt' in o).toBe(false);
    }
  });

  it('hides mutiny pledges until revealed', () => {
    const g = newGame(7);
    g.mutiny.active = true;
    g.mutiny.pledges = { p1: 2, p2: 1 };
    let v = viewFor(g, 'p1');
    expect(v.mutiny.pledges).toBeNull();
    g.mutiny.revealed = true;
    v = viewFor(g, 'p1');
    expect(v.mutiny.pledges).toEqual({ p1: 2, p2: 1 });
  });

  it('hides the actor of a ritual pending from everyone but the actor', () => {
    const g = newGame(7);
    const leader = g.seatOrder.find((id) => g.players[id]!.cultLeader)!;
    g.pending = { kind: 'ritual', by: leader, data: { ritual: 'conversion' } };
    // The leader still sees themself as the actor, with their private data.
    const leaderView = viewFor(g, leader);
    expect(leaderView.pending).toEqual({ kind: 'ritual', by: leader, isYou: true });
    expect(leaderView.pendingData).toEqual({ ritual: 'conversion' });
    // Everyone else gets a nameless pending — naming `by` would out the leader.
    const other = g.seatOrder.find((id) => id !== leader)!;
    const otherView = viewFor(g, other);
    expect(otherView.pending).toEqual({ kind: 'ritual', by: null, isYou: false });
    expect(otherView.pendingData).toBeNull();
  });

  it('still names the actor of non-ritual pendings', () => {
    const g = newGame(7);
    g.pending = { kind: 'mapAction', by: g.officers.captain!, data: { icon: 'magnify' } };
    const watcher = g.seatOrder.find((id) => id !== g.officers.captain)!;
    const v = viewFor(g, watcher);
    expect(v.pending).toEqual({ kind: 'mapAction', by: g.officers.captain, isYou: false });
  });

  it('is idempotent (pure)', () => {
    const g = newGame(6);
    const a = viewFor(g, g.seatOrder[1]!);
    const b = viewFor(g, g.seatOrder[1]!);
    expect(a).toEqual(b);
  });
});

describe('rng', () => {
  it('is a permutation and reproducible', () => {
    const r = makeRng(42);
    const out = r.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(makeRng(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8])).toEqual(out);
  });
});

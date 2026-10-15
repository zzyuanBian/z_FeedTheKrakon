/**
 * Reducer tests: drive whole rounds through the six-phase loop and assert the
 * rules from doc/ruleset_notes.md. These double as the spec for the moves.
 */
import { describe, expect, it } from 'vitest';
import {
  SHORT_MAP, createGame, makeRng, reduce, viewFor,
  type Action, type GameState, type PlayerId,
} from '../src/index.js';

function game(playerCount = 7, seed = 1234): GameState {
  return createGame({
    seed,
    settings: { playerCount, map: 'short', fivePlayerTwoPirates: false },
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    map: SHORT_MAP,
  });
}

/** Apply actions in order, asserting each one does not throw unless listed. */
function apply(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce((st, a) => reduce(st, a), s);
}

const cap = (s: GameState): PlayerId => s.officers.captain!;
const lt = (s: GameState): PlayerId => s.officers.lieutenant!;
const nav = (s: GameState): PlayerId => s.officers.navigator!;
const others = (s: GameState, except: PlayerId[]): PlayerId[] =>
  s.seatOrder.filter((id) => !except.includes(id));

/** Living crew a captain may legally appoint as lieutenant/navigator. */
const appointees = (s: GameState, captain: PlayerId): PlayerId[] =>
  s.seatOrder.filter((id) => {
    const p = s.players[id]!;
    return p.alive && !p.offDuty && id !== captain;
  });

/** Appoint a team and decline the mutiny (everyone pledges 0). */
function appointAndNoMutiny(s: GameState): GameState {
  const c = cap(s);
  const team = appointees(s, c);
  let st = reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[1]! });
  const crew = st.seatOrder.filter((id) => id !== cap(st) && st.players[id]!.alive);
  for (const id of crew) st = reduce(st, { type: 'mutinyPledge', actor: id, guns: 0 });
  return st;
}

/** Execute a full navigation honestly (captain/lieutenant keep card 0). */
function runNavigation(s: GameState): GameState {
  let st = s;
  const c = cap(st);
  const l = lt(st);
  st = reduce(st, { type: 'navContribute', actor: c, keep: st.navigation.captainCards[0]!, discard: st.navigation.captainCards[1]! });
  st = reduce(st, { type: 'navContribute', actor: l, keep: st.navigation.lieutenantCards[0]!, discard: st.navigation.lieutenantCards[1]! });
  st = reduce(st, { type: 'navLogbook', actor: nav(st), discard: st.navigation.logbook[0]! });
  return reduce(st, { type: 'revealAndExecute', actor: cap(st) });
}

/** Auto-resolve whatever the state is waiting on (for tests that don't care). */
function autoResolve(s: GameState): GameState {
  let st = s;
  let guard = 0;
  while (st.pending && guard++ < 20) {
    // Only the host may force-advance.
    st = reduce(st, { type: 'forceAdvance', actor: st.host });
  }
  return st;
}

describe('phases', () => {
  it('starts in appointTeam with a captain', () => {
    const s = game();
    expect(s.phase).toBe('appointTeam');
    expect(s.officers.captain).toBeTruthy();
    expect(s.round).toBe(1);
  });

  it('appoints a team then enters loyalty', () => {
    const s = game();
    const c = cap(s);
    const team = others(s, [c]);
    const st = reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[1]! });
    expect(st.phase).toBe('loyalty');
    expect(st.officers.lieutenant).toBe(team[0]);
    expect(st.officers.navigator).toBe(team[1]);
  });

  it('rejects illegal appointments', () => {
    const s = game();
    const c = cap(s);
    const team = others(s, [c]);
    expect(() => reduce(s, { type: 'appointTeam', actor: c, lieutenant: c, navigator: team[0]! }))
      .toThrow();
    expect(() => reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[0]! }))
      .toThrow();
  });
});

describe('mutiny', () => {
  it('fails below the threshold and nobody loses guns', () => {
    const s = game(7);
    const st = appointAndNoMutiny(s);
    expect(st.phase).toBe('navigation');
    expect(st.mutiny.success).toBe(false);
    expect(Object.values(st.players).every((p) => p.guns === 3)).toBe(true);
  });

  it('at exactly 3 guns (5-7 players) succeeds and strips revealed guns', () => {
    let s = game(7);
    const c = cap(s);
    const team = appointees(s, c);
    s = reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[1]! });
    const crew = s.seatOrder.filter((id) => id !== c);
    for (const id of crew) s = reduce(s, { type: 'mutinyPledge', actor: id, guns: id === crew[0] ? 3 : 0 });
    // A successful mutiny installs a new captain, who opens a fresh round.
    expect(s.phase).toBe('appointTeam');
    expect(s.mutiny.success).toBe(true);
    expect(s.mutiny.newCaptain).toBe(crew[0]);
    expect(s.players[crew[0]!]!.guns).toBe(0);
    expect(s.players[crew[1]!]!.guns).toBe(3);
    expect(s.officers.captain).toBe(crew[0]);
  });

  it('resolves a tie by sequential peer choice', () => {
    let s = game(7);
    const c = cap(s);
    const team = others(s, [c]);
    s = reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[1]! });
    const crew = s.seatOrder.filter((id) => id !== c);
    for (const id of crew) s = reduce(s, { type: 'mutinyPledge', actor: id, guns: id === crew[0] || id === crew[1] ? 3 : 0 });
    expect(s.pending?.kind).toBe('mutinyTie');
    s = reduce(s, { type: 'mutinyTieBreak', actor: c, standDown: crew[0]! });
    expect(s.mutiny.newCaptain).toBe(crew[1]);
  });
});

describe('navigation', () => {
  it('draws 4 cards, discards 3, reveals 1 and moves the ship', () => {
    let s = appointAndNoMutiny(game(7));
    expect(s.navigation.captainCards).toHaveLength(2);
    expect(s.navigation.lieutenantCards).toHaveLength(2);
    const before = s.navigation.discard.length;
    s = runNavigation(s);
    // 3 cards discarded this navigation.
    expect(s.navigation.discard.length).toBe(before + 3);
    expect(s.ship.spaceId).not.toBe(1);
  });

  it('denial of command eliminates the navigator, moves nothing, no résumé', () => {
    let s = appointAndNoMutiny(game(7));
    const c = cap(s);
    const l = lt(s);
    const n = nav(s);
    s = reduce(s, { type: 'navContribute', actor: c, keep: s.navigation.captainCards[0]!, discard: s.navigation.captainCards[1]! });
    s = reduce(s, { type: 'navContribute', actor: l, keep: s.navigation.lieutenantCards[0]!, discard: s.navigation.lieutenantCards[1]! });
    const space = s.ship.spaceId;
    const resumes = s.players[c]!.resumes;
    s = reduce(s, { type: 'denialOfCommand', actor: n });
    expect(s.players[n]!.alive).toBe(false);
    expect(s.ship.spaceId).toBe(space);
    expect(s.players[c]!.resumes).toBe(resumes);
    expect(s.ship.emergency).toBe(true);
    expect(s.pending?.kind).toBe('emergencyNav');
  });

  it('emergency navigation lets the captain pick an off-duty navigator', () => {
    let s = appointAndNoMutiny(game(7));
    const c = cap(s);
    const l = lt(s);
    const n = nav(s);
    s = reduce(s, { type: 'navContribute', actor: c, keep: s.navigation.captainCards[0]!, discard: s.navigation.captainCards[1]! });
    s = reduce(s, { type: 'navContribute', actor: l, keep: s.navigation.lieutenantCards[0]!, discard: s.navigation.lieutenantCards[1]! });
    s = reduce(s, { type: 'denialOfCommand', actor: n });
    const replacement = others(s, [c, l, n])[0]!;
    s = reduce(s, { type: 'emergencyNav', actor: c, navigator: replacement });
    // A fresh navigation: the captain and lieutenant draw again, the logbook is
    // rebuilt from scratch (the jumped navigator's cards were discarded).
    expect(s.phase).toBe('navigation');
    expect(s.officers.navigator).toBe(replacement);
    expect(s.officers.lieutenant).toBe(l);
    expect(s.navigation.captainCards).toHaveLength(2);
    expect(s.navigation.lieutenantCards).toHaveLength(2);
    expect(s.navigation.logbook).toHaveLength(0);
    expect(s.navigation.acted).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('same seed + same actions => identical state', () => {
    const play = (): GameState => {
      let s = appointAndNoMutiny(game(7, 555));
      s = runNavigation(s);
      return autoResolve(s);
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

describe('full game runs to a win', () => {
  it('reaches a victory within 40 rounds with honest play', () => {
    let s = appointAndNoMutiny(game(7, 2024));
    let rounds = 0;
    while (s.phase !== 'gameOver' && rounds++ < 40) {
      s = runNavigation(s);
      s = autoResolve(s);
      if (s.phase === 'appointTeam') s = appointAndNoMutiny(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBeTruthy();
    expect(['sailor', 'pirate', 'cult']).toContain(s.winner);
  });
});

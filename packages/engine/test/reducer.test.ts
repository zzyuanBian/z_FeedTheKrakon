/**
 * Reducer tests: drive whole rounds through the six-phase loop and assert the
 * rules from doc/ruleset_notes.md. These double as the spec for the moves.
 */
import { describe, expect, it } from 'vitest';
import {
  SHORT_MAP, STARTING_GUNS, createGame, livingPlayers, makeRng, reduce, viewFor,
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

/** Execute a full navigation honestly (captain/lieutenant keep card 0).
 *  The logbook discard settles the course AND applies the card in one move. */
function runNavigation(s: GameState): GameState {
  let st = s;
  const c = cap(st);
  const l = lt(st);
  st = reduce(st, { type: 'navContribute', actor: c, keep: st.navigation.captainCards[0]!, discard: st.navigation.captainCards[1]! });
  st = reduce(st, { type: 'navContribute', actor: l, keep: st.navigation.lieutenantCards[0]!, discard: st.navigation.lieutenantCards[1]! });
  return reduce(st, { type: 'navLogbook', actor: nav(st), discard: st.navigation.logbook[0]! });
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

describe('setFactionConfig', () => {
  it('re-deals teams to the host\'s new breakdown', () => {
    const s = game(7);
    const st = reduce(s, {
      type: 'setFactionConfig', actor: s.host, factionCounts: { sailor: 3, pirate: 3, cult: 1 },
    });
    expect(st.settings.factionCounts).toEqual({ sailor: 3, pirate: 3, cult: 1 });
    const tally = { sailor: 0, pirate: 0, cult: 0 };
    for (const id of st.seatOrder) tally[st.players[id]!.team] += 1;
    expect(tally).toEqual({ sailor: 3, pirate: 3, cult: 1 });
    // The captain card is part of the same deal: the officer corps still has a
    // captain, and the opening log entry points at them.
    expect(st.officers.captain).toBeTruthy();
    expect(st.log[0]).toMatchObject({ t: 'round', captain: st.officers.captain });
    // Exactly one Cult Leader, and rngState advanced past the re-deal.
    expect(st.seatOrder.filter((id) => st.players[id]!.cultLeader)).toHaveLength(1);
    expect(st.rngState).not.toBe(s.rngState);
    // The projection exposes the new breakdown to every seat.
    expect(viewFor(st, st.seatOrder[1]!).factionCounts).toEqual({ sailor: 3, pirate: 3, cult: 1 });
  });

  it('rejects non-hosts, post-start calls, and bogus counts', () => {
    const s = game(7);
    const notHost = s.seatOrder[1]!;
    expect(() => reduce(s, { type: 'setFactionConfig', actor: notHost, factionCounts: { sailor: 4, pirate: 2, cult: 1 } })).toThrow();
    expect(() => reduce(s, { type: 'setFactionConfig', actor: s.host, factionCounts: { sailor: 4, pirate: 2, cult: 2 } })).toThrow(); // sum != 7
    expect(() => reduce(s, { type: 'setFactionConfig', actor: s.host, factionCounts: { sailor: 0, pirate: 6, cult: 1 } })).toThrow();
    // Every seat syncs first (as live clients do on connect); a ghost seat
    // would rightly block the start below.
    const synced = s.seatOrder.reduce(
      (acc, id) => reduce(acc, { type: 'syncName', actor: id, name: acc.players[id]!.name || `Name ${id}` }),
      s,
    );
    const started = reduce(synced, { type: 'hostStartGame', actor: s.host });
    expect(() => reduce(started, { type: 'setFactionConfig', actor: s.host, factionCounts: { sailor: 4, pirate: 2, cult: 1 } })).toThrow();
  });

  it('refuses to start while an active seat never synced (ghost)', () => {
    const s = game(6);
    const synced = s.seatOrder.slice(0, 5).reduce(
      (acc, id) => reduce(acc, { type: 'syncName', actor: id, name: `Name ${id}` }),
      s,
    );
    // p6 never synced — the start must be refused, even though every name
    // (setup-time "Player N") is non-empty. This is the 5→6 人间 bug: the
    // ghost's role card could never be confirmed.
    expect(() => reduce(synced, { type: 'hostStartGame', actor: synced.host })).toThrow(/ghost/);
  });

  it('keeps a game reproducible after a re-deal', () => {
    const play = (): GameState =>
      reduce(game(7, 777), {
        type: 'setFactionConfig', actor: game(7, 777).host,
        factionCounts: { sailor: 2, pirate: 2, cult: 3 },
      });
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

describe('full-capacity rooms (Avalon lobby)', () => {
  /** A 7-player game dealt into an 11-seat room. */
  const roomy = (seed = 1234): GameState => createGame({
    seed,
    settings: { playerCount: 7, seats: 11, map: 'short', fivePlayerTwoPirates: false },
    names: Array.from({ length: 7 }, (_, i) => `P${i + 1}`),
    map: SHORT_MAP,
  });

  it('leaves the extra seats inert: dead, nameless, roleless, gunless', () => {
    const s = roomy();
    expect(s.seatOrder).toHaveLength(11);
    const bench = s.seatOrder.slice(7);
    for (const id of bench) {
      const p = s.players[id]!;
      expect(p.alive).toBe(false);
      expect(p.name).toBe('');
      expect(p.guns).toBe(0);
      expect(p.cultLeader).toBe(false);
    }
    expect(s.gunSupply).toBe(40 - STARTING_GUNS * 7);
    // The bench is invisible to living-player queries and never leads the cult.
    expect(livingPlayers(s)).toHaveLength(7);
    const leader = s.seatOrder.find((id) => s.players[id]!.cultLeader)!;
    expect(bench).not.toContain(leader);
  });

  it('scopes confirmation and the view to active seats; bench seats cannot confirm', () => {
    const s = roomy();
    const v = viewFor(s, 'p1');
    expect(v.playerCount).toBe(7);
    expect(v.roleConfirmations.total).toBe(7);
    expect(v.others.filter((p) => p.benched)).toHaveLength(4);
    expect(() => reduce(s, { type: 'confirmRole', actor: 'p8' })).toThrow();
  });

  it('retunes the target crew size live: grow revives bench seats, shrink re-benches them', () => {
    let s = roomy();
    s = reduce(s, {
      type: 'setFactionConfig', actor: s.host,
      factionCounts: { sailor: 5, pirate: 3, cult: 1 }, nextCount: 9,
    });
    expect(s.settings.playerCount).toBe(9);
    // p8/p9 woke up with real roles and starting guns; p10 stays benched.
    for (const id of ['p8', 'p9']) {
      expect(s.players[id]!.alive).toBe(true);
      expect(s.players[id]!.guns).toBe(STARTING_GUNS);
    }
    expect(s.players.p10!.alive).toBe(false);
    expect(s.gunSupply).toBe(40 - STARTING_GUNS * 9);
    expect(s.mutiny.threshold).toBe(4); // 8..9 players -> threshold 4
    const tally = { sailor: 0, pirate: 0, cult: 0 };
    for (const id of s.seatOrder.slice(0, 9)) tally[s.players[id]!.team] += 1;
    expect(tally).toEqual({ sailor: 5, pirate: 3, cult: 1 });
    const v = viewFor(s, 'p1');
    expect(v.playerCount).toBe(9);
    expect(v.others.filter((p) => p.benched)).toHaveLength(2);

    // Shrinking re-benches the tail and re-stamps the threshold.
    s = reduce(s, {
      type: 'setFactionConfig', actor: s.host,
      factionCounts: { sailor: 4, pirate: 2, cult: 1 }, nextCount: 7,
    });
    expect(s.players.p8!.alive).toBe(false);
    expect(s.mutiny.threshold).toBe(3);
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

describe('post-game fun vote', () => {
  it('is gated to game over, hides targets until the full tally, then reveals', () => {
    // Play an honest game to its winner.
    let s = appointAndNoMutiny(game(7, 2024));
    let rounds = 0;
    while (s.phase !== 'gameOver' && rounds++ < 40) {
      s = runNavigation(s);
      s = autoResolve(s);
      if (s.phase === 'appointTeam') s = appointAndNoMutiny(s);
    }
    expect(s.phase).toBe('gameOver');

    // Illegal before game over would be rejected — here it IS over, so the
    // vote lands. Self-vote and double-vote are refused.
    expect(() => reduce(s, { type: 'funVote', actor: 'p1', target: 'p1' })).toThrow();
    s = reduce(s, { type: 'funVote', actor: 'p1', target: 'p2' });
    expect(() => reduce(s, { type: 'funVote', actor: 'p1', target: 'p3' })).toThrow();

    // Partial tally: voters public, result withheld.
    let v = viewFor(s, 'p2');
    expect(v.funVotes).toEqual(['p1']);
    expect(v.funVoteResult).toBeNull();
    expect(v.allRevealed!.map((r) => r.id)).toEqual(s.seatOrder.filter((id) => s.players[id]!.seat < 7));
    // Teams outed, converter named for mid-game converts only.
    for (const r of v.allRevealed!) {
      expect(r.team).toBe(s.players[r.id]!.team);
      expect(r.convertedBy).toBe(s.players[r.id]!.convertedBy);
    }

    // Everyone votes → tally published, highest first. (p2 can't self-vote,
    // so theirs goes to p1 — p2 still tops the tally at 6: p1's early vote
    // plus the five voters here.)
    const ids = s.seatOrder.filter((id) => s.players[id]!.seat < 7 && id !== 'p1');
    for (const id of ids) s = reduce(s, { type: 'funVote', actor: id, target: id === 'p2' ? 'p1' : 'p2' });
    v = viewFor(s, 'p3');
    expect(v.funVoteResult![0]).toEqual({ playerId: 'p2', count: 6 });

    // Nobody may sneak a rule move in after the win — reduce is a silent
    // no-op (the transport drops it the same way).
    const after = reduce(s, { type: 'appointTeam', actor: 'p1', lieutenant: 'p2', navigator: 'p3' });
    expect(after).toBe(s);
  });
});

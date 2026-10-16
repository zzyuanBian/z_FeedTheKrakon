/**
 * Tests for the pure client helpers — the "what can I do now?" projections.
 * These encode the UI's gating rules; if they drift from the engine, a player
 * would be offered a move the engine rejects.
 */
import { describe, expect, it } from 'vitest';
import { createGame, reduce, viewFor, SHORT_MAP, type GameState, type PlayerId } from '@ftk/engine';
import {
  eligibleTeam, iAmAppointing, iMustContribute, iMustResolveLogbook, iOweMutinyPledge,
  pickableTargets,
} from '../src/actions.js';

function game(playerCount = 7): GameState {
  return createGame({
    seed: 7,
    settings: { playerCount, map: 'short', fivePlayerTwoPirates: false },
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    map: SHORT_MAP,
  });
}

const cap = (s: GameState): PlayerId => s.officers.captain!;
const seat = (s: GameState, id: PlayerId): number => s.players[id]!.seat;

function appoint(s: GameState): GameState {
  const c = cap(s);
  const team = s.seatOrder.filter((id) => id !== c && s.players[id]!.alive && !s.players[id]!.offDuty);
  return reduce(s, { type: 'appointTeam', actor: c, lieutenant: team[0]!, navigator: team[1]! });
}

/** Appoint, then decline the mutiny so the game enters the navigation phase. */
function navigate(s: GameState): GameState {
  let st = appoint(s);
  for (const id of st.seatOrder) {
    if (id !== cap(st)) st = reduce(st, { type: 'mutinyPledge', actor: id, guns: 0 });
  }
  return st;
}

describe('client action gating', () => {
  it('offers the captain the appoint form only in appointTeam', () => {
    const s = game();
    const view = viewFor(s, cap(s));
    expect(iAmAppointing(view)).toBe(true);
    expect(iAmAppointing(viewFor(s, s.seatOrder.find((id) => id !== cap(s))!))).toBe(false);
  });

  it('lists only eligible appointees for the captain', () => {
    const s = game();
    const view = viewFor(s, cap(s));
    const list = eligibleTeam(view);
    expect(list).not.toContain(cap(s));
    expect(list).toHaveLength(6);
  });

  it('marks crew (not the captain) as owing a mutiny pledge', () => {
    const s = appoint(game());
    const crew = s.seatOrder.find((id) => id !== cap(s))!;
    expect(iOweMutinyPledge(viewFor(s, crew))).toBe(true);
    expect(iOweMutinyPledge(viewFor(s, cap(s)))).toBe(false);
  });

  it('stops asking for a pledge once the viewer has pledged', () => {
    // Regression: without this the form stayed up and every further click was
    // silently rejected by the engine ("you already pledged"), deadlocking the
    // player in a real game.
    const s = appoint(game());
    const crew = s.seatOrder.find((id) => id !== cap(s))!;
    const pledged = reduce(s, { type: 'mutinyPledge', actor: crew, guns: 0 });
    expect(viewFor(pledged, crew).mutiny.hasPledged).toBe(true);
    expect(iOweMutinyPledge(viewFor(pledged, crew))).toBe(false);
  });

  it('routes contribute -> logbook to the right seats', () => {
    let s = navigate(game());
    const c = cap(s);
    const l = s.officers.lieutenant!;
    const n = s.officers.navigator!;
    expect(s.phase).toBe('navigation');
    expect(iMustContribute(viewFor(s, c))).toBe(true);
    expect(iMustContribute(viewFor(s, l))).toBe(false);

    s = reduce(s, { type: 'navContribute', actor: c, keep: s.navigation.captainCards[0]!, discard: s.navigation.captainCards[1]! });
    expect(iMustContribute(viewFor(s, l))).toBe(true);
    expect(iMustContribute(viewFor(s, c))).toBe(false);

    s = reduce(s, { type: 'navContribute', actor: l, keep: s.navigation.lieutenantCards[0]!, discard: s.navigation.lieutenantCards[1]! });
    expect(iMustResolveLogbook(viewFor(s, n))).toBe(true);
    expect(iMustResolveLogbook(viewFor(s, c))).toBe(false);
    // Regression: at the logbook step `navigation.awaiting` IS the navigator, so
    // a stage-blind iMustContribute handed them the contribute split instead —
    // every click was then rejected by the engine.
    expect(iMustContribute(viewFor(s, n))).toBe(false);
  });

  it('never offers the viewer as their own target', () => {
    const s = game();
    const view = viewFor(s, cap(s));
    expect(pickableTargets(view)).not.toContain(view.you.id);
    expect(seat(s, view.you.id)).toBeGreaterThanOrEqual(0);
  });
});

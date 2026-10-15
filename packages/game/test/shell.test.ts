/**
 * Shell tests: prove the boardgame.io wiring is correct, not the rules (the
 * engine owns those). We assert three integration contracts:
 *
 *   1. seat index <-> PlayerId mapping and setup,
 *   2. an illegal move must NOT mutate state (INVALID_MOVE, not a crash),
 *   3. `playerView` never leaks another player's team.
 *
 * Moves are invoked directly against the `Game` config (fast, deterministic);
 * one end-to-end test drives a real bgio `Client` in local mode.
 */
import { describe, expect, it } from 'vitest';
import { Client } from 'boardgame.io/client';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { GameState } from '@ftk/engine';
import { FtkGame, seatIdForIndex } from '../src/index.js';

const newGame = (seed = 42): GameState => FtkGame.setup!(
  { ctx: { numPlayers: 7 } } as never,
  { seed, playerCount: 7 },
);

/** bgio seats are '0'..'6'; engine ids are 'p1'..'p7'. */
const seat = (engineId: string): string => String(Number(engineId.slice(1)) - 1);

/** Invoke a bgio move against `s`, returning G or INVALID_MOVE. */
function applyOn(
  s: GameState, name: string, playerID: string, ...args: unknown[]
): GameState | typeof INVALID_MOVE {
  const m = FtkGame.moves![name]!;
  const fn = typeof m === 'function' ? m : m.move;
  return (fn as (c: unknown, ...a: unknown[]) => GameState | typeof INVALID_MOVE)(
    { G: s, ctx: {}, playerID }, ...args,
  );
}

function step(s: GameState, name: string, playerID: string, ...args: unknown[]): GameState {
  const out = applyOn(s, name, playerID, ...args);
  if (out === INVALID_MOVE) throw new Error(`${name} was rejected`);
  return out;
}

describe('shell setup', () => {
  it('maps seat index to engine player id', () => {
    expect(seatIdForIndex(0)).toBe('p1');
    expect(seatIdForIndex(6)).toBe('p7');
  });

  it('seeds a 7-player game from setupData', () => {
    const s = newGame();
    expect(s.seatOrder).toHaveLength(7);
    expect(s.phase).toBe('appointTeam');
    expect(s.settings.playerCount).toBe(7);
  });
});

describe('move wrapper', () => {
  it('rejects an out-of-turn move without mutating state', () => {
    const s = newGame();
    const before = JSON.stringify(s);
    const notCaptain = s.seatOrder.find((id) => id !== s.officers.captain)!;
    const out = applyOn(s, 'revealAndExecute', seat(notCaptain));
    expect(out).toBe(INVALID_MOVE);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('applies a legal move and returns the whole new state', () => {
    const s = newGame();
    const c = s.officers.captain!;
    const team = s.seatOrder.filter((id) => id !== c);
    const after = step(s, 'appointTeam', seat(c), team[0], team[1]);
    expect(after.phase).toBe('loyalty');
    expect(after.officers.lieutenant).toBe(team[0]);
    expect(after.officers.navigator).toBe(team[1]);
  });
});

describe('playerView secrecy', () => {
  it('never exposes another player’s team', () => {
    const s = newGame();
    const view = (FtkGame.playerView as (c: unknown) => unknown)({
      G: s, ctx: {}, playerID: '0',
    }) as { you: { team: string }; others: Record<string, unknown>[] };
    expect(view.you.team).toBe(s.players['p1']!.team);
    for (const other of view.others) {
      expect(other).not.toHaveProperty('team');
      expect(other).not.toHaveProperty('cultLeader');
    }
  });
});

describe('end-to-end with the bgio client', () => {
  it('plays an appointment through a real Client', () => {
    const client = Client({
      game: FtkGame,
      numPlayers: 7,
      playerID: '0',
      // bgio 0.50.2's ClientOpts typings predate `setupData`, though the runtime
      // honours it. Cast through the option shape the runtime actually reads.
      setupData: { seed: 7, playerCount: 7 },
    } as unknown as Parameters<typeof Client>[0]);
    // In local mode bgio applies `playerView`, so a client only ever sees the
    // filtered view — exactly what the real multiplayer client receives.
    type View = {
      phase: string;
      officers: { captain: string; lieutenant: string | null };
      you: { id: string; alive: boolean; offDuty: boolean };
      others: { id: string; alive: boolean; offDuty: boolean }[];
    };
    const view = client.getState()!.G as unknown as View;
    expect(view.phase).toBe('appointTeam');

    // Become the captain (seat '0' may not hold that badge) and appoint a team.
    const captain = view.officers.captain;
    client.updatePlayerID(String(Number(captain.slice(1)) - 1));
    const team = [view.you, ...view.others]
      .filter((p) => p.id !== captain && p.alive && !p.offDuty)
      .map((p) => p.id);
    client.moves.appointTeam!(team[0], team[1]);

    const after = client.getState()!.G as unknown as View;
    expect(after.phase).toBe('loyalty');
    expect(after.officers.lieutenant).toBe(team[0]);
  });
});

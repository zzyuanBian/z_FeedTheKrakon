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
    let s = newGame();
    // Lift the role-confirm gate first, so the rejection below comes from the
    // engine's actor check rather than the pre-game gate.
    for (const id of s.seatOrder) s = step(s, 'confirmRole', seat(id));
    const before = JSON.stringify(s);
    const notCaptain = s.seatOrder.find((id) => id !== s.officers.captain)!;
    const out = applyOn(s, 'appointTeam', seat(notCaptain), s.seatOrder[1], s.seatOrder[2]);
    expect(out).toBe(INVALID_MOVE);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('applies a legal move and returns the whole new state', () => {
    let s = newGame();
    // Lift the role-confirm gate first — the move filter rejects every
    // non-pre-game move until all seats have acknowledged.
    for (const id of s.seatOrder) s = step(s, 'confirmRole', seat(id));
    const c = s.officers.captain!;
    const team = s.seatOrder.filter((id) => id !== c);
    const after = step(s, 'appointTeam', seat(c), team[0], team[1]);
    expect(after.phase).toBe('loyalty');
    expect(after.officers.lieutenant).toBe(team[0]);
    expect(after.officers.navigator).toBe(team[1]);
  });

  it('gates game moves behind role confirmation but allows pre-game moves', () => {
    let s = newGame();
    const c = s.officers.captain!;
    const team = s.seatOrder.filter((id) => id !== c);

    // Game moves are rejected before anyone confirms…
    expect(applyOn(s, 'appointTeam', seat(c), team[0], team[1])).toBe(INVALID_MOVE);

    // …while the pre-game moves sail through: name bridge + host start.
    s = step(s, 'syncName', '0', '阿明');
    expect(s.players.p1!.name).toBe('阿明');
    s = step(s, 'hostStartGame', '0');
    expect(s.hostStarted).toBe(true);

    // Partial confirmation does NOT lift the gate.
    s = step(s, 'confirmRole', '0');
    expect(applyOn(s, 'appointTeam', seat(c), team[0], team[1])).toBe(INVALID_MOVE);

    // All seats confirming does.
    for (const id of s.seatOrder.slice(1)) s = step(s, 'confirmRole', seat(id));
    const done = step(s, 'appointTeam', seat(c), team[0], team[1]);
    expect(done.phase).toBe('loyalty');
  });

  it('opts the declarative pre-game moves out of the stale-stateID rejection', () => {
    // bgio's master drops any move whose client-side stateID lags the
    // server's — which is exactly what a second fast tap in the waiting
    // room produces (<0.5s after the first, before its broadcast lands).
    // The declarative moves must carry `ignoreStaleStateID` so rapid host
    // taps compose server-side; everything else keeps the strict check.
    const moves = FtkGame.moves!;
    const flag = (name: string): boolean => {
      const m = moves[name]!;
      return !(m instanceof Function) && m.ignoreStaleStateID === true;
    };
    expect(flag('setFactionConfig')).toBe(true);
    expect(flag('hostStartGame')).toBe(true);
    expect(flag('syncName')).toBe(true);
    expect(flag('appointTeam')).toBe(false);
  });

  it('redacts the args of the ritual moves in the transport log', () => {
    // bgio ships its deltalog (move author + args) to every client; anyone
    // with devtools open could otherwise read the conversion target or the
    // gun distribution. The ritual moves carry `redact: true` so their args
    // are stripped for everyone but the sender.
    const moves = FtkGame.moves!;
    const redacted = (name: string): boolean => {
      const m = moves[name]!;
      return !(m instanceof Function) && m.redact === true;
    };
    expect(redacted('ritualConversion')).toBe(true);
    expect(redacted('ritualGunsStash')).toBe(true);
    expect(redacted('ritualAck')).toBe(true);
    // Public-actor moves keep their args in the transport log.
    expect(redacted('appointTeam')).toBe(false);
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

    // Lift the role-confirm gate: every seat acknowledges in turn (local
    // mode, so we rotate the single client through each playerID).
    for (let i = 0; i < 7; i++) {
      client.updatePlayerID(String(i));
      client.moves.confirmRole!();
    }
    client.updatePlayerID(String(Number(view.officers.captain.slice(1)) - 1));

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

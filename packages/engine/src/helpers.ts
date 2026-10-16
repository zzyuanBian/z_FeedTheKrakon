/**
 * Internal helpers shared by the reducer: seat queries, gun transactions,
 * ship movement and victory checks. Pure functions over GameState.
 */

import {
  navCard, type ArrowColor, type Faction, type GameState, type NavCardId,
  type PlayerId,
} from './state.js';

export function requirePlayer(s: GameState, id: PlayerId): void {
  if (!s.players[id]) throw new Error(`unknown player ${id}`);
}

/** The living, on-duty players eligible to be lieutenant/navigator (not the captain). */
export function eligibleOfficers(s: GameState): PlayerId[] {
  return s.seatOrder.filter((id) => {
    const p = s.players[id]!;
    return p.alive && !p.offDuty && id !== s.officers.captain;
  });
}

export function livingPlayers(s: GameState): PlayerId[] {
  return s.seatOrder.filter((id) => s.players[id]!.alive);
}

/** The seats actually in this game (the dealt crew) — full rooms hold extra
 *  bench seats beyond `settings.playerCount` that nobody is dealt into. */
export function activeSeatIds(s: GameState): PlayerId[] {
  return s.seatOrder.slice(0, s.settings.playerCount);
}

/** Clockwise (increasing seat) walk from `from`, wrapping, keeping those passing `filter`. */
export function walkClockwise(
  s: GameState, from: PlayerId, filter: (id: PlayerId) => boolean,
): PlayerId[] {
  const n = s.seatOrder.length;
  const start = s.seatOrder.indexOf(from);
  const out: PlayerId[] = [];
  for (let k = 1; k <= n; k++) {
    const id = s.seatOrder[(start + k) % n]!;
    if (filter(id)) out.push(id);
  }
  return out;
}

/* ------------------------------- guns ---------------------------------- */

/** Move up to `n` guns from the general supply to a player. Returns the amount moved. */
export function grantGuns(s: GameState, id: PlayerId, n: number): number {
  const real = Math.max(0, Math.min(n, s.gunSupply));
  s.players[id]!.guns += real;
  s.gunSupply -= real;
  return real;
}

/** Return up to `n` guns from a player to the general supply. Returns the amount returned. */
export function takeGuns(s: GameState, id: PlayerId, n: number): number {
  const real = Math.max(0, Math.min(n, s.players[id]!.guns));
  s.players[id]!.guns -= real;
  s.gunSupply += real;
  return real;
}

/* ------------------------------ movement ------------------------------- */

/** Move the ship one space in `color`'s direction. Returns the new space id. */
export function moveShip(s: GameState, color: ArrowColor): number {
  const from = s.ship.spaceId;
  const row = s.movement[from];
  if (!row) throw new Error(`moveShip: space ${from} is terminal (no arrows)`);
  const to = row[color];
  s.ship.spaceId = to;
  s.log.push({ t: 'moved', from, to, color });
  return to;
}

/** Apply a game-ending result. */
export function endGame(s: GameState, winner: Faction, reason: string): void {
  s.phase = 'gameOver';
  s.winner = winner;
  s.winReason = reason;
  s.pending = null;
  s.log.push({ t: 'gameOver', winner, reason });
}

/**
 * If the ship's current space is a win region, end the game. Returns true if so.
 * Called after every move and after a Feed-the-Kraken sacrifice.
 */
export function checkVictory(s: GameState): boolean {
  const kind = s.spaces[s.ship.spaceId]!.kind;
  if (kind === 'win-sailor') { endGame(s, 'sailor', '船抵达蓝水湾（Bluewater Bay）'); return true; }
  if (kind === 'win-pirate') { endGame(s, 'pirate', '船抵达深红湾（Crimson Cove）'); return true; }
  if (kind === 'win-kraken') { endGame(s, 'cult', '船抵达海怪（Kraken）'); return true; }
  return false;
}

export function cardColor(id: NavCardId): ArrowColor {
  return navCard(id).color;
}

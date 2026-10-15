/** Derived rules constants (rulebook tables). */

import type { MutinyThreshold, PlayerId } from './state.js';

/** Rulebook p.9. */
export function mutinyThreshold(playerCount: number): MutinyThreshold {
  if (playerCount <= 7) return 3;
  if (playerCount <= 9) return 4;
  return 5;
}

export type OfficerRole = 'captain' | 'lieutenant' | 'navigator';

/** Roles that receive an off-duty sign after navigation (rulebook p.11). */
export function offDutyRoles(playerCount: number): OfficerRole[] {
  if (playerCount <= 6) return ['navigator'];
  if (playerCount <= 8) return ['lieutenant', 'navigator'];
  return ['captain', 'lieutenant', 'navigator'];
}

/** The roles that carry a badge/nav cards this round. */
export const TEAM_ROLES: readonly OfficerRole[] = ['lieutenant', 'navigator'];

/** Gun threshold is also readable from The Crew card; keep the function total. */
export function isSailorOrPirate(team: string): boolean {
  return team === 'sailor' || team === 'pirate';
}

/** Next seat clockwise from `id` in a fixed ring. */
export function nextSeat(seatOrder: readonly PlayerId[], id: PlayerId, steps = 1): PlayerId {
  const i = seatOrder.indexOf(id);
  if (i < 0) throw new Error(`nextSeat: ${id} not seated`);
  return seatOrder[(i + steps + seatOrder.length) % seatOrder.length] as PlayerId;
}

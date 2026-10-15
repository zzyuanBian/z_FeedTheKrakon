/**
 * Deck construction for a given game. Pure: uses the passed `Rng` for shuffles
 * and returns data (never mutates its inputs).
 */

import { NAV_CARDS, RITUAL_CARDS, type NavCardId, type RitualCardId } from './state.js';
import { expandCounts, type Rng } from './rng.js';

export function buildNavDeck(map: 'short' | 'long', rng: Rng): NavCardId[] {
  const entries = NAV_CARDS.map((c) => ({
    id: c.id,
    count: map === 'long' ? c.countLong : c.countQuick,
  }));
  return rng.shuffle(expandCounts(entries));
}

export function buildRitualDeck(rng: Rng): RitualCardId[] {
  return rng.shuffle(expandCounts(RITUAL_CARDS));
}

/** Expected deck sizes, for assertions/tests. */
export function navDeckSize(map: 'short' | 'long'): number {
  return NAV_CARDS.reduce((n, c) => n + (map === 'long' ? c.countLong : c.countQuick), 0);
}

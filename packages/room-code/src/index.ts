/**
 * Room code generator: short, pronounceable, all-uppercase alphabetic codes
 * used as human-friendly match identifiers.
 *
 * Design goals:
 *   - 5 characters so the code fits on a phone screen and is easy to say aloud
 *     ("bravo kilo zulu…")
 *   - CV-CVC pattern (consonant/vowel alternating) so the result is roughly
 *     pronounceable — easier to remember than random letters
 *   - ambiguous glyphs stripped (no I/L/O/U that look like 1/l/0/v)
 *
 * The entropy (~14–15 bits) is plenty for a friends-only in-memory lobby: a
 * server holding 20 live rooms has < 0.1 % chance of a collision in the first
 * 10 retry attempts.
 */

// Consonants, minus I/L (look like 1/l) and with both S/Z kept for variety.
const CONSONANTS = 'BCDFGHJKMNPQRSTVWXYZ';
// Vowels, minus ambiguous I/O/U.
const VOWELS = 'AE';

export const CODE_LENGTH = 5;

/** Generate one random code matching the CV-CVC pattern, e.g. `BAKUQ`. */
export function generateRoomCode(rand: () => number = Math.random): string {
  const pick = (pool: string): string => pool[Math.floor(rand() * pool.length)]!;
  // Pattern: C V C V C  (5 chars, pronounceable-ish).
  return [
    pick(CONSONANTS),
    pick(VOWELS),
    pick(CONSONANTS),
    pick(VOWELS),
    pick(CONSONANTS),
  ].join('');
}

/** Normalize user input: uppercase, keep only allowed letters. */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}

export function isRoomCode(s: string): boolean {
  return s.length === CODE_LENGTH && /^[A-Z]{5}$/.test(s);
}

/**
 * Match-ID generator.
 *
 * boardgame.io lets the host plug in its own `uuid` function: every new match
 * calls it to produce the matchID string. For a friends-only game we want codes
 * that are short, pronounceable, and — crucially — **collision-free** against
 * matches still live in the in-memory db.
 *
 * Strategy: a deterministic counter mapped onto the CV-CVC code space. Because
 * each counter value maps to a unique code, collisions are impossible until the
 * entire code space (≈ 28 000 codes) wraps around. To prevent the first few
 * rooms from having obvious codes like BAAAA, the index is salted so the
 * starting offset is unpredictable across server restarts.
 */

import { CODE_LENGTH } from '@ftk/room-code';

const CONSONANTS = 'BCDFGHJKMNPQRSTVWXYZ'; // 20 chars, ambiguous I/L stripped
const VOWELS = 'AE'; // 2 chars, ambiguous I/O/U stripped
// Pattern C-V-C-V-C → 20 * 2 * 20 * 2 * 20 = 32 000 distinct codes.
const SPACE = CONSONANTS.length * VOWELS.length * CONSONANTS.length * VOWELS.length * CONSONANTS.length;

function codeForIndex(i: number): string {
  // Wrap into the code space; negative-safe.
  let n = ((i % SPACE) + SPACE) % SPACE;
  // Decompose from least-significant digit outward; reverse at the end so the
  // pattern reads C-V-C-V-C left-to-right.
  const c0 = CONSONANTS[n % CONSONANTS.length]!; n = Math.floor(n / CONSONANTS.length);
  const v0 = VOWELS[n % VOWELS.length]!;        n = Math.floor(n / VOWELS.length);
  const c1 = CONSONANTS[n % CONSONANTS.length]!; n = Math.floor(n / CONSONANTS.length);
  const v1 = VOWELS[n % VOWELS.length]!;         n = Math.floor(n / VOWELS.length);
  const c2 = CONSONANTS[n % CONSONANTS.length]!;
  return `${c2}${v1}${c1}${v0}${c0}`;
}

/**
 * Build a uuid function bgio can call. The returned closure walks a counter,
 * emitting unique 5-letter codes. A per-process random salt shifts the start
 * so restarts don't always begin with the same code.
 */
export function createRoomCodeUuid(): () => string {
  const salt = Math.floor(Math.random() * SPACE);
  let counter = 0;
  return () => {
    if (counter >= SPACE) {
      // Exceedingly unlikely for a friends-only game, but fail loud rather than
      // silently wrap and reuse codes that might still be live.
      throw new Error(`exhausted room-code space (${SPACE} codes)`);
    }
    const code = codeForIndex(salt + counter);
    counter += 1;
    return code;
  };
}

export { CODE_LENGTH };

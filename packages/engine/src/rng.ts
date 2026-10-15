/**
 * Seeded, state-carried PRNG. Every random draw in the engine goes through an
 * `Rng` built from `GameState.rngState`, and the reducer writes the advanced
 * state back — so a game is fully reproducible from `(seed, ordered actions)`.
 *
 * Algorithm: mulberry32 (32-bit, tiny, good enough for shuffling a card deck).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: readonly T[]): T[];
  /** Current internal state — persist this back onto the game state. */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => {
    if (n <= 0) throw new Error('rng.int: n must be > 0');
    return Math.floor(next() * n);
  };

  const pick = <T>(xs: readonly T[]): T => {
    if (xs.length === 0) throw new Error('rng.pick: empty array');
    return xs[int(xs.length)] as T;
  };

  // Fisher–Yates, returns a new array (does not mutate the input).
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = a[i] as T;
      a[i] = a[j] as T;
      a[j] = tmp;
    }
    return a;
  };

  return { next, int, pick, shuffle, state: () => s };
}

/** Expand a compact spec like ['drunk','drunk','mermaid'] into full lists. */
export function expandCounts<T>(entries: readonly { id: T; count: number }[]): T[] {
  const out: T[] = [];
  for (const e of entries) for (let i = 0; i < e.count; i++) out.push(e.id);
  return out;
}

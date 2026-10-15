import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, generateRoomCode, isRoomCode, normalizeRoomCode } from './index.js';

describe('generateRoomCode', () => {
  it('produces a 5-letter all-uppercase code', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(CODE_LENGTH);
    expect(isRoomCode(code)).toBe(true);
  });

  it('never uses ambiguous glyphs (I, L, O, U)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('follows the CV-CVC pattern', () => {
    // Positions 1 and 3 (0-indexed) are vowels; the rest are consonants.
    const vowels = new Set(['A', 'E']);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(vowels.has(code[1]!)).toBe(true);
      expect(vowels.has(code[3]!)).toBe(true);
      expect(vowels.has(code[0]!)).toBe(false);
      expect(vowels.has(code[2]!)).toBe(false);
      expect(vowels.has(code[4]!)).toBe(false);
    }
  });

  it('respects a deterministic RNG', () => {
    let i = 0;
    const seq = [0, 0.5, 0.25, 0.75, 0.99];
    const code = generateRoomCode(() => seq[i++]!);
    expect(code).toHaveLength(5);
    expect(typeof code).toBe('string');
  });
});

describe('normalizeRoomCode', () => {
  it('uppercases and strips non-letters', () => {
    expect(normalizeRoomCode('bakuq')).toBe('BAKUQ');
    expect(normalizeRoomCode('Ba-Ku_q!')).toBe('BAKUQ');
    expect(normalizeRoomCode('12BAKUQ34')).toBe('BAKUQ');
  });

  it('truncates to CODE_LENGTH', () => {
    expect(normalizeRoomCode('BAKUQXXXX')).toBe('BAKUQ');
  });
});

describe('isRoomCode', () => {
  it('accepts well-formed codes', () => {
    expect(isRoomCode('BAKUQ')).toBe(true);
    expect(isRoomCode('ZZZZZ')).toBe(true);
  });

  it('rejects short / lowercase / numeric input', () => {
    expect(isRoomCode('BAKU')).toBe(false);
    expect(isRoomCode('BAKUQQ')).toBe(false);
    expect(isRoomCode('bakuq')).toBe(false);
    expect(isRoomCode('12345')).toBe(false);
    expect(isRoomCode('')).toBe(false);
  });
});

/** Bundled Quick Journey map (verified 2026-10-14; see doc/ruleset_notes.md). */
import type { RawMap } from '../map.js';
import short from './maps/short.json' with { type: 'json' };

export const SHORT_MAP: RawMap = short as RawMap;

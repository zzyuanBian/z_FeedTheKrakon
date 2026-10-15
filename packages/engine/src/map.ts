/**
 * Map loading and validation. Turns a `map_*.json` (produced by the labelling
 * tool) into a validated `MapDef` plus a `MovementTable`.
 *
 * The movement table is built FAITHFULLY from the printed arrows: every
 * navigable space keeps all three colours. A space may legitimately have two
 * colours pointing at the same neighbour (the board really draws two parallel
 * arrows there) — the table represents that, so `movement[id].yellow` and
 * `movement[id].red` are simply allowed to be equal. Play is unaffected: the
 * ship only ever selects one colour at a time.
 */

import type {
  ArrowColor, Arrow, MapDef, MovementTable, Space, SpaceIcon, SpaceKind,
} from './state.js';
import { ARROW_COLORS } from './state.js';

/** Raw JSON shape emitted by tools/map_editor.html. */
export interface RawMap {
  map: 'short' | 'long';
  image: string;
  imageWidth: number;
  imageHeight: number;
  spaces: { id: number; x: number; y: number; icon: string; kind: string }[];
  arrows: { from: number; color: string; to: number }[];
}

const VALID_KINDS: readonly SpaceKind[] =
  ['normal', 'start', 'win-sailor', 'win-pirate', 'win-kraken'];
const VALID_ICONS: readonly SpaceIcon[] = ['none', 'magnify', 'octopus'];

export interface LoadedMap {
  def: MapDef;
  movement: MovementTable;
  /** Spaces that have at least one outgoing arrow (can be sailed from). */
  navigable: number[];
  /** Terminal spaces (win regions): no outgoing arrows. */
  terminal: number[];
}

function fail(msg: string): never {
  throw new Error(`map: ${msg}`);
}

export function loadMap(raw: RawMap): LoadedMap {
  const ids = new Set<number>();
  const spaces: Space[] = raw.spaces.map((s) => {
    if (ids.has(s.id)) fail(`duplicate space id ${s.id}`);
    ids.add(s.id);
    if (!VALID_KINDS.includes(s.kind as SpaceKind)) fail(`bad kind '${s.kind}' on space ${s.id}`);
    if (!VALID_ICONS.includes(s.icon as SpaceIcon)) fail(`bad icon '${s.icon}' on space ${s.id}`);
    return { id: s.id, x: s.x, y: s.y, kind: s.kind as SpaceKind, icon: s.icon as SpaceIcon };
  });

  const arrows: Arrow[] = raw.arrows.map((a) => {
    if (!ids.has(a.from)) fail(`arrow from unknown space ${a.from}`);
    if (!ids.has(a.to)) fail(`arrow to unknown space ${a.to}`);
    if (!ARROW_COLORS.includes(a.color as ArrowColor)) fail(`bad colour '${a.color}'`);
    if (a.from === a.to) fail(`self-loop on space ${a.from}`);
    return { from: a.from, color: a.color as ArrowColor, to: a.to };
  });

  // Build the movement table + validate.
  const movement: MovementTable = {};
  for (const a of arrows) {
    const row = (movement[a.from] ??= {} as Record<ArrowColor, number>);
    if (row[a.color] !== undefined) fail(`space ${a.from} has two ${a.color} arrows`);
    row[a.color] = a.to;
  }

  const navigable: number[] = [];
  const terminal: number[] = [];
  for (const s of spaces) {
    const row = movement[s.id];
    if (!row) {
      terminal.push(s.id);
      // Terminal spaces must be win regions (a start/normal dead-end is a bug).
      if (s.kind !== 'win-sailor' && s.kind !== 'win-pirate' && s.kind !== 'win-kraken') {
        fail(`space ${s.id} has no outgoing arrows but kind is '${s.kind}'`);
      }
      continue;
    }
    for (const c of ARROW_COLORS) {
      if (row[c] === undefined) fail(`navigable space ${s.id} is missing its ${c} arrow`);
    }
    navigable.push(s.id);
  }

  if (!spaces.some((s) => s.kind === 'start')) fail('no start space');
  if (!spaces.some((s) => s.kind === 'win-kraken')) fail('no kraken win space');

  const def: MapDef = {
    id: raw.map,
    image: raw.image,
    imageWidth: raw.imageWidth,
    imageHeight: raw.imageHeight,
    spaces,
    arrows,
  };
  return { def, movement, navigable, terminal };
}

/** Distinct neighbours reachable from a space, ignoring which colour used. */
export function uniqueTargets(movement: MovementTable, spaceId: number): Set<number> {
  const row = movement[spaceId];
  if (!row) return new Set();
  return new Set(ARROW_COLORS.map((c) => row[c]));
}

/** True if the directed movement graph has no cycle (verified for the short map). */
export function isAcyclic(movement: MovementTable): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>();
  const visit = (u: number): boolean => {
    color.set(u, GRAY);
    const row = movement[u];
    if (row) {
      for (const c of ARROW_COLORS) {
        const v = row[c];
        const cv = color.get(v) ?? WHITE;
        if (cv === GRAY) return false;
        if (cv === WHITE && !visit(v)) return false;
      }
    }
    color.set(u, BLACK);
    return true;
  };
  for (const id of Object.keys(movement).map(Number)) {
    if ((color.get(id) ?? WHITE) === WHITE && !visit(id)) return false;
  }
  return true;
}

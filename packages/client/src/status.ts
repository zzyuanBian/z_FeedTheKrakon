/**
 * What the game is waiting on right now — the single-line status shown in
 * the roster header (and derived once so every surface agrees on it).
 *
 * Also derived here: the navigation pick board (选牌中/已决定). Captain and
 * lieutenant pick simultaneously, so everyone can watch both states; the
 * navigator is shown the same way during the logbook step.
 */

import type { PlayerId, PlayerView } from '@ftk/engine';

export interface WaitStatus {
  text: string;
  cls: 'you' | 'wait' | 'ritual';
}

const nameOf = (view: PlayerView, id: PlayerId): string => {
  const p = id === view.you.id ? view.you : view.others.find((o) => o.id === id);
  return p?.name ?? id;
};

export function waitStatus(view: PlayerView): WaitStatus | null {
  if (view.winner !== null) return null;
  const p = view.pending;
  if (p) {
    return p.isYou
      ? { text: '轮到你操作', cls: 'you' }
      : p.by
        ? { text: `等待 ${nameOf(view, p.by)}`, cls: 'wait' }
        : { text: '仪式进行中', cls: 'ritual' };
  }
  if (view.phase === 'navigation') {
    const { stage, awaiting } = view.navigation;
    // Contribute: BOTH officers pick at once — list whoever is still holding.
    if (stage === 'contribute') {
      const pickers = [view.officers.captain, view.officers.lieutenant]
        .filter((id): id is PlayerId => !!id && !view.navigation.acted.includes(id));
      if (pickers.length > 0) {
        if (pickers.includes(view.you.id)) return { text: '轮到你出牌', cls: 'you' };
        return { text: `等待 ${pickers.map((id) => nameOf(view, id)).join('、')} 出牌`, cls: 'wait' };
      }
    }
    if (stage === 'logbook' && awaiting) {
      return awaiting === view.you.id
        ? { text: '轮到你定航向', cls: 'you' }
        : { text: `等待 ${nameOf(view, awaiting)} 定航向`, cls: 'wait' };
    }
  }
  return null;
}

/** Per-seat pick state during the navigation: 'picking' = still choosing,
 *  'decided' = contribution in. Covers captain + lieutenant while the
 *  contribute stage is open, the navigator during the logbook step. */
export function navPickStatus(view: PlayerView): Partial<Record<PlayerId, 'picking' | 'decided'>> {
  if (view.winner !== null || view.phase !== 'navigation') return {};
  const { stage, acted } = view.navigation;
  const relevant =
    stage === 'contribute'
      ? [view.officers.captain, view.officers.lieutenant]
      : stage === 'logbook'
        ? [view.officers.navigator]
        : [];
  const out: Partial<Record<PlayerId, 'picking' | 'decided'>> = {};
  for (const id of relevant) {
    if (id) out[id] = acted.includes(id) ? 'decided' : 'picking';
  }
  return out;
}

/** One-line summary of the pick board for the quiet action panel
 *  ("选牌中：… · 已决定：…"), or null outside the navigation. */
export function navPickLine(view: PlayerView): string | null {
  const st = navPickStatus(view);
  const ids = Object.keys(st) as PlayerId[];
  if (ids.length === 0) return null;
  const roleOf = (id: PlayerId): string =>
    id === view.officers.captain ? '船长' : id === view.officers.lieutenant ? '大副' : '领航员';
  const fmt = (state: 'picking' | 'decided'): string =>
    ids.filter((id) => st[id] === state).map((id) => `${roleOf(id)}（${nameOf(view, id)}）`).join('、');
  const parts: string[] = [];
  const picking = fmt('picking');
  const decided = fmt('decided');
  if (picking) parts.push(`选牌中：${picking}`);
  if (decided) parts.push(`已决定：${decided}`);
  return parts.join(' · ');
}

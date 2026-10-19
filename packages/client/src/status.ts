/**
 * What the game is waiting on right now — the single-line status shown in
 * the roster header (and derived once so every surface agrees on it).
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
  if (view.phase === 'navigation' && view.navigation.awaiting) {
    const a = view.navigation.awaiting;
    const verb = view.navigation.stage === 'logbook' ? '定航向' : '出牌';
    return a === view.you.id
      ? { text: `轮到你${verb}`, cls: 'you' }
      : { text: `等待 ${nameOf(view, a)} ${verb}`, cls: 'wait' };
  }
  return null;
}

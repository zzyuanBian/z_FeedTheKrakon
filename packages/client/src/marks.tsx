/**
 * Private player marks (Avalon-parity feature, ported from mytest
 * client/src/stores/gameStore.ts `playerMarks` + PlayerMarking.tsx).
 *
 * During a game a player may annotate their suspicion table: tap a crew
 * token, guess that seat's faction / role, and the guess rides the table —
 * colored dots on the chat avatars, badges in the roster list. Purely local
 * note-taking: marks never leave this browser (no move, no state, no leak —
 * you could not share them even by accident), so they live in
 * sessionStorage keyed by matchID+seat and die with the tab.
 */

import { useEffect, useState } from 'react';
import type { PlayerView } from '@ftk/engine';

/** One mark option: storage key, label, and which side it colors. */
export interface MarkOption {
  key: string;
  label: string;
  /** Suspicious (red) vs trustworthy (teal/green). */
  tone: 'evil' | 'good';
}

const MARK_OPTIONS: MarkOption[] = [
  { key: 'sailor', label: '水手', tone: 'good' },
  { key: 'pirate', label: '海盗', tone: 'evil' },
  { key: 'cult', label: '邪教徒', tone: 'evil' },
  { key: 'cultLeader', label: '邪教首领', tone: 'evil' },
];

const MARK_MAP = new Map(MARK_OPTIONS.map((o) => [o.key, o]));

export function markOption(key: string): MarkOption | undefined {
  return MARK_MAP.get(key);
}

export type PlayerMarks = Record<string, string[]>;

const STORAGE_KEY = 'ftk-player-marks';

function storageKey(matchID: string, seat: string): string {
  return `${STORAGE_KEY}:${matchID}:${seat}`;
}

function parse(raw: string | null): PlayerMarks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Keep only string[] values — a hand-edited or older entry must not
    // poison the shape.
    const marks: PlayerMarks = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) marks[id] = v.filter((m): m is string => typeof m === 'string');
    }
    return marks;
  } catch {
    return {};
  }
}

function load(matchID: string, seat: string): PlayerMarks {
  try {
    return parse(sessionStorage.getItem(storageKey(matchID, seat)));
  } catch {
    return {};
  }
}

function save(matchID: string, seat: string, marks: PlayerMarks): void {
  try {
    sessionStorage.setItem(storageKey(matchID, seat), JSON.stringify(marks));
  } catch {
    /* private-mode quota: marks are disposable, dropping them is fine */
  }
}

/** Toggle one mark on one player; returns the updated map. Marks within a
 *  player are a set — faction guesses are mutually exclusive in spirit, but
 *  Avalon's free-toggle felt right there and stays right here. */
export function toggleMark(marks: PlayerMarks, playerId: string, mark: string): PlayerMarks {
  const current = marks[playerId] ?? [];
  const updated = current.includes(mark)
    ? current.filter((m) => m !== mark)
    : [...current, mark];
  return { ...marks, [playerId]: updated };
}

/** React state hook: marks for this match+seat, persisted on every change. */
export function usePlayerMarks(matchID: string, seat: string): {
  marks: PlayerMarks;
  toggle: (playerId: string, mark: string) => void;
  clearAll: () => void;
} {
  const [marks, setMarks] = useState<PlayerMarks>(() => load(matchID, seat));
  useEffect(() => {
    setMarks(load(matchID, seat));
  }, [matchID, seat]);
  const toggle = (playerId: string, mark: string) => {
    setMarks((prev) => {
      const next = toggleMark(prev, playerId, mark);
      save(matchID, seat, next);
      return next;
    });
  };
  const clearAll = () => {
    setMarks({});
    save(matchID, seat, {});
  };
  return { marks, toggle, clearAll };
}

/* ------------------------------ the modal -------------------------------- */

/** Guess sheet for one player (mytest PlayerMarking.tsx, restyled to FTK's
 *  panel language). Renders inside a bottom-sheet overlay, same pattern as
 *  the chat drawer. */
export function PlayerMarkModal({
  view,
  playerId,
  marks,
  onToggle,
  onClearAll,
  onClose,
}: {
  view: PlayerView;
  playerId: string;
  marks: PlayerMarks;
  onToggle: (playerId: string, mark: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const seats = [view.you, ...view.others];
  const target = seats.find((p) => p.id === playerId);
  if (!target) return null;
  const current = marks[playerId] ?? [];

  return (
    <div className="markpop" onClick={onClose}>
      <div className="markpop__sheet" onClick={(e) => e.stopPropagation()}>
        <div className="markpop__head">
          <h3>标记 {target.name}</h3>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="markpop__hint">仅自己可见的猜测笔记，不会发给其他玩家。</p>

        <div className="markpop__group">
          <p className="markpop__group-title">阵营猜测</p>
          <div className="markpop__options">
            {MARK_OPTIONS.map((o) => {
              const active = current.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  className={
                    'markpop__opt' +
                    (active ? ` markpop__opt--on markpop__opt--${o.tone}` : '')
                  }
                  onClick={() => onToggle(playerId, o.key)}
                >
                  {active ? '✓ ' : ''}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="markpop__foot">
          {current.length > 0 && (
            <button type="button" className="markpop__clear" onClick={onClearAll}>
              清空全部标记
            </button>
          )}
          <button type="button" className="btn btn--primary markpop__done" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small colored dots summarizing a player's marks (chat avatar corner,
 *  roster token ring). tone→color: evil red, good teal. */
export function MarkDots({ playerMarks, playerId }: { playerMarks: string[]; playerId: string }) {
  if (playerMarks.length === 0) return null;
  return (
    <span className="mark-dots" data-for={playerId}>
      {playerMarks.map((m) => {
        const tone = markOption(m)?.tone ?? 'good';
        return <span key={m} className={`mark-dots__dot mark-dots__dot--${tone}`} title={markOption(m)?.label ?? m} />;
      })}
    </span>
  );
}

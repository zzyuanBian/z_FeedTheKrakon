/**
 * Live game summary — the narrow column left of the map.
 *
 * Everything shown is public state already on the PlayerView, so "real-time"
 * is free: every broadcast re-renders it. The one derived number is the
 * voyage progress — fewest navigations (BFS over the printed arrows) from
 * the ship's current space to each faction's win region.
 */

import type { PlayerId, PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { PHASE_LABEL } from './labels.js';
import { waitStatus } from './status.js';

/* Movement table + space kinds, built once from the bundled map. */
const MOVEMENT: Record<number, Partial<Record<string, number>>> = {};
for (const a of SHORT_MAP.arrows) (MOVEMENT[a.from] ??= {})[a.color] = a.to;
const KIND: Record<number, string> = {};
for (const s of SHORT_MAP.spaces) KIND[s.id] = s.kind;

type WinKind = 'sailor' | 'pirate' | 'kraken';

/** Fewest navigations from `from` to each win region (null = unreachable). */
function voyageSteps(from: number): Record<WinKind, number | null> {
  const best: Record<WinKind, number | null> = { sailor: null, pirate: null, kraken: null };
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist.get(cur)!;
    // BFS: the first time a region kind is reached is its shortest distance.
    if (KIND[cur] === 'win-sailor') best.sailor ??= d;
    else if (KIND[cur] === 'win-pirate') best.pirate ??= d;
    else if (KIND[cur] === 'win-kraken') best.kraken ??= d;
    for (const to of Object.values(MOVEMENT[cur] ?? {})) {
      if (to === undefined || dist.has(to)) continue;
      dist.set(to, d + 1);
      queue.push(to);
    }
  }
  return best;
}

const VICTORIES: { key: WinKind; icon: string; label: string }[] = [
  { key: 'sailor', icon: '⚓', label: '蓝水湾' },
  { key: 'pirate', icon: '☠️', label: '深红湾' },
  { key: 'kraken', icon: '🐙', label: '海怪' },
];

export function SummaryPanel({ view }: { view: PlayerView }) {
  const nameOf = (id: PlayerId | null): string => {
    if (!id) return '—';
    const p = id === view.you.id ? view.you : view.others.find((o) => o.id === id);
    return p?.name ?? id;
  };

  const steps = voyageSteps(view.ship.spaceId);
  const reached = [steps.sailor, steps.pirate, steps.kraken]
    .filter((n): n is number => n !== null);
  const nearest = reached.length ? Math.min(...reached) : null;

  // Who the game is waiting on (shared with the roster header pill).
  const wait = waitStatus(view);

  const officers: [string, PlayerId | null][] = [
    ['🧭 船长', view.officers.captain],
    ['🎖️ 大副', view.officers.lieutenant],
    ['🏴‍☠️ 领航', view.officers.navigator],
  ];

  return (
    <div className="summary">
      <section className="summary__sec">
        <h3 className="summary__title">航程</h3>
        {VICTORIES.map(({ key, icon, label }) => {
          const d = steps[key];
          return (
            <div
              key={key}
              className={'summary__row' + (d !== null && d === nearest ? ' summary__row--near' : '')}
            >
              <span className="summary__label">
                <span className="summary__glyph" aria-hidden="true">{icon}</span>
                {label}
              </span>
              <span className={`summary__val summary__val--${key}`}>
                {d ?? '—'}<small> 步</small>
              </span>
            </div>
          );
        })}
      </section>

      <section className="summary__sec">
        <h3 className="summary__title">现状</h3>
        <div className="summary__row summary__round">
          第 <b>{view.round}</b> 回合 · {PHASE_LABEL[view.phase] ?? view.phase}
        </div>
        {officers.map(([role, id]) => (
          <div key={role} className="summary__row">
            <span className="summary__label">{role}</span>
            <span className="summary__val summary__val--name">{nameOf(id)}</span>
          </div>
        ))}
      </section>

      <section className="summary__sec">
        <h3 className="summary__title">补给</h3>
        <div className="summary__row">
          <span className="summary__label">牌堆</span>
          <span className="summary__val">{view.navigation.deckCount}</span>
        </div>
        <div className="summary__row">
          <span className="summary__label">深海</span>
          <span className="summary__val">{view.navigation.discardCount}</span>
        </div>
        <div className="summary__row">
          <span className="summary__label">仪式余</span>
          <span className="summary__val summary__val--kraken">{view.rituals.remaining}</span>
        </div>
        <div className="summary__row">
          <span className="summary__label">公枪</span>
          <span className="summary__val">{view.gunSupply}</span>
        </div>
      </section>

      {(view.mutiny.active || view.ship.emergency || wait) && (
        <section className="summary__sec summary__sec--alerts">
          {view.mutiny.active && (
            <div className="summary__alert summary__alert--mutiny">
              ⚡ 哗变 · 需 {view.mutiny.threshold} 枪
            </div>
          )}
          {view.ship.emergency && (
            <div className="summary__alert summary__alert--mutiny">⚠ 紧急航行</div>
          )}
          {wait && <div className={`summary__alert summary__alert--${wait.cls}`}>{wait.text}</div>}
        </section>
      )}
    </div>
  );
}

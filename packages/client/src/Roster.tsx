/**
 * Player roster as the crew circle — everyone seated around the ship's table.
 * You sit at the bottom (6 o'clock); the rest spread clockwise in seat order.
 * Public information only. `team` exists solely on the viewer's own seat —
 * the type makes leaking another player's faction impossible.
 */

import type { PlayerView } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL } from './labels.js';

export function Roster({ view }: { view: PlayerView }) {
  // Bench seats (beyond the target crew size) are not players — never render.
  const seats = [view.you, ...view.others].filter((p) => !p.benched);
  const { officers } = view;
  const n = seats.length;

  // You at the 6-o'clock position; later seats walk clockwise around the
  // table. Screen coords (y grows downward) put angle 90° at bottom centre.
  const angleOf = (i: number) => ((90 + (360 / n) * i) * Math.PI) / 180;
  // Seat-anchor radius as a % of the table — seats sit on the dashed ring.
  const R = 40;

  return (
    <section className="roster">
      <h3 className="sec__title">船员 · {n} 人</h3>
      <div className={'roster__table' + (n >= 9 ? ' roster__table--crowded' : '')}>
        <div className="roster__ring" aria-hidden="true" />
        <div className="roster__hub" aria-hidden="true">
          <span className="roster__hub-glyph">⚓</span>
          <span className="roster__hub-count">{n} 人</span>
        </div>
        {seats.map((p, i) => {
          const self = p.id === view.you.id;
          const team = self ? view.you.team : null;
          const a = angleOf(i);
          return (
            <div
              key={p.id}
              className={
                'roster__seat' +
                (self ? ' roster__seat--self' : '') +
                (p.alive ? '' : ' roster__seat--dead')
              }
              style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` }}
            >
              <span className="roster__seat-name">
                {officers.captain === p.id && <em title="船长">🧭</em>}
                {officers.lieutenant === p.id && <em title="大副">🎖️</em>}
                {officers.navigator === p.id && <em title="领航员">🏴‍☠️</em>}
                {p.name}
                {self && ' (你)'}
              </span>
              <span className="roster__seat-meta">
                {team && <span className="badge">{FACTION_ICON[team]}{FACTION_LABEL[team]}</span>}
                <span className="badge" title="枪">🔫{p.guns}</span>
                <span className="badge" title="履历">📜{p.resumes}</span>
                {p.offDuty && <span className="badge badge--off" title="轮休">💤</span>}
                {p.declaredCult && <span className="badge badge--cult" title="已被公开为邪教徒">🐙</span>}
                {!p.alive && <span className="badge badge--dead">出局</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Player roster: public information only. `team` exists solely on the viewer's
 * own row — the type makes leaking another player's faction impossible.
 */

import type { PlayerView } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL } from './labels.js';

export function Roster({ view }: { view: PlayerView }) {
  const rows = [view.you, ...view.others];
  const { officers } = view;
  return (
    <section className="roster">
      <h3 className="sec__title">船员</h3>
      <ul className="roster__list">
        {rows.map((p) => {
          const self = p.id === view.you.id;
          const team = self ? view.you.team : null;
          return (
            <li key={p.id} className={'roster__row' + (p.alive ? '' : ' roster__row--dead')}>
              <span className="roster__name">
                {officers.captain === p.id && <em title="船长">🧭</em>}
                {officers.lieutenant === p.id && <em title="大副">🎖️</em>}
                {officers.navigator === p.id && <em title="领航员">🏴‍☠️</em>}
                {p.name}
                {self && ' (你)'}
              </span>
              <span className="roster__meta">
                {team && <span className="badge">{FACTION_ICON[team]}{FACTION_LABEL[team]}</span>}
                <span className="badge" title="枪">🔫{p.guns}</span>
                <span className="badge" title="履历">📜{p.resumes}</span>
                {p.offDuty && <span className="badge badge--off" title="轮休">💤</span>}
                {p.declaredCult && <span className="badge badge--cult" title="已被公开为邪教徒">🐙</span>}
                {!p.alive && <span className="badge badge--dead">已出局</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

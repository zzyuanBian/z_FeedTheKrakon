/**
 * Player roster as the crew circle — avatar tokens around the ship's table,
 * with a compact info list below. You sit at the bottom (6 o'clock); the
 * rest spread clockwise in seat order.
 *
 * Why tokens instead of info cards: a 380px sidebar cannot fit 11 fixed-size
 * cards around a ring without overlap (chord distance at 11 seats < card
 * width). Small round tokens (portrait + officer crest) never collide, and
 * the per-player detail (guns / resumes / status badges) lives in the
 * always-visible list under the table instead. Public information only;
 * `team` exists solely on the viewer's own seat — the type makes leaking
 * another player's faction impossible.
 *
 * Avalon-parity: tapping ANOTHER player's token opens the private marking
 * sheet (faction/role guesses, this browser only). Marks render as colored
 * dots pinned to the token and as badges in the list below.
 */

import { useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL } from './labels.js';
import { AvatarImage } from './Avatars.js';
import { MarkDots, PlayerMarkModal, markOption, type PlayerMarks } from './marks.js';
import { navPickStatus } from './status.js';

/** Set of the viewer's starting teammates (pirate gathering / leader's
 *  flock) — rendered as a persistent badge on those seats. Private by
 *  construction: the engine ships `teammates` only in the viewer's own view. */
function teammateSet(view: PlayerView): Set<string> {
  return new Set(view.you.teammates ?? []);
}

export function Roster({
  view,
  marks,
  onToggleMark,
  onClearMarks,
}: {
  view: PlayerView;
  marks: PlayerMarks;
  onToggleMark: (playerId: string, mark: string) => void;
  onClearMarks: () => void;
}) {
  // Bench seats (beyond the target crew size) are not players — never render.
  const seats = [view.you, ...view.others].filter((p) => !p.benched);
  const { officers } = view;
  const n = seats.length;
  const [marking, setMarking] = useState<string | null>(null);
  const mates = teammateSet(view);

  // You at the 6-o'clock position; later seats walk clockwise around the
  // table. Screen coords (y grows downward) put angle 90° at bottom centre.
  const angleOf = (i: number) => ((90 + (360 / n) * i) * Math.PI) / 180;
  const R = 40;
  // Navigation pick board (选牌中/已决定) while the crew is choosing cards.
  const picking = navPickStatus(view);

  return (
    <section className="roster">
      <div className="roster__table">
        <div className="roster__ring" aria-hidden="true" />
        <div className="roster__hub" aria-hidden="true">
          <span className="roster__hub-glyph">⚓</span>
          <span className="roster__hub-count">{n} 人</span>
        </div>
        {seats.map((p, i) => {
          const self = p.id === view.you.id;
          const a = angleOf(i);
          const myMarks = marks[p.id] ?? [];
          const pick = picking[p.id];
          return (
            <div
              key={p.id}
              className={
                'roster__token' +
                (self ? ' roster__token--self' : '') +
                (p.alive ? '' : ' roster__token--dead') +
                (self ? '' : ' roster__token--markable')
              }
              style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` }}
              title={self ? p.name : `${p.name}（点击标记）`}
              onClick={() => !self && setMarking(p.id)}
            >
              {/* Officer crests as corner badges. */}
              {officers.captain === p.id && (
                <span className="roster__token-crest" title="船长">🧭</span>
              )}
              {officers.lieutenant === p.id && (
                <span className="roster__token-crest" title="大副">🎖️</span>
              )}
              {officers.navigator === p.id && (
                <span className="roster__token-crest" title="领航员">🏴‍☠️</span>
              )}
              {mates.has(p.id) && (
                <span
                  className={'roster__token-mate ' + (view.you.cultLeader ? 'roster__token-mate--cult' : '')}
                  title={view.you.cultLeader ? '你的邪教同伴' : '你的海盗同伴'}
                >
                  {view.you.cultLeader ? '🐙' : '☠️'}
                </span>
              )}
              {p.offDuty && <span className="roster__token-dot" title="歇班">💤</span>}
              {p.declaredCult && (
                <span className="roster__token-dot roster__token-dot--cult" title="已被公开为邪教徒">🐙</span>
              )}
              <AvatarImage avatarId={p.avatar} size={40} title={p.name} className="roster__token-face" />
              {/* Name label beside the seat token. */}
              <span className={'roster__token-name' + (self ? ' roster__token-name--self' : '')}>
                {p.name}
              </span>
              {/* Live pick state while the navigation cards are being chosen. */}
              {pick && (
                <span
                  className={'roster__token-pick' + (pick === 'decided' ? ' roster__token-pick--decided' : '')}
                >
                  {pick === 'decided' ? '已决定' : '选牌中'}
                </span>
              )}
              {/* Private guess notes, pinned to the token's lower edge. */}
              <MarkDots playerMarks={myMarks} playerId={p.id} />
            </div>
          );
        })}
      </div>

      <ul className="roster__list">
        {seats.map((p) => {
          const self = p.id === view.you.id;
          const team = self ? view.you.team : null;
          const myMarks = marks[p.id] ?? [];
          return (
            <li
              key={p.id}
              className={
                'roster__row' +
                (self ? ' roster__row--self' : '') +
                (p.alive ? '' : ' roster__row--dead')
              }
              onClick={() => !self && setMarking(p.id)}
            >
              <AvatarImage avatarId={p.avatar} size={24} title={p.name} className="roster__row-ava" />
              <span className="roster__row-name">
                {officers.captain === p.id && <em title="船长">🧭</em>}
                {officers.lieutenant === p.id && <em title="大副">🎖️</em>}
                {officers.navigator === p.id && <em title="领航员">🏴‍☠️</em>}
                {mates.has(p.id) && (
                  <em
                    className={'roster__row-mate ' + (view.you.cultLeader ? 'roster__row-mate--cult' : '')}
                    title={view.you.cultLeader ? '你的邪教同伴' : '你的海盗同伴'}
                  >
                    {view.you.cultLeader ? '🐙' : '☠️'}
                  </em>
                )}
                {p.name}
                {self && ' (你)'}
              </span>
              <span className="roster__row-meta">
                {/* Guess badges: click a row (not self) to edit them. */}
                {!self &&
                  myMarks.map((m) => (
                    <span
                      key={m}
                      className={`badge badge--mark badge--mark-${markOption(m)?.tone ?? 'good'}`}
                    >
                      {markOption(m)?.label ?? m}
                    </span>
                  ))}
                {team && <span className="badge">{FACTION_ICON[team]}{FACTION_LABEL[team]}</span>}
                <span className="badge" title="枪">🔫{p.guns}</span>
                <span className="badge" title="履历">📜{p.resumes}</span>
                {p.offDuty && <span className="badge badge--off" title="歇班">💤</span>}
                {p.declaredCult && <span className="badge badge--cult" title="已被公开为邪教徒">🐙</span>}
                {!p.alive && <span className="badge badge--dead">出局</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {marking && (
        <PlayerMarkModal
          view={view}
          playerId={marking}
          marks={marks}
          onToggle={onToggleMark}
          onClearAll={onClearMarks}
          onClose={() => setMarking(null)}
        />
      )}
    </section>
  );
}

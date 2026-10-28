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
import { GUN_URL } from './assets.js';
import { MarkDots, PlayerMarkModal, markOption, type PlayerMarks } from './marks.js';
import { navPickStatus } from './status.js';
import { ResumeModal, resumesFromLog } from './Resumes.js';

/** Teammate badges on seats, split by WHICH KIND of mate they are — the
 *  badge icon/tooltip must describe the team-mate, not the viewer:
 *  - cultMaster: the converter (always the Cult Leader) → 🐙 邪教首领;
 *  - pirateMates: fellow pirates (☠️ 海盗同伴) — pirate sight only;
 *  - cultMates: the leader's starting flock (🐙 邪教同伴).
 * Private by construction: the engine ships these only in the viewer's own
 * view. */
function mateSets(view: PlayerView): {
  cultMaster: Set<string>;
  pirateMates: Set<string>;
  cultMates: Set<string>;
} {
  const teammates = view.you.teammates ?? [];
  return {
    cultMaster: new Set(view.you.convertedBy ? [view.you.convertedBy] : []),
    pirateMates: new Set(view.you.team === 'pirate' ? teammates : []),
    cultMates: new Set(view.you.cultLeader ? teammates : []),
  };
}

export function Roster({
  view,
  marks,
  onToggleMark,
  onClearPlayerMarks,
}: {
  view: PlayerView;
  marks: PlayerMarks;
  onToggleMark: (playerId: string, mark: string) => void;
  onClearPlayerMarks: (playerId: string) => void;
}) {
  // Bench seats (beyond the target crew size) are not players — never render.
  const seats = [view.you, ...view.others].filter((p) => !p.benched);
  const { officers } = view;
  const n = seats.length;
  const [marking, setMarking] = useState<string | null>(null);
  // Résumé inspection: which nav cards each player has earned as captain
  // (public per the rulebook). null = no sheet open.
  const [resumeOf, setResumeOf] = useState<string | null>(null);
  const resumes = resumesFromLog(view);
  const mates = mateSets(view);
  /** Per-seat teammate badge: which kind of mate is this seat (if any)? */
  const mateOf = (id: string): 'master' | 'pirate' | 'cult' | null =>
    mates.cultMaster.has(id) ? 'master' : mates.pirateMates.has(id) ? 'pirate' : mates.cultMates.has(id) ? 'cult' : null;

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
              {/* Officer crests as corner badges (rulebook medal scans). */}
              {officers.captain === p.id && (
                <img className="roster__token-medal" src="img/crest-captain.png" alt="船长" title="船长" draggable={false} />
              )}
              {officers.lieutenant === p.id && (
                <img className="roster__token-medal" src="img/crest-lieutenant.png" alt="大副" title="大副" draggable={false} />
              )}
              {officers.navigator === p.id && (
                <img className="roster__token-medal" src="img/crest-navigator.png" alt="领航员" title="领航员" draggable={false} />
              )}
              {mateOf(p.id) === 'master' && (
                <span className="roster__token-mate roster__token-mate--cult" title="邪教首领（转化了你）">🐙</span>
              )}
              {mateOf(p.id) === 'pirate' && (
                <span className="roster__token-mate" title="你的海盗同伴">☠️</span>
              )}
              {mateOf(p.id) === 'cult' && (
                <span className="roster__token-mate roster__token-mate--cult" title="你的邪教同伴">🐙</span>
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
                {officers.captain === p.id && <img className="roster__row-medal" src="img/crest-captain.png" alt="船长" title="船长" draggable={false} />}
                {officers.lieutenant === p.id && <img className="roster__row-medal" src="img/crest-lieutenant.png" alt="大副" title="大副" draggable={false} />}
                {officers.navigator === p.id && <img className="roster__row-medal" src="img/crest-navigator.png" alt="领航员" title="领航员" draggable={false} />}
                {mateOf(p.id) === 'master' && <em className="roster__row-mate roster__row-mate--cult" title="邪教首领（转化了你）">🐙</em>}
                {mateOf(p.id) === 'pirate' && <em className="roster__row-mate" title="你的海盗同伴">☠️</em>}
                {mateOf(p.id) === 'cult' && <em className="roster__row-mate roster__row-mate--cult" title="你的邪教同伴">🐙</em>}
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
                <span className="badge" title="枪"><img className="gun-ico" src={GUN_URL} alt="" />{p.guns}</span>
                {/* Résumés are public — tap to inspect the actual cards. */}
                <button
                  type="button"
                  className="badge badge--link"
                  title="查看履历（担任船长时领出的航海卡）"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResumeOf(p.id);
                  }}
                >
                  📜{p.resumes}
                </button>
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
          onClearPlayer={onClearPlayerMarks}
          onClose={() => setMarking(null)}
        />
      )}

      {resumeOf && (
        <ResumeModal
          view={view}
          playerId={resumeOf}
          resumes={resumes[resumeOf] ?? []}
          onClose={() => setResumeOf(null)}
        />
      )}
    </section>
  );
}

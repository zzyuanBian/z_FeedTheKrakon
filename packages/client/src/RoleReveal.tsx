/**
 * Role-reveal screen (Avalon-style).
 *
 * Each player sees a face-down card that they flip by tapping. Flipping IS
 * readiness: after the flip animation plays the client broadcasts
 * `confirmRole` on its own (the old "我准备好了" button is gone). Once every
 * seat is in `state.confirmedRole`, the move gate in @ftk/game lifts and App
 * holds this screen up for a shared 5-second countdown before revealing the
 * board.
 *
 * `alreadyConfirmed` covers the refresh-after-confirm case: the player has
 * already done their bit, so skip the flip and show a "waiting on others"
 * message.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

export interface RoleRevealProps {
  view: PlayerView;
  onConfirm: () => void;
  /** Shared launch countdown, owned by App (null while still waiting). */
  countdown: number | null;
}

/** True physical card art, scanned from the tabletop edition.
 *  `camp-back.jpg` is the shared card back (four colour quadrants + compass).
 *  `camp-fronts.jpg` is a 2×2 contact sheet of the three wax-seal fronts
 *  (top-left pirate, top-right cult, bottom-left sailor; the bottom-right
 *  quadrant is black filler). We crop the needed quadrant in CSS — see
 *  .role-card__art--{team} in styles.css. */
const CARD_BACK = 'cards/camp-back.jpg';
const CARD_FRONTS = 'cards/camp-fronts.jpg';

/** Wait until both card scans are in the browser cache (index.html already
 *  preloads them, so this usually resolves instantly). Until then the flip
 *  card is hidden — half-loaded art must never be visible. */
function useCardArtReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const pending = [CARD_BACK, CARD_FRONTS].map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve();
          img.src = src;
        }),
    );
    void Promise.all(pending).then(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);
  return ready;
}

const ROLE_TITLE: Record<string, string> = {
  sailor: '水手',
  pirate: '海盗',
  cult: '邪教徒',
};

const ROLE_COPY: Record<string, string> = {
  sailor: '忠于船长，提防海盗与邪教徒。',
  pirate: '船长和水手都不知道你的真实身份。伺机而动。',
  cult: '你是克苏鲁的仆从。等待时机，转化船员。',
};

export function RoleReveal({ view, onConfirm, countdown }: RoleRevealProps) {
  const artReady = useCardArtReady();
  const alreadyConfirmed = view.you.roleConfirmed;
  const [flipped, setFlipped] = useState(alreadyConfirmed);
  // Flip-then-confirm: the reveal broadcast doubles as the readiness signal.
  // A ref guards the 0.9s timer against double fires (React 18 strict mode,
  // re-renders) so exactly one `confirmRole` goes out per flip.
  const sentRef = useRef(alreadyConfirmed);

  const { confirmed, total } = view.roleConfirmations;
  const team = view.you.team;
  const title = ROLE_TITLE[team] ?? team;
  const copy = ROLE_COPY[team] ?? '';
  const knownNames = view.you.knownCultists.map((id) => {
    if (id === view.you.id) return view.you.name;
    return view.others.find((p) => p.id === id)?.name ?? id;
  });

  const handleFlip = () => {
    if (flipped || sentRef.current) return;
    setFlipped(true);
    // Let the 0.8s flip animation finish so the player has actually SEEN
    // their card before readiness registers.
    window.setTimeout(() => {
      if (!sentRef.current) {
        sentRef.current = true;
        onConfirm();
      }
    }, 900);
  };

  return (
    <div className="role-reveal">
      <div className="role-reveal__hero">
        <div className="role-reveal__ornament" aria-hidden="true">🕯️</div>
        <h2 className="role-reveal__title">身份确认</h2>
        <p className="role-reveal__sub">
          {alreadyConfirmed
            ? '你已确认身份，等待其他船员'
            : '翻开你的卡牌，确认你在船上的身份'}
        </p>
      </div>

      {artReady ? (
        <button
          type="button"
          className={'role-card' + (flipped ? ' role-card--flipped' : '')}
          onClick={handleFlip}
          aria-label={flipped ? '身份卡（已翻开）' : '点击翻开身份卡'}
          disabled={flipped}
        >
          <div className="role-card__inner">
            <div className="role-card__face role-card__face--back">
              <img className="role-card__art" src={CARD_BACK} alt="" draggable={false} />
              <div className="role-card__back-hint">点击翻开</div>
            </div>
            <div className={'role-card__face role-card__face--front role-card__face--' + team}>
              <img className={'role-card__art role-card__art--' + team} src={CARD_FRONTS} alt="" draggable={false} />
              <div className="role-card__caption">
                <div className="role-card__role">{title}</div>
                {view.you.cultLeader && <div className="role-card__leader">· 首领 ·</div>}
              </div>
            </div>
          </div>
        </button>
      ) : (
        <div className="role-card role-card--loading" aria-label="卡牌整理中">
          <div className="role-card__inner">
            <div className="role-card__face role-card__face--loading">
              <span className="role-card__loading-anchor" aria-hidden="true">⚓</span>
              <span className="role-card__loading-text">卡牌整理中…</span>
            </div>
          </div>
        </div>
      )}

      {flipped && !alreadyConfirmed && (
        <div className="role-reveal__info">
          <p className="role-reveal__copy">{copy}</p>
          {team === 'cult' && view.you.cultLeader && knownNames.length > 0 && (
            <div className="role-reveal__known">
              <div className="role-reveal__known-title">克苏鲁选中了这些人：</div>
              <ul className="role-reveal__known-list">
                {knownNames.map((n) => (
                  <li key={n}>
                    <span className="role-reveal__known-glyph" aria-hidden="true">🐙</span>
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="role-reveal__status">
        <span className="role-reveal__count">
          已准备 <strong>{confirmed}</strong> / {total}
        </span>
      </div>
      {/* Crew readiness list, Avalon-style: every active seat with its
          ✓/未准备 mark so the table can see who is holding up the reveal.
          bySeat runs along seatOrder (active seats only) and seat ids are
          `p<seat+1>`, so row i maps to playerId `p${i + 1}`. Benched players
          hold no role card and are skipped, mirroring the count. */}
      <div className="role-reveal__readiness">
        <div className="role-reveal__readiness-title">船员准备情况</div>
        <ul className="role-reveal__readiness-list">
          {[...view.others.map((p) => ({ ...p, me: false })), { ...view.you, me: true }]
            .filter((p) => !p.benched)
            .sort((a, b) => a.seat - b.seat)
            .map((p) => {
              const seatIdx = Number(p.id.slice(1)) - 1;
              const ready = view.roleConfirmations.bySeat[seatIdx] === true;
              return (
                <li
                  key={p.id}
                  className={
                    'role-reveal__readiness-row'
                    + (p.me ? ' role-reveal__readiness-row--me' : '')
                    + (ready ? ' role-reveal__readiness-row--ready' : '')
                  }
                >
                  <AvatarImage avatarId={p.avatar} size={26} className="role-reveal__readiness-ava" />
                  <span className="role-reveal__readiness-name">
                    {p.name}
                    {p.me && <span className="role-reveal__readiness-me">（我）</span>}
                  </span>
                  <span className="role-reveal__readiness-mark">
                    {ready ? '✓ 已准备' : '未准备'}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>

      {/* Shared launch countdown — App owns the timer so every client sees
          the same number the moment the all-ready broadcast lands. */}
      {countdown !== null && (
        <div className="role-reveal__launch" role="status" aria-live="assertive">
          <p className="role-reveal__launch-label">全员已准备，即将启航</p>
          <span className="role-reveal__launch-num">{countdown}</span>
        </div>
      )}
    </div>
  );
}

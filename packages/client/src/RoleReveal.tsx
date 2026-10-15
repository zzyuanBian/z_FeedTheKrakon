/**
 * Role-reveal screen (Avalon-style).
 *
 * Each player sees a face-down card that they flip by tapping. Once flipped:
 *   - their own faction + role title
 *   - for the Cult Leader: a list of fellow cultists (Merlin-sight)
 *   - for pirates: a reminder that they're undercover
 *   - for sailors: a reminder of duty
 *
 * A "我准备好了" button becomes enabled after the flip. Once the player
 * confirms, the server marks them in `state.confirmedRole`. When every seat
 * has confirmed, the move gate in @ftk/game lifts and the captain can make
 * their first appointment.
 *
 * `alreadyConfirmed` covers the refresh-after-confirm case: the player has
 * already done their bit, so skip the flip and show a "waiting on others"
 * message.
 */

import { useState } from 'react';
import type { PlayerView } from '@ftk/engine';

export interface RoleRevealProps {
  view: PlayerView;
  onConfirm: () => void;
}

const FACTION_GLYPH: Record<string, string> = {
  sailor: '⚓',
  pirate: '☠️',
  cult: '🐙',
};

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

export function RoleReveal({ view, onConfirm }: RoleRevealProps) {
  const alreadyConfirmed = view.you.roleConfirmed;
  const [flipped, setFlipped] = useState(alreadyConfirmed);
  const [submitted, setSubmitted] = useState(alreadyConfirmed);

  const { confirmed, total } = view.roleConfirmations;
  const team = view.you.team;
  const glyph = FACTION_GLYPH[team] ?? '❓';
  const title = ROLE_TITLE[team] ?? team;
  const copy = ROLE_COPY[team] ?? '';
  const knownNames = view.you.knownCultists.map((id) => {
    if (id === view.you.id) return view.you.name;
    return view.others.find((p) => p.id === id)?.name ?? id;
  });

  const handleConfirm = () => {
    if (!flipped || submitted) return;
    setSubmitted(true);
    onConfirm();
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

      <button
        type="button"
        className={'role-card' + (flipped ? ' role-card--flipped' : '')}
        onClick={() => !flipped && setFlipped(true)}
        aria-label={flipped ? '身份卡（已翻开）' : '点击翻开身份卡'}
        disabled={flipped}
      >
        <div className="role-card__inner">
          <div className="role-card__face role-card__face--back">
            <div className="role-card__back-glyph" aria-hidden="true">⚓</div>
            <div className="role-card__back-title">险恶疑航</div>
            <div className="role-card__back-hint">点击翻开</div>
          </div>
          <div className={'role-card__face role-card__face--front role-card__face--' + team}>
            <div className="role-card__glyph">{glyph}</div>
            <div className="role-card__role">{title}</div>
            {view.you.cultLeader && <div className="role-card__leader">· 首领 ·</div>}
          </div>
        </div>
      </button>

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

      <button
        type="button"
        className="btn-cthulhu btn-cthulhu--gold role-reveal__confirm"
        onClick={handleConfirm}
        disabled={!flipped || submitted}
      >
        <span className="btn-cthulhu__glyph">✓</span>
        <span className="btn-cthulhu__body">
          <span className="btn-cthulhu__title">
            {!flipped ? '先翻开卡牌' : submitted ? '已确认，等待其他船员…' : '我准备好了'}
          </span>
        </span>
      </button>
    </div>
  );
}

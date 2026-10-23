/**
 * 仪式选牌页 (ritual pick window). House rule: the Cult Uprising card lets
 * the CAPTAIN pick which ritual to carry out. When the pick window opens
 * (pending kind=ritual step=chooseRitual) every seat pops this overlay:
 * the remaining ritual KINDS laid out in a row — name + rules text. Only
 * the captain's cards are clickable; everyone else sees 等待船长选择.
 *
 * The pick is PUBLIC (the chosen card is revealed face-up): this overlay
 * closes for all seats the moment the engine consumes the pick, and the
 * 邪教仪式 flow (RitualPeek → 闭眼 veil → RitualForm) takes over with the
 * picked card.
 */

import type { PlayerView, RitualCardId } from '@ftk/engine';
import { RITUAL_LABEL, RITUAL_HINT } from './labels.js';

export function ritualPickActive(view: PlayerView): boolean {
  return view.winner === null && view.rituals.pickable.length > 0;
}

const GLYPH: Record<RitualCardId, string> = {
  conversion: '🕯️',
  gunsStash: '🔫',
  cultCabinSearch: '🔍',
};

export function RitualChoice({ view, onPick }: {
  view: PlayerView;
  onPick: (card: RitualCardId) => void;
}) {
  const cards = view.rituals.pickable;
  // pending.by IS the captain during the pick window, so isYou says it all.
  const myChoice = view.pending?.isYou === true;

  return (
    <div className="modal ritual-choice" role="alertdialog" aria-label="邪教仪式 — 船长选牌">
      <div className="modal__box ritual-choice__box">
        <p className="ritual-choice__kicker">航海牌 · 邪教起义</p>
        <h3 className="ritual-choice__title">船长必须选择一张仪式牌</h3>
        <div className="ritual-choice__row">
          {cards.map((card) => (
            <button
              key={card}
              type="button"
              className="ritual-choice__card"
              disabled={!myChoice}
              onClick={() => onPick(card)}
              title={RITUAL_HINT[card]}
            >
              <span className="ritual-choice__glyph" aria-hidden="true">{GLYPH[card]}</span>
              <span className="ritual-choice__name">{RITUAL_LABEL[card]}</span>
              <span className="ritual-choice__hint">{RITUAL_HINT[card]}</span>
            </button>
          ))}
        </div>
        <p className="ritual-choice__wait">
          {myChoice ? '点击一张仪式牌，当众翻开并执行。' : '等待船长选择…'}
        </p>
      </div>
    </div>
  );
}

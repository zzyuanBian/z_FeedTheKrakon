/**
 * 仪式选牌页 (ritual pick window). House rule: the Cult Uprising card lets
 * the CAPTAIN pick which ritual to carry out — by drawing a FACE-DOWN card
 * from the remaining deck, exactly like drawing from the table pile. Every
 * seat pops this overlay: `rituals.picking` uniform card backs in a row.
 * Only the captain's backs are clickable (slot index — which kind sits
 * where never leaves the engine); everyone else sees 等待船长选择.
 *
 * The pick is public as an EVENT (all seats see the pile shrink and the
 * flipped card next): the overlay closes for everyone the moment the engine
 * consumes the slot, and the 5s RitualPeek shows what was drawn before the
 * 闭眼 flow takes over.
 */

import type { PlayerView } from '@ftk/engine';

export function ritualPickActive(view: PlayerView): boolean {
  return view.winner === null && view.rituals.picking > 0;
}

const DECK_RITUAL = 'cards/deck-ritual.jpg';

export function RitualChoice({ view, onPick }: {
  view: PlayerView;
  onPick: (slot: number) => void;
}) {
  const cards = view.rituals.picking;
  // pending.by IS the captain during the pick window, so isYou says it all.
  const myChoice = view.pending?.isYou === true;

  return (
    <div className="modal ritual-choice" role="alertdialog" aria-label="邪教仪式 — 船长选牌">
      <div className="modal__box ritual-choice__box">
        <p className="ritual-choice__kicker">航海牌 · 邪教起义</p>
        <h3 className="ritual-choice__title">船长从剩余仪式牌中抽一张</h3>
        <div className="ritual-choice__row">
          {Array.from({ length: cards }, (_, slot) => (
            <button
              key={slot}
              type="button"
              className="ritual-choice__card"
              disabled={!myChoice}
              onClick={() => onPick(slot)}
              aria-label={`抽第 ${slot + 1} 张仪式牌`}
            >
              <img src={DECK_RITUAL} alt="" draggable={false} />
            </button>
          ))}
        </div>
        <p className="ritual-choice__wait">
          {myChoice ? '点选一张牌背，当众翻开并执行。' : '等待船长选择…'}
        </p>
      </div>
    </div>
  );
}

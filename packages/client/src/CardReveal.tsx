/**
 * 航海牌揭示弹框. When the navigator settles the logbook the engine flips
 * the card (`navigation.revealed`) and applies it — every client pops this
 * modal at that same moment, showing the card art plus WHAT IT DOES, so
 * nobody has to know the labels by heart (the tabletop group reads the
 * physical card; here the screen must say it).
 *
 * Edge/latch: App keys this veil on `round:revealedCard`; when the key is
 * unseen the modal opens, 继续航程/继续 dismisses it by recording the key.
 * A refresh re-opens it only for the CURRENT card (the latch holds the seen
 * key in memory — after a refresh mid-execution the player gets the card
 * explanation once more, which is acceptable and even helpful).
 */

import type { PlayerView } from '@ftk/engine';
import { NAV_CARD_LABEL, NAV_CARD_HINT } from './labels.js';
import { NavCardFace } from './NavCardFace.js';

export function cardRevealKey(view: PlayerView): string | null {
  const card = view.navigation.revealed;
  if (card === null || view.winner !== null) return null;
  return `${view.round}:${card}`;
}

export function CardReveal({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const card = view.navigation.revealed!;
  return (
    <div className="modal card-reveal" role="alertdialog" aria-label="翻开航海牌">
      <div className="modal__box card-reveal__box">
        <p className="card-reveal__kicker">领航员翻开了航海牌</p>
        <div className="card-reveal__face">
          <NavCardFace card={card} />
        </div>
        <h3 className="card-reveal__title">{NAV_CARD_LABEL[card]}</h3>
        <p className="card-reveal__hint">{NAV_CARD_HINT[card]}</p>
        <button type="button" className="btn btn--primary card-reveal__close" onClick={onDone}>
          继续航程
        </button>
      </div>
    </div>
  );
}

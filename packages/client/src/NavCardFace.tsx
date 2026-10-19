/**
 * The physical navigation-card scan for one card.
 *
 * The tabletop scans live in `public/cards/`, cropped from the original
 * `sail.png` contact sheet: `sail-<cardId>.jpg`, one 500×500 square per
 * card. The Chinese card name rides on a bottom gradient band.
 */

import type { NavCardId } from '@ftk/engine';
import { NAV_CARD_HINT, NAV_CARD_LABEL } from './labels.js';

export function NavCardFace({ card }: { card: NavCardId }) {
  return (
    <div className="navface" title={NAV_CARD_HINT[card]}>
      <img className="navface__art" src={`cards/sail-${card}.jpg`} alt="" draggable={false} />
      <span className="navface__label">{NAV_CARD_LABEL[card]}</span>
    </div>
  );
}

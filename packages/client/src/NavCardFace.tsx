/**
 * The physical navigation-card scan for one card.
 *
 * The tabletop scans live in `public/cards/`, cropped from the original
 * `sail.png` contact sheet: `sail-<cardId>.jpg`, one 500×500 square per
 * card. The Chinese card name rides on a bottom gradient band.
 *
 * `expand` renders the one-line rules text under the face — phones have
 * no hover tooltip, and pick moments are exactly when the effect matters.
 * CSS hides it on hover-capable pointers (PC keeps the `title` tooltip
 * only). The line is inert text (pointer-events:none): tapping it still
 * selects the card in a CardSplitter button.
 */

import type { NavCardId } from '@ftk/engine';
import { NAV_CARD_HINT, NAV_CARD_LABEL } from './labels.js';

export function NavCardFace({ card, expand = false }: {
  card: NavCardId;
  /** Show the always-on rules line under the face (mobile only via CSS). */
  expand?: boolean;
}) {
  return (
    <>
      <div className="navface" title={NAV_CARD_HINT[card]}>
        <img className="navface__art" src={`cards/sail-${card}.jpg`} alt="" draggable={false} />
        <span className="navface__label">{NAV_CARD_LABEL[card]}</span>
      </div>
      {expand && <p className="navface__hint">{NAV_CARD_HINT[card]}</p>}
    </>
  );
}

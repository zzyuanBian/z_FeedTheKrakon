/**
 * The physical navigation-card scan for one card.
 *
 * The tabletop scans live in `public/cards/`, cropped from the original
 * `sail.png` contact sheet: `sail-<cardId>.jpg`, one 500×500 square per
 * card. The Chinese card name rides on a bottom gradient band.
 *
 * `NavCardHint` is the one-line rules text that accompanies a card: PC
 * hides it (the hover `title` tooltip covers it there); the mobile media
 * query shows it. Parents render it OUTSIDE the card box (方案 A) — 牌归牌，
 * 说明归说明 — so the pick frame never wraps the text.
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

/** Rules line for one card — render as a sibling BELOW the card box. */
export function NavCardHint({ card }: { card: NavCardId }) {
  return <p className="navface__hint">{NAV_CARD_HINT[card]}</p>;
}


/**
 * The physical navigation-card scan for one card.
 *
 * The tabletop scans live in `public/cards/`, cropped from the original
 * `sail.png` contact sheet: `sail-<cardId>.jpg`, one 500×500 square per
 * card. The Chinese card name rides on a bottom gradient band.
 *
 * `expand` adds a tap-to-toggle rules line under the face: on PC the card
 * already has the hover `title` tooltip, but phones have no hover — and
 * pick/comply moments are exactly when the effect text matters. One shared
 * `expanded` flag lets a parent flip all its cards' text at once (tap the
 * card face to toggle its own).
 */

import { useState } from 'react';
import type { NavCardId } from '@ftk/engine';
import { NAV_CARD_HINT, NAV_CARD_LABEL } from './labels.js';

export function NavCardFace({ card, expand = false }: {
  card: NavCardId;
  /** Show the tap-to-toggle effect line under the face. */
  expand?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="navface"
        title={NAV_CARD_HINT[card]}
        onClick={expand ? (e) => { e.stopPropagation(); setOpen((v) => !v); } : undefined}
        role={expand ? 'button' : undefined}
        aria-expanded={expand ? open : undefined}
      >
        <img className="navface__art" src={`cards/sail-${card}.jpg`} alt="" draggable={false} />
        <span className="navface__label">{NAV_CARD_LABEL[card]}</span>
        {expand && (
          <span className={'navface__more' + (open ? ' navface__more--on' : '')} aria-hidden="true">
            {open ? '收起' : '效果'}
          </span>
        )}
      </div>
      {expand && open && <p className="navface__hint">{NAV_CARD_HINT[card]}</p>}
    </>
  );
}

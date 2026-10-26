/**
 * 仪式牌预览 (ritual card peek). When a ritual flips its card the lids used
 * to slam shut instantly — the table never got to read WHAT the ritual does
 * (the tabletop group passes the physical card around before closing eyes).
 * This overlay shows the flipped card's name + one-line rules text with a
 * 5s countdown; when it lands (or 知道了 is clicked early) App unmounts it
 * and the 闭眼 veil takes over.
 *
 * App gates this on its own `peeking` flag (ritualPending + 5s timer), so
 * the two timers run in parallel — this component's countdown is purely the
 * visible expression of the same window. A mid-peek refresh restarts both.
 */

import { useEffect, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { RITUAL_LABEL, RITUAL_HINT } from './labels.js';
import { RitualFace } from './RitualFace.js';

const PEEK_SECONDS = 5;

export function RitualPeek({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const ritual = view.rituals.revealed.at(-1);
  const [left, setLeft] = useState(PEEK_SECONDS);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((v) => v - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);

  if (ritual === undefined) return null;
  return (
    <div className="modal ritual-peek" role="alertdialog" aria-label="邪教仪式牌">
      <div className="modal__box ritual-peek__box">
        <p className="ritual-peek__kicker">船舱深处，有人翻开了仪式牌…</p>
        <div className="ritual-peek__face">
          <RitualFace card={ritual} className="ritualface--peek" />
        </div>
        <h3 className="ritual-peek__title">{RITUAL_LABEL[ritual]}</h3>
        <p className="ritual-peek__hint">{RITUAL_HINT[ritual]}</p>
        <button type="button" className="btn btn--primary ritual-peek__close" onClick={onDone}>
          知道了，闭眼（{Math.max(left, 0)}）
        </button>
      </div>
    </div>
  );
}

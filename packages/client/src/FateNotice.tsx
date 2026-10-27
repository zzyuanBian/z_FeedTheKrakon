/**
 * 命运公示 (fate notice). p.12: below three living players the open
 * positions are resolved randomly — fate draws/settles the navigation cards.
 * Both beats are public at a physical table (cards flip face up on the
 * table); this notice restores that: when the log's tail is a fate entry,
 * every seat pops the card(s) that chance produced.
 *
 * Same latch pattern as the other notices: keyed on log length, opens once
 * per entry, a refresh re-shows only while the entry is still the tail.
 */

import type { NavCardId, PlayerView } from '@ftk/engine';
import { NavCardFace } from './NavCardFace.js';

type FateEntry =
  | { t: 'randomDraw'; idx: number; card: NavCardId }
  | { t: 'randomSettle'; idx: number; discarded: NavCardId; kept: NavCardId };

/** The fate entry while it is the log's tail, else null. */
export function fateKey(view: PlayerView): FateEntry | null {
  if (view.winner !== null || view.log.length === 0) return null;
  const idx = view.log.length - 1;
  const tail = view.log[idx]!;
  if (tail.t === 'randomDraw') return { t: 'randomDraw', idx, card: tail.card };
  if (tail.t === 'randomSettle') {
    return { t: 'randomSettle', idx, discarded: tail.discarded, kept: tail.kept };
  }
  return null;
}

export function FateNotice({
  view,
  entry,
  onDone,
}: {
  view: PlayerView;
  entry: FateEntry;
  onDone: () => void;
}) {
  const settle = entry.t === 'randomSettle';
  return (
    <div className="modal fate-notice" role="alertdialog" aria-label="命运公示">
      <div className="modal__box fate-notice__box">
        <span className="fate-notice__glyph" aria-hidden="true">🎲</span>
        <h3 className="fate-notice__title">命运补位</h3>
        <p className="fate-notice__sub">
          {settle
            ? '无人领航——命运掷下的两张牌，一张沉默入海，一张决定航向'
            : '无人大副——命运代为分牌：一张沉入深海（下图），一张悄入航海日志'}
        </p>
        <div className="fate-notice__cards">
          {settle ? (
            <>
              <div className="fate-notice__card">
                <div className="navcard navcard--static"><NavCardFace card={entry.discarded} /></div>
                <span className="fate-notice__tag fate-notice__tag--drop">弃 · 入海</span>
              </div>
              <div className="fate-notice__card">
                <div className="navcard navcard--static"><NavCardFace card={entry.kept} /></div>
                <span className="fate-notice__tag fate-notice__tag--keep">执行 · 定航向</span>
              </div>
            </>
          ) : (
            <div className="fate-notice__card">
              <div className="navcard navcard--static"><NavCardFace card={entry.card} /></div>
              <span className="fate-notice__tag fate-notice__tag--drop">弃 · 入海</span>
            </div>
          )}
        </div>
        <button type="button" className="btn btn--primary fate-notice__close" onClick={onDone}>
          知道了
        </button>
      </div>
    </div>
  );
}

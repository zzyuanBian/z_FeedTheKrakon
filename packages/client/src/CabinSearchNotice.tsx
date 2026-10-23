/**
 * 放大镜(船舱搜查)通知. When the ship docks on a magnify space the engine
 * opens the mapAction pending — the CAPTAIN gets the TargetPicker in the
 * action panel, but everyone else used to see nothing until the log moved.
 * Every seat pops this notice at the same edge instead: the icon art +
 * what is about to happen. The captain dismisses it and acts; the rest
 * dismiss and watch. Latched per round (a magnify dock happens at most
 * once per round) — a refresh mid-pending re-shows it, which is fine.
 */

import type { PlayerView } from '@ftk/engine';

export function cabinSearchKey(view: PlayerView): string | null {
  if (view.winner !== null) return null;
  const p = view.pending;
  // Only the magnify space — the octopus (献祭) has its own gravity.
  if (!p || p.kind !== 'mapAction' || p.icon !== 'magnify') return null;
  return `cs:${view.round}`;
}

export function CabinSearchNotice({ onDone }: { onDone: () => void }) {
  return (
    <div className="modal cabin-notice" role="alertdialog" aria-label="船舱搜查">
      <div className="modal__box cabin-notice__box">
        <img className="cabin-notice__icon" src="img/icon-magnify.jpg" alt="" draggable={false} />
        <h3 className="cabin-notice__title">船舱搜查</h3>
        <p className="cabin-notice__text">
          船停在了<b>放大镜</b>海域——船长正在验证一名玩家的身份。
          <br />
          被搜查者自此<b>无法被转化</b>。
        </p>
        <button type="button" className="btn btn--primary cabin-notice__close" onClick={onDone}>
          知道了
        </button>
      </div>
    </div>
  );
}

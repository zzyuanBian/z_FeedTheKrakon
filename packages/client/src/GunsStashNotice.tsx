/**
 * 邪教囤枪公示. gunsStash resolves secretly (the leader distributes 3 guns
 * in the dark), but the RESULT is public at the tabletop — the log entry
 * `ritualGuns` lists every recipient. When that entry lands, every seat
 * pops this notice: who now holds how many extra guns. Latched on the log
 * length at the moment the entry appeared, so it opens exactly once per
 * stash and a refresh re-shows only if the entry is still the newest.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';
import { GUN_URL } from './assets.js';
import { RitualFace } from './RitualFace.js';

/** `index:count` of the newest ritualGuns entry, or null while unseen. */
export function gunsStashKey(view: PlayerView): string | null {
  if (view.winner !== null) return null;
  const idx = view.log.findIndex((e) => e.t === 'ritualGuns');
  if (idx === -1) return null;
  // Only "fresh" stashes: the entry must still be the log's tail region —
  // once a later round has moved on, re-showing would be noise. Compare
  // against the LAST log entry instead: any newer event supersedes it.
  return idx === view.log.length - 1 ? `gs:${idx}` : null;
}

export function GunsStashNotice({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const entry = [...view.log].reverse().find((e) => e.t === 'ritualGuns');
  const nameOf = (id: string) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;
  const grants = entry && entry.t === 'ritualGuns' ? entry.grants : [];
  const total = grants.reduce((n, g) => n + g.guns, 0);

  return (
    <div className="modal guns-notice" role="alertdialog" aria-label="邪教囤枪">
      <div className="modal__box guns-notice__box">
        <div className="guns-notice__face">
          <RitualFace card="gunsStash" className="ritualface--notice" />
        </div>
        <h3 className="guns-notice__title">邪教囤枪</h3>
        <p className="guns-notice__sub">仪式结束，枪的去向已公开：</p>
        <ul className="guns-notice__list">
          {grants.filter((g) => g.guns > 0).map((g) => (
            <li key={g.to} className="guns-notice__row">
              <AvatarImage
                avatarId={g.to === view.you.id ? view.you.avatar : view.others.find((p) => p.id === g.to)?.avatar ?? -1}
                size={26}
                title={nameOf(g.to)}
              />
              <span className="guns-notice__name">{nameOf(g.to)}{g.to === view.you.id && '（你）'}</span>
              <span className="guns-notice__guns" title={`${g.guns} 把枪`}>
                {Array.from({ length: Math.min(g.guns, 5) }, (_, i) => (
                  <img key={i} className="gun-ico" src={GUN_URL} alt="" />
                ))}
                {g.guns > 5 ? ` ×${g.guns}` : ''}
              </span>
            </li>
          ))}
          {grants.every((g) => g.guns === 0) && (
            <li className="guns-notice__row guns-notice__row--none">无人得到枪</li>
          )}
        </ul>
        <p className="guns-notice__total">共 {total} 把枪流入船员之手</p>
        <button type="button" className="btn btn--primary guns-notice__close" onClick={onDone}>
          知道了
        </button>
      </div>
    </div>
  );
}

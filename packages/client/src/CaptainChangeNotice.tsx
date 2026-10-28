/**
 * 船长更替公示. A captain hand-over that is NOT a mutiny currently has no
 * beat of its own: the 醉汉 (drunk) card silently reassigns the chair —
 * the log's `round` line updates and everyone's medal quietly slides one
 * seat over. This notice gives the table its moment: it fires on any
 * captain change the mutiny veil doesn't already own, naming the outgoing
 * and incoming captain.
 *
 * Detection is derived client-side from public data only — the log's tail
 * is a fresh `round` entry whose captain differs from the PREVIOUS round
 * entry's captain, and no `mutiny` entry sits between them (a mutiny
 * hand-over already has the full-screen MutinyReveal; double-announcing
 * would just be noise). Latched per log length like the other notices, so
 * it opens exactly once per hand-over and a refresh re-shows only while
 * the entry is still news.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

/** `cc:<logLength>` while the newest entry is a fresh non-mutiny captain
 *  hand-over — or the game's OPENING round line (the table learns who
 *  captain starts), else null. */
export function captainChangeKey(view: PlayerView): string | null {
  if (view.winner !== null || view.log.length === 0) return null;
  const tail = view.log[view.log.length - 1]!;
  if (tail.t !== 'round') return null;
  // Opening announcement: the FIRST round line is news too — everyone
  // should learn the starting captain the same way a hand-over lands.
  const prevRound = [...view.log]
    .slice(0, -1)
    .reverse()
    .find((e) => e.t === 'round');
  if (!prevRound || prevRound.t !== 'round') {
    // A round line at index > 0 means appointments/loyalty already ran in
    // between — the opening window has passed; refreshes must not replay it.
    return view.log.indexOf(tail) === 0 ? `cc:${view.log.length}` : null;
  }
  if (prevRound.captain === tail.captain) return null;
  // A SUCCESSFUL mutiny between the two round lines owns its own reveal
  // veil. A FAILED one (e.g. a mutiny beaten late in a round) must not
  // swallow this notice: findLastIndex used to match ANY mutiny entry and
  // the drunk hand-over that followed went silently unannounced.
  const mutinyIdx = view.log.findLastIndex((e) => e.t === 'mutiny' && e.success);
  if (mutinyIdx > view.log.lastIndexOf(prevRound)) return null;
  return `cc:${view.log.length}`;
}

export function CaptainChangeNotice({
  view,
  onDone,
}: {
  view: PlayerView;
  onDone: () => void;
}) {
  const tail = view.log[view.log.length - 1]!;
  const seatOf = (id: string) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id));
  const fresh = tail.t === 'round' ? seatOf(tail.captain) : undefined;
  // Opening line (log index 0) = the game's first captain, not a hand-over.
  const opening = view.log.indexOf(tail) === 0;

  return (
    <div className="modal captain-change" role="alertdialog" aria-label={opening ? '首任船长' : '船长更替'}>
      <div className="modal__box captain-change__box">
        {opening ? (
          <img className="captain-change__crest" src="img/crest-captain.png" alt="" draggable={false} />
        ) : (
          <span className="captain-change__glyph" aria-hidden="true">🍺</span>
        )}
        <h3 className="captain-change__title">{opening ? '首任船长' : '船长更替'}</h3>
        <p className="captain-change__sub">
          {opening
            ? fresh?.id === view.you.id
              ? '起航了——本轮由你掌舵'
              : '起航了——本轮由他掌舵'
            : '醉汉上头，船长跌跌撞撞下了台'}
        </p>
        {fresh && (
          <div className="captain-change__captain">
            <AvatarImage avatarId={fresh.avatar} size={72} />
            <span className="captain-change__name">
              {fresh.name}{fresh.id === view.you.id && '（你）'}
            </span>
            {!opening && (
              <span className="captain-change__medal">
                <img src="img/crest-captain.png" alt="" draggable={false} /> 新任船长
              </span>
            )}
          </div>
        )}
        <button type="button" className="btn btn--primary captain-change__close" onClick={onDone}>
          知道了
        </button>
      </div>
    </div>
  );
}

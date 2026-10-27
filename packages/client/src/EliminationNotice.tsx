/**
 * 出局公示 (elimination notice). Two paths put a player overboard:
 *  - 献祭给海怪 (feedKraken): the captain's private MapReveal shows THEM the
 *    target and the cult-win outcome — everyone else just sees the player
 *    vanish from the living roster with no ceremony;
 *  - 跳海抗命 (jump): the navigator refuses command; the log line is quick
 *    and the table may be mid-navigation.
 *
 * At a physical table both are loud public beats — someone just died. This
 * notice restores the ceremony: when the log's tail is an elimination
 * entry, every seat pops a full-screen notice naming the departed. Latched
 * per log length (like GunsStashNotice / CaptainChangeNotice) so it opens
 * exactly once per death and a refresh re-shows only while the entry is
 * still the newest.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

type ElimEntry =
  | { t: 'jump'; idx: number; player: string }
  | { t: 'mapAction'; idx: number; kind: 'feedKraken'; actor: string; target: string };

/** The elimination entry while it is the log's tail, else null. */
export function eliminationKey(view: PlayerView): ElimEntry | null {
  if (view.winner !== null || view.log.length === 0) return null;
  const idx = view.log.length - 1;
  const tail = view.log[idx]!;
  if (tail.t === 'jump') return { t: 'jump', idx, player: tail.player };
  if (tail.t === 'mapAction' && tail.kind === 'feedKraken') {
    return { t: 'mapAction', idx, kind: 'feedKraken', actor: tail.actor, target: tail.target };
  }
  return null;
}

export function EliminationNotice({
  view,
  entry,
  onDone,
}: {
  view: PlayerView;
  entry: ElimEntry;
  onDone: () => void;
}) {
  const id = entry.t === 'jump' ? entry.player : entry.target;
  const p = id === view.you.id ? view.you : view.others.find((o) => o.id === id);
  if (!p) return null;
  const fed = entry.t === 'mapAction';
  const nameOf = (pid: string) =>
    (pid === view.you.id ? view.you : view.others.find((o) => o.id === pid))?.name ?? pid;

  return (
    <div className="modal elim-notice" role="alertdialog" aria-label="出局公示">
      <div className="modal__box elim-notice__box">
        <span className="elim-notice__glyph" aria-hidden="true">{fed ? '🐙' : '🌊'}</span>
        <h3 className="elim-notice__title">{fed ? '献祭给海怪' : '跳海抗命'}</h3>
        <p className="elim-notice__sub">
          {fed ? `${nameOf(entry.actor)} 将 ${p.name} 献给了深海` : '领航员拒绝执行命令，纵身入海'}
        </p>
        <div className="elim-notice__who">
          <AvatarImage avatarId={p.avatar} size={72} />
          <span className="elim-notice__name">
            {p.name}
            {id === view.you.id && '（你）'}
          </span>
          <span className="elim-notice__fate">⚓ 已出局 · 余 {view.others.filter((o) => o.alive).length + (view.you.alive ? 1 : 0)} 人</span>
        </div>
        <button type="button" className="btn btn--primary elim-notice__close" onClick={onDone}>
          {fed ? '默哀' : '目送入海'}
        </button>
      </div>
    </div>
  );
}

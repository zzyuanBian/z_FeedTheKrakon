/**
 * 私密结算结果弹窗 (map-action reveal beat). After the captain picks a
 * target for the magnify (船舱搜查) or octopus (献祭) space, the engine
 * holds the rest of the navigation on a `reveal` pending — ONLY the
 * captain's screen pops this modal, showing the target's identity (and for
 * the sacrifice, that they were fed to the Kraken). The table sees
 * nothing; the tabletop analogue is the captain reading the card alone.
 * 知道了 fires `mapActionRevealAck` and the card effect resumes publicly.
 *
 * Data rides the actor-scoped `pendingData` ({step:'reveal', kind, target})
 * — already secret to everyone but the captain by the view projection.
 */

import type { PlayerView, PlayerId } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL } from './labels.js';
import { AvatarImage } from './Avatars.js';

/** The captain's reveal window: pending kind=mapAction step=reveal isYou. */
export function mapRevealActive(view: PlayerView): boolean {
  const d = view.pendingData;
  return view.winner === null
    && view.pending?.kind === 'mapAction'
    && view.pending.isYou === true
    && d?.['step'] === 'reveal'
    && typeof d['target'] === 'string';
}

export function MapReveal({ view, onAck }: {
  view: PlayerView;
  onAck: () => void;
}) {
  const d = view.pendingData!;
  const kind = d['kind'] as 'cabinSearch' | 'feedKraken';
  const targetId = d['target'] as PlayerId;
  const target = [view.you, ...view.others].find((p) => p.id === targetId);
  if (!target) return null;

  const sacrifice = kind === 'feedKraken';
  return (
    <div className="modal map-reveal" role="alertdialog" aria-label="搜查结果">
      <div className="modal__box map-reveal__box">
        <p className="map-reveal__kicker">{sacrifice ? '🐙 献祭给海怪' : '🔍 船舱搜查'}</p>
        <div className="map-reveal__who">
          <AvatarImage avatarId={target.avatar} size={72} />
          <strong className="map-reveal__name">{target.name}</strong>
        </div>
        <p className={'map-reveal__team map-reveal__team--' + view.knowledge.find((k) => k.about === targetId)?.team}>
          {(() => {
            const k = view.knowledge.find((x) => x.about === targetId);
            if (!k) return '（情报尚未记录…）';
            return `他的阵营是 ${FACTION_ICON[k.team]} ${FACTION_LABEL[k.team]}`;
          })()}
        </p>
        {sacrifice && <p className="map-reveal__sub">这名玩家已被献祭给深海。</p>}
        {!sacrifice && <p className="map-reveal__sub">被搜查者自此无法被转化。</p>}
        <button type="button" className="btn btn--primary map-reveal__close" onClick={onAck}>
          知道了
        </button>
      </div>
    </div>
  );
}

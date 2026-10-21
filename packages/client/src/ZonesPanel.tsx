/**
 * Board zones, split to flank the map like the physical game's table:
 *
 * - DiscardSea (深海): stacked ABOVE the log in the PC left rail. The drop
 *   art keeps its true tall card proportions and the nav-back pile stacks at
 *   real card size — a text line pinned to the art's bottom edge carries the
 *   count (the engine only exposes the count, the pile is decorative). On
 *   mobile it shrinks to a corner buoy on the map.
 * - OffDutyZone (歇班): a strip ABOVE the crew circle in the right column,
 *   listing resting players' avatars + names; a whisper when nobody rests.
 *   The viewer themselves may be resting — their avatar shows here too.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

const NAV_BACK = 'cards/nav-back.jpg';

/** 深海弃牌区（地图左侧）。整张 drop.png 原样呈现——横幅、漩涡都是画里
 *  自带的，UI 不重画；弃牌牌背叠在上部深色海面，张数以图下一行文字呈现。 */
export function DiscardSea({ view }: { view: PlayerView }) {
  const discardCount = view.navigation.discardCount;
  // Up to three decorative backs: 0 count shows none, otherwise scale the
  // fan with the pile (1 card → 1, 2-4 → 2, 5+ → 3).
  const backs = discardCount <= 0 ? 0 : Math.min(3, Math.ceil(discardCount / 3));

  return (
    <div className="discard-sea" role="img" aria-label={`深海弃牌区，共 ${discardCount} 张`}>
      <div className="discard-sea__artbox">
        <img className="discard-sea__art" src="img/zone-drop.jpg" alt="" draggable={false} />
        {backs > 0 && (
          <div className="discard-sea__stack" aria-hidden="true">
            {Array.from({ length: backs }, (_, i) => (
              <img
                key={i}
                className="discard-sea__card"
                src={NAV_BACK}
                alt=""
                draggable={false}
                style={{
                  transform: `translate(-50%, -50%) translate(${i * 6 - 6}px, ${i * 8}px) rotate(${(i - 1) * 9}deg)`,
                  zIndex: i,
                }}
              />
            ))}
          </div>
        )}
        <span className="discard-sea__label">弃牌 {discardCount} 张</span>
      </div>
    </div>
  );
}

/** 歇班条（右侧玩家圆桌上方）。 */
export function OffDutyZone({ view }: { view: PlayerView }) {
  const offDuty = [...view.others, view.you].filter((p) => p.offDuty).sort((a, b) => a.seat - b.seat);

  return (
    <div className="offduty">
      <span className="zones__banner zones__banner--rest">歇班</span>
      {offDuty.length === 0 ? (
        <p className="offduty__empty">无人歇班</p>
      ) : (
        <ul className="offduty__crew">
          {offDuty.map((p) => (
            <li key={p.id} className="offduty__crew-item">
              <AvatarImage avatarId={p.avatar} size={28} title={p.name} className="offduty__crew-ava" />
              <span className="offduty__crew-name">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

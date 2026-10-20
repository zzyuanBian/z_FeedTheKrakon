/**
 * Board zone panels: the discard sea and the off-duty bench, rendered under
 * the map like the physical game's table zones.
 *
 * - 深海 (discard): the drop art as the backdrop, up to three stacked
 *   card-backs (nav-back.jpg, offset + rotated like a real pile), and a gold
 *   count badge. The engine exposes only the count (`view.navigation.
 *   discardCount`) — the stack is decorative, the number is the truth.
 * - 歇班 (off-duty): the rest art as the backdrop with the off-duty players'
 *   avatars + names; an empty-state whisper when nobody is resting. The
 *   viewer themselves may be off-duty — their avatar shows here too, first.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

const NAV_BACK = 'cards/nav-back.jpg';

export function ZonesPanel({ view }: { view: PlayerView }) {
  const discardCount = view.navigation.discardCount;
  // Up to three decorative backs: 1 card shows 1, 2+ shows 2, 4+ shows 3.
  const backs = Math.min(3, Math.max(discardCount, 0) === 0 ? 0 : Math.min(3, Math.ceil(discardCount / 3)));
  const offDuty = [...view.others, view.you].filter((p) => p.offDuty).sort((a, b) => a.seat - b.seat);

  return (
    <div className="zones">
      <div className="zones__drop" role="img" aria-label={`深海弃牌区，共 ${discardCount} 张`}>
        <span className="zones__banner zones__banner--drop">丢弃</span>
        {backs > 0 && (
          <div className="zones__stack" aria-hidden="true">
            {Array.from({ length: backs }, (_, i) => (
              <img
                key={i}
                className="zones__card"
                src={NAV_BACK}
                alt=""
                draggable={false}
                style={{
                  transform: `translate(-50%, -50%) translate(${i * 5 - 5}px, ${i * -4}px) rotate(${(i - 1) * 7}deg)`,
                  zIndex: i,
                }}
              />
            ))}
          </div>
        )}
        <span className="zones__count">{discardCount}</span>
      </div>

      <div className="zones__rest">
        <span className="zones__banner zones__banner--rest">歇班</span>
        {offDuty.length === 0 ? (
          <p className="zones__empty">无人歇班</p>
        ) : (
          <ul className="zones__crew">
            {offDuty.map((p) => (
              <li key={p.id} className="zones__crew-item">
                <AvatarImage avatarId={p.avatar} size={30} title={p.name} className="zones__crew-ava" />
                <span className="zones__crew-name">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

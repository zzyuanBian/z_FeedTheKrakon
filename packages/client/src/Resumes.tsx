/**
 * 履历 (captain's résumé). Per the rulebook, every resolved navigation adds
 * the revealed nav card FACE UP in front of the captain — a public track
 * record any player may walk over and inspect ("The card remains openly
 * visible in front of them until the end of the game"). At a real table
 * anyone can look; here the 📜N badge in the roster opens the same view.
 *
 * Zero engine surface: the reducer bumps `resumes` and pushes the `card`
 * log entry at the same instant (executeRevealed), so scanning the public
 * log for `t: 'card'` entries reproduces each player's résumé exactly —
 * including its absence on denied navigations (跳船抗命 produces neither a
 * résumé nor a card entry). Pure client-side derivation.
 */

import type { NavCardId, PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';
import { NavCardFace } from './NavCardFace.js';

export interface ResumeEntry {
  card: NavCardId;
  /** Log index of the `card` entry — stable React key + chronology. */
  idx: number;
  /** Which navigation (engine round) it came from. */
  round: number;
}

/** Each player's résumé, derived from the public log. `view.log[idx].t ===
 *  'card'` and the entry sits right after its `round` sibling, so the round
 *  number is read off the nearest preceding round line (0 before the first). */
export function resumesFromLog(view: PlayerView): Record<string, ResumeEntry[]> {
  const out: Record<string, ResumeEntry[]> = {};
  let round = 0;
  view.log.forEach((e, idx) => {
    if (e.t === 'round') round = e.round;
    if (e.t === 'card') {
      (out[e.captain] ??= []).push({ card: e.card, idx, round });
    }
  });
  return out;
}

/** The résumé inspection sheet — which cards, in order, each one earned. */
export function ResumeModal({
  view,
  playerId,
  resumes,
  onClose,
}: {
  view: PlayerView;
  playerId: string;
  resumes: ResumeEntry[];
  onClose: () => void;
}) {
  const p = playerId === view.you.id ? view.you : view.others.find((o) => o.id === playerId);
  if (!p) return null;
  return (
    <div className="markpop resumepop" onClick={onClose}>
      <div className="markpop__sheet resumepop__sheet" onClick={(e) => e.stopPropagation()}>
        <div className="markpop__head">
          <h3>📜 {p.name} 的履历</h3>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="resumepop__who">
          <AvatarImage avatarId={p.avatar} size={28} title={p.name} />
          <span>
            {resumes.length === 0
              ? '还没有履历——担任船长完成一次航行后，领出的航海卡会摆在这里。'
              : `共 ${resumes.length} 张航海卡，按获得顺序排列（公开信息）。`}
          </span>
        </div>
        {resumes.length > 0 && (
          <div className="resumepop__cards">
            {resumes.map((r) => (
              <div key={r.idx} className="resumepop__cell">
                <NavCardFace card={r.card} />
                <span className="resumepop__round">第 {r.round} 回合</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

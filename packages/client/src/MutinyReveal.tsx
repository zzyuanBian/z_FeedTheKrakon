/**
 * Full-screen mutiny reveal (成功专用). When the reveal broadcast lands —
 * `mutiny.revealed && success` — every client pops the same veil: 出枪者
 * 列表 (pledges are public once revealed) and the incoming captain. For a
 * tie, the new captain line waits: `newCaptain` only appears after the
 * tie-break chain finishes, and the veil stays open until it does.
 *
 * Dismissal: the 继续航程 button, or an 8s auto-close once the captain is
 * known (early close would cut the tie-break suspense short).
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';

export function MutinyReveal({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const m = view.mutiny;
  const nameOf = (id: string) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

  // Highest first, then seat order — the "winner row" reads on top.
  const pledgeRows = Object.entries(m.pledges ?? {})
    .filter(([, guns]) => guns > 0)
    .sort((a, b) => b[1] - a[1] || Number(a[0].slice(1)) - Number(b[0].slice(1)));
  const max = pledgeRows[0]?.[1] ?? 0;
  const tie = pledgeRows.filter(([, g]) => g === max).length > 1;
  const captainKnown = m.newCaptain !== null;

  // Auto-close only once the new captain is on the board (tie-break done).
  const [left, setLeft] = useState(8);
  useEffect(() => {
    if (!captainKnown) return;
    const t = window.setInterval(() => setLeft((v) => v - 1), 1000);
    return () => window.clearInterval(t);
  }, [captainKnown]);
  useEffect(() => {
    if (captainKnown && left <= 0) onDone();
  }, [captainKnown, left, onDone]);

  // First render inside the veil: pop-in animation beat (ref, not state —
  // no re-render needed, CSS animates on mount).
  const mounted = useRef(false);
  mounted.current = true;

  return (
    <div className="mutiny-reveal" role="alertdialog" aria-label="哗变结果">
      <div className="mutiny-reveal__box">
        <div className="mutiny-reveal__head">
          <span className="mutiny-reveal__glyph" aria-hidden="true">⚡</span>
          <h2>哗变成功！</h2>
        </div>
        <p className="mutiny-reveal__sub">
          至少 {m.threshold} 枪 · 共 {Object.values(m.pledges ?? {}).reduce((n, g) => n + g, 0)} 枪
          {tie && captainKnown ? ' · 平局表决后定出新船长' : tie ? ' · 平局，表决进行中…' : ''}
        </p>

        <ul className="mutiny-reveal__pledges">
          {pledgeRows.map(([id, guns]) => (
            <li key={id} className={'mutiny-reveal__row' + (guns === max ? ' mutiny-reveal__row--top' : '')}>
              <AvatarImage avatarId={
                id === view.you.id ? view.you.avatar : view.others.find((p) => p.id === id)?.avatar ?? -1
              } size={26} title={nameOf(id)} />
              <span className="mutiny-reveal__name">{nameOf(id)}{id === view.you.id && '（你）'}</span>
              <span className="mutiny-reveal__guns">{'🔫'.repeat(Math.min(guns, 5))}{guns > 5 ? ` ×${guns}` : ''}</span>
            </li>
          ))}
          {pledgeRows.length === 0 && <li className="mutiny-reveal__row mutiny-reveal__row--none">无人出枪</li>}
        </ul>

        {captainKnown ? (
          <div className="mutiny-reveal__captain">
            <span className="mutiny-reveal__captain-label">新任船长</span>
            <span className="mutiny-reveal__captain-name">
              🧭 {nameOf(m.newCaptain!)}{m.newCaptain === view.you.id && '（你）'}
            </span>
          </div>
        ) : (
          <div className="mutiny-reveal__captain mutiny-reveal__captain--wait">等待平局表决…</div>
        )}

        {captainKnown && (
          <button type="button" className="btn btn--primary mutiny-reveal__close" onClick={onDone}>
            继续航程（{Math.max(left, 0)}s）
          </button>
        )}
      </div>
    </div>
  );
}

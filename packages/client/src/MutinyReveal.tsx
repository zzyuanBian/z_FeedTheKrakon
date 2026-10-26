/**
 * Full-screen mutiny reveal (成功与失败共用). When the reveal broadcast
 * lands — `mutiny.revealed` — every client pops the same veil: 出枪者列表
 * (pledges are public once revealed). Success shows the incoming captain
 * (waiting through the tie-break chain: `newCaptain` only appears after it
 * finishes, and the veil stays open until it does); failure shows how many
 * guns the threshold was missed by — the crew learns the uprising died and
 * the voyage carries on.
 *
 * Tie-break: the veil IS the ballot box. While a `mutinyTie` pending waits
 * on a picker, that player's veil gains the stand-down vote (chips + confirm)
 * — the old flow rendered the picker in the action panel BEHIND this
 * full-screen veil, so their clicks never landed and the game deadlocked.
 * Non-pickers keep the 等待平局表决… readout.
 *
 * Dismissal: the button, or an 8s auto-close once the outcome is settled
 * (early close would cut the tie-break suspense short).
 */

import { useEffect, useState } from 'react';
import type { PlayerId, PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';
import { GUN_URL } from './assets.js';

export function MutinyReveal({ view, onDone, standDownCandidates, onStandDown }: {
  view: PlayerView;
  onDone: () => void;
  /** Tie-break only: the still-standing candidates for THIS picker. */
  standDownCandidates?: PlayerId[] | undefined;
  onStandDown?: ((id: PlayerId) => void) | undefined;
}) {
  const m = view.mutiny;
  const nameOf = (id: string) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

  // Highest first, then seat order — the "winner row" reads on top.
  const pledgeRows = Object.entries(m.pledges ?? {})
    .filter(([, guns]) => guns > 0)
    .sort((a, b) => b[1] - a[1] || Number(a[0].slice(1)) - Number(b[0].slice(1)));
  const total = Object.values(m.pledges ?? {}).reduce((n, g) => n + g, 0);
  const success = m.success;
  const max = pledgeRows[0]?.[1] ?? 0;
  const tie = pledgeRows.filter(([, g]) => g === max).length > 1;
  const captainKnown = m.newCaptain !== null;

  // Auto-close only once the outcome is final: success needs the new
  // captain (tie-break done); failure is final immediately.
  const settled = success ? captainKnown : true;
  const [left, setLeft] = useState(8);
  useEffect(() => {
    if (!settled) return;
    const t = window.setInterval(() => setLeft((v) => v - 1), 1000);
    return () => window.clearInterval(t);
  }, [settled]);
  useEffect(() => {
    if (settled && left <= 0) onDone();
  }, [settled, left, onDone]);

  return (
    <div className={'mutiny-reveal' + (success ? '' : ' mutiny-reveal--failed')} role="alertdialog" aria-label="哗变结果">
      <div className="mutiny-reveal__box">
        <div className="mutiny-reveal__head">
          <span className="mutiny-reveal__glyph" aria-hidden="true">{success ? '⚡' : '⚓'}</span>
          <h2>{success ? '哗变成功！' : '哗变失败'}</h2>
        </div>
        <p className="mutiny-reveal__sub">
          {success
            ? `至少 ${m.threshold} 枪 · 共 ${total} 枪${tie && captainKnown ? ' · 平局表决后定出新船长' : tie ? ' · 平局，表决进行中…' : ''}`
            : `还差 ${Math.max(m.threshold - total, 1)} 枪 · ${total} / ${m.threshold} 枪，船长留任，航程继续`}
        </p>

        <ul className="mutiny-reveal__pledges">
          {pledgeRows.map(([id, guns]) => (
            <li key={id} className={'mutiny-reveal__row' + (success && guns === max ? ' mutiny-reveal__row--top' : '')}>
              <AvatarImage avatarId={
                id === view.you.id ? view.you.avatar : view.others.find((p) => p.id === id)?.avatar ?? -1
              } size={26} title={nameOf(id)} />
              <span className="mutiny-reveal__name">{nameOf(id)}{id === view.you.id && '（你）'}</span>
              <span className="mutiny-reveal__guns" title={`${guns} 枪`}>
                {Array.from({ length: Math.min(guns, 5) }, (_, i) => (
                  <img key={i} className="gun-ico" src={GUN_URL} alt="" />
                ))}
                {guns > 5 ? ` ×${guns}` : ''}
              </span>
            </li>
          ))}
          {pledgeRows.length === 0 && <li className="mutiny-reveal__row mutiny-reveal__row--none">无人出枪</li>}
        </ul>

        {success ? (
          standDownCandidates && standDownCandidates.length > 0 && onStandDown ? (
            <TieBallot view={view} candidates={standDownCandidates} onStandDown={onStandDown} />
          ) : captainKnown ? (
            <div className="mutiny-reveal__captain">
              <span className="mutiny-reveal__captain-label">新任船长</span>
              <span className="mutiny-reveal__captain-name">
                🧭 {nameOf(m.newCaptain!)}{m.newCaptain === view.you.id && '（你）'}
              </span>
            </div>
          ) : (
            <div className="mutiny-reveal__captain mutiny-reveal__captain--wait">等待平局表决…</div>
          )
        ) : (
          <div className="mutiny-reveal__captain mutiny-reveal__captain--wait">忠于船长 · 继续航行</div>
        )}

        {settled && (
          <button type="button" className="btn btn--primary mutiny-reveal__close" onClick={onDone}>
            继续航程（{Math.max(left, 0)}s）
          </button>
        )}
      </div>
    </div>
  );
}

/** The tie-break ballot, rendered INSIDE the veil so the picker's clicks
 *  actually land (the veil is full-screen and sits above the action panel).
 *  Candidates are exactly the engine's `remaining` list — a tap off-list
 *  would be a silent server reject, so nothing else is offered. */
function TieBallot({ view, candidates, onStandDown }: {
  view: PlayerView;
  candidates: PlayerId[];
  onStandDown: (id: PlayerId) => void;
}) {
  const [pick, setPick] = useState<PlayerId | null>(null);
  const nameOf = (id: PlayerId) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;
  return (
    <div className="mutiny-reveal__ballot">
      <p className="mutiny-reveal__ballot-lead">
        {view.pending?.isYou
          ? '平局——由你点名一名玩家弃权，余者中枪数最高者任新船长：'
          : '平局表决…'}
      </p>
      <div className="mutiny-reveal__ballot-grid">
        {candidates.map((id) => (
          <button
            key={id}
            type="button"
            className={'chip' + (pick === id ? ' chip--on' : '')}
            onClick={() => setPick(id)}
          >
            {nameOf(id)}
          </button>
        ))}
      </div>
      {view.pending?.isYou && (
        <button
          type="button"
          className="btn btn--primary mutiny-reveal__ballot-go"
          disabled={!pick}
          onClick={() => pick && onStandDown(pick)}
        >
          点名弃权
        </button>
      )}
    </div>
  );
}

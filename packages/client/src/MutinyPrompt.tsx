/**
 * 哗变表决弹框（收表态环节）. When the captain appoints the navigation team
 * the game enters the loyalty phase — this modal pops for EVERY seat at that
 * moment, so nobody has to notice a tab changed:
 *
 *  - a crew member who has not pledged: the appointment result, the public
 *    pledged/not-pledged roster, and the pledge input — one button per gun
 *    (0 = 宣誓忠诚), then confirm. Replaces the old slider.
 *  - the captain, an off-duty/dead seat, or someone who already pledged:
 *    the same modal in its waiting form — roster + progress, no input.
 *
 * Dismissal is a MINIMIZE, not a cancel: 「稍后决定」 collapses the modal and
 * the 行动 tab keeps a reopen button until the phase resolves. Nothing is
 * stored locally except that collapsed flag — every refresh re-derives the
 * open state from the game state, so an unfinished pledge always re-prompts.
 *
 * (The 成功揭晓 fullscreen veil is MutinyReveal, a separate beat.)
 */

import { useState } from 'react';
import type { PlayerView, PlayerId } from '@ftk/engine';
import { iOweMutinyPledge } from './actions.js';
import { AvatarImage } from './Avatars.js';

export function MutinyPrompt({
  view,
  onPledge,
  onReopen,
}: {
  view: PlayerView;
  onPledge: (guns: number) => void;
  /** Collapsed → expanded (the action tab's reopen button calls this). */
  onReopen: () => void;
}) {
  const owePledge = iOweMutinyPledge(view);
  const [collapsed, setCollapsed] = useState(false);

  // While collapsed the modal renders nothing; the action panel offers the
  // reopen. The flag lives here so a phase change (fresh mutiny next round)
  // naturally un-collapses — a new mount, a new decision.
  if (collapsed) return null;

  const roster = [view.you, ...view.others].filter(
    (p) => p.alive && !p.benched && p.id !== view.officers.captain,
  );
  // `pledged` is a newer engine field; a stale client talking to a fresh
  // server (or vice versa) may not have it — treat as nobody-spoken-yet.
  const pledgedSet = new Set(view.mutiny.pledged ?? []);
  const done = roster.filter((p) => pledgedSet.has(p.id)).length;
  const lieutenant = view.officers.lieutenant;
  const navigator = view.officers.navigator;

  return (
    <div className="modal mutiny-prompt" role="alertdialog" aria-label="哗变表决">
      <div className="modal__box mutiny-prompt__box">
        {owePledge ? (
          <PledgeForm
            view={view}
            lieutenant={lieutenant}
            navigator={navigator}
            onPledge={onPledge}
          />
        ) : (
          <div className="mutiny-prompt__wait">
            <h3 className="mutiny-prompt__title">忠诚提问</h3>
            <p className="mutiny-prompt__sub">
              {view.officers.captain === view.you.id
                ? '你任命的团队正在接受质询。'
                : '你已表态，等待其余船员…'}
            </p>
          </div>
        )}

        <RosterStatus view={view} roster={roster} pledgedSet={pledgedSet} />

        <p className="mutiny-prompt__progress">
          已表态 {done} / {roster.length} · 共需 {view.mutiny.threshold} 枪哗变
        </p>

        {owePledge ? (
          <button type="button" className="btn mutiny-prompt__min" onClick={() => setCollapsed(true)}>
            稍后决定
          </button>
        ) : (
          <button type="button" className="btn mutiny-prompt__min" onClick={() => setCollapsed(true)}>
            收起
          </button>
        )}
      </div>
    </div>
  );
}

/** The pledge input: one button per gun the viewer holds, 0 = loyalty. */
function PledgeForm({
  view,
  lieutenant,
  navigator,
  onPledge,
}: {
  view: PlayerView;
  lieutenant: PlayerId | null;
  navigator: PlayerId | null;
  onPledge: (guns: number) => void;
}) {
  const nameOf = (id: PlayerId | null) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? '—';
  const guns = view.you.guns;
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <>
      <h3 className="mutiny-prompt__title">忠诚提问 · 哗变</h3>
      <p className="mutiny-prompt__sub">
        船长已任命 {nameOf(lieutenant)} 为大副、{nameOf(navigator)} 为领航员。
        <br />
        满意则宣誓忠诚；不满可亮枪——全场共 {view.mutiny.threshold} 枪即哗变成功。
      </p>
      <p className="hint">你怀里有 {guns} 把枪。选择亮出几把：</p>
      <div className="mutiny-prompt__guns" role="radiogroup" aria-label="亮出的枪数">
        {Array.from({ length: guns + 1 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={picked === n}
            className={'chip mutiny-prompt__gun' + (picked === n ? ' chip--on' : '')}
            onClick={() => setPicked(n)}
          >
            {n === 0 ? '忠诚' : `🔫${n}`}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--primary mutiny-prompt__confirm"
        disabled={picked === null}
        onClick={() => picked !== null && onPledge(picked)}
      >
        {picked === 0 ? '宣誓忠诚' : picked === null ? '选择枪数' : `亮出 ${picked} 把枪`}
      </button>
    </>
  );
}

/** Who has spoken (✓) and who is still silent (…) — public at a real table. */
function RosterStatus({
  view,
  roster,
  pledgedSet,
}: {
  view: PlayerView;
  roster: { id: PlayerId; avatar: number; name: string }[];
  pledgedSet: Set<PlayerId>;
}) {
  return (
    <ul className="mutiny-prompt__roster">
      {roster.map((p) => {
        const inP = pledgedSet.has(p.id);
        return (
          <li key={p.id} className={'mutiny-prompt__row' + (inP ? ' mutiny-prompt__row--in' : '')}>
            <AvatarImage avatarId={p.avatar} size={22} title={p.name} />
            <span className="mutiny-prompt__name">
              {p.name}
              {p.id === view.you.id && '（你）'}
            </span>
            <span className="mutiny-prompt__state" aria-label={inP ? '已表态' : '未表态'}>
              {inP ? '✓ 已表态' : '… 未表态'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

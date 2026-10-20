/**
 * Public event log + private knowledge panel. The log is what everyone sees;
 * the "你的情报" block shows only what THIS viewer has privately learned
 * (Cabin Search results), which the engine marks per viewer.
 *
 * Key facts inside each entry render <b> with a tone class (gold names,
 * red danger, teal safety) so the log scans at a glance.
 */

import type { ReactNode } from 'react';
import type { PlayerView } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL, NAV_CARD_LABEL, RITUAL_LABEL } from './labels.js';

const nameOf = (view: PlayerView, id: string): string =>
  (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

/** Key-fact highlight: tone picks the color (gold=person/turn, red=lethal
 *  or traitor, teal=benign), the <b> supplies the weight. */
const B = ({ tone, children }: { tone: 'gold' | 'red' | 'teal'; children: ReactNode }) => (
  <b className={`log__hl log__hl--${tone}`}>{children}</b>
);

export function LogPanel({ view }: { view: PlayerView }) {
  const reversed = [...view.log].reverse().slice(0, 50);
  return (
    <section className="log">
      {view.knowledge.length > 0 && (
        <div className="knowledge">
          <h3 className="sec__title">你的情报</h3>
          <ul>
            {[...view.knowledge].reverse().map((k, i) => (
              <li key={`${k.about}-${i}`}>
                {nameOf(view, k.about)} 是 {FACTION_ICON[k.team]}{FACTION_LABEL[k.team]}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h3 className="sec__title">记录</h3>
      <ul className="log__list">
        {reversed.map((e, i) => (
          <li key={i}>{renderEntry(view, e)}</li>
        ))}
      </ul>
    </section>
  );
}

function renderEntry(view: PlayerView, e: PlayerView['log'][number]): ReactNode {
  switch (e.t) {
    case 'round':
      return (
        <>— 第 <B tone="gold">{e.round}</B> 回合 · 船长 <B tone="gold">{nameOf(view, e.captain)}</B> —</>
      );
    case 'officers':
      return (
        <>任命：大副 <B tone="gold">{nameOf(view, e.lieutenant)}</B>，领航员 <B tone="gold">{nameOf(view, e.navigator)}</B></>
      );
    case 'mutiny':
      return (
        <>
          {e.success
            ? <>哗变成功（共 <B tone="red">{e.total}</B> 枪）！新船长 <B tone="red">{e.newCaptain ? nameOf(view, e.newCaptain) : '?'}</B></>
            : <>哗变失败（共 <B tone="teal">{e.total}</B> 枪），团队不变</>}
          {Object.keys(e.pledges).length > 0 && (
            <span className="log__mutiny-pledges">
              {Object.entries(e.pledges)
                .map(([id, guns]) => [id, guns ?? 0] as const)
                .sort((a, b) => b[1] - a[1] || Number(a[0].slice(1)) - Number(b[0].slice(1)))
                .map(([id, guns]) => (
                  <span key={id} className="log__mutiny-pledge">
                    {nameOf(view, id)} <B tone={guns > 0 ? 'red' : 'teal'}>{guns}枪</B>
                  </span>
                ))}
            </span>
          )}
        </>
      );
    case 'moved':
      return (
        <>船从 <B tone="gold">{e.from}</B> 驶向 <B tone="gold">{e.to}</B></>
      );
    case 'card':
      return (
        <>{nameOf(view, e.captain)} 翻开航海卡：<B tone="gold">{NAV_CARD_LABEL[e.card]}</B></>
      );
    case 'ritual':
      return (
        <>仪式：<B tone="red">{RITUAL_LABEL[e.card]}</B></>
      );
    case 'mapAction':
      return e.kind === 'cabinSearch'
        ? <><B tone="gold">{nameOf(view, e.actor)}</B> 搜查了 <B tone="red">{nameOf(view, e.target)}</B> 的船舱</>
        : <><B tone="red">{nameOf(view, e.actor)}</B> 将 <B tone="red">{nameOf(view, e.target)}</B> 献祭给海怪</>;
    case 'jump':
      return (
        <><B tone="red">{nameOf(view, e.player)}</B> 跳海抗命，被淘汰</>
      );
    case 'converted':
      return '有人被转化为邪教徒…';
    case 'gameOver':
      return (
        <>游戏结束：<B tone="gold">{FACTION_LABEL[e.winner]}</B> 获胜（{e.reason}）</>
      );
  }
}

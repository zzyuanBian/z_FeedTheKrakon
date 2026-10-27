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
import { navCard } from '@ftk/engine';
import {
  COLOR_GLYPH, COLOR_LABEL, FACTION_ICON, FACTION_LABEL, NAV_CARD_LABEL, RITUAL_LABEL,
} from './labels.js';
import { waitStatus } from './status.js';

const nameOf = (view: PlayerView, id: string): string =>
  (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

/** Key-fact highlight: tone picks the color (gold=person/turn, red=lethal
 *  or traitor, teal=benign), the <b> supplies the weight. */
const B = ({ tone, children }: { tone: 'gold' | 'red' | 'teal'; children: ReactNode }) => (
  <b className={`log__hl log__hl--${tone}`}>{children}</b>
);

/** The sailed card's course, coloured to its arrow (yellow/blue/red — same
 *  palette the board's move lines speak). */
const COURSE_TONE = { yellow: 'log__course--yellow', blue: 'log__course--blue', red: 'log__course--red' } as const;

const Course = ({ card }: { card: Parameters<typeof navCard>[0] }) => {
  const def = navCard(card);
  return (
    <span className={`log__course ${COURSE_TONE[def.color]}`}>
      {COLOR_LABEL[def.color]} {COLOR_GLYPH[def.color]}
    </span>
  );
};

export function LogPanel({ view }: { view: PlayerView }) {
  const reversed = [...view.log].reverse().slice(0, 50);
  // Transient alerts ride the TOP of the log column (moved out of the
  // summary strip) — mutiny window, emergency, and who the game waits on.
  const wait = waitStatus(view);
  const hasAlerts = view.mutiny.active || view.ship.emergency || !!wait;
  return (
    <section className="log">
      {hasAlerts && (
        <div className="log__alerts">
          {view.mutiny.active && (
            <div className="log__alert log__alert--mutiny">
              ⚡ 哗变 · 需 {view.mutiny.threshold} 枪
            </div>
          )}
          {view.ship.emergency && (
            <div className="log__alert log__alert--mutiny">⚠ 紧急航行</div>
          )}
          {wait && <div className={`log__alert log__alert--${wait.cls}`}>{wait.text}</div>}
        </div>
      )}
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
        {reversed.map((e, i) => renderEntry(view, e, view.log.length - 1 - i))
          .filter((node): node is ReactNode => node !== null)
          .map((node, i) => (
            <li key={i}>{node}</li>
          ))}
      </ul>
    </section>
  );
}

function renderEntry(view: PlayerView, e: PlayerView['log'][number], idx: number): ReactNode {
  switch (e.t) {
    case 'round': {
      // Annotate a non-mutiny captain hand-over (醉汉): the previous round
      // line names a different captain and no mutiny entry sits between —
      // a mutiny hand-over already tells its own story one line down.
      const prevRound = view.log.slice(0, idx).reverse().find((p) => p.t === 'round');
      // Only a mutiny BETWEEN the two round lines explains the change (the
      // whole-log search the old code used never fired: every historical
      // mutiny sits at an index < idx).
      const prevRoundIdx = prevRound ? view.log.lastIndexOf(prevRound) : -1;
      const mutinyBetween = prevRoundIdx >= 0 &&
        view.log.slice(prevRoundIdx + 1, idx).some((p) => p.t === 'mutiny');
      const drunkHandover =
        prevRound !== undefined && prevRound.t === 'round' && prevRound.captain !== e.captain &&
        !mutinyBetween;
      return (
        <>
          — 第 <B tone="gold">{e.round}</B> 回合 · 船长 <B tone="gold">{nameOf(view, e.captain)}</B> —
          {drunkHandover && (
            <span className="log__handover">🍺 醉汉上台</span>
          )}
        </>
      );
    }
    case 'officers':
      return (
        <>
          任命：大副 <B tone="gold">{e.lieutenant ? nameOf(view, e.lieutenant) : '🎲 命运补位'}</B>
          ，领航员 <B tone="gold">{e.navigator ? nameOf(view, e.navigator) : '🎲 命运补位'}</B>
        </>
      );
    case 'mutiny':
      return (
        <>
          {e.success
            ? <>哗变成功（共 <B tone="red">{e.total}</B> 枪）！新船长 <B tone="red">{e.newCaptain ? nameOf(view, e.newCaptain) : '?'}</B></>
            : <>未哗变，采用团队（共 <B tone="teal">{e.total}</B> 枪）</>}
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
      // The ship's move is already visible on the map; the log stays quiet.
      return null;
    case 'card':
      return (
        <>{nameOf(view, e.captain)} 翻开航海卡：<B tone="gold">{NAV_CARD_LABEL[e.card]}</B>，航向 <Course card={e.card} /></>
      );
    case 'ritual':
      return (
        <>仪式：<B tone="red">{RITUAL_LABEL[e.card]}</B></>
      );
    case 'ritualGuns':
      return (
        <>
          囤枪去向：
          <span className="log__mutiny-pledges">
            {[...e.grants]
              .sort((a, b) => b.guns - a.guns)
              .map((g, i) => (
                <span key={i} className="log__mutiny-pledge">
                  {nameOf(view, g.to)} <B tone="gold">+{g.guns}枪</B>
                </span>
              ))}
          </span>
        </>
      );
    case 'mapAction':
      return e.kind === 'cabinSearch'
        ? <><B tone="gold">{nameOf(view, e.actor)}</B> 搜查了 <B tone="red">{nameOf(view, e.target)}</B> 的船舱</>
        : <><B tone="red">{nameOf(view, e.actor)}</B> 将 <B tone="red">{nameOf(view, e.target)}</B> 献祭给海怪</>;
    case 'jump':
      return (
        <><B tone="red">{nameOf(view, e.player)}</B> 跳海抗命，被淘汰</>
      );
    case 'randomDraw':
      // p.12 fate draw (no lieutenant): the discarded card is public.
      return (
        <><B tone="gold">命运</B> 代大副分牌：翻开 <B tone="gold">{NAV_CARD_LABEL[e.card]}</B> 弃入深海</>
      );
    case 'randomSettle':
      // p.12 fate settle (no navigator): both cards are public.
      return (
        <><B tone="gold">命运</B> 定航向：<B tone="gold">{NAV_CARD_LABEL[e.discarded]}</B> 入海，执行 <B tone="gold">{NAV_CARD_LABEL[e.kept]}</B>，航向 <Course card={e.kept} /></>
      );
    case 'converted':
      return '有人被转化为邪教徒…';
    case 'gameOver':
      return (
        <>游戏结束：<B tone="gold">{FACTION_LABEL[e.winner]}</B> 获胜（{e.reason}）</>
      );
  }
}

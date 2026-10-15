/**
 * Public event log + private knowledge panel. The log is what everyone sees;
 * the "你的情报" block shows only what THIS viewer has privately learned
 * (Cabin Search results), which the engine marks per viewer.
 */

import type { PlayerView } from '@ftk/engine';
import { FACTION_ICON, FACTION_LABEL, NAV_CARD_LABEL, RITUAL_LABEL } from './labels.js';

const nameOf = (view: PlayerView, id: string): string =>
  (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

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

function renderEntry(view: PlayerView, e: PlayerView['log'][number]): string {
  switch (e.t) {
    case 'round': return `— 第 ${e.round} 回合 · 船长 ${nameOf(view, e.captain)} —`;
    case 'officers': return `任命：大副 ${nameOf(view, e.lieutenant)}，领航员 ${nameOf(view, e.navigator)}`;
    case 'mutiny':
      return e.success
        ? `哗变成功（${e.total} 枪）！新船长 ${e.newCaptain ? nameOf(view, e.newCaptain) : '?'}`
        : `哗变失败（${e.total} 枪），团队不变`;
    case 'moved': return `船从 ${e.from} 驶向 ${e.to}`;
    case 'card': return `${nameOf(view, e.captain)} 翻开航海卡：${NAV_CARD_LABEL[e.card]}`;
    case 'ritual': return `仪式：${RITUAL_LABEL[e.card]}`;
    case 'mapAction':
      return e.kind === 'cabinSearch'
        ? `${nameOf(view, e.actor)} 搜查了 ${nameOf(view, e.target)} 的船舱`
        : `${nameOf(view, e.actor)} 将 ${nameOf(view, e.target)} 献祭给海怪`;
    case 'jump': return `${nameOf(view, e.player)} 跳海抗命，被淘汰`;
    case 'converted': return '有人被转化为邪教徒…';
    case 'gameOver': return `游戏结束：${FACTION_LABEL[e.winner]} 获胜（${e.reason}）`;
  }
}

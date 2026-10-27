/**
 * 终局结算页 (EndScreen). Replaces the old dismiss-to-board modal: after the
 * winner banner, 查看终局 opens this full screen with three sections —
 *
 *  1. 身份公开 — every seat's team, the Cult Leader, and converts with the
 *     round (and leader) they were converted at. Engine projects
 *     `allRevealed` only once the game is over; before that this screen
 *     cannot exist.
 *  2. 完整复盘 — the public log grouped per round: captain, appointments,
 *     the card sailed (with its arrow direction), mutinies, map actions,
 *     jumps, conversions. Nothing is re-simulated; the log already carries
 *     the whole voyage.
 *  3. 最愚玩家投票 — ported from the Avalon reference project: one final,
 *     unchangeable vote per seat (not yourself); the tally reveals once
 *     everyone has voted. Bragging rights only — no rule effect.
 *
 * 回到牌桌 flips back to the (now read-only) board; the host's start-new
 * controls live in the top bar as before.
 */

import { useEffect, useState } from 'react';
import type { PlayerView, LogEntry } from '@ftk/engine';
import {
  FACTION_LABEL,
  FACTION_ICON,
  NAV_CARD_LABEL,
  COLOR_LABEL,
  COLOR_GLYPH,
} from './labels.js';
import { AvatarImage } from './Avatars.js';

export function EndScreen({
  view,
  onBack,
  onFunVote,
}: {
  view: PlayerView;
  onBack: () => void;
  onFunVote: (target: string) => void;
}) {
  const nameOf = (id: string) =>
    (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;
  const [section, setSection] = useState<'reveal' | 'recap' | 'fun'>('reveal');

  return (
    <div className="endscreen">
      <div className={`endscreen__banner endscreen__banner--${view.winner}`}>
        <span className="endscreen__banner-icon" aria-hidden="true">
          {view.winner === 'sailor' ? '⚓' : view.winner === 'pirate' ? '☠️' : '🐙'}
        </span>
        <h1>{view.winner && FACTION_LABEL[view.winner]} 获胜</h1>
        <p>{view.winReason}</p>
      </div>

      <nav className="endscreen__tabs" role="tablist">
        {(
          [
            ['reveal', '身份公开'],
            ['recap', '完整复盘'],
            ['fun', '最愚投票'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={section === key}
            className={'endscreen__tab' + (section === key ? ' endscreen__tab--on' : '')}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'reveal' && <RevealTable view={view} nameOf={nameOf} />}
      {section === 'recap' && <Recap view={view} nameOf={nameOf} />}
      {section === 'fun' && <FunVote view={view} nameOf={nameOf} onVote={onFunVote} />}

      <button type="button" className="btn endscreen__back" onClick={onBack}>
        回到牌桌
      </button>
    </div>
  );
}

/* --------------------------- 1. identity reveal -------------------------- */

function RevealTable({
  view,
  nameOf,
}: {
  view: PlayerView;
  nameOf: (id: string) => string;
}) {
  const revealed = view.allRevealed ?? [];
  return (
    <ul className="endscreen__reveal">
      {revealed.map((p) => {
        const isMe = p.id === view.you.id;
        return (
          <li key={p.id} className={'endscreen__row' + (isMe ? ' endscreen__row--me' : '')}>
            <AvatarImage avatarId={p.avatar} size={28} title={nameOf(p.id)} />
            <span className="endscreen__name">
              {nameOf(p.id)}
              {isMe && '（你）'}
              {!p.alive && <span className="endscreen__dead">（已出局）</span>}
            </span>
            <span className={`endscreen__team endscreen__team--${p.team}`}>
              {FACTION_ICON[p.team]} {FACTION_LABEL[p.team]}
              {p.cultLeader && ' · 首领'}
            </span>
            <span className="endscreen__convert">
              {p.team === 'cult' && p.convertedAt !== null
                ? `第 ${p.convertedAt} 回合被${p.convertedBy ? nameOf(p.convertedBy) : ''}转化`
                : p.convertedAt !== null
                  ? `第 ${p.convertedAt} 回合被转化`
                  : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------ 2. the recap ----------------------------- */

/** One card per round, built only from public log entries. Entries between
 *  two `round` markers belong to that round. */
function Recap({
  view,
  nameOf,
}: {
  view: PlayerView;
  nameOf: (id: string) => string;
}) {
  const rounds: { round: number; captain: string; events: LogEntry[] }[] = [];
  for (const e of view.log) {
    if (e.t === 'round') {
      rounds.push({ round: e.round, captain: e.captain, events: [] });
    } else if (e.t !== 'gameOver') {
      rounds[rounds.length - 1]?.events.push(e);
    }
  }

  return (
    <div className="endscreen__recap">
      {rounds.map((r) => (
        <div key={r.round} className="endscreen__round">
          <div className="endscreen__round-head">
            <span className="endscreen__round-no">第 {r.round} 回合</span>
            <span className="endscreen__round-captain">🧭 船长 {nameOf(r.captain)}</span>
          </div>
          <ul className="endscreen__events">
            {r.events.map((e, i) => (
              <li key={i}>{eventLine(e, nameOf)}</li>
            ))}
            {r.events.length === 0 && <li className="endscreen__event-none">（无事件）</li>}
          </ul>
        </div>
      ))}
      {view.log.find((e) => e.t === 'gameOver') && (
        <p className="endscreen__final">
          {(() => {
            const e = view.log.find((ev) => ev.t === 'gameOver');
            return e && e.t === 'gameOver' ? e.reason : '';
          })()}
        </p>
      )}
    </div>
  );
}

/** One readable line per log entry type. */
function eventLine(e: LogEntry, nameOf: (id: string) => string): string {
  switch (e.t) {
    case 'officers':
      return `任命大副 ${e.lieutenant ? nameOf(e.lieutenant) : '命运补位'}、领航员 ${e.navigator ? nameOf(e.navigator) : '命运补位'}`;
    case 'mutiny': {
      const base = e.success
        ? `哗变成功（${e.total} 枪）— 新船长 ${e.newCaptain ? nameOf(e.newCaptain) : '?'}`
        : `哗变失败（${e.total} 枪，未及 ${''}阈值）`;
      return base;
    }
    case 'card': {
      // The colour/arrow of the sailed card lives in the following 'moved'.
      return `出航牌「${NAV_CARD_LABEL[e.card]}」（船长 ${nameOf(e.captain)}）`;
    }
    case 'moved':
      return `船队 ${COLOR_LABEL[e.color]} ${COLOR_GLYPH[e.color]}：${e.from} → ${e.to}`;
    case 'ritual':
      return `邪教仪式：${e.card === 'conversion' ? '皈依' : e.card === 'gunsStash' ? '囤枪' : '船舱搜查'}`;
    case 'ritualGuns':
      return `囤枪：${e.grants.map((g) => `${nameOf(g.to)} +${g.guns}枪`).join('，')}`;
    case 'mapAction':
      return e.kind === 'cabinSearch'
        ? `船舱搜查：${nameOf(e.actor)} 搜查 ${nameOf(e.target)}`
        : `喂食海怪：${nameOf(e.actor)} 献祭了 ${nameOf(e.target)}`;
    case 'jump':
      return `${nameOf(e.player)} 跳船`;
    case 'converted':
      return '有人被邪教转化了……';
    default:
      return '';
  }
}

/* ---------------------------- 3. the fun vote ---------------------------- */

/** The Avalon port's rotating fool memes: 4 images, one every 5s, shared by
 *  every seat so the table sees the same face at the same time. */
const FOOL_IMGS = ['/img/fool1.png', '/img/fool2.png', '/img/fool3.png', '/img/fool4.png'];

function FunVote({
  view,
  nameOf,
  onVote,
}: {
  view: PlayerView;
  nameOf: (id: string) => string;
  onVote: (target: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const votedIds = view.funVotes ?? [];
  const mine = votedIds.includes(view.you.id);
  const result = view.funVoteResult;
  // Active seats only; you cannot vote for yourself.
  const candidates = [view.you, ...view.others].filter((p) => !p.benched);
  const votedCount = votedIds.length;
  const totalVoters = candidates.length;
  // Meme rotation: local interval is fine — the draw is decor, not data.
  const [foolImg, setFoolImg] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setFoolImg((prev) => (prev % 4) + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  if (result) {
    const top = result[0];
    const byId = new Map(view.allRevealed?.map((p) => [p.id, p]));
    const winner = top && byId.get(top.playerId);
    return (
      <div className="endscreen__funresult">
        <img
          src={FOOL_IMGS[foolImg - 1]}
          alt="最愚玩家"
          className="endscreen__funmeme"
          draggable={false}
        />
        <span className="endscreen__funresult-icon" aria-hidden="true">🤡</span>
        <p className="endscreen__funresult-name">
          {winner ? nameOf(winner.id) : '?'}
          {winner && (
            <span className={`endscreen__team endscreen__team--${winner.team}`}>
              {FACTION_ICON[winner.team]} {FACTION_LABEL[winner.team]}
            </span>
          )}
        </p>
        <p className="endscreen__funresult-sub">
          荣获本局最愚称号！以 {top?.count ?? 0} / {totalVoters} 票当选
        </p>
        {result.length > 1 && result[1]!.count === top?.count && (
          <p className="hint">（并列票数取先投者）</p>
        )}
        {/* Full ranking (Avalon port): top 5 with vote counts. */}
        {result.length > 1 && (
          <ul className="endscreen__funrank">
            {result.slice(0, 5).map((r, i) => {
              const p = byId.get(r.playerId);
              return (
                <li key={r.playerId} className={i === 0 ? 'is-top' : ''}>
                  <span className="endscreen__funrank-name">
                    {i === 0 ? '🤡' : `${i + 1}.`} {p ? nameOf(p.id) : '?'}
                  </span>
                  <span className="endscreen__funrank-votes">{r.count} 票</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (mine) {
    return (
      <div className="endscreen__funwait">
        <p>你已投票，等待其余船员…（{votedCount} / {totalVoters}）</p>
        <ul className="endscreen__funroster">
          {candidates.map((p) => {
            const inP = votedIds.includes(p.id);
            return (
              <li key={p.id} className={inP ? 'is-in' : ''}>
                {nameOf(p.id)}
                {p.id === view.you.id && '（你）'} — {inP ? '✓ 已投' : '… 未投'}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="endscreen__funvote">
      <p className="hint">选出本局最愚的那位船员（不能投自己，投后不可改）：</p>
      <div className="endscreen__fungrid">
        {candidates
          .filter((p) => p.id !== view.you.id)
          .map((p) => (
            <button
              key={p.id}
              type="button"
              className={'chip' + (picked === p.id ? ' chip--on' : '')}
              onClick={() => setPicked(p.id)}
            >
              {p.name}
            </button>
          ))}
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={!picked}
        onClick={() => picked && onVote(picked)}
      >
        投票
      </button>
    </div>
  );
}

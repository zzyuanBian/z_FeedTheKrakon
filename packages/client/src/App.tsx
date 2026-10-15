/**
 * App shell. Flow: lobby -> (session) -> game. The layout is a two-column
 * desktop view that collapses to stacked panels on mobile, so the same build
 * serves PC and phones.
 */

import { useCallback, useEffect, useState } from 'react';
import { CODE_LENGTH } from '@ftk/room-code';
import { Lobby } from './Lobby.js';
import { Board } from './Board.js';
import { Roster } from './Roster.js';
import { ActionPanel } from './ActionPanel.js';
import { LogPanel } from './LogPanel.js';
import { ChatPanel } from './ChatPanel.js';
import { RoleReveal } from './RoleReveal.js';
import { lobby, clearSession, loadSession, useGame } from './useGame.js';
import type { Session } from './session.js';
import { GAME_NAME } from './config.js';
import { FACTION_LABEL, PHASE_LABEL } from './labels.js';

/** How long the connecting screen waits before auto-resetting to the lobby.
 *  Must match the stale-session timeout in useGame. */
const CONNECT_TIMEOUT_SECONDS = 10;

/** Connecting screen: live countdown + manual cancel. When the timer hits 0
 *  the parent calls onCancel (which clears the session), landing the user in
 *  the lobby instead of being stuck forever on a dead matchID. */
function ConnectingScreen({ matchID, onCancel }: { matchID: string; onCancel: () => void }) {
  const [left, setLeft] = useState(CONNECT_TIMEOUT_SECONDS);
  useEffect(() => {
    if (left <= 0) { onCancel(); return; }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, onCancel]);

  const expired = left <= 0;
  return (
    <div className="connecting">
      <p>{expired ? '连接失败' : `正在连接房间 ${matchID}…`}</p>
      <p className="connecting__sub">
        {expired
          ? '房间可能已失效，正在返回大厅…'
          : `${left} 秒后若无响应将自动返回大厅`}
      </p>
      <button type="button" className="btn btn--ghost" onClick={onCancel}>
        返回大厅
      </button>
    </div>
  );
}

/** A small pill that shows the 5-letter room code and copies it on click. */
function RoomId({ matchID }: { matchID: string }) {
  const [flash, setFlash] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(matchID);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = matchID;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    setFlash(true);
    window.setTimeout(() => setFlash(false), 1200);
  }, [matchID]);
  return (
    <button
      type="button"
      className={'pill pill--room' + (flash ? ' pill--copied' : '')}
      onClick={copy}
      title="点击复制房间码"
      aria-label="房间码（点击复制）"
    >
      <span className="pill__label">房间</span>
      <span className="pill__code">{matchID}</span>
      {flash && <span className="pill__flash">✓</span>}
    </button>
  );
}

/** A player summary used while the match is still filling up. bgio fills
 *  unnamed seats with "Player N" by default; we show an empty placeholder
 *  instead so it's obvious who's still missing. */
interface RosterSeat { id: string; name: string | null; }

/** Shown right after the host creates the room: big room code, copy button,
 *  live roster of who has joined. Polls the lobby API every 1.5s until either
 *  all seats are filled or the game state starts arriving via the socket.
 *
 *  When `liveView` is supplied, we're past the first socket sync: the seat
 *  list comes from the live GameState instead of the lobby API, and empty
 *  seats are detected via bgio's default "Player N" placeholder names. */
function WaitingRoom({
  session,
  onLeave,
  playerCount,
  liveView,
  waitingLabel = '航线已开辟',
}: {
  session: Session;
  onLeave: () => void;
  playerCount: number;
  liveView?: { filled: number; seats: { id: string; name: string }[] };
  waitingLabel?: string;
}) {
  const [polledSeats, setPolledSeats] = useState<RosterSeat[]>([]);
  const [copied, setCopied] = useState(false);

  // Only poll the lobby API while we don't have a live GameState to read
  // from. Once `liveView` is present, bgio's own state sync keeps the seat
  // list up to date and polling becomes redundant.
  useEffect(() => {
    if (liveView) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const match = await lobby.getMatch(GAME_NAME, session.matchID);
        if (cancelled) return;
        setPolledSeats(
          match.players.map((p) => ({
            id: String(p.id),
            name: p.name ?? null,
          })),
        );
      } catch {
        /* transient; we'll retry */
      }
    };
    poll();
    const t = window.setInterval(poll, 1500);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [session.matchID, liveView]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(session.matchID);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = session.matchID;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [session.matchID]);

  // Live-seat rendering (after first socket sync): "Player N" placeholders
  // stand in for empty seats — bgio's @ftk/game setup names seats that way
  // until a human joins and overwrites the name via the lobby API.
  const seats: { id: string; name: string | null; isPlaceholder: boolean }[] = liveView
    ? liveView.seats.map((s) => ({
        id: s.id,
        name: /^Player \d+$/.test(s.name) ? null : s.name,
        isPlaceholder: /^Player \d+$/.test(s.name),
      }))
    : polledSeats.map((s) => ({ ...s, isPlaceholder: false }));

  const filled = liveView ? liveView.filled : polledSeats.filter((s) => s.name).length;
  const letters = session.matchID.padEnd(CODE_LENGTH, ' ').split('');

  return (
    <div className="waiting">
      <div className="waiting__hero">
        <div className="waiting__ornament" aria-hidden="true">⚓</div>
        <h2 className="waiting__title">{waitingLabel}</h2>
        <p className="waiting__sub">
          {liveView
            ? '还差几位船员，先把房间码发给他们'
            : '把房间码发给船员，等他们登船'}
        </p>
      </div>

      <button type="button" className="waiting__code" onClick={copy} aria-label="点击复制房间码">
        <div className="waiting__code-letters">
          {letters.map((ch, i) => (
            <span key={i} className={'code-letter' + (ch === ' ' ? ' code-letter--empty' : '')}>
              {ch === ' ' ? '–' : ch}
            </span>
          ))}
        </div>
        <span className="waiting__copy-hint">{copied ? '✓ 已复制' : '点击复制'}</span>
      </button>

      <div className="waiting__roster">
        <div className="waiting__roster-head">
          <span>船员</span>
          <span>{filled} / {playerCount}</span>
        </div>
        <ul className="waiting__roster-list">
          {seats.length === 0 && (
            <li className="waiting__roster-loading">读取船员名单中…</li>
          )}
          {seats.map((s) => {
            const empty = !s.name || s.isPlaceholder;
            return (
              <li key={s.id} className={'waiting__roster-row' + (empty ? ' waiting__roster-row--empty' : '')}>
                <span className="waiting__roster-seat">{Number(s.id) + 1}</span>
                <span className="waiting__roster-name">
                  {empty ? '空位' : s.name}
                  {s.id === session.playerID && ' (你)'}
                </span>
                {s.id === session.playerID && <span className="waiting__roster-you">房主</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="waiting__hint">人齐后进入身份确认阶段</p>

      <button type="button" className="btn-ghost waiting__leave" onClick={onLeave}>
        放弃这条航线
      </button>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const resetToLobby = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);
  const game = useGame(session, resetToLobby);

  const [tab, setTab] = useState<'action' | 'chat' | 'log'>('action');
  const [showGameOver, setShowGameOver] = useState(true);

  // On mobile the three panels are tabs; auto-focus the action tab when the
  // player has something to do.
  const needsMe = !!game.view?.pending?.isYou;

  useEffect(() => {
    if (needsMe) setTab('action');
  }, [needsMe]);

  if (!session) {
    return (
      <div className="app app--lobby">
        <Lobby savedSession={null} onReady={setSession} onForget={() => {}} />
      </div>
    );
  }

  // We have a session but no live game state yet. If the user just created
  // this match (playerCount is sealed into the session), show the waiting
  // room with the code hero. Otherwise they re-joined an existing match —
  // show a connecting screen that auto-resets if the room is gone.
  if (!game.view) {
    return (
      <div className="app app--lobby">
        {session.playerCount ? (
          <WaitingRoom
            session={session}
            onLeave={resetToLobby}
            playerCount={session.playerCount}
          />
        ) : (
          <ConnectingScreen matchID={session.matchID} onCancel={resetToLobby} />
        )}
      </div>
    );
  }

  const view = game.view;
  const over = view.winner !== null;
  const youName = view.you.name;
  // `playerCount` is fixed at setup time; derive it from the full roster.
  const playerCount = 1 + view.others.length;

  // Step 1 — waiting for seats to fill. Empty bgio seats are named "Player N"
  // by @ftk/game's setup (no names passed to createMatch). A seat with such a
  // placeholder name has no real human behind it yet, so we stay on the
  // waiting screen regardless of whether you're the host or a joiner. Once
  // every seat has a real name we fall through to role-reveal.
  const unfilledSeats = view.others.filter((p) => /^Player \d+$/.test(p.name)).length;
  const realPlayers = playerCount - unfilledSeats;
  if (unfilledSeats > 0) {
    return (
      <div className="app app--lobby">
        <WaitingRoom
          session={session}
          onLeave={resetToLobby}
          playerCount={playerCount}
          liveView={{ filled: realPlayers, seats: [view.you, ...view.others] }}
          waitingLabel="等待船员登船"
        />
      </div>
    );
  }

  // Step 2 — role-reveal gate: every seat must acknowledge their role card
  // before any in-game move is legal. Until this player has done so, render
  // the flip-card screen in place of the board + side panels.
  if (!view.you.roleConfirmed) {
    return (
      <div className="app app--lobby">
        <RoleReveal view={view} onConfirm={game.confirmRole} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <strong>险恶疑航</strong>
          <span className={'pill' + (game.connected ? ' pill--ok' : ' pill--bad')}>
            {game.connected ? '已连接' : '连接中…'}
          </span>
          <RoomId matchID={session.matchID} />
        </div>
        <div className="topbar__mid">
          第 {view.round} 回合 · {PHASE_LABEL[view.phase] ?? view.phase}
        </div>
        <div className="topbar__right">
          <span className="pill">你是 {youName}</span>
          <span className="pill pill--team">
            {FACTION_LABEL[view.you.team]}
            {view.you.cultLeader && ' · 首领'}
          </span>
          {view.isHost && <span className="pill">房主</span>}
        </div>
      </header>

      <main className="main">
        <section className="col col--board">
          <Board view={view} />
          <div className="boardinfo">
            <span>船位：{view.ship.spaceId}{view.ship.emergency ? ' · ⚠紧急' : ''}</span>
            <span>牌堆 {view.navigation.deckCount} · 深海 {view.navigation.discardCount}</span>
            <span>仪式剩余 {view.rituals.remaining}</span>
          </div>
        </section>

        <aside className="col col--side">
          <div className="tabs">
            <button className={'tab' + (tab === 'action' ? ' tab--on' : '')} onClick={() => setTab('action')}>
              行动{needsMe ? ' ●' : ''}
            </button>
            <button className={'tab' + (tab === 'chat' ? ' tab--on' : '')} onClick={() => setTab('chat')}>
              讨论
            </button>
            <button className={'tab' + (tab === 'log' ? ' tab--on' : '')} onClick={() => setTab('log')}>
              记录
            </button>
          </div>

          {tab === 'action' && (
            <>
              <Roster view={view} />
              {over ? (
                <div className="panel panel--over">
                  <h3>游戏结束</h3>
                  <p>{view.winner && FACTION_LABEL[view.winner]} 获胜</p>
                  <p className="hint">{view.winReason}</p>
                </div>
              ) : (
                <ActionPanel view={view} moves={game.moves} />
              )}
            </>
          )}
          {tab === 'chat' && (
            <ChatPanel
              view={view}
              chat={game.chat}
              sendChat={game.sendChat}
              muted={!view.you.alive}
            />
          )}
          {tab === 'log' && <LogPanel view={view} />}
        </aside>
      </main>

      {over && showGameOver && (
        <div className="modal" onClick={() => setShowGameOver(false)}>
          <div className="modal__box" onClick={(e) => e.stopPropagation()}>
            <h2>{view.winner && FACTION_LABEL[view.winner]} 获胜！</h2>
            <p>{view.winReason}</p>
            <button className="btn btn--primary" onClick={() => setShowGameOver(false)}>查看终局</button>
          </div>
        </div>
      )}
    </div>
  );
}

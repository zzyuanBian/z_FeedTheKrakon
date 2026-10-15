/**
 * App shell. Flow: lobby -> (session) -> game. The layout is a two-column
 * desktop view that collapses to stacked panels on mobile, so the same build
 * serves PC and phones.
 */

import { useCallback, useEffect, useState } from 'react';
import { Lobby, FactionSlider } from './Lobby.js';
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

/** Shown after the host creates the room: big room code, copy button, live
 *  roster of who has joined, a read-only summary of the host's config, and a
 *  "开始游戏" button the host flips once everyone is at their keyboard.
 *
 *  When `liveView` is supplied, we're past the first socket sync: the seat
 *  list comes from the live GameState instead of the lobby API, and empty
 *  seats are detected via bgio's default "Player N" placeholder names. */
function WaitingRoom({
  session,
  onLeave,
  onStart,
  playerCount,
  liveView,
  waitingLabel = '航线已开辟',
  canStart,
  isHost,
}: {
  session: Session;
  onLeave: () => void;
  onStart: () => void;
  playerCount: number;
  liveView?: { filled: number; seats: { id: string; name: string; isMe?: boolean }[] };
  waitingLabel?: string;
  canStart: boolean;
  isHost: boolean;
}) {
  const [polledSeats, setPolledSeats] = useState<RosterSeat[]>([]);
  const [copied, setCopied] = useState(false);
  const [startRequested, setStartRequested] = useState(false);

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

  const handleStart = () => {
    if (!canStart || startRequested) return;
    setStartRequested(true);
    onStart();
  };

  // Seat rendering. Empty/placeholder seats are FILTERED OUT — the crew list
  // grows as people join instead of pre-rendering N rows of 空位 (the
  // "X / N" counter in the header still shows the target size).
  //
  // NB: the two branches produce different id namespaces:
  //   - liveView.seats[*].id is the ENGINE PlayerId ("p1", "p2", ...)
  //   - polledSeats[*].id is the bgio seat index as a string ("0", "1", ...)
  // So "am I this seat?" can't just be `s.id === session.playerID` — we
  // precompute `isMe` in the shape itself.
  const seats: { id: string; name: string; isMe: boolean }[] = liveView
    ? liveView.seats
        .filter((s) => !/^Player \d+$/.test(s.name))
        .map((s) => ({ id: s.id, name: s.name, isMe: !!s.isMe }))
    : polledSeats
        .filter((s) => s.name)
        .map((s) => ({ id: s.id, name: s.name!, isMe: s.id === session.playerID }));

  const filled = liveView ? liveView.filled : polledSeats.filter((s) => s.name).length;

  // Config panel: the host's exact faction breakdown. createMatch always
  // seals factionCounts into setupData and joinMatch copies it into every
  // joiner's session, so this is always present and always what the host
  // configured — no rulebook-preset guesswork anywhere.
  const fc = session.factionCounts ?? { sailor: 0, pirate: 0, cult: 0 };

  return (
    <div className="waiting">
      <div className="waiting__hero">
        <div className="waiting__ornament" aria-hidden="true">⚓</div>
        <h2 className="waiting__title">{waitingLabel}</h2>
        <p className="waiting__sub">把房间码发给船员，等他们登船</p>
      </div>

      <button type="button" className="room-code" onClick={copy} aria-label="点击复制房间码">
        <span className="room-code__label">房间码</span>
        <span className="room-code__value">{session.matchID}</span>
        <span className="room-code__icon" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>

      {/* Locked config panel — same visual as CreateRoom's sliders, disabled,
          so the create page and the waiting page read as one continuous flow. */}
      <div className="waiting__config">
        <div className="waiting__config-title">本局配置 · {playerCount} 人局</div>
        <div className="faction-grid">
          <FactionSlider label="水手" glyph="⚓" value={fc.sailor} onChange={() => {}} min={0} max={11} accent="gold" disabled />
          <FactionSlider label="海盗" glyph="☠️" value={fc.pirate} onChange={() => {}} min={0} max={11} accent="blood" disabled />
          <FactionSlider label="邪教徒" glyph="🐙" value={fc.cult} onChange={() => {}} min={0} max={11} accent="cult" disabled />
        </div>
      </div>

      <div className="waiting__roster">
        <div className="waiting__roster-head">
          <span>船员</span>
          <span>{filled} / {playerCount}</span>
        </div>
        <ul className="waiting__roster-list">
          {seats.length === 0 && (
            <li className="waiting__roster-loading">读取船员名单中…</li>
          )}
          {seats.map((s, i) => (
            <li key={s.id} className="waiting__roster-row">
              <span className="waiting__roster-seat">{i + 1}</span>
              <span className="waiting__roster-name">
                {s.name}
                {s.isMe && ' (你)'}
              </span>
              {s.isMe && isHost && <span className="waiting__roster-you">房主</span>}
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <button
          type="button"
          className="btn-cthulhu btn-cthulhu--gold waiting__start"
          onClick={handleStart}
          disabled={!canStart || startRequested}
        >
          <span className="btn-cthulhu__glyph">🐙</span>
          <span className="btn-cthulhu__body">
            <span className="btn-cthulhu__title">
              {startRequested ? '正在发号…' : !canStart ? `等人齐 (${filled}/${playerCount})` : '开始游戏'}
            </span>
            <span className="btn-cthulhu__hint">
              {canStart ? '所有人将看到自己的身份' : '船员到齐后才能发号'}
            </span>
          </span>
        </button>
      ) : (
        <p className="waiting__hint">
          {filled < playerCount
            ? `等待其他船员 (${filled}/${playerCount})`
            : '等待房主发号施令'}
        </p>
      )}

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
            onStart={() => {}}
            playerCount={session.playerCount}
            canStart={false}
            isHost={false}
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

  // bgio keeps lobby-display names and GameState names in two separate
  // stores. Every client bridges its own name into GameState via `syncName`
  // on first sync, but until that round-trip completes for EVERY seat, the
  // GameState still carries setup-time "Player N" placeholders. While any
  // seat is a placeholder we render the POLLING WaitingRoom (names sourced
  // from the lobby API), so the roster never flashes 空位 in the window
  // between socket-sync and syncName landing.
  const PLACEHOLDER = /^Player \d+$/;
  const namesSynced =
    !PLACEHOLDER.test(view.you.name) && view.others.every((p) => !PLACEHOLDER.test(p.name));

  if (!namesSynced) {
    return (
      <div className="app app--lobby">
        <WaitingRoom
          session={session}
          onLeave={resetToLobby}
          onStart={game.hostStartGame}
          playerCount={playerCount}
          // Deliberately NO liveView → WaitingRoom polls the lobby API,
          // whose metadata carries real names the moment each player joins.
          waitingLabel="等待船员登船"
          canStart={false}
          isHost={view.isHost}
        />
      </div>
    );
  }

  // Step 1 — waiting for seats to fill. Every GameState name is real now, so
  // the placeholder check is purely informational here.
  const unfilledSeats = view.others.filter((p) => PLACEHOLDER.test(p.name)).length;
  const realPlayers = playerCount - unfilledSeats;
  const allSeatsFilled = unfilledSeats === 0;

  // Step 2 — all seats filled, but the host hasn't flipped the "开始游戏"
  // switch yet. Stay on the waiting screen; the host sees a gold CTA, other
  // seats see a "等待房主开始" hint.
  if (!allSeatsFilled || !view.hostStarted) {
    return (
      <div className="app app--lobby">
        <WaitingRoom
          session={session}
          onLeave={resetToLobby}
          onStart={game.hostStartGame}
          playerCount={playerCount}
          liveView={{
            filled: realPlayers,
            seats: [
              { id: view.you.id, name: view.you.name, isMe: true },
              ...view.others.map((p) => ({ id: p.id, name: p.name, isMe: false })),
            ],
          }}
          waitingLabel={allSeatsFilled ? '船员到齐，等待房主发号' : '等待船员登船'}
          canStart={allSeatsFilled && view.isHost}
          isHost={view.isHost}
        />
      </div>
    );
  }

  // Step 3 — role-reveal gate: every seat must acknowledge their role card
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

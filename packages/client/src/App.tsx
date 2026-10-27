/**
 * App shell. Flow: lobby -> (session) -> game. The layout is a four-column
 * desktop view that collapses to map-first + tabbed panels on mobile, so the
 * same build serves PC and phones.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type FactionCounts, type PlayerId } from '@ftk/engine';
import {
  CountStepper, FactionStepper, Lobby, canShift, presetFor, scaleCounts, shiftSeat,
} from './Lobby.js';
import { Board } from './Board.js';
import { DiscardSea, DrawPiles, OffDutyZone } from './ZonesPanel.js';
import { Roster } from './Roster.js';
import { usePlayerMarks, type PlayerMarks } from './marks.js';
import { MutinyReveal } from './MutinyReveal.js';
import { CardReveal, cardRevealKey } from './CardReveal.js';
import { RitualPeek } from './RitualPeek.js';
import { CabinSearchNotice, cabinSearchKey } from './CabinSearchNotice.js';
import { CaptainChangeNotice, captainChangeKey } from './CaptainChangeNotice.js';
import { EliminationNotice, eliminationKey } from './EliminationNotice.js';
import { FateNotice, fateKey } from './FateNotice.js';
import { MapReveal, mapRevealActive } from './MapReveal.js';
import { MapViewer } from './MapViewer.js';
import { GunsStashNotice, gunsStashKey } from './GunsStashNotice.js';
import { RitualChoice, ritualPickActive } from './RitualChoice.js';
import { MutinyPrompt } from './MutinyPrompt.js';
import { EndScreen } from './EndScreen.js';
import { RitualReveal } from './RitualReveal.js';
import { ActionPanel } from './ActionPanel.js';
import { LogPanel } from './LogPanel.js';
import { ChatBubble } from './ChatBubble.js';
import { RoleReveal } from './RoleReveal.js';
import { StoryPrologue } from './StoryPrologue.js';
import { lobby, clearSession, loadSession, leaveMatch, useGame } from './useGame.js';
import type { Session } from './session.js';
import { MAX_PLAYERS, MIN_PLAYERS, GAME_NAME } from './config.js';
import { FACTION_ICON, FACTION_LABEL, PHASE_LABEL } from './labels.js';
import { copyText, roomShareUrl } from './clipboard.js';
import { TurnToast, useTurnNudge, useTurnReminderPref } from './TurnNudge.js';
import { iOweMutinyPledge } from './actions.js';

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
    await copyText(matchID);
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

/** Shown after the host creates the room: big room code, share/copy buttons,
 *  live roster of who has joined, the run's config — EDITABLE by the host
 *  until the game starts — and a "开始游戏" button the host flips once
 *  everyone is at their keyboard.
 *
 *  Host config editing: BOTH the faction breakdown and the target crew size
 *  go through the `setFactionConfig` move — the room's seats are permanent
 *  (built at full capacity), so nothing ever rebuilds the match; everyone in
 *  the room sees the new numbers on the next broadcast. Players beyond the
 *  target size sit on the bench (候补) until the host raises it.
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
  waitingLabel = '等待船员登船',
  canStart,
  isHost,
  factionCounts,
  onSetFactionCounts,
  benchCount = 0,
  onBootSeat,
  ghosts,
}: {
  session: Session;
  onLeave: () => void;
  onStart: () => void;
  playerCount: number;
  liveView?: { filled: number; seats: { id: string; name: string; isMe?: boolean; benched?: boolean }[] };
  waitingLabel?: string;
  canStart: boolean;
  isHost: boolean;
  /** Live faction breakdown from the GameState, when a sync has landed.
   *  Falls back to the breakdown sealed in the session (pre-sync). */
  factionCounts?: FactionCounts | undefined;
  /** Host only: re-seal the breakdown (and optionally the target crew size)
   *  via the setFactionConfig move. Absent pre-connection, where the move
   *  could be dropped by a not-yet-open socket. */
  onSetFactionCounts?: ((fc: FactionCounts, nextCount?: number) => void) | undefined;
  /** How many players are waiting on the bench (beyond the target size). */
  benchCount?: number | undefined;
  /** Host only: clear an unclaimed (ghost) seat via the clearSeat move. */
  onBootSeat?: ((targetId: string) => void) | undefined;
  /** Active seats whose GameState name is unclaimed (never synced, or the
   *  player left) — engine ids, from App's live view. */
  ghosts?: string[] | undefined;
}) {
  const [polledSeats, setPolledSeats] = useState<RosterSeat[]>([]);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
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
    await copyText(session.matchID);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [session.matchID]);

  const share = useCallback(async () => {
    await copyText(roomShareUrl(session.matchID));
    setShared(true);
    window.setTimeout(() => setShared(false), 1400);
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
  const seats: { id: string; name: string; isMe: boolean; benched: boolean }[] = liveView
    ? liveView.seats
        // Active AND bench seats hide placeholder / empty names: a seat the
        // host shrank away keeps its setup-time "Player N" placeholder, and
        // one that left via 放弃这条航线 clears its GameState name to ''.
        // Neither belongs in the roster.
        .filter((s) => s.name !== '' && !/^Player \d+$/.test(s.name))
        .map((s) => ({ id: s.id, name: s.name, isMe: !!s.isMe, benched: !!s.benched }))
    : polledSeats
        .filter((s) => s.name)
        .map((s) => ({ id: s.id, name: s.name!, isMe: s.id === session.playerID, benched: false }));

  const filled = liveView ? liveView.filled : polledSeats.filter((s) => s.name).length;

  // ---- host config editing ----
  // The breakdown on display: live from the GameState once synced, else the
  // breakdown sealed into the session at create time.
  const sealed = session.factionCounts ?? { sailor: 4, pirate: 2, cult: 1 };
  const fc = factionCounts ?? sealed;
  const editable = isHost && !!onSetFactionCounts;

  // Local draft mirrors the authoritative numbers; the echo of each
  // setFactionConfig broadcast re-snaps it (covers races + rejected moves).
  // `draftRef` advances synchronously inside bump() so two rapid clicks —
  // even two landing before the next React render — always compose instead
  // of reading the same stale draft twice.
  const [draft, setDraft] = useState<FactionCounts>(fc);
  const draftRef = useRef(draft);
  const fcKey = `${fc.sailor},${fc.pirate},${fc.cult}`;
  useEffect(() => {
    draftRef.current = fc;
    setDraft(fc);
  }, [fcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const bump = (f: 'sailor' | 'pirate' | 'cult', d: 1 | -1) => {
    const next = shiftSeat(draftRef.current, f, d);
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
    onSetFactionCounts?.(next);
  };

  // Player count: retunes the target crew size through the same live move as
  // the faction steppers — the room, its code and every seated player stay
  // put. The breakdown jumps to the new count's preset (or scales the current
  // one when the count has no rulebook preset); the broadcast echo re-snaps.
  const canEditCount = isHost && !!onSetFactionCounts;
  const changeCount = (next: number) => {
    if (!canEditCount || next === playerCount) return;
    const p = presetFor(next);
    const nextFc: FactionCounts = p
      ? { sailor: p.sailor, pirate: p.pirate, cult: p.cult }
      : scaleCounts(draft, next);
    draftRef.current = nextFc;
    setDraft(nextFc);
    onSetFactionCounts?.(nextFc, next);
  };

  // Ghost seats: active seats whose GameState name is unclaimed (empty, or
  // still the setup-time placeholder because the client died before its
  // syncName landed — exactly the ghost that deadlocks the start gate). The
  // authoritative list comes from App's live view; here they render as 空位
  // rows the host can clear.
  const ghostIds = ghosts ?? [];

  // Booting a ghost: the engine's clearSeat does the whole job in one move —
  // it shrinks the crew so the ghost (and every vacancy after it) leaves the
  // active ring, rescales the breakdown and re-deals. Nothing else to do here.
  const bootSeat = (targetId: string) => {
    onBootSeat?.(targetId);
  };

  // The 发号 latch must not wedge: if hostStartGame was rejected server-side
  // (a race — a ghost appeared between the gate check and the click), re-arm
  // so the host can retry instead of staring at 正在发号… forever.
  useEffect(() => {
    if (!startRequested) return;
    const t = window.setTimeout(() => setStartRequested(false), 3000);
    return () => window.clearTimeout(t);
  }, [startRequested]);

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

      <button
        type="button"
        className={'btn-ghost btn-ghost--sm share-btn' + (shared ? ' share-btn--copied' : '')}
        onClick={share}
      >
        {shared ? '✓ 链接已复制，发给船员吧' : '🔗 一键分享（复制房间链接）'}
      </button>

      {/* Config panel — live-editable for the host (steppers with automatic
          seat balancing), read-only numbers for everyone else. */}
      <div className="waiting__config">
        <div className="waiting__config-title">
          <span>本局配置 · {playerCount} 人局</span>
          {canEditCount && (
            <CountStepper
              value={playerCount}
              min={MIN_PLAYERS}
              max={MAX_PLAYERS}
              onChange={changeCount}
            />
          )}
        </div>
        <div className="faction-grid">
          <FactionStepper
            label="水手"
            glyph="img/seal-sailor.png"
            value={draft.sailor}
            accent="gold"
            disabled={!editable}
            canPlus={canShift(draft, 'sailor', 1)}
            canMinus={canShift(draft, 'sailor', -1)}
            onDelta={(d) => bump('sailor', d)}
          />
          <FactionStepper
            label="海盗"
            glyph="img/seal-pirate.png"
            value={draft.pirate}
            accent="blood"
            disabled={!editable}
            canPlus={canShift(draft, 'pirate', 1)}
            canMinus={canShift(draft, 'pirate', -1)}
            onDelta={(d) => bump('pirate', d)}
          />
          <FactionStepper
            label="邪教徒"
            glyph="img/seal-cult.png"
            value={draft.cult}
            accent="cult"
            disabled={!editable}
            canPlus={canShift(draft, 'cult', 1)}
            canMinus={canShift(draft, 'cult', -1)}
            onDelta={(d) => bump('cult', d)}
          />
        </div>
        {editable && (() => {
          const p = presetFor(playerCount);
          if (!p) return null;
          const on = draft.sailor === p.sailor && draft.pirate === p.pirate && draft.cult === p.cult;
          return (
            <div className="preset-row">
              <button
                type="button"
                className={'preset-chip' + (on ? ' preset-chip--on' : '')}
                onClick={() => {
                  const preset: FactionCounts = { sailor: p.sailor, pirate: p.pirate, cult: p.cult };
                  draftRef.current = preset;
                  setDraft(preset);
                  onSetFactionCounts?.(preset);
                }}
              >
                推荐：{p.sailor}⚓ {p.pirate}☠️ {p.cult}🐙
              </button>
            </div>
          );
        })()}
      </div>

      <div className="waiting__roster">
        <div className="waiting__roster-head">
          <span>船员</span>
          <span>{filled} / {playerCount}{benchCount > 0 ? ` · 候补 ${benchCount}` : ''}</span>
        </div>
        <ul className="waiting__roster-list">
          {seats.length === 0 && ghostIds.length === 0 && (
            <li className="waiting__roster-loading">读取船员名单中…</li>
          )}
          {(() => {
            let activeNo = 0;
            return seats.map((s) => {
              const no = s.benched ? null : ++activeNo;
              return (
                <li
                  key={s.id}
                  className={'waiting__roster-row' + (s.benched ? ' waiting__roster-row--bench' : '')}
                >
                  <span className="waiting__roster-seat">{no ?? '⏳'}</span>
                  <span className="waiting__roster-name">
                    {s.name}
                    {s.isMe && ' (你)'}
                  </span>
                  {s.benched
                    ? <span className="waiting__roster-bench">候补</span>
                    : s.isMe && isHost && <span className="waiting__roster-you">房主</span>}
                </li>
              );
            });
          })()}
          {/* Ghost rows: active seats whose name is unclaimed (never synced,
              or vacated by a leave). The host can clear them (clearSeat) —
              without this a dead tab would hold the start gate hostage
              forever. Engine ids, so only the live-view branch has them. */}
          {ghostIds.map((id) => (
            <li key={id} className="waiting__roster-row waiting__roster-row--ghost">
              <span className="waiting__roster-seat">—</span>
              <span className="waiting__roster-name">空位（连接中断）</span>
              {isHost && onBootSeat && (
                <button
                  type="button"
                  className="btn-ghost btn-ghost--sm waiting__roster-boot"
                  title="清除此空位，腾出席位"
                  onClick={() => bootSeat(id)}
                >
                  清除
                </button>
              )}
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
  // The live connection's syncName — assigned after useGame below, read by
  // resetToLobby. A ref because the callback outlives render order (it is
  // also useGame's onStale, which can fire during the same effect pass).
  const syncNameRef = useRef<((name: string) => void) | null>(null);
  // 放弃这条航线: announce the departure (clear the GameState name over the
  // socket + free the lobby seat server-side) BEFORE dropping the local
  // session — otherwise other players' rosters keep the ghost forever.
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const resetToLobby = useCallback(() => {
    const s = sessionRef.current;
    if (s) void leaveMatch(s, syncNameRef.current);
    setSession(null);
  }, []);
  const game = useGame(session, resetToLobby);
  syncNameRef.current = game.syncName;
  // Private guess notes (Avalon-parity marking): one store per match+seat,
  // sessionStorage-backed, rendered by the roster AND the chat avatars.
  const playerMarks = usePlayerMarks(session?.matchID ?? '', session?.playerID ?? '');

  const [tab, setTab] = useState<'action' | 'crew' | 'log'>('action');
  // Chat typing detection: while the chat input holds focus (soft keyboard
  // up on mobile), invasive modals defer — see the MutinyPrompt mount gate.
  const [chatFocused, setChatFocused] = useState(false);
  const [showGameOver, setShowGameOver] = useState(true);
  // 查看终局 swaps the winner modal for the full EndScreen (identities,
  // recap, fun vote); 回到牌桌 returns to the read-only board.
  const [showEndScreen, setShowEndScreen] = useState(false);

  // Launch countdown (role-reveal → board): when the all-confirmed broadcast
  // lands, hold every client on the reveal screen for a shared 5-second
  // count, then release the whole table onto the board on the same state.
  // The countdown is cosmetic — the server's confirmedRole gate is what
  // actually admits moves — but the App gate must KEEP holding the reveal
  // screen while it runs, or the board would render the instant the last
  // player confirms and nobody would see the count.
  //
  // A sessionStorage "launched" flag (per match+seat) keeps a mid-game
  // refresh from replaying the countdown: once this tab has seen the board
  // for this match, a reload drops straight through to it.
  const launchGateKey = session ? `ftk-launched:${session.matchID}:${session.playerID}` : '';
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (!launchGateKey) return;
    let ever = false;
    try { ever = sessionStorage.getItem(launchGateKey) === '1'; } catch { /* private mode */ }
    setLaunched(ever);
  }, [launchGateKey]);
  const markLaunched = useCallback(() => {
    if (!launchGateKey) return;
    setLaunched(true);
    try { sessionStorage.setItem(launchGateKey, '1'); } catch { /* private mode */ }
  }, [launchGateKey]);
  const [launchAt, setLaunchAt] = useState<number | null>(null);
  const [launchLeft, setLaunchLeft] = useState(5);
  const allConfirmed =
    !!game.view
    && game.view.roleConfirmations.total > 0
    && game.view.roleConfirmations.confirmed >= game.view.roleConfirmations.total;
  const counting = allConfirmed && !launched;
  useEffect(() => {
    if (counting && launchAt === null) setLaunchAt(Date.now());
    if (!counting && launchAt !== null) setLaunchAt(null);
  }, [counting, launchAt]);
  useEffect(() => {
    if (launchAt === null) return;
    const tick = () => setLaunchLeft(Math.max(0, Math.ceil((launchAt + 5000 - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [launchAt]);
  useEffect(() => {
    if (counting && launchAt !== null && launchLeft <= 0) markLaunched();
  }, [counting, launchAt, launchLeft, markLaunched]);
  const launchCountdown = counting ? launchLeft : null;

  // Mutiny reveal veil (成功与失败都弹): edge-triggered on the reveal
  // broadcast. Every client sees the same public pledges at the same moment.
  // Dismissing sets the flag; when the mutiny window ends (`revealed` back
  // to false — next round's appointment clears it) the flag resets so the
  // NEXT mutiny re-pops the veil. Success stays true through the tie-break
  // chain, so the veil persists until the new captain is known + dismissed.
  const [mutinyDismissed, setMutinyDismissed] = useState(false);
  const mutinyRevealed = !!game.view?.mutiny.revealed;
  useEffect(() => {
    if (!mutinyRevealed) setMutinyDismissed(false);
  }, [mutinyRevealed]);

  // 航海牌揭示弹框: every client pops the settled card + its rules text the
  // moment the navigator flips it. Keyed on `round:card` — a key never seen
  // before opens the modal; 继续 records it. A failed mutiny flows straight
  // into navigation, so this also covers the voyage's first reveal; the
  // card stays visible in the board's own widgets after dismissal.
  const cardKey = game.view ? cardRevealKey(game.view) : null;
  const [seenCardKey, setSeenCardKey] = useState<string | null>(null);
  const cardRevealOpen = cardKey !== null && cardKey !== seenCardKey;

  // 哗变表决弹框 (MutinyPrompt): pops for every seat the moment the game
  // enters the loyalty phase, input included — nobody has to notice a tab
  // changed. `open` re-arms on each NEW loyalty window (the next round's
  // appointment); minimizing just closes it for now — the action tab keeps
  // a reopen button while the pledge is still owed, and a page refresh
  // re-opens (the window is still live, the pledge still unfinished).
  const loyaltyLive = !!game.view && game.view.phase === 'loyalty' && game.view.mutiny.active;
  const [mutinyPromptOpen, setMutinyPromptOpen] = useState(false);
  const mutinyRef = useRef<{ phase: boolean }>({ phase: false });
  if (loyaltyLive && !mutinyRef.current.phase) setMutinyPromptOpen(true);
  mutinyRef.current.phase = loyaltyLive;
  useEffect(() => {
    if (!loyaltyLive) setMutinyPromptOpen(false);
  }, [loyaltyLive]);

  // Ritual veil (闭眼仪式): eyelids slide shut for every seat while a
  // ritual's pending is open, plus a one-shot secret beat for the player
  // just converted — their view gains `convertedBy` at the conversion
  // broadcast (the SAME one that clears the ritual pending). Both windows
  // drive `ritualVeilActive`; the component plays its own close/open
  // animation and calls onGone after the lids part, which only clears the
  // unmount gate. Dismissal (沉入黑暗/睁开双眼) sets ritualDismissed — BOTH
  // branches honour it: the old ternary sent the freshly-converted player
  // down a branch that never read the flag, so their click did nothing.
  // A ritual pending is the closed-eyes flow — EXCEPT the captain's public
  // pick window (Cult Uprising house rule): while the pick pile is open
  // (`rituals.picking > 0`) the table is still choosing, so no peek and no
  // lids (RitualChoice owns the screen). The captain's pick closes the
  // window, which re-opens this edge — the 5s peek then shows the PICKED
  // card: the whole table confirms its content before the lids close and
  // the ritual executes.
  const ritualPending = game.view?.pending?.kind === 'ritual'
    && game.view.rituals.picking === 0;
  const convertedBy = game.view?.you.convertedBy ?? null;
  const [ritualDismissed, setRitualDismissed] = useState(false);
  const [seenConversion, setSeenConversion] = useState<string | null>(null);
  const [veilMounted, setVeilMounted] = useState(false);
  const freshConversion = !!convertedBy && seenConversion !== convertedBy;
  // 5s card peek BEFORE the lids close: the ritual card just flipped and the
  // table should get to read WHAT it does (the tabletop group passes the
  // physical card around; online the veil used to swallow it instantly).
  // During the peek the ritual is NOT yet "active" — the board stays visible
  // with the CardReveal modal on top; when the timer lands, the lids take
  // over. A mid-peek refresh just restarts the 5s (harmless).
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!ritualPending) {
      setPeeking(false);
      return;
    }
    setPeeking(true);
    const t = window.setTimeout(() => setPeeking(false), 5000);
    return () => window.clearTimeout(t);
  }, [ritualPending]);
  // The conversion beat (被转化 reveal) must NOT be delayed — it carries no
  // card to read and the leader is waiting to act. Peek gates only the
  // bystander/leader lid-closing driven by `ritualPending`.
  const ritualVeilActive =
    !!game.view && game.view.winner === null &&
    ((ritualPending && !peeking) || freshConversion) && !ritualDismissed;
  // Mount the veil the moment a window opens; onGone (lids finished parting)
  // unmounts it. Keeps the exit animation alive across the active→idle edge.
  useEffect(() => {
    if (ritualVeilActive) setVeilMounted(true);
  }, [ritualVeilActive]);
  // Re-arm on each NEW ritual window.
  useEffect(() => {
    if (ritualPending) setRitualDismissed(false);
  }, [ritualPending]);
  // 闭眼即清场: the lids own the screen while a ritual runs, and a public
  // modal left open underneath (card reveal, cabin/guns notices, mutiny
  // reveal) would resurface the moment they part. Latch every veil's
  // seen-key the instant the lids close. The pick window cannot be open
  // here (the veil edge excludes it) and MutinyPrompt only renders in the
  // loyalty phase — nothing else lingers.
  useEffect(() => {
    if (!ritualVeilActive) return;
    if (cardRevealOpen) setSeenCardKey(cardKey);
    if (cabinNoticeOpen) setSeenCsKey(csKey);
    if (gunsNoticeOpen) setSeenGsKey(gsKey);
    if (captainChangeOpen) setSeenCcKey(ccKey);
    if (elimEntry) setSeenElimIdx(elimEntry.idx);
    if (fateEntry) setSeenFateIdx(fateEntry.idx);
    if (mutinyRevealed && !mutinyDismissed) setMutinyDismissed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ritualVeilActive]);
  // Latch the conversion the moment the veil is dismissed — keying on the
  // converter id means a SECOND conversion of the same player (rule
  // illegal, but defensive) would still re-pop. Latching only on dismiss
  // keeps the click from being instantly overwritten while open.
  useEffect(() => {
    if (ritualDismissed && freshConversion && convertedBy) setSeenConversion(convertedBy);
  }, [ritualDismissed, freshConversion, convertedBy]);

  // 放大镜(船舱搜查)通知: pops for EVERY seat while the mapAction pending
  // for a magnify space is live; keyed per round, dismissed per key.
  const csKey = game.view ? cabinSearchKey(game.view) : null;
  const [seenCsKey, setSeenCsKey] = useState<string | null>(null);
  const cabinNoticeOpen = csKey !== null && csKey !== seenCsKey;
  // 邪教囤枪公示: pops when the ritualGuns log entry is the newest event;
  // keyed on the entry's index so each stash notifies exactly once.
  const gsKey = game.view ? gunsStashKey(game.view) : null;
  const [seenGsKey, setSeenGsKey] = useState<string | null>(null);
  const gunsNoticeOpen = gsKey !== null && gsKey !== seenGsKey;
  // 船长更替公示 (drunk-card hand-overs — mutiny has its own veil): keyed on
  // the log length at the moment the fresh `round` line landed.
  const ccKey = game.view ? captainChangeKey(game.view) : null;
  const [seenCcKey, setSeenCcKey] = useState<string | null>(null);
  const captainChangeOpen = ccKey !== null && ccKey !== seenCcKey;
  // 出局公示 (feedKraken / jump): the tail elimination entry until seen.
  const elimEntry = game.view ? eliminationKey(game.view) : null;
  const [seenElimIdx, setSeenElimIdx] = useState<number | null>(null);
  const eliminationOpen = elimEntry !== null && elimEntry.idx !== seenElimIdx;
  // 命运公示 (fate draws/settles below three players): same latch shape.
  const fateEntry = game.view ? fateKey(game.view) : null;
  const [seenFateIdx, setSeenFateIdx] = useState<number | null>(null);
  const fateOpen = fateEntry !== null && fateEntry.idx !== seenFateIdx;

  // On mobile the side column is tabs; auto-focus the action tab when the
  // player has something to do. The navigation contribute/logbook stages set
  // NO engine pending — they ride navigation.stage/mine instead — so they
  // must be spelled out here or a captain/lieutenant sitting on another tab
  // (e.g. just after the mutiny vote) never gets pulled back to their cards.
  const nav = game.view?.navigation;
  const navMine =
    (!!game.view && nav?.stage === 'contribute' && !nav.hasActed &&
      (game.view.you.id === game.view.officers.captain ||
        game.view.you.id === game.view.officers.lieutenant)) ||
    (!!game.view && nav?.stage === 'logbook' &&
      game.view.you.id === game.view.officers.navigator);
  const needsMe = !!game.view?.pending?.isYou || navMine ||
    // An unpledged seat during an open loyalty vote owes the 哗变 pledge even
    // after minimising the MutinyPrompt (稍后决定): the badge / tab dot /
    // title flicker must keep chasing them until they pledge.
    (!!game.view && iOweMutinyPledge(game.view));

  useEffect(() => {
    if (needsMe) setTab('action');
  }, [needsMe]);

  // 轮到你了 nudges (TurnNudge): persistent badge + one-shot chime/buzz/toast
  // + background-tab title flicker. `suppressed` = any full-screen modal or
  // veil currently covering the board; the chime fires when it clears (the
  // modal itself IS the loudest possible reminder while it is up). The hook
  // must sit above the pre-game early returns (rules of hooks), so the pick
  // gate is re-derived from game.view here — `pickGateOpen` below is the
  // same expression once `view` exists.
  const [reminderOn, toggleReminder] = useTurnReminderPref();
  // 身份掩码 (faction pill privacy): tapping the topbar's faction pill
  // toggles a ❓ mask — for playing over someone's shoulder. Per
  // match+seat in sessionStorage: the mask is a per-game courtesy, it
  // should NOT survive into the next room. Must sit above the pre-game
  // early returns (rules of hooks).
  const factionMaskKey = session
    ? `ftk-faction-mask:${session.matchID}:${session.playerID}`
    : '';
  const [factionMasked, setFactionMasked] = useState(
    () => (factionMaskKey ? sessionStorage.getItem(factionMaskKey) === '1' : false),
  );
  const toggleFactionMask = () => {
    if (!factionMaskKey) return;
    setFactionMasked((v) => {
      sessionStorage.setItem(factionMaskKey, v ? '0' : '1');
      return !v;
    });
  };
  const pickGatePre = !!game.view && ritualPickActive(game.view) && cardRevealOpen;
  // While the MutinyPrompt is actually on screen it is its own loudest
  // reminder — the chime waits. Tapping 稍后决定 closes it, so an unpledged
  // seat's nudge (chime/buzz/toast + persistent badge) fires right then
  // instead of being muted for the whole loyalty phase.
  const mutinyPromptUp = loyaltyLive && mutinyPromptOpen;
  const nudgesSuppressed =
    cardRevealOpen || cabinNoticeOpen || gunsNoticeOpen || captainChangeOpen ||
    eliminationOpen || fateOpen ||
    pickGatePre || mutinyRevealed || ritualVeilActive || mutinyPromptUp || peeking;
  const { badge: nudgeBadge, toast: nudgeToast } = useTurnNudge(
    needsMe, nudgesSuppressed, reminderOn,
  );

  // Host config: player count AND faction breakdown both ride the live
  // `setFactionConfig` move — rooms are built at full seat capacity, so no
  // config change ever rebuilds the match or strands a joined player.

  // 手机端海图放大镜: the board band is ~38vh on phones — too small to
  // read route arrows. Only pointer-coarse devices (phones/tablets) get
  // the tap-to-expand affordance; PC reads the map directly.
  const [mapExpanded, setMapExpanded] = useState(false);
  const coarsePointer = useMemo(
    () => window.matchMedia?.('(pointer: coarse)').matches ?? false,
    [],
  );

  if (!session) {
    return (
      <div className="app app--lobby">
        <Lobby savedSession={null} onReady={setSession} onForget={() => {}} />
      </div>
    );
  }

  // Every in-session screen (waiting room, role reveal, board) shares the
  // floating chat bubble — bgio chat rides the match socket, live from the
  // moment the session exists, so the waiting room is chat-capable too.
  // Muted only applies once the live view exists (elimination); the
  // waiting room is pre-game and always open for talk. The board branch
  // overrides `deferredModal` (忠诚提问 waits out typing) and threads the
  // input-focus report; pre-game screens never defer.
  const shell = (node: ReactNode, deferredModal: string | null = null) => (
    <WithChat
      session={session}
      game={game}
      muted={game.view ? !game.view.you.alive : false}
      marks={playerMarks.marks}
      onChatFocus={setChatFocused}
      deferredModal={deferredModal}
    >
      {node}
    </WithChat>
  );

  // We have a session but no live game state yet. If the user just created
  // this match (playerCount is sealed into the session), show the waiting
  // room with the code hero. Otherwise they re-joined an existing match —
  // show a connecting screen that auto-resets if the room is gone.
  if (!game.view) {
    return shell(
      <div className="app app--lobby">
        {session.playerCount ? (
          <WaitingRoom
            key={session.matchID}
            session={session}
            onLeave={resetToLobby}
            onStart={() => {}}
            playerCount={session.playerCount}
            canStart={false}
            // Seat 0 is the host by construction; claiming it pre-sync avoids
            // the host briefly seeing the joiner view (no CTA, locked panel).
            isHost={session.playerID === '0'}
            // Host editability must NOT wait for the first socket sync — the
            // move dispatch works over the socket as soon as it opens, and
            // passing it here keeps the 推荐 chip / steppers from popping in
            // a few seconds later (the config panel never changes shape).
            onSetFactionCounts={
              session.playerID === '0' ? game.moves.setFactionConfig : undefined
            }
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
  // The target crew size the roles are dealt against; room seats beyond it
  // are bench seats (候补) that no role is dealt into.
  const playerCount = view.playerCount;
  // 邪教起义选牌窗 must NOT race the card reveal — the table reads the
  // uprising card first and only THEN sees the captain's pick pile. Gated
  // on the reveal modal's own seen-key: while it is up (key unseen) the
  // pick window stays unmounted; dismissing 继续航程 reveals it.
  const pickGateOpen = ritualPickActive(view) && !cardRevealOpen;

  // bgio keeps lobby-display names and GameState names in two separate
  // stores. Every client bridges its own name into GameState via `syncName`
  // on first sync, but until that round-trip completes for EVERY seat, the
  // GameState still carries setup-time "Player N" placeholders. While any
  // ACTIVE seat is a placeholder we render the POLLING WaitingRoom (names
  // sourced from the lobby API), so the roster never flashes 空位 in the
  // window between socket-sync and syncName landing. Bench seats stay out
  // of both checks — nobody is dealt in there, nobody needs to sync.
  const PLACEHOLDER = /^Player \d+$/;
  // A seat that LEFT (放弃这条航线 clears its GameState name via syncName(''))
  // reads as an empty string: not a placeholder, just absent. Both count as
  // unclaimed — the host sees 等人齐 instead of a game that can never confirm.
  const unclaimed = (name: string) => !name || PLACEHOLDER.test(name);
  const activeOthers = view.others.filter((p) => !p.benched);
  const benchOthers = view.others.filter((p) => p.benched && p.name && !PLACEHOLDER.test(p.name));
  const namesSynced =
    !unclaimed(view.you.name) && activeOthers.every((p) => !unclaimed(p.name));

  if (!namesSynced) {
    return shell(
      <div className="app app--lobby">
        <WaitingRoom
          key={session.matchID}
          session={session}
          onLeave={resetToLobby}
          onStart={game.hostStartGame}
          playerCount={playerCount}
          // Deliberately NO liveView → WaitingRoom polls the lobby API,
          // whose metadata carries real names the moment each player joins.
          canStart={false}
          isHost={view.isHost}
          factionCounts={view.factionCounts}
          onSetFactionCounts={view.isHost ? game.moves.setFactionConfig : undefined}
          benchCount={benchOthers.length}
        />
      </div>
    );
  }

  // Step 1 — waiting for active seats to fill. A seat counts as unfilled when
  // its GameState name is unclaimed (never synced, or vacated by a leave) OR
  // its client never synced at all (a ghost: name may read "Player N" but no
  // client is listening, so its role card could never be confirmed). Ghosts
  // surface as host-bootable 空位 rows instead of a dead 等人齐.
  const ghostOf = (p: { name: string; synced?: boolean }) =>
    unclaimed(p.name) || p.synced === false;
  const unfilledSeats = activeOthers.filter(ghostOf).length;
  const unclaimedGhostIds = [
    ...(ghostOf(view.you) ? [view.you.id] : []),
    ...activeOthers.filter(ghostOf).map((p) => p.id),
  ];
  const realPlayers = 1 + activeOthers.length - unfilledSeats;
  const allSeatsFilled = unfilledSeats === 0;

  // Step 2 — all active seats filled, but the host hasn't flipped the "开始
  // 游戏" switch yet. Stay on the waiting screen; the host sees a gold CTA,
  // other seats see a "等待房主开始" hint.
  if (!allSeatsFilled || !view.hostStarted) {
    return shell(
      <div className="app app--lobby">
        <WaitingRoom
          key={session.matchID}
          session={session}
          onLeave={resetToLobby}
          onStart={game.hostStartGame}
          playerCount={playerCount}
          liveView={{
            filled: realPlayers,
            seats: [
              { id: view.you.id, name: view.you.name, isMe: true, benched: view.you.benched },
              ...view.others.map((p) => ({ id: p.id, name: p.name, isMe: false, benched: p.benched })),
            ],
          }}
          waitingLabel={allSeatsFilled ? '船员到齐，等待房主发号' : '等待船员登船'}
          canStart={allSeatsFilled && view.isHost}
          isHost={view.isHost}
          factionCounts={view.factionCounts}
          onSetFactionCounts={view.isHost ? game.moves.setFactionConfig : undefined}
          benchCount={benchOthers.length}
          onBootSeat={view.isHost ? game.moves.clearSeat : undefined}
          ghosts={unclaimedGhostIds}
        />
      </div>
    );
  }

  // Step 3 — role-reveal gate: every ACTIVE seat must acknowledge their role
  // card before any in-game move is legal. A player who has confirmed stays
  // on the reveal screen (its alreadyConfirmed state) until EVERY seat has —
  // the whole table then flips into the game on the same broadcast, instead
  // of early birds staring at an empty board. Bench players have no role
  // card — they wait on a dedicated screen until the host raises the target
  // count and a seat opens up for them.
  if (view.you.benched) {
    return shell(
      <div className="app app--lobby">
        <div className="role-reveal">
          <div className="role-reveal__hero">
            <div className="role-reveal__ornament" aria-hidden="true">⏳</div>
            <h2 className="role-reveal__title">候补席</h2>
            <p className="role-reveal__sub">
              本局已满员（{playerCount} 人）。房主调高人数后你会自动入局。
            </p>
          </div>
          <p className="waiting__hint">你已入座候补，角色卡不会发给你。</p>
        </div>
      </div>
    );
  }
  const allSeatsConfirmed = view.roleConfirmations.confirmed >= view.roleConfirmations.total;
  // 开场序章 (StoryPrologue): while the shared countdown runs, the whole
  // screen IS the story — the reveal screen (and its countdown number) hides
  // underneath it. 跳过 or countdown-zero both land in `markLaunched` (the
  // board); the story never holds the launch up. Seen-flag lives inside the
  // component (sessionStorage per match+seat): a refresh inside the window
  // skips straight through.
  if (counting && launchCountdown !== null && launchCountdown > 0) {
    return shell(
      <div className="app app--lobby">
        <StoryPrologue
          sessionKey={`${session.matchID}:${session.playerID}`}
          soundOn={reminderOn}
          onDone={markLaunched}
        />
      </div>
    );
  }
  if (!view.you.roleConfirmed || !allSeatsConfirmed || !launched) {
    return shell(
      <div className="app app--lobby">
        <RoleReveal view={view} onConfirm={game.confirmRole} countdown={launchCountdown} />
      </div>
    );
  }

  return shell(
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <strong>险恶疑航</strong>
          <span className={'pill' + (game.connected ? ' pill--ok' : ' pill--bad')}>
            {game.connected ? '已连接' : '连接中…'}
          </span>
          <RoomId matchID={session.matchID} />
          {/* 本局角色配置 — public info (the waiting room shows the same
              numbers); keeping it beside the room code settles "这局几个
              坏人" at a glance for late-loading or refreshed seats. */}
          <span className="pill pill--config" title="本局角色配置">
            {FACTION_ICON.sailor}{view.factionCounts.sailor}
            {' · '}
            {FACTION_ICON.pirate}{view.factionCounts.pirate}
            {view.factionCounts.cult > 0 && (
              <>
                {' · '}
                {FACTION_ICON.cult}{view.factionCounts.cult}
              </>
            )}
          </span>
        </div>
        <div className="topbar__mid">
          第 {view.round} 回合 · {PHASE_LABEL[view.phase] ?? view.phase}
        </div>
        <div className="topbar__right">
          {/* 🔔 轮到提醒 mute toggle (layer 2): sound+vibration only — the
              badge/toast/title layers always fire. */}
          <button
            type="button"
            className={'pill pill--bell' + (reminderOn ? ' pill--bell-on' : '')}
            title={reminderOn ? '轮到提醒：响铃+震动（点击静音）' : '轮到提醒已静音（点击开启）'}
            onClick={toggleReminder}
          >
            {reminderOn ? '🔔' : '🔕'}
          </button>
          <span className="pill">你是 {youName}</span>
          {/* Tap to mask/unmask: play over someone's shoulder without
              showing your faction. Text-only per request (no icon); the
              ❓ keeps pill width stable when masked. */}
          <button
            type="button"
            className="pill pill--team"
            title={factionMasked ? '身份已隐藏（点击显示）' : '点击隐藏身份'}
            onClick={toggleFactionMask}
          >
            {factionMasked ? '❓' : (
              <span className="pill__team-word">{FACTION_LABEL[view.you.team]}{view.you.cultLeader ? ' · 首领' : ''}</span>
            )}
          </button>
          {view.isHost && <span className="pill pill--host">房主</span>}
        </div>
      </header>

      <main className="main">
        {/* 对翼 left wing: 歇班 strip on top, 深海 discard sea below — one
            190px column, so both arts scale uniformly (aspect-ratio boxes,
            never one-axis stretched). 游戏记录 keeps its own column right of
            the map. Mobile unchanged: discard = map-corner buoy, off-duty +
            roster live in the 船员 tab. */}
        <div className="col col--wing">
          <OffDutyZone view={view} />
          <DrawPiles view={view} />
          <DiscardSea view={view} />
        </div>

        <section className="col col--board">
          <Board view={view} onExpand={coarsePointer ? () => setMapExpanded(true) : undefined} />
        </section>

        <aside className="col col--log">
          <LogPanel view={view} />
        </aside>

        <aside className="col col--side">
          {/* Mobile IA (方案A): the map stays pinned above; this column's tab
              strip is its header and the active pane scrolls beneath it. On
              PC the strip is hidden and the panes stack in column order
              (roster → actions); the log pane stays PC-hidden since the log
              has its own column there. PC's 歇班 strip lives atop the left
              wing column instead. */}
          <div className="tabs">
            <button className={'tab' + (tab === 'action' ? ' tab--on' : '') + (needsMe ? ' tab--owed' : '')} onClick={() => setTab('action')}>
              行动{needsMe ? ' ●' : ''}
            </button>
            <button className={'tab' + (tab === 'crew' ? ' tab--on' : '')} onClick={() => setTab('crew')}>
              船员
            </button>
            <button className={'tab' + (tab === 'log' ? ' tab--on' : '')} onClick={() => setTab('log')}>
              记录
            </button>
          </div>

          <div
            className={'side-pane side-pane--crew' + (tab === 'crew' ? '' : ' side-pane--off')}
          >
            {/* Mobile only: on PC the 歇班 strip tops the left wing column. */}
            <div className="side-pane__offduty">
              <OffDutyZone view={view} />
            </div>
            <Roster
              view={view}
              marks={playerMarks.marks}
              onToggleMark={playerMarks.toggle}
              onClearPlayerMarks={playerMarks.clearPlayer}
            />
          </div>
          <div
            className={'side-pane side-pane--action' + (tab === 'action' ? '' : ' side-pane--off') + (nudgeBadge ? ' side-pane--nudge' : '')}
          >
            {/* Layer 1: persistent 轮到你了 badge for as long as an action is
                owed — visible on PC (where the form can sit unnoticed while
                the player reads the map/log) and identical on mobile. */}
            {nudgeBadge && !over && (
              <div className="nudge-badge" role="status">⚓ 轮到你了</div>
            )}
            {over ? (
              <div className="panel panel--over">
                <h3>游戏结束</h3>
                <p>{view.winner && FACTION_LABEL[view.winner]} 获胜</p>
                <p className="hint">{view.winReason}</p>
              </div>
            ) : (
              <ActionPanel view={view} moves={game.moves} onOpenMutiny={() => setMutinyPromptOpen(true)} />
            )}
          </div>
          <div
            className={'side-pane side-pane--log' + (tab === 'log' ? '' : ' side-pane--off')}
          >
            <LogPanel view={view} />
          </div>
        </aside>
      </main>

      {mutinyRevealed && !mutinyDismissed && (
        <MutinyReveal
          view={view}
          onDone={() => setMutinyDismissed(true)}
          // Tie-break: the veil is full-screen, so the picker's vote must
          // live INSIDE it — the old in-panel TargetPicker was behind the
          // veil and its clicks never landed (game deadlock).
          standDownCandidates={
            view.pending?.kind === 'mutinyTie'
              ? ((view.pendingData?.['remaining'] as PlayerId[] | undefined) ?? [])
              : undefined
          }
          onStandDown={view.pending?.kind === 'mutinyTie' ? game.moves.mutinyTieBreak : undefined}
        />
      )}

      {peeking && !freshConversion && (
        <RitualPeek view={view} onDone={() => setPeeking(false)} />
      )}

      {cabinNoticeOpen && (
        <CabinSearchNotice onDone={() => setSeenCsKey(csKey)} />
      )}

      {/* The captain's PRIVATE result beat — rendered after the public
          notices so it sits on top of them if both are up. 知道了 acks and
          the navigation resumes. */}
      {mapRevealActive(view) && (
        <MapReveal view={view} onAck={() => game.moves.mapActionRevealAck!()} />
      )}

      {gunsNoticeOpen && (
        <GunsStashNotice view={view} onDone={() => setSeenGsKey(gsKey)} />
      )}

      {/* 船长更替公示 (drunk-card hand-over) — after the notices so it stacks
          over them if two land in the same broadcast. */}
      {captainChangeOpen && (
        <CaptainChangeNotice view={view} onDone={() => setSeenCcKey(ccKey)} />
      )}

      {eliminationOpen && elimEntry && (
        <EliminationNotice view={view} entry={elimEntry} onDone={() => setSeenElimIdx(elimEntry.idx)} />
      )}

      {fateOpen && fateEntry && (
        <FateNotice view={view} entry={fateEntry} onDone={() => setSeenFateIdx(fateEntry.idx)} />
      )}

      {pickGateOpen && (
        <RitualChoice view={view} onPick={(slot) => game.moves.ritualPick!(slot)} />
      )}

      {cardRevealOpen && game.view.winner === null && (
        <CardReveal
          view={view}
          onDone={() => setSeenCardKey(cardKey)}
          // Cult Uprising opens the captain's ritual-pick window next — give
          // the table 3s to read the card before anyone can dismiss. Rendered
          // AFTER RitualChoice so it sits on top: read the card first (locked
          // 3s), dismiss, and the pick window is right below.
          lockSeconds={view.navigation.revealed === 'cultUprising' ? 3 : 0}
        />
      )}

      {/* 忠诚提问 does NOT hijack a player who is mid-typing in chat (the
          soft keyboard would be crushed and the half-written message with
          it). While chat holds focus the modal defers; the drawer banner +
          FAB dot name the pending vote, and closing the chat (or tapping
          send) mounts it. A pledge that already went visible stays put —
          deferral only delays the FIRST appearance. */}
      {loyaltyLive && mutinyPromptOpen && game.view.winner === null && !chatFocused && (
        <MutinyPrompt
          view={view}
          onPledge={(guns) => game.moves.mutinyPledge!(guns)}
          onClose={() => setMutinyPromptOpen(false)}
        />
      )}

      {veilMounted && (
        <RitualReveal
          view={view}
          active={ritualVeilActive}
          freshConversion={freshConversion}
          onDismiss={() => setRitualDismissed(true)}
          onGone={() => setVeilMounted(false)}
        />
      )}

      {over && showGameOver && !showEndScreen && (
        <div className="modal" onClick={() => setShowGameOver(false)}>
          <div className="modal__box" onClick={(e) => e.stopPropagation()}>
            <h2>{view.winner && FACTION_LABEL[view.winner]} 获胜！</h2>
            <p>{view.winReason}</p>
            <button className="btn btn--primary" onClick={() => setShowEndScreen(true)}>查看终局</button>
          </div>
        </div>
      )}

      {over && showEndScreen && (
        <EndScreen
          view={view}
          onBack={() => setShowEndScreen(false)}
          onFunVote={(target) => game.moves.funVote!(target)}
        />
      )}

      {/* 海图放大镜 — last so it stacks over every modal; Esc-equivalent is
          the 收起海图 button. The ship marker rides along, so the viewer
          answers "where are we" too. */}
      {mapExpanded && (
        <MapViewer view={view} onClose={() => setMapExpanded(false)} />
      )}

      {/* 轮到你了 toast (layer 2's visual arm) — last so it rides over
          everything except the map viewer's own HUD. */}
      <TurnToast show={nudgeToast} />
    </div>,
    // 忠诚提问 defers while the player is typing in chat: the modal mounts
    // the moment the drawer closes (and the soft keyboard drops with it).
    // The FAB dot + drawer banner keep the pending vote visible meanwhile.
    chatFocused && loyaltyLive && mutinyPromptOpen && !over ? '忠诚表决进行中' : null,
  );
}

/** Everything the floating chat bubble needs, threaded from the App level so
 *  it works on every in-session screen (waiting room / reveal / board) with
 *  one mount point instead of one per return branch. */
function WithChat({
  session,
  game,
  muted,
  marks,
  onChatFocus,
  deferredModal,
  children,
}: {
  session: Session;
  game: ReturnType<typeof useGame>;
  /** Eliminated players are muted (pre-sync screens are never muted). */
  muted: boolean;
  /** Private guess notes, shown as dots on message avatars. */
  marks: PlayerMarks;
  /** Input focus reporting (typing detection for modal deferral). */
  onChatFocus?: (focused: boolean) => void;
  /** A modal is waiting for the chat to close — banner + FAB dot. */
  deferredModal?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <ChatBubble
        view={game.view}
        chat={game.chat}
        sendChat={game.sendChat}
        muted={muted}
        mySeat={session.playerID}
        myName={session.playerName}
        myAvatarId={session.avatarId ?? -1}
        marks={marks}
        onFocusChange={onChatFocus}
        deferredModal={deferredModal}
      />
    </>
  );
}


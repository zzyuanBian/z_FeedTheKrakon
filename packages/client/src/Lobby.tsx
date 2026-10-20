/**
 * Lobby: the first thing a player sees.
 *
 * Layout is a centered, mobile-first column inspired by social-deduction web
 * lobbies (Avalon, Secret Hitler online): title card up top, a name field, two
 * prominent action buttons, and a small "still here?" reconnect affordance
 * when the browser has a live session from the last visit.
 *
 * 「开辟新航线」creates the match immediately and lands the host in the
 * waiting room — the old pre-create config page is gone; the config lives in
 * the waiting room now (see WaitingRoom in App.tsx), where the host can keep
 * tuning it while people board.
 *
 * Visual language: deep-ocean palette, gold serif titles, a faint kraken
 * silhouette rendered as inline SVG so the build stays single-file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEAM_COMPOSITIONS, type FactionCounts } from '@ftk/engine';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@ftk/room-code';
import { createMatch, joinMatch, lobby } from './useGame.js';
import { AVATARS, AvatarImage, pickAvatarId } from './Avatars.js';
import { ArtImage } from './ArtImage.js';
import type { Session } from './session.js';
import { GAME_NAME } from './config.js';

type Screen = 'menu' | 'join';

/** Player count a fresh「开辟新航线」starts with. The rulebook's smallest
 *  game (5 players: 3⚓ 1☠️ 1🐙) — the host retunes it in the waiting room. */
export const DEFAULT_PLAYER_COUNT = 5;

// --------------------------- faction-count math ---------------------------

export type FactionName = 'sailor' | 'pirate' | 'cult';

/** Per-faction floors: the engine requires >=1 sailor and >=1 pirate (an
 *  officer corps and a mutiny threat); cult may be 0. */
const FACTION_MIN: Record<FactionName, number> = { sailor: 1, pirate: 1, cult: 0 };

/** Read the rulebook preset for a given player count. Returns null for counts
 *  outside the TEAM_COMPOSITIONS table. */
export function presetFor(count: number) {
  return TEAM_COMPOSITIONS.find((c) => c.players === count) ?? null;
}

/** Move ONE seat between factions, keeping the total equal to the player
 *  count — with this primitive a mis-tally is impossible, so the UI needs no
 *  合计 warning row. `+` takes the seat from the largest other faction;
 *  `−` hands the freed seat to the largest other faction. Returns `fc`
 *  unchanged when the shift would break a faction floor. */
export function shiftSeat(fc: FactionCounts, f: FactionName, delta: 1 | -1): FactionCounts {
  const others = (['sailor', 'pirate', 'cult'] as const).filter((x) => x !== f);
  if (delta === 1) {
    const donors = others.filter((x) => fc[x] > FACTION_MIN[x]);
    if (donors.length === 0) return fc;
    const donor = donors.reduce((a, b) => (fc[b]! > fc[a]! ? b : a));
    return { ...fc, [f]: fc[f] + 1, [donor]: fc[donor]! - 1 };
  }
  if (fc[f] <= FACTION_MIN[f]) return fc;
  const receiver = others.reduce((a, b) => (fc[b]! > fc[a]! ? b : a));
  return { ...fc, [f]: fc[f] - 1, [receiver]: fc[receiver]! + 1 };
}

/** Whether `shiftSeat` would actually move a seat — drives the ± disabled
 *  states so buttons never no-op silently. */
export function canShift(fc: FactionCounts, f: FactionName, delta: 1 | -1): boolean {
  return shiftSeat(fc, f, delta) !== fc;
}

/** Rescale a breakdown for a different player count (no rulebook preset):
 *  keep the cult, split the rest roughly 60/40 sailor/pirate. Used when the
 *  host changes the player count and the new count has no preset row. */
export function scaleCounts(fc: FactionCounts, count: number): FactionCounts {
  const cult = Math.min(fc.cult, Math.max(0, count - 2));
  const rest = Math.max(2, count - cult);
  const pirate = Math.max(1, Math.floor(rest * 0.4));
  return { sailor: rest - pirate, pirate, cult };
}

// ------------------------------- decorators -------------------------------

// --------------------------------- atoms ----------------------------------

function GoldTitle() {
  return (
    <div className="title-block">
      <h1 className="title-main">险恶疑航</h1>
      <p className="title-sub">Feed the Kraken</p>
      <p className="title-tag">深海之下，克苏鲁已醒。别喂错人了。</p>
    </div>
  );
}

function NameField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="themed-field">
      <input
        className="themed-field__input"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 20))}
        placeholder="输入昵称"
        maxLength={20}
        autoFocus={autoFocus}
      />
    </label>
  );
}

/** Five-box code input. Auto-advances focus, pastes a whole code in one go. */
function CodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const slots = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const focusSlot = (i: number) => {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, i));
    inputRefs.current[clamped]?.focus();
  };

  const handleInput = (i: number, raw: string) => {
    const cleaned = normalizeRoomCode(raw);
    if (!cleaned) return;
    // If the user pasted the full code into any slot, take the whole thing.
    if (cleaned.length >= CODE_LENGTH) {
      onChange(cleaned.slice(0, CODE_LENGTH));
      focusSlot(CODE_LENGTH - 1);
      return;
    }
    // Otherwise, insert at slot i and advance.
    const next = (value.slice(0, i) + cleaned[0] + value.slice(i + 1)).slice(0, CODE_LENGTH);
    onChange(next);
    focusSlot(i + cleaned.length);
  };

  const handleBackspace = (i: number) => {
    if (value[i]) {
      onChange(value.slice(0, i) + value.slice(i + 1));
    } else if (i > 0) {
      onChange(value.slice(0, i - 1) + value.slice(i));
      focusSlot(i - 1);
    }
  };

  return (
    <div className="code-input" role="group" aria-label="房间码">
      {slots.map((ch, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          className="code-input__slot"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={CODE_LENGTH}
          value={ch}
          disabled={disabled}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') { e.preventDefault(); handleBackspace(i); }
            else if (e.key === 'ArrowLeft') focusSlot(i - 1);
            else if (e.key === 'ArrowRight') focusSlot(i + 1);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            const cleaned = normalizeRoomCode(pasted);
            if (cleaned) {
              e.preventDefault();
              onChange(cleaned.slice(0, CODE_LENGTH));
              focusSlot(Math.min(cleaned.length, CODE_LENGTH - 1));
            }
          }}
        />
      ))}
    </div>
  );
}

// ----------------------------- avatar picker -----------------------------

/** Human-facing message from a lobby failure. bgio's LobbyClientError puts
 *  the server's text body (e.g. the 409 该头像已被其他船员选用 guard) in
 *  `details` — a bare string, or `{ message }` for JSON bodies — while the
 *  Error itself only says "HTTP status 409". Fall back through both. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const details = (e as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim()) return details;
    if (details && typeof details === 'object') {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

/** Grid of the 10 crew portraits. Taken ones (already claimed by a seat in
 *  this room) are dimmed and refuse clicks; the selection has a gold ring.
 *  `takenIds` is empty on the menu screen (no room yet) — there every
 *  portrait is free. */
export function AvatarPicker({
  value,
  onChange,
  takenIds,
}: {
  value: number;
  onChange: (id: number) => void;
  takenIds?: Set<number> | undefined;
}) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="选择头像">
      {AVATARS.map((av) => {
        const taken = takenIds?.has(av.id) ?? false;
        const selected = av.id === value;
        return (
          <button
            key={av.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={taken ? `${av.name}（已被选用）` : av.name}
            className={
              'avatar-pick'
              + (selected ? ' avatar-pick--on' : '')
              + (taken ? ' avatar-pick--taken' : '')
            }
            disabled={taken}
            onClick={() => onChange(av.id)}
          >
            <AvatarImage avatarId={av.id} size={44} />
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------- main menu ---------------------------------

function MainMenu({
  name,
  setName,
  avatarId,
  setAvatarId,
  error,
  onCreate,
  onGo,
  busy,
}: {
  name: string;
  setName: (v: string) => void;
  avatarId: number;
  setAvatarId: (id: number) => void;
  error: string | null;
  /** 「开辟新航线」— creates the match at once and enters the waiting room. */
  onCreate: () => void;
  onGo: (screen: Screen) => void;
  busy: boolean;
}) {
  const nameOk = name.trim().length > 0;
  return (
    <>
      <GoldTitle />
      <div className="menu-card">
        <NameField value={name} onChange={setName} autoFocus />
        <AvatarPicker value={avatarId} onChange={setAvatarId} />
        <div className="menu-actions">
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--gold"
            disabled={!nameOk || busy}
            onClick={onCreate}
          >
            <span className="btn-cthulhu__glyph">
              <ArtImage src="img/map-glyph.png" size={38} />
            </span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">开辟新航线</span>
              <span className="btn-cthulhu__hint">创建房间，进房后再调配置</span>
            </span>
          </button>
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--ink"
            disabled={!nameOk || busy}
            onClick={() => onGo('join')}
          >
            <span className="btn-cthulhu__glyph">
              <ArtImage src="img/seal-sailor.png" size={38} />
            </span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">登上友船</span>
              <span className="btn-cthulhu__hint">输入 5 位房间码</span>
            </span>
          </button>
        </div>
        {error && <p className="error-line">{error}</p>}
      </div>
      <p className="footer-hint">5–11 人 · 线上语音最佳 · 单局约 40 分钟</p>
    </>
  );
}

// ------------------------------- steppers --------------------------------

/** ± stepper for a faction size. Every press delegates to `onDelta`; the
 *  parent owns the auto-balance math (`shiftSeat`), so the three rows always
 *  sum to the player count. `disabled` collapses the row to read-only
 *  numbers — a frozen control invites pokes, so hide its buttons entirely. */
export function FactionStepper({
  label,
  glyph,
  value,
  accent,
  disabled,
  canPlus,
  canMinus,
  onDelta,
}: {
  label: string;
  /** Image URL of the faction's wax-seal icon (public/img/seal-*.png). */
  glyph: string;
  value: number;
  accent: 'gold' | 'blood' | 'cult';
  disabled?: boolean;
  canPlus: boolean;
  canMinus: boolean;
  onDelta: (d: 1 | -1) => void;
}) {
  const locked = !!disabled;
  return (
    <div className={`faction-stepper faction-stepper--${accent}` + (locked ? ' faction-stepper--locked' : '')}>
      <span className="faction-stepper__head">
        <span className="faction-stepper__glyph" aria-hidden="true">
          <ArtImage src={glyph} size={34} />
        </span>
        <span className="faction-stepper__label">{label}</span>
        {!locked && (
          <span className="faction-stepper__controls">
            <button
              type="button"
              className="stepper-btn"
              aria-label={`减少${label}`}
              disabled={!canMinus}
              onClick={() => onDelta(-1)}
            >
              −
            </button>
            <span className="faction-stepper__value">{value}</span>
            <button
              type="button"
              className="stepper-btn"
              aria-label={`增加${label}`}
              disabled={!canPlus}
              onClick={() => onDelta(1)}
            >
              +
            </button>
          </span>
        )}
        {locked && <span className="faction-stepper__value">{value}</span>}
      </span>
    </div>
  );
}

/** ± stepper for the player count itself. */
export function CountStepper({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <span className="count-stepper">
      <button
        type="button"
        className="stepper-btn"
        aria-label="减少人数"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="count-stepper__value">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        aria-label="增加人数"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  );
}

// --------------------------------- join ----------------------------------

function JoinRoom({
  name,
  setName,
  avatarId,
  setAvatarId,
  onBack,
  onReady,
  onError,
  error,
  initialCode = '',
}: {
  name: string;
  setName: (v: string) => void;
  avatarId: number;
  setAvatarId: (id: number) => void;
  onBack: () => void;
  onReady: (s: Session) => void;
  onError: (msg: string) => void;
  /** The join failure to show (duplicate name, full room, bad code, …). */
  error: string | null;
  initialCode?: string;
}) {
  const [code, setCode] = useState(normalizeRoomCode(initialCode));
  const [busy, setBusy] = useState(false);
  // Portraits already claimed by seated players — polled from the lobby API
  // while the typed code looks like a real room code. Stale by a beat at
  // worst; the server's 409 guard is the hard backstop.
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const valid = isRoomCode(code);
  const nameOk = name.trim().length > 0;

  useEffect(() => {
    if (!valid) {
      setTaken(new Set());
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const match = await lobby.getMatch(GAME_NAME, code);
        if (cancelled) return;
        setTaken(
          new Set(
            match.players
              .map((p) => (p.data as { avatarId?: number } | undefined)?.avatarId)
              .filter((v): v is number => typeof v === 'number' && v >= 0),
          ),
        );
      } catch {
        /* room not there (yet) — leave the previous set */
      }
    };
    poll();
    const t = window.setInterval(poll, 2000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [code, valid]);

  // The typed code changed → the taken-set is for a different room. If my
  // current pick collides there, hop to a free portrait so 立刻登船 never
  // fails on a stale selection.
  useEffect(() => {
    if (valid && taken.has(avatarId)) setAvatarId(pickAvatarId(taken));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken]);

  const join = async () => {
    if (!valid || !nameOk) return;
    setBusy(true);
    try {
      const session = await joinMatch(code, name.trim(), avatarId);
      onReady(session);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Deep links land here straight from the menu, so the name field must be
  // on this screen too. It starts empty — no persisted-name prefill.
  return (
    <>
      <GoldTitle />
      <div className="menu-card">
        <h2 className="card-title">登上友船</h2>
        {initialCode && <p className="card-hint">已识别房间码，确认名字后登船</p>}
        <NameField value={name} onChange={setName} />
        <CodeInput value={code} onChange={setCode} disabled={busy} />
        <AvatarPicker value={avatarId} onChange={setAvatarId} takenIds={valid ? taken : undefined} />
        {error && <p className="error-line">{error}</p>}
        <div className="card-actions">
          <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
            ← 返回
          </button>
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--gold"
            disabled={!valid || !nameOk || busy}
            onClick={join}
          >
            <span className="btn-cthulhu__glyph">
              <ArtImage src="img/seal-sailor.png" size={38} />
            </span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">
                {busy ? '正在登船…' : '立刻登船'}
              </span>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

// ------------------------------- rejoin banner ---------------------------

function RejoinBanner({
  session,
  onRejoin,
  onDismiss,
}: {
  session: Session;
  onRejoin: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rejoin">
      <div className="rejoin__body">
        <span className="rejoin__label">你上次还在</span>
        <span className="rejoin__code">{session.matchID}</span>
      </div>
      <div className="rejoin__actions">
        <button type="button" className="btn-ghost btn-ghost--sm" onClick={onDismiss}>
          换桌
        </button>
        <button type="button" className="btn-cthulhu btn-cthulhu--ink btn-cthulhu--sm" onClick={onRejoin}>
          <span className="btn-cthulhu__title">继续</span>
        </button>
      </div>
    </div>
  );
}

// --------------------------------- shell ---------------------------------

export interface LobbyProps {
  /** A previously-saved session, if any. Used to offer a "rejoin" shortcut. */
  savedSession: Session | null;
  /** Called when the player has a live session (created, joined, or re-joined). */
  onReady: (s: Session) => void;
  /** Called to forget the saved session (user picked "换桌" on the banner). */
  onForget: () => void;
}

export function Lobby({ savedSession, onReady, onForget }: LobbyProps) {
  // Deep link: ?room=XXXXX (from the waiting room's 一键分享) skips straight
  // to the join screen with the code filled in. The param is stripped right
  // after landing so a manual refresh doesn't re-trigger the jump — the code
  // has already been copied into the input.
  const [initialCode] = useState(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('room') ?? '';
      return normalizeRoomCode(raw).slice(0, CODE_LENGTH);
    } catch { return ''; }
  });
  const [screen, setScreen] = useState<Screen>(() => (initialCode ? 'join' : 'menu'));
  // Deliberately NOT persisted: every landing starts with an empty name field
  // — a leftover name from a previous session (often another player on a
  // shared device) silently joining as "km1" is worse than a blank box.
  const [name, setName] = useState('');
  // The portrait, though, pre-dealt at random (still editable in the grid).
  const [avatarId, setAvatarId] = useState(() => pickAvatarId([]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initialCode) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
  }, [initialCode]);

  const wrappedReady = (s: Session) => {
    setError(null);
    onReady(s);
  };
  const wrappedError = (msg: string) => setError(msg);

  // One tap from the menu to a live waiting room: create the match with the
  // rulebook's 7-player preset right away. The config stays tunable in the
  // waiting room, so there is nothing worth a separate setup page anymore.
  const handleCreate = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const p = presetFor(DEFAULT_PLAYER_COUNT)!;
      const session = await createMatch({
        playerName: name.trim(),
        playerCount: DEFAULT_PLAYER_COUNT,
        factionCounts: { sailor: p.sailor, pirate: p.pirate, cult: p.cult },
        avatarId,
      });
      wrappedReady(session);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleForget = () => {
    onForget();
    setError(null);
  };

  const content = useMemo(() => {
    switch (screen) {
      case 'join':
        return <JoinRoom name={name} setName={setName} avatarId={avatarId} setAvatarId={setAvatarId} initialCode={initialCode} error={error} onBack={() => setScreen('menu')} onReady={wrappedReady} onError={wrappedError} />;
      default:
        return <MainMenu name={name} setName={setName} avatarId={avatarId} setAvatarId={setAvatarId} error={error} onCreate={handleCreate} onGo={setScreen} busy={busy} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, name, avatarId, error, busy, initialCode]);

  return (
    <div className="lobby-shell">
      <div className="lobby-stack">
        {content}
        {screen === 'menu' && savedSession && (
          <RejoinBanner
            session={savedSession}
            onRejoin={() => wrappedReady(savedSession)}
            onDismiss={handleForget}
          />
        )}
      </div>
    </div>
  );
}

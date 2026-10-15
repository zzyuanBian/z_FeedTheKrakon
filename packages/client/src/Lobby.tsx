/**
 * Lobby: the first thing a player sees.
 *
 * Layout is a centered, mobile-first column inspired by social-deduction web
 * lobbies (Avalon, Secret Hitler online): title card up top, a name field, two
 * prominent action buttons, and a small "still here?" reconnect affordance
 * when the browser has a live session from the last visit.
 *
 * Visual language: deep-ocean palette, gold serif titles, a faint kraken
 * silhouette rendered as inline SVG so the build stays single-file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEAM_COMPOSITIONS, type FactionCounts } from '@ftk/engine';
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@ftk/room-code';
import { MAX_PLAYERS, MIN_PLAYERS } from './config.js';
import { createMatch, joinMatch } from './useGame.js';
import type { Session } from './session.js';

type Screen = 'menu' | 'create' | 'join';

const NAME_STORAGE_KEY = 'ftk.name.v1';

// ------------------------------- decorators -------------------------------

/** Tentacles drifting up from the bottom edge. Purely decorative. */
function KrakenBackdrop() {
  return (
    <svg
      className="kraken-bg"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="glow" cx="50%" cy="110%" r="70%">
          <stop offset="0%" stopColor="#1c4d5c" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#0a1f2e" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#050914" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tentacle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a7a8a" stopOpacity="0" />
          <stop offset="60%" stopColor="#2a7a8a" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0f2a38" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#glow)" />
      <g fill="none" stroke="url(#tentacle)" strokeWidth="10" strokeLinecap="round">
        <path d="M80 600 Q 120 420 90 320 T 60 160" />
        <path d="M200 600 Q 260 460 230 360 T 280 200" />
        <path d="M400 600 Q 380 470 420 380 T 390 220" />
        <path d="M600 600 Q 560 460 600 360 T 560 200" />
        <path d="M740 600 Q 720 440 760 340 T 720 180" />
      </g>
    </svg>
  );
}

// --------------------------------- atoms ----------------------------------

function GoldTitle() {
  return (
    <div className="title-block">
      <div className="title-ornament" aria-hidden="true">⚓</div>
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
      <span className="themed-field__label">你的名字</span>
      <input
        className="themed-field__input"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 20))}
        placeholder="船长、大副，或随便一个绰号"
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

// ----------------------------- main menu ---------------------------------

function MainMenu({
  name,
  setName,
  error,
  onGo,
  busy,
}: {
  name: string;
  setName: (v: string) => void;
  error: string | null;
  onGo: (screen: Screen) => void;
  busy: boolean;
}) {
  const nameOk = name.trim().length > 0;
  return (
    <>
      <GoldTitle />
      <div className="menu-card">
        <NameField value={name} onChange={setName} autoFocus />
        <div className="menu-actions">
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--gold"
            disabled={!nameOk || busy}
            onClick={() => onGo('create')}
          >
            <span className="btn-cthulhu__glyph">🐙</span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">开辟新航线</span>
              <span className="btn-cthulhu__hint">创建房间，召唤船员</span>
            </span>
          </button>
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--ink"
            disabled={!nameOk || busy}
            onClick={() => onGo('join')}
          >
            <span className="btn-cthulhu__glyph">⚓</span>
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

// ------------------------------ create -----------------------------------

/** Read the rulebook preset for a given player count. Returns null for counts
 *  outside the TEAM_COMPOSITIONS table — the host is then forced to pick
 *  custom factionCounts. */
function presetFor(count: number) {
  return TEAM_COMPOSITIONS.find((c) => c.players === count) ?? null;
}

function FactionSlider({
  label,
  glyph,
  value,
  onChange,
  min,
  max,
  accent,
}: {
  label: string;
  glyph: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  accent: 'gold' | 'blood' | 'cult';
}) {
  const cls =
    accent === 'gold'
      ? 'faction-slider faction-slider--gold'
      : accent === 'blood'
      ? 'faction-slider faction-slider--blood'
      : 'faction-slider faction-slider--cult';
  return (
    <label className={cls}>
      <span className="faction-slider__head">
        <span className="faction-slider__glyph" aria-hidden="true">{glyph}</span>
        <span className="faction-slider__label">{label}</span>
        <span className="faction-slider__value">{value}</span>
      </span>
      <input
        className="count-slider"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function CreateRoom({
  name,
  onBack,
  onReady,
  onError,
}: {
  name: string;
  onBack: () => void;
  onReady: (s: Session) => void;
  onError: (msg: string) => void;
}) {
  const [count, setCount] = useState(7);
  const [twoPirates, setTwoPirates] = useState(false);
  const [sailor, setSailor] = useState(() => presetFor(7)?.sailor ?? 4);
  const [pirate, setPirate] = useState(() => presetFor(7)?.pirate ?? 2);
  const [cult, setCult] = useState(() => presetFor(7)?.cult ?? 1);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset faction counts whenever the player count changes. If there's a
  // rulebook preset for the new count, snap to it; otherwise force custom
  // mode and try to preserve sensible defaults.
  useEffect(() => {
    const p = presetFor(count);
    if (p) {
      const s = count === 5 && twoPirates ? p.sailor - 1 : p.sailor;
      const pi = count === 5 && twoPirates ? p.pirate + 1 : p.pirate;
      setSailor(s);
      setPirate(pi);
      setCult(p.cult);
    } else {
      setCustom(true);
      // Safe fallback: 1 cult, rest split roughly 60/40 sailor/pirate.
      setCult(1);
      const rest = Math.max(2, count - 1);
      setSailor(Math.ceil(rest * 0.6));
      setPirate(Math.floor(rest * 0.4));
    }
  }, [count, twoPirates]);

  const applyPreset = (variant: 'default' | 'twoPirates') => {
    const p = presetFor(count);
    if (!p) return;
    setCustom(false);
    if (variant === 'twoPirates' && count === 5) {
      setTwoPirates(true);
      setSailor(p.sailor - 1);
      setPirate(p.pirate + 1);
      setCult(p.cult);
    } else {
      setTwoPirates(false);
      setSailor(p.sailor);
      setPirate(p.pirate);
      setCult(p.cult);
    }
  };

  // Drift into custom mode as soon as the user nudges a slider away from the
  // preset values.
  const touchSailor = (n: number) => { setCustom(true); setSailor(n); };
  const touchPirate = (n: number) => { setCustom(true); setPirate(n); };
  const touchCult = (n: number) => { setCustom(true); setCult(n); };

  const preset = presetFor(count);
  const total = sailor + pirate + cult;
  const valid = sailor >= 1 && pirate >= 1 && cult >= 0 && total === count;
  const factionCounts: FactionCounts | undefined =
    custom || (count === 5 && twoPirates)
      ? { sailor, pirate, cult }
      : undefined;

  const create = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const session = await createMatch({
        playerName: name.trim(),
        playerCount: count,
        fivePlayerTwoPirates: count === 5 ? twoPirates : false,
        ...(factionCounts ? { factionCounts } : {}),
      });
      onReady(session);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const maxPerFaction = Math.max(1, count - 2); // leave room for >=1 in each of the others

  return (
    <>
      <GoldTitle />
      <div className="menu-card">
        <h2 className="card-title">开辟新航线</h2>

        <label className="themed-field">
          <span className="themed-field__label">船员人数</span>
          <div className="count-row">
            <span className="count-big">{count}</span>
            <input
              className="count-slider"
              type="range"
              min={MIN_PLAYERS}
              max={MAX_PLAYERS}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
            <span className="count-range">{MIN_PLAYERS}–{MAX_PLAYERS}</span>
          </div>
        </label>

        {preset && (
          <div className="preset-row">
            <button
              type="button"
              className={
                'preset-chip' + (!custom && !twoPirates ? ' preset-chip--on' : '')
              }
              onClick={() => applyPreset('default')}
            >
              推荐：{preset.sailor}⚓ {preset.pirate}☠️ {preset.cult}🐙
            </button>
            {count === 5 && (
              <button
                type="button"
                className={
                  'preset-chip' + (!custom && twoPirates ? ' preset-chip--on' : '')
                }
                onClick={() => applyPreset('twoPirates')}
              >
                5 人变体：2⚓ 2☠️ 1🐙
              </button>
            )}
          </div>
        )}

        <div className="faction-grid">
          <FactionSlider
            label="水手"
            glyph="⚓"
            value={sailor}
            onChange={touchSailor}
            min={1}
            max={maxPerFaction}
            accent="gold"
          />
          <FactionSlider
            label="海盗"
            glyph="☠️"
            value={pirate}
            onChange={touchPirate}
            min={1}
            max={maxPerFaction}
            accent="blood"
          />
          <FactionSlider
            label="邪教徒"
            glyph="🐙"
            value={cult}
            onChange={touchCult}
            min={0}
            max={Math.max(0, count - 2)}
            accent="cult"
          />
        </div>

        <div className={'faction-total' + (valid ? '' : ' faction-total--bad')}>
          <span>合计</span>
          <strong>
            {total} / {count}
          </strong>
          {!valid && (
            <span className="faction-total__hint">
              {total !== count
                ? `还差 ${count - total} 人`
                : '水手和海盗至少各 1 人'}
            </span>
          )}
        </div>

        <div className="card-actions">
          <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
            ← 返回
          </button>
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--gold"
            onClick={create}
            disabled={busy || !valid}
          >
            <span className="btn-cthulhu__glyph">🐙</span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">{busy ? '正在创建…' : '创建房间'}</span>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

// --------------------------------- join ----------------------------------

function JoinRoom({
  name,
  onBack,
  onReady,
  onError,
  initialCode = '',
}: {
  name: string;
  onBack: () => void;
  onReady: (s: Session) => void;
  onError: (msg: string) => void;
  initialCode?: string;
}) {
  const [code, setCode] = useState(normalizeRoomCode(initialCode));
  const [busy, setBusy] = useState(false);
  const valid = isRoomCode(code);

  const join = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const session = await joinMatch(code, name.trim());
      onReady(session);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GoldTitle />
      <div className="menu-card">
        <h2 className="card-title">登上友船</h2>
        <p className="card-hint">让房主把 5 位房间码发给你</p>
        <CodeInput value={code} onChange={setCode} disabled={busy} />
        <div className="card-actions">
          <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
            ← 返回
          </button>
          <button
            type="button"
            className="btn-cthulhu btn-cthulhu--gold"
            disabled={!valid || busy}
            onClick={join}
          >
            <span className="btn-cthulhu__glyph">⚓</span>
            <span className="btn-cthulhu__body">
              <span className="btn-cthulhu__title">{busy ? '正在登船…' : '加入房间'}</span>
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
  const [screen, setScreen] = useState<Screen>('menu');
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(NAME_STORAGE_KEY) ?? ''; } catch { return ''; }
  });
  const [error, setError] = useState<string | null>(null);

  // Persist the name as they type, so it's still there next launch.
  useEffect(() => {
    try { localStorage.setItem(NAME_STORAGE_KEY, name); } catch { /* ignore */ }
  }, [name]);

  const wrappedReady = (s: Session) => {
    setError(null);
    onReady(s);
  };
  const wrappedError = (msg: string) => setError(msg);

  const handleForget = () => {
    onForget();
    setError(null);
  };

  const content = useMemo(() => {
    switch (screen) {
      case 'create':
        return <CreateRoom name={name} onBack={() => setScreen('menu')} onReady={wrappedReady} onError={wrappedError} />;
      case 'join':
        return <JoinRoom name={name} onBack={() => setScreen('menu')} onReady={wrappedReady} onError={wrappedError} />;
      default:
        return <MainMenu name={name} setName={setName} error={error} onGo={setScreen} busy={false} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, name, error]);

  return (
    <div className="lobby-shell">
      <KrakenBackdrop />
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

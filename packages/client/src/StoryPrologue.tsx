/**
 * 开场序章 (StoryPrologue). The per-game cold open: the moment the shared
 * launch countdown starts (all seats confirmed), every screen swaps to a
 * full-veil reading of the voyage's opening story — three stanzas fading in
 * one after another over the storm-deck art, one every 3.5 seconds (≈10.5s
 * + a final hold). When the story completes, a ⚓ 登船 button surfaces — the
 * board takes over only on the player's click.
 * Nothing is stored engine-side; sessionStorage per match+seat keeps a
 * mid-game refresh from replaying it.
 *
 * Ambience: a synthesized low surf + hull creak (same WebAudio family as the
 * turn chime — zero asset weight), gated on the 🔔 reminder pref and fired
 * only on this component's mount. Autoplay-safe: the user has always
 * gestured before all seats confirm (they tapped their role card), so the
 * AudioContext is allowed to start unsuspended in practice; a blocked
 * context just stays silent.
 */

import { useEffect, useRef, useState } from 'react';
import { PROLOGUE_STANZAS } from './labels.js';
import { unlockAudio, sharedAudioCtx } from './TurnNudge.js';

/** Reading pace: one stanza every 3.5s (user-tuned). After the final beat
 *  holds its slot, the ⚓ 登船 button appears and waits for the click. */
const STANZA_EVERY_MS = 3500;
const FADE_MS = 900;

/** Per-stanza start offsets: 0s / 3.5s / 7s. */
const STANZA_MS: readonly number[] = PROLOGUE_STANZAS.map(
  (_, i) => i * STANZA_EVERY_MS,
);

/** Milliseconds from mount until the story completes (the 登船 button's
 *  cue): the last stanza gets its full slot too. */
export const PROLOGUE_TOTAL_MS =
  STANZA_MS[STANZA_MS.length - 1]! + STANZA_EVERY_MS;

/** One-shot synthesized ambience: filtered noise swell (surf) + a couple of
 *  low groans (hull). Best-effort like the chime — never worth crashing. */
function playAmbience(): void {
  try {
    // Shared singleton (unlocked by the flip/登船 gestures) — a fresh
    // non-gesture AudioContext would be born suspended on iOS.
    const ctx = sharedAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.12, t0 + 1.2);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.2);
    master.connect(ctx.destination);

    // Surf: looping white noise through a slow lowpass sweep.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(220, t0);
    lp.frequency.linearRampToValueAtTime(520, t0 + 2.4);
    lp.frequency.linearRampToValueAtTime(180, t0 + 5);
    const g = ctx.createGain();
    g.gain.value = 0.5;
    noise.connect(lp).connect(g).connect(master);
    noise.start(t0);
    noise.stop(t0 + 5.4);

    // Hull creak: two descending low groans.
    for (const [f, at] of [[64, 0.9], [52, 2.8]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t0 + at);
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + at + 1.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0 + at);
      og.gain.exponentialRampToValueAtTime(0.28, t0 + at + 0.18);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.2);
      const olp = ctx.createBiquadFilter();
      olp.type = 'lowpass';
      olp.frequency.value = 240;
      osc.connect(olp).connect(og).connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + 1.3);
    }
    // Best-effort cleanup once the swell is done.
    window.setTimeout(() => void ctx.close().catch(() => {}), 6000);
  } catch {
    /* audio blocked or unsupported — the story reads fine in silence */
  }
}

export function StoryPrologue({
  sessionKey,
  soundOn,
  onDone,
}: {
  /** `<matchID>:<playerID>` — the sessionStorage skip-record key suffix. */
  sessionKey: string;
  /** The 🔔 reminder pref: mutes the ambience, not the visuals. */
  soundOn: boolean;
  /** Story over (skipped or the veils are being torn down by the parent). */
  onDone: () => void;
}) {
  // Seen-flag: a refresh mid-game does not replay the prologue — the mount
  // gate in App only renders this while the countdown is live anyway, so the
  // flag only guards "reconnect within the same countdown window".
  const seenKey = `ftk-prologue:${sessionKey}`;
  const [skip, setSkip] = useState(false);
  const [beat, setBeat] = useState(0); // index of the newest stanza on stage
  // The story no longer auto-boards: once the last stanza's slot closes,
  // 登船 surfaces and the player boards at their own pace. `skip` doubles
  // as the clicked-guard so 登船 can't fire onDone twice.
  const [read, setRead] = useState(false);
  const seenRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (seenRef.current) return;
    seenRef.current = true;
    try {
      if (sessionStorage.getItem(seenKey) === '1') { onDone(); return; }
      sessionStorage.setItem(seenKey, '1');
    } catch { /* private mode: every load replays — fine */ }
  }, [seenKey, onDone]);

  // Stanza timeline: each stanza appears when its reading slot opens; when
  // the last slot closes, 登船 surfaces — boarding is the player's click.
  useEffect(() => {
    const timers = STANZA_MS.map((ms, i) =>
      window.setTimeout(() => setBeat(i + 1), ms),
    );
    const done = window.setTimeout(() => setRead(true), PROLOGUE_TOTAL_MS);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(done);
    };
  }, []);

  return (
    <div className="prologue" role="status" aria-live="polite" aria-label="序章">
      <div className="prologue__art" aria-hidden="true" />
      <div className="prologue__veil" aria-hidden="true" />
      <div className="prologue__text">
        <p className="prologue__kicker">序章 · 险恶疑航</p>
        {PROLOGUE_STANZAS.slice(0, beat).map((stanza, i) => (
          <p key={i} className="prologue__stanza" style={{ animationDelay: '0ms' }}>
            {stanza}
          </p>
        ))}
      </div>
      {read && !skip && (
        <button
          type="button"
          className="btn btn--primary prologue__board"
          onClick={() => { unlockAudio(); setSkip(true); onDoneRef.current(); }}
        >
          ⚓ 登船
        </button>
      )}
      {/* (soundOn drives the ambience fire in App — see the mount gate.) */}
      <PrologueSound fire={soundOn} />
    </div>
  );
}

/** Fires the ambience exactly once per mount when `fire` is true. Split into
 *  a tiny child so the effect deps stay honest without replaying on pref
 *  changes mid-story. */
function PrologueSound({ fire }: { fire: boolean }) {
  const fired = useRef(false);
  useEffect(() => {
    if (!fire || fired.current) return;
    fired.current = true;
    playAmbience();
  }, [fire]);
  return null;
}

export const PROLOGUE_STANZA_MS = STANZA_MS;
export const PROLOGUE_FADE_MS = FADE_MS;

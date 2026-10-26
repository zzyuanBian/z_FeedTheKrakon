/**
 * 轮到你了 nudges (three layers, one module).
 *
 * `needsMe` in App is computed purely from the viewer's OWN view
 * (pending.isYou + the navigation stages), so everything here is client-side
 * presentation — no engine change, no information leak.
 *
 * Layer 1 — persistent: a gold 轮到你了 badge glued to the top of the action
 * pane + a breathing glow on the pane itself (PC) / a blinking tab dot
 * (mobile), for as long as the player owes an action.
 *
 * Layer 2 — moment: when the turn arrives (or the covering modal/veil just
 * cleared), a synthesized ship's-bell chime plays (WebAudio, no audio file —
 * the 375KB/s server pipe stays untouched), the phone buzzes where supported
 * (Android; iOS web pages cannot vibrate), and a toast slides in for 4s.
 * A 🔔 pill in the topbar mutes sound+vibration (localStorage); the visual
 * layers always fire.
 *
 * Layer 3 — background: while the tab is hidden the document title flickers
 * 【轮到你】, restored the moment the tab is foregrounded or the turn ends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const REMINDER_KEY = 'ftk-turn-reminder';

/** Sound+vibration preference, persisted. Visual nudges are not muteable —
 *  the bell silences the noise, not the information. */
export function useTurnReminderPref(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REMINDER_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(REMINDER_KEY, next ? 'on' : 'off');
      } catch {
        /* private mode: pref is disposable */
      }
      return next;
    });
  }, []);
  return [on, toggle];
}

/* Two bell partials a fifth apart with slow decays — reads as a ship's bell,
   not an alarm beep. The context is a lazy singleton; a suspended context
   (no user gesture yet, e.g. a fresh page load) resumes best-effort or
   stays silent — the visual layers always fired regardless. */
let audioCtx: AudioContext | null = null;
function chime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
    const t0 = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
    master.connect(audioCtx.destination);
    for (const [freq, at] of [[659.25, 0], [987.77, 0.12]] as const) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.9, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.75);
      osc.connect(g).connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.8);
    }
  } catch {
    /* audio blocked or unsupported — never worth crashing over */
  }
}

export function useTurnNudge(
  /** It is this viewer's turn (pending.isYou / navigation stages), game live. */
  active: boolean,
  /** A full-screen modal or veil currently covers the board — the chime waits
   *  for it to clear (one chime per turn-arrival, never per modal). */
  suppressed: boolean,
  /** Sound+vibration enabled (the 🔔 pref). */
  soundOn: boolean,
): { badge: boolean; toast: boolean } {
  const [badge, setBadge] = useState(false);
  const [toast, setToast] = useState(false);
  const prevActive = useRef(false);
  const reminded = useRef(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    if (window.navigator.vibrate) window.navigator.vibrate(0); // cancel pending
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    if (!active) {
      setBadge(false);
      setToast(false);
      reminded.current = false;
      prevActive.current = false;
      return;
    }
    const edge = !prevActive.current;
    prevActive.current = true;
    setBadge(true);
    if (suppressed) return; // owed, but a veil owns the screen — chime later
    if (edge || !reminded.current) {
      reminded.current = true;
      if (soundOn) {
        chime();
        // Android buzzes; iOS web pages have no vibration API — optional call.
        window.navigator.vibrate?.([90, 60, 90]);
      }
      setToast(true);
      toastTimer.current = window.setTimeout(() => setToast(false), 4000);
    }
  }, [active, suppressed, soundOn]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  // Layer 3: flicker the document title while the tab is hidden.
  useEffect(() => {
    if (!active) return;
    const base = document.title;
    let flipFlop = false;
    const tick = () => {
      if (document.hidden) {
        flipFlop = !flipFlop;
        document.title = flipFlop ? `【轮到你】${base}` : base;
      } else if (document.title !== base) {
        document.title = base;
      }
    };
    const t = window.setInterval(tick, 900);
    const vis = () => {
      if (!document.hidden) document.title = base;
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      document.title = base;
    };
  }, [active]);

  return { badge, toast };
}

/** The transient top toast (layer 2's visual arm). */
export function TurnToast({ show }: { show: boolean }) {
  return (
    <div className={'nudge-toast' + (show ? ' nudge-toast--on' : '')} role="status">
      ⚓ 轮到你了 —— 请在行动栏操作
    </div>
  );
}

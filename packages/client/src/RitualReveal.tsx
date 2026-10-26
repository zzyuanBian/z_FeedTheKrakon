/**
 * Full-screen ritual veil — 闭眼仪式. Two "eyelids" slide shut over the
 * board the moment a ritual is underway (参考哗变统计的全屏遮挡，但意象是
 * 闭眼): bystanders sit in darkness with breathing whispers and NO button —
 * the lids part on their own the instant the ritual resolves, so the whole
 * table 睁眼 together. Two seats see through the dark:
 *
 *  - the Cult Leader: the ceremony banner + 睁开双眼 (they must go act —
 *    in the physical game the leader's eyes stay open during the rite);
 *  - the freshly converted: their secret indoctrination — 沉入黑暗.
 *
 * Lifecycle: `active` (ritual pending OR an unshown conversion) drives the
 * lids. Mount → lids slide shut (~1s) → hold while active → when `active`
 * drops, lids slide open again and `onGone` unmounts after the exit beat.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';
import { RITUAL_LABEL } from './labels.js';
import { RitualFace } from './RitualFace.js';

export function RitualReveal({ view, active, freshConversion, onDismiss, onGone }: {
  view: PlayerView;
  /** Ritual window open (pending or an unshown conversion for THIS seat). */
  active: boolean;
  /** True only while THIS viewer's conversion is still unshown — an older
   *  cultist must never see the indoctrination beat again on later rituals. */
  freshConversion: boolean;
  /** The leader's / convert's own "open my eyes" — closes THIS seat's window
   *  (the lids then part on the active→idle edge, like everyone else's). */
  onDismiss: () => void;
  /** Called after the opening animation, so the parent can unmount. */
  onGone: () => void;
}) {
  const [closed, setClosed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Ref keeps the exit timer immune to the parent re-creating the callback.
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  useEffect(() => {
    if (active) {
      setLeaving(false);
      // One frame at retracted lids so the transition actually plays.
      const t = window.setTimeout(() => setClosed(true), 30);
      return () => window.clearTimeout(t);
    }
    setClosed(false);
    setLeaving(true);
    const t = window.setTimeout(() => onGoneRef.current(), 1100);
    return () => window.clearTimeout(t);
  }, [active]);

  const ritual = view.rituals.revealed.at(-1) ?? null;
  const isLeader = view.you.cultLeader;
  // The indoctrination beat: shown ONLY while the conversion is fresh —
  // otherwise every later ritual would replay "你被转化了…" to an old
  // cultist (that was a real bug).
  const masterId = freshConversion ? view.you.convertedBy : null;
  const master = masterId
    ? (masterId === view.you.id
      ? view.you
      : view.others.find((p) => p.id === masterId))
    : undefined;
  const newlyConverted = !!masterId && !!master;

  return (
    <div
      className={
        'ritual-veil' +
        (closed ? ' ritual-veil--closed' : '') +
        (leaving ? ' ritual-veil--leaving' : '')
      }
      role="alertdialog"
      aria-label="邪教仪式"
    >
      <div className="ritual-veil__lid ritual-veil__lid--top" aria-hidden="true" />
      <div className="ritual-veil__lid ritual-veil__lid--bottom" aria-hidden="true" />

      <div className="ritual-veil__content">
        {ritual && <RitualFace card={ritual} className="ritualface--veil" />}
        {!ritual && <div className="ritual-reveal__glyphs" aria-hidden="true"><span>🐙</span></div>}

        {newlyConverted ? (
          <>
            <h2 className="ritual-reveal__title">你被转化了…</h2>
            <p className="ritual-reveal__sub">深海的低语穿透了你的梦。如今你已是 &ldquo;邪教徒&rdquo;。</p>
            <div className="ritual-reveal__master">
              <span className="ritual-reveal__master-label">引领你走入深渊的人</span>
              <span className="ritual-reveal__master-name">
                <AvatarImage
                  avatarId={master!.avatar}
                  size={40}
                  title={master!.name}
                  className="ritual-reveal__master-ava"
                />
                {master!.name}
                {masterId === view.you.id && '（你）'}
              </span>
              <span className="ritual-reveal__master-role">🐙 邪教首领</span>
            </div>
            <p className="ritual-reveal__whisper">保守这个秘密——直到海水漫过甲板。</p>
            <button type="button" className="btn btn--primary ritual-reveal__close" onClick={onDismiss}>
              沉入黑暗
            </button>
          </>
        ) : isLeader ? (
          <>
            <h2 className="ritual-reveal__title">{ritual ? RITUAL_LABEL[ritual] : '邪教仪式'}</h2>
            <p className="ritual-reveal__sub">全船闭眼，唯有你睁着。请在下方的行动面板中主持仪式。</p>
            <button type="button" className="btn btn--primary ritual-reveal__close" onClick={onDismiss}>
              睁开双眼
            </button>
          </>
        ) : (
          <>
            <h2 className="ritual-reveal__title">闭上眼睛…</h2>
            <p className="ritual-reveal__sub">
              {ritual ? `船舱深处，有人翻开了「${RITUAL_LABEL[ritual]}」。` : '船舱深处，烛光摇曳。'}
              {' '}不要偷看。
            </p>
            <p className="ritual-veil__breathe">深 海 在 低 语</p>
            <p className="ritual-reveal__whisper">仪式结束时，所有人一起睁眼。</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen ritual veil — the Cult ceremony, styled for mystery (参考哗变
 * 统计的全屏遮挡). Pops for EVERY seat the moment a ritual card is flipped:
 *
 *  - the Cult Leader sees the ceremony's name and acts from here (their
 *    ActionPanel below still renders the real form);
 *  - the just-converted player gets their secret indoctrination beat: they
 *    are told they are now 邪教徒 and are shown WHO led the ritual — their
 *    new master. This is private: only their view carries `convertedBy`.
 *  - everyone else sees only that "a ritual is underway" — the veil's text
 *    is deliberately vague so nothing about the leader's identity leaks.
 *
 * Dismissal: the leader's veil closes when the ritual resolves (pending
 * clears); everyone else gets a 继续航程 button — nobody is force-waited on
 * the leader's pace.
 */

import type { PlayerView } from '@ftk/engine';
import { AvatarImage } from './Avatars.js';
import { RITUAL_LABEL } from './labels.js';

export function RitualReveal({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const ritual = view.rituals.revealed.at(-1) ?? null;
  const isLeader = view.you.cultLeader;
  // The indoctrination beat: this viewer was converted mid-game and the
  // converter is on their private view. Engine guarantee: convertedBy is
  // always the Cult Leader.
  const masterId = view.you.convertedBy;
  const master = masterId
    ? (masterId === view.you.id
      ? view.you
      : view.others.find((p) => p.id === masterId))
    : undefined;
  // Just-converted THIS round (the veil's first broadcast after the ritual):
  // convertedBy lands on the view only at the conversion move, so its mere
  // presence marks the fresh convert — a start-of-game cultist has null.
  const newlyConverted = !!masterId && !!master;

  return (
    <div className="ritual-reveal" role="alertdialog" aria-label="邪教仪式">
      <div className="ritual-reveal__glyphs" aria-hidden="true">
        <span>🐙</span>
      </div>

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
          <button type="button" className="btn btn--primary ritual-reveal__close" onClick={onDone}>
            沉入黑暗
          </button>
        </>
      ) : isLeader ? (
        <>
          <h2 className="ritual-reveal__title">{ritual ? RITUAL_LABEL[ritual] : '邪教仪式'}</h2>
          <p className="ritual-reveal__sub">仪式由你主持。请在下方的行动面板中完成它。</p>
          <button type="button" className="btn btn--primary ritual-reveal__close" onClick={onDone}>
            睁开双眼
          </button>
        </>
      ) : (
        <>
          <h2 className="ritual-reveal__title">诡异的低语…</h2>
          <p className="ritual-reveal__sub">
            {ritual ? `有人翻开了「${RITUAL_LABEL[ritual]}」。` : '船舱深处，烛光摇曳。'}
            {' '}深海正在注视着这艘船。
          </p>
          <button type="button" className="btn btn--primary ritual-reveal__close" onClick={onDone}>
            继续航程
          </button>
        </>
      )}
    </div>
  );
}

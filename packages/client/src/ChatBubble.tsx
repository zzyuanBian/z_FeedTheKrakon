/**
 * Avalon-style floating chat: a round bubble button pinned to the bottom-
 * right corner with an unread badge; tapping it opens a bottom-sheet drawer
 * with the message log and input (layout ported from the Avalon reference,
 * D:\Code\mytest client/src/components/ChatPanel.tsx).
 *
 * Mounted at App level so chat works in the waiting room AND in-game — bgio
 * carries chat over the match socket, which is live from the moment the
 * session exists, so no separate lobby channel is needed.
 *
 * Eliminated players may not send (rulebook: they must remain silent) — the
 * input is disabled while muted, but they can still read.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import type { ChatLine } from './useGame.js';
import { AvatarImage } from './Avatars.js';
import { MarkDots, type PlayerMarks } from './marks.js';

export interface ChatBubbleProps {
  /** Live player view — null before the first socket sync (waiting room). */
  view: PlayerView | null;
  chat: ChatLine[];
  sendChat: (message: string) => void;
  /** Eliminated players are muted. */
  muted: boolean;
  /** The viewer's seat as bgio assigns it ('0'…), from the session. */
  mySeat: string;
  /** The viewer's display name, from the session (available pre-sync). */
  myName: string;
  /** The viewer's avatar id, from the session (-1 = none). */
  myAvatarId?: number;
  /** Private guess notes (marks.tsx), shown as dots on message avatars. */
  marks?: PlayerMarks;
  /** Report the input's focus to App: while the player is TYPING, invasive
   *  modals (忠诚提问) defer themselves so the soft keyboard — and the
   *  half-written message — survive the interruption. */
  onFocusChange?: ((focused: boolean) => void) | undefined;
  /** A deferred modal is waiting: the drawer tops a banner naming it and
   *  the FAB wears a pulsing dot, so the interruption stays visible. */
  deferredModal?: string | null | undefined;
}

export function ChatBubble({ view, chat, sendChat, muted, mySeat, myName, myAvatarId = -1, marks = {}, onFocusChange, deferredModal }: ChatBubbleProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [seenCount, setSeenCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const unread = Math.max(0, chat.length - seenCount);

  // Closing the drawer unmounts the input — which can vanish without firing
  // blur — so the typing flag must be cleared here or a deferred modal would
  // wait behind a closed drawer forever.
  useEffect(() => {
    if (!open) onFocusChange?.(false);
  }, [open, onFocusChange]);

  // Lock the page scroll while the drawer is open. On mobile the document
  // IS the scrollport, and swiping behind the fixed overlay makes the URL
  // bar collapse/expand — the visual viewport shifts and drags the drawer
  // up/down with it (bottom clips away, then returns). No page scroll, no
  // drift; the drawer is modal anyway.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('ftk-scroll-lock');
    return () => root.classList.remove('ftk-scroll-lock');
  }, [open]);

  // Opening (and staying open) marks everything as read.
  useEffect(() => {
    if (open) setSeenCount(chat.length);
  }, [open, chat.length]);

  // Keep the newest message in view — the list scrolls, never the page.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [open, chat.length]);

  // Resolve a bgio seat sender ('0') to a display name + avatar. The session
  // gives the viewer's own identity even before the first sync; everyone else
  // resolves from the live view, falling back to a seat label while names
  // are still placeholder ("Player N") in the waiting room.
  const engineIdOf = (sender: string): string =>
    /^\d+$/.test(sender) ? `p${Number(sender) + 1}` : sender;
  const nameOf = (sender: string): string => {
    if (sender === mySeat) return myName;
    return view?.others.find((p) => p.id === engineIdOf(sender))?.name ?? `玩家 ${Number(sender) + 1}`;
  };
  const avatarOf = (sender: string): number => {
    if (sender === mySeat) return myAvatarId;
    return view?.others.find((p) => p.id === engineIdOf(sender))?.avatar ?? -1;
  };
  // Marks are keyed by engine id ('p3'), chat senders by bgio seat ('2').
  const marksOf = (sender: string): string[] => marks[engineIdOf(sender)] ?? [];
  // 船长标注: the current captain's messages carry a crest + word tag, so
  // table talk can be read against the authority (rulebook: the captain
  // leads discussion). officers.captain is an engine id ('p3').
  const captainSeat = view?.officers.captain ?? null;
  const isCaptain = (sender: string): boolean =>
    captainSeat !== null && engineIdOf(sender) === captainSeat;

  const submit = () => {
    const t = text.trim();
    if (!t || muted) return;
    sendChat(t);
    setText('');
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          className={'chatpop__fab' + (deferredModal ? ' chatpop__fab--defer' : '')}
          aria-label="打开聊天"
          onClick={() => setOpen(true)}
        >
          💬
          {unread > 0 && (
            <span className="chatpop__badge">{unread > 9 ? '9+' : unread}</span>
          )}
          {deferredModal && <span className="chatpop__defer-dot" aria-hidden="true" />}
        </button>
      )}

      {open && (
        <div className="chatpop" onClick={() => setOpen(false)}>
          <div className="chatpop__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="chatpop__head">
              <h3>💬 讨论</h3>
              <button type="button" aria-label="收起聊天" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {/* A modal deferred itself because the player was typing: keep
                the interruption visible right above the input so it can't
                be forgotten once the conversation winds down. */}
            {deferredModal && (
              <div className="chatpop__defer" role="status">
                ⚡ {deferredModal}——发送后关闭聊天即可看到
              </div>
            )}
            <div ref={listRef} className="chatpop__log">
              {chat.length === 0 && <p className="chat__empty">暂无消息，起个头吧！</p>}
              {chat.map((m) => {
                const me = m.sender === mySeat;
                return (
                  <div key={m.id} className={'chat__row' + (me ? ' chat__row--me' : '')}>
                    <div className="chat__ava">
                      <span className="chat__who">
                        {nameOf(m.sender)}
                        {isCaptain(m.sender) && (
                          <span className="chat__captain" title="船长">
                            <img src="img/crest-captain.png" alt="" draggable={false} /> 船长
                          </span>
                        )}
                      </span>
                      <span className="chat__ava-wrap">
                        <AvatarImage avatarId={avatarOf(m.sender)} size={26} title={nameOf(m.sender)} />
                        <MarkDots playerMarks={marksOf(m.sender)} playerId={m.sender} />
                      </span>
                    </div>
                    <div className="chat__bubble">{m.message}</div>
                  </div>
                );
              })}
            </div>
            <form
              className="chatpop__form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={text}
                disabled={muted}
                maxLength={500}
                placeholder={muted ? '你已出局，无法发言' : '输入消息…'}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => onFocusChange?.(true)}
                onBlur={() => onFocusChange?.(false)}
              />
              <button
                type="submit"
                className="btn btn--primary"
                disabled={muted || !text.trim()}
              >
                发送
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

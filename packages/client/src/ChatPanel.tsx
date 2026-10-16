/**
 * Text chat, ported from the Avalon reference (D:\Code\mytest) chat panel:
 * bubble layout (own messages right-aligned and gold-tinted, everyone else
 * left in dark bubbles), a name label above each bubble, auto-scroll to the
 * newest message, Enter-to-send with the send button disabled while the
 * input is empty. The panel itself is a permanent right-hand column in the
 * game layout — not a tab.
 *
 * Eliminated players may not send (rulebook: they must remain silent) — the
 * input is disabled when the viewer is out, but they can still read. bgio
 * carries chat over the same socket as game state.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';

export interface ChatPanelProps {
  view: PlayerView;
  chat: { id: string; sender: string; message: string }[];
  sendChat: (message: string) => void;
  /** Eliminated players are muted. */
  muted: boolean;
}

/** bgio chat senders are seat indices ('0'); engine ids are 'p1'. Resolve name. */
function senderName(view: PlayerView, sender: string): string {
  const engineId = /^\d+$/.test(sender) ? `p${Number(sender) + 1}` : sender;
  if (engineId === view.you.id) return view.you.name;
  return view.others.find((p) => p.id === engineId)?.name ?? sender;
}

export function ChatPanel({ view, chat, sendChat, muted }: ChatPanelProps) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const mySeat = String(Number(view.you.id.slice(1)) - 1);

  // Keep the newest message in view — the list scrolls, never the page.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  return (
    <section className="chat">
      <h3 className="sec__title">讨论</h3>
      <div ref={listRef} className="chat__log">
        {chat.length === 0 && <p className="chat__empty">暂无消息，起个头吧！</p>}
        {chat.map((m) => {
          const me = m.sender === mySeat;
          return (
            <div key={m.id} className={'chat__row' + (me ? ' chat__row--me' : '')}>
              <span className="chat__who">{senderName(view, m.sender)}</span>
              <div className="chat__bubble">{m.message}</div>
            </div>
          );
        })}
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || muted) return;
          sendChat(text.trim());
          setText('');
        }}
      >
        <input
          value={text}
          disabled={muted}
          maxLength={500}
          placeholder={muted ? '你已出局，无法发言' : '输入消息…'}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn--primary" disabled={muted || !text.trim()} type="submit">
          发送
        </button>
      </form>
    </section>
  );
}

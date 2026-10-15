/**
 * Text chat. Eliminated players may not send (rulebook: they must remain
 * silent) — the input is disabled when the viewer is out, but they can still
 * read. bgio carries chat over the same socket as game state.
 */

import { useState } from 'react';
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
  return (
    <section className="chat">
      <h3 className="sec__title">讨论</h3>
      <div className="chat__log">
        {chat.length === 0 && <p className="hint">还没有人发言。</p>}
        {chat.map((m) => (
          <div key={m.id} className={'chat__msg' + (m.sender === String(Number(view.you.id.slice(1)) - 1) ? ' chat__msg--me' : '')}>
            <span className="chat__who">{senderName(view, m.sender)}</span>
            <span className="chat__text">{m.message}</span>
          </div>
        ))}
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
          placeholder={muted ? '你已出局，无法发言' : '说点什么…'}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn--primary" disabled={muted || !text.trim()} type="submit">
          发送
        </button>
      </form>
    </section>
  );
}

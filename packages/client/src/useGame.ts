/**
 * React bindings over the boardgame.io vanilla `Client`.
 *
 * We use the vanilla client rather than bgio's React component so that the
 * subscription surface is explicit and version-stable: `Client` gives us
 * `getState()`, `subscribe()`, `moves`, `events`, `sendChatMessage`, and
 * `chatMessages`. `useGame` returns the current filtered `PlayerView`, a set of
 * bound move dispatchers, and the chat transcript.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client, LobbyClient } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import { FtkGame, type FtkSetupData } from '@ftk/game';
import type { PlayerView } from '@ftk/engine';
import { GAME_NAME, SERVER_ORIGIN } from './config.js';
import { clearSession, loadSession, saveSession, type Session } from './session.js';

type GameClient = ReturnType<typeof Client>;

export const lobby = new LobbyClient(
  SERVER_ORIGIN ? { server: SERVER_ORIGIN } : {},
);

/** A player's seat as the server assigned it, plus the match id. */
export interface Connection {
  session: Session;
  /** True once the socket has received its first state sync. */
  connected: boolean;
  error: string | null;
}

export interface CreateOptions {
  playerName: string;
  playerCount: number;
  seed?: number;
  fivePlayerTwoPirates?: boolean;
}

/** Create a match, take seat 0, and return the session. */
export async function createMatch(opts: CreateOptions): Promise<Session> {
  const setupData: FtkSetupData = {
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    playerCount: opts.playerCount,
    map: 'short',
    fivePlayerTwoPirates: opts.fivePlayerTwoPirates ?? false,
  };
  const { matchID } = await lobby.createMatch(GAME_NAME, {
    numPlayers: opts.playerCount,
    setupData,
  });
  const { playerID, playerCredentials } = await lobby.joinMatch(GAME_NAME, matchID, {
    playerID: '0',
    playerName: opts.playerName,
  });
  const session: Session = {
    matchID,
    playerID,
    credentials: playerCredentials,
    playerName: opts.playerName,
    playerCount: opts.playerCount,
  };
  saveSession(session);
  return session;
}

/** Join the first open seat in a match. */
export async function joinMatch(matchID: string, playerName: string): Promise<Session> {
  const match = await lobby.getMatch(GAME_NAME, matchID);
  const open = match.players.find((p) => !p.name);
  if (!open) throw new Error('该房间已满');
  const { playerID, playerCredentials } = await lobby.joinMatch(GAME_NAME, matchID, {
    playerID: open.id.toString(),
    playerName,
  });
  const session: Session = { matchID, playerID, credentials: playerCredentials, playerName };
  saveSession(session);
  return session;
}

export interface ChatLine {
  id: string;
  sender: string;
  message: string;
}

export interface GameConnection {
  view: PlayerView | null;
  moves: Record<string, (...args: unknown[]) => void>;
  chat: ChatLine[];
  sendChat: (message: string) => void;
  /** Convenience wrapper for `moves.confirmRole()` — the only move that is
   *  legal during the pre-game role-reveal gate. */
  confirmRole: () => void;
  connected: boolean;
  isActive: boolean;
  gameover: unknown;
  leave: () => void;
}

/** How long to wait for the first state sync before deciding the session is stale. */
const STALE_TIMEOUT_MS = 10_000;

/** Connect to a session and expose its live state. `onStale` fires once if the
 *  first state sync never arrives within STALE_TIMEOUT_MS — typically because
 *  the match was lost (server restart, expired id). The host should clear the
 *  session so the user lands back in the lobby. */
export function useGame(
  session: Session | null,
  onStale?: () => void,
): GameConnection {
  const clientRef = useRef<GameClient | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [connected, setConnected] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [gameover, setGameover] = useState<unknown>(undefined);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    if (!session) return;
    const client = Client({
      game: FtkGame,
      // boardgame.io mounts a Svelte debug panel to document.body by default
      // (CONTROLS / GAME / PLAYER / AI tabs). We ship our own UI and don't
      // want it poking out of the right edge — setting `debug: false` short-
      // circuits ClientManager.mountDebug.
      debug: false,
      multiplayer: SocketIO({ server: SERVER_ORIGIN || window.location.origin }),
      matchID: session.matchID,
      playerID: session.playerID,
      credentials: session.credentials,
    });
    clientRef.current = client;

    let gotFirstSync = false;
    const sync = (): void => {
      const state = client.getState();
      if (!state) return;
      gotFirstSync = true;
      setView((state.G as unknown as PlayerView) ?? null);
      setConnected(state.isConnected);
      setIsActive(state.isActive);
      setGameover(state.ctx.gameover);
      // bgio wraps each chat payload as { id, sender, payload: <what we sent> }.
      setChat(
        client.chatMessages.map((m) => ({
          id: m.id,
          sender: m.sender,
          message:
            typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload),
        })),
      );
    };

    client.subscribe(sync);
    client.start();
    sync();

    const staleTimer = window.setTimeout(() => {
      if (!gotFirstSync) staleRef.current?.();
    }, STALE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(staleTimer);
      client.stop();
      clientRef.current = null;
    };
  }, [session]);

  const moves = useMemo(() => {
    const proxy: Record<string, (...args: unknown[]) => void> = {};
    for (const name of Object.keys(FtkGame.moves ?? {})) {
      proxy[name] = (...args: unknown[]) => {
        const fn = clientRef.current?.moves[name] as ((...a: unknown[]) => void) | undefined;
        fn?.(...args);
      };
    }
    return proxy;
  }, [session]);

  const sendChat = useCallback((message: string) => {
    // Send the raw string; bgio wraps it as { id, sender, payload }.
    clientRef.current?.sendChatMessage(message);
  }, []);

  const leave = useCallback(() => {
    clientRef.current?.stop();
    clientRef.current = null;
    clearSession();
  }, []);

  const confirmRole = useCallback(() => {
    const fn = clientRef.current?.moves.confirmRole as ((...a: unknown[]) => void) | undefined;
    fn?.();
  }, []);

  return { view, moves, chat, sendChat, confirmRole, connected, isActive, gameover, leave };
}

export { loadSession, clearSession };

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
import { FtkGame, SEAT_CAPACITY, type FtkSetupData } from '@ftk/game';
import type { FactionCounts, PlayerView } from '@ftk/engine';
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
  /** Optional host override: explicit sailor / pirate / cult counts. When
   *  set, the rulebook table and fivePlayerTwoPirates are bypassed. */
  factionCounts?: FactionCounts;
}

/** Create a match, take seat 0, and return the session.
 *
 *  The room is always built at full seat capacity — `playerCount` seals only
 *  the TARGET crew size into the setup data, and the host retunes it live via
 *  `setFactionConfig` without ever rebuilding the match (the room code, the
 *  share link and everyone's seat survive any config change). */
export async function createMatch(opts: CreateOptions): Promise<Session> {
  const setupData: FtkSetupData = {
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    playerCount: opts.playerCount,
    map: 'short',
    fivePlayerTwoPirates: opts.fivePlayerTwoPirates ?? false,
    ...(opts.factionCounts ? { factionCounts: opts.factionCounts } : {}),
  };
  const { matchID } = await lobby.createMatch(GAME_NAME, {
    numPlayers: SEAT_CAPACITY,
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
    ...(opts.factionCounts ? { factionCounts: opts.factionCounts } : {}),
  };
  saveSession(session);
  return session;
}

/** Join the first open seat in a match. If the name matches a seat that is
 *  already taken, the seat is CLAIMED instead (friends-table reconnect):
 *  the server re-issues that seat's credential and the returning player
 *  takes over their old body — role, guns, resumes all intact. */
export async function joinMatch(matchID: string, playerName: string): Promise<Session> {
  const match = await lobby.getMatch(GAME_NAME, matchID);
  const takenSeat = match.players.find(
    (p) => p.name && p.name.trim().toLowerCase() === playerName.trim().toLowerCase(),
  );
  if (takenSeat) {
    return claimSeat(matchID, playerName);
  }
  const open = match.players.find((p) => !p.name);
  if (!open) throw new Error('该房间已满');
  const { playerID, playerCredentials } = await lobby.joinMatch(GAME_NAME, matchID, {
    playerID: open.id.toString(),
    playerName,
  });
  // Seal the host's chosen playerCount + factionCounts into the session so
  // App.tsx can render the WaitingRoom (with the correct "X / N" and the
  // host's exact faction breakdown) before the first socket sync lands.
  // Without this the joiner would show a rulebook-preset guess instead of
  // what the host actually configured.
  const setup = (match.setupData ?? {}) as {
    playerCount?: number;
    factionCounts?: { sailor: number; pirate: number; cult: number };
  };
  const session: Session = {
    matchID,
    playerID,
    credentials: playerCredentials,
    playerName,
    playerCount: setup.playerCount ?? match.players.length,
    ...(setup.factionCounts ? { factionCounts: setup.factionCounts } : {}),
  };
  saveSession(session);
  return session;
}

/** Take over an existing seat by display name via the server's claim
 *  endpoint. Used both for reconnection after losing the session and (with
 *  the duplicate-name flow in joinMatch) for the "hey, that's me" case. */
async function claimSeat(matchID: string, playerName: string): Promise<Session> {
  const origin = SERVER_ORIGIN || window.location.origin;
  const res = await fetch(`${origin}/ftk/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchID, playerName: playerName.trim() }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? '认领座位失败，请稍后再试');
  }
  const { playerID, credentials } = (await res.json()) as {
    playerID: string;
    credentials: string;
  };
  // The seat's target crew size / breakdown live in the match setup data.
  const match2 = await lobby.getMatch(GAME_NAME, matchID);
  const setup = (match2.setupData ?? {}) as {
    playerCount?: number;
    factionCounts?: { sailor: number; pirate: number; cult: number };
  };
  const session: Session = {
    matchID,
    playerID,
    credentials,
    playerName: playerName.trim(),
    playerCount: setup.playerCount ?? match2.players.length,
    ...(setup.factionCounts ? { factionCounts: setup.factionCounts } : {}),
  };
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
  /** Convenience wrapper for `moves.hostStartGame()` — only the host (seat 0)
   *  may call this; other seats will be rejected by the reducer. */
  hostStartGame: () => void;
  /** Push the lobby-side display name into GameState. bgio's joinMatch
   *  updates only the lobby metadata, not the reducer's state, so without
   *  this the live-view roster would show the setup-time placeholder
   *  ("Player N") forever. Called automatically by useGame on first sync;
   *  exposed for tests and manual retries. */
  syncName: (name: string) => void;
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
    // New session → drop everything the previous connection produced. Without
    // this, the instant after a waiting-room rebuild swaps the session the UI
    // would render the OLD match's view under the NEW room code until the
    // first sync of the new socket landed.
    setView(null);
    setConnected(false);
    setIsActive(false);
    setGameover(undefined);
    setChat([]);
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
    let nameSyncd = false;
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
      // Bridge the lobby-side display name into GameState exactly once per
      // session. bgio's joinMatch only updates the lobby metadata, so the
      // reducer's players[p].name would otherwise stay on the setup-time
      // placeholder ("Player N") forever and the live-view roster would
      // show every seat as empty.
      if (!nameSyncd && session.playerName) {
        nameSyncd = true;
        const fn = client.moves.syncName as ((...a: unknown[]) => void) | undefined;
        fn?.(session.playerName);
      }
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

  const hostStartGame = useCallback(() => {
    const fn = clientRef.current?.moves.hostStartGame as ((...a: unknown[]) => void) | undefined;
    fn?.();
  }, []);

  const syncName = useCallback((name: string) => {
    const fn = clientRef.current?.moves.syncName as ((...a: unknown[]) => void) | undefined;
    fn?.(name);
  }, []);

  return { view, moves, chat, sendChat, confirmRole, hostStartGame, syncName, connected, isActive, gameover, leave };
}

export { loadSession, clearSession };

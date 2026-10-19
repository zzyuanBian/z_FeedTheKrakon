/**
 * Session persistence: matchID + the player's seat and credentials, so a
 * refresh (or a dropped phone connection) returns to the same seat. Kept out
 * of the URL because credentials are a shared secret — anyone with them can
 * act as that player.
 *
 * Uses `sessionStorage` rather than `localStorage`: the session survives an
 * F5 mid-game but dies with the tab/browser, so opening a fresh window lands
 * the user in the lobby instead of reconnecting to a stale match.
 */

import { STORAGE_KEY } from './config.js';

export interface Session {
  matchID: string;
  playerID: string;
  credentials: string;
  playerName: string;
  /** Picked at join time (random, room-unique) and bridged into GameState
   *  via syncAvatar. Optional because older sessions predate the field. */
  avatarId?: number;
  /** Sealed in when the host creates the room, so the waiting screen can
   *  show "X / N" before the first game state arrives. Optional because older
   *  sessions predate the field. */
  playerCount?: number;
  /** Host's chosen faction breakdown. Optional because older sessions predate
   *  the field; WaitingRoom falls back to the 7-player rulebook preset when
   *  absent (pre-sync display only). */
  factionCounts?: { sailor: number; pirate: number; cult: number };
}

function parse(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.matchID || parsed.playerID === undefined || !parsed.credentials) return null;
    return {
      matchID: parsed.matchID,
      playerID: parsed.playerID,
      credentials: parsed.credentials,
      playerName: parsed.playerName ?? 'Player',
      ...(typeof parsed.avatarId === 'number' ? { avatarId: parsed.avatarId } : {}),
      ...(typeof parsed.playerCount === 'number' ? { playerCount: parsed.playerCount } : {}),
      ...(parsed.factionCounts
        ? {
            factionCounts: {
              sailor: parsed.factionCounts.sailor,
              pirate: parsed.factionCounts.pirate,
              cult: parsed.factionCounts.cult,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function loadSession(): Session | null {
  try {
    const primary = parse(sessionStorage.getItem(STORAGE_KEY));
    if (primary) return primary;
    // One-time migration from the earlier localStorage layout. If we find an
    // old entry there, lift it into sessionStorage for the current tab and
    // wipe the persistent copy so a future browser launch starts in the lobby.
    const legacy = parse(localStorage.getItem(STORAGE_KEY));
    if (legacy) {
      sessionStorage.setItem(STORAGE_KEY, localStorage.getItem(STORAGE_KEY) ?? '');
      localStorage.removeItem(STORAGE_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    const json = JSON.stringify(s);
    sessionStorage.setItem(STORAGE_KEY, json);
    // Belt-and-braces: kill any lingering persistent copy from pre-migration
    // installs so we never regress to the "stuck on a dead matchID" behaviour.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  } catch {
    /* storage may be unavailable (private mode); the game still works */
  }
}

export function clearSession(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

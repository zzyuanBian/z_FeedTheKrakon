/**
 * @ftk/game — the boardgame.io shell.
 *
 * Design: the pure @ftk/engine reducer is the single source of truth for BOTH
 * rules and flow. boardgame.io is used only for what it is genuinely good at:
 *
 *   - per-player `playerView` projection (secrets are stripped server-side),
 *   - move transport and state sync to React clients,
 *   - the game-over signal.
 *
 * We deliberately do NOT map the six engine phases onto bgio `phases`: bgio's
 * phase/turn machinery gates moves and rotates the current player, which fights
 * the engine's own "who may act right now" model (the `pending` queue). Instead
 * there is a single, never-ending bgio turn with every player active; the engine
 * rejects any move that is illegal in the current situation, and the client
 * reads `view.phase` for display.
 *
 * Secrecy: every move atomically returns the full new `GameState` (it must,
 * because the engine mutates hidden information), so every move is declared
 * `client: false`. Clients never execute a move optimistically against a
 * partial state — they send it and wait for the server's filtered broadcast.
 */

import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import type { Game, Move } from 'boardgame.io';
import {
  SHORT_MAP, activeSeatIds, createGame, reduce, spectatorView, viewFor,
  type Action, type FactionCounts, type GameState, type PlayerId,
} from '@ftk/engine';

export interface FtkSetupData {
  seed: number;
  playerCount: number;
  /** 'short' | 'long' — only 'short' ships a bundled map today. */
  map?: 'short' | 'long';
  /** 5-player only: 2 Sailors / 2 Pirates instead of the 3/1 default.
   *  Ignored when `factionCounts` is supplied. */
  fivePlayerTwoPirates?: boolean;
  /** Optional host override: explicit sailor / pirate / cult counts. When
   *  set, TEAM_COMPOSITIONS and `fivePlayerTwoPirates` are bypassed. */
  factionCounts?: FactionCounts;
  /** Optional display names, indexed by seat. Defaults to "Player 1"… */
  names?: string[];
}

/** bgio seat index ('0'..) <-> engine PlayerId ('p1'..). Fixed by construction. */
export const idForIndex = (index: number): PlayerId => `p${index + 1}`;
const indexForId = (id: PlayerId): number => Number(id.slice(1)) - 1;

/** Every room is built at maximum capacity (Avalon-style lobby): the match
 *  always has this many bgio seats, the engine's `settings.playerCount` says
 *  how many of them are actually in the game, and the host retunes that via
 *  `setFactionConfig` without ever rebuilding the match. */
export const SEAT_CAPACITY = 11;

function isFtkGame(G: unknown): G is GameState {
  return !!G && typeof G === 'object' && 'seatOrder' in G && 'phase' in G;
}

/**
 * Wrap an engine action as a bgio move. The move receives the caller's bgio
 * playerID, stamps it onto the action as `actor`, delegates to the engine and
 * returns the new state. An engine `assert` failure (an illegal move) surfaces
 * as INVALID_MOVE rather than a crash.
 *
 * Role-confirm gate: until every seat is in `G.confirmedRole`, only the
 * `confirmRole` action itself is allowed — every other action short-circuits
 * to INVALID_MOVE. The `confirmRole` action is exempt because otherwise
 * nobody could ever lift the gate.
 */
function move(
  create: (actor: PlayerId, ...args: unknown[]) => Action,
  opts: { ignoreStaleStateID?: boolean; redact?: boolean } = {},
): Move<GameState> {
  return {
    client: false,
    // bgio's master rejects any move whose client-side stateID no longer
    // matches the server's (`invalid stateID`). For declarative, idempotent
    // moves that is the wrong semantics: two quick taps <0.5s apart would
    // send the second one before the first broadcast round-trips, and it
    // would be silently dropped. Opting those moves out makes the server
    // apply them against its latest state; their legality is still guarded
    // by the reducer's own assertions.
    ...(opts.ignoreStaleStateID ? { ignoreStaleStateID: true } : {}),
    // `redact` strips the move's ARGS from the transport log shipped to other
    // clients (bgio's deltalog reaches every browser — args are otherwise
    // readable in devtools). Used for moves whose args carry secrets.
    ...(opts.redact ? { redact: true } : {}),
    move: ({ G, playerID }, ...args: unknown[]) => {
      if (!isFtkGame(G)) return INVALID_MOVE;
      if (playerID === null || playerID === undefined) return INVALID_MOVE;
      const action = create(idForIndex(Number(playerID)), ...args);
      // Role-confirm gate: exempt `confirmRole`, `hostStartGame`, and the
      // pre-game `sync*` bridges; block every other action until every seat
      // is in G.confirmedRole. All exempt moves are pre-game — they have to
      // fire as soon as the socket connects, before anyone has a chance to
      // confirm their role.
      if (
        action.type !== 'confirmRole'
        && action.type !== 'hostStartGame'
        && action.type !== 'syncName'
        && action.type !== 'syncAvatar'
        && action.type !== 'setFactionConfig'
        && action.type !== 'clearSeat'
      ) {
        // Active seats only: bench seats hold no role card, so requiring
        // their confirmation would deadlock the gate forever.
        const allConfirmed = activeSeatIds(G)
          .every((id) => G.confirmedRole.includes(id));
        if (!allConfirmed) return INVALID_MOVE;
      }
      try {
        return reduce(G, action);
      } catch {
        // Illegal per the engine's own validation — do not mutate anything.
        return INVALID_MOVE;
      }
    },
  };
}

/** Convenience: stamp the actor and build the action. */
const as = <T extends string>(type: T, actor: PlayerId, rest: Record<string, unknown> = {}): Action =>
  ({ type, actor, ...rest }) as Action;

export const FtkGame: Game<GameState, Record<string, unknown>, FtkSetupData> = {
  name: 'feed-the-kraken',
  minPlayers: 5,
  maxPlayers: 11,
  disableUndo: true,

  setup: ({ ctx }, setupData) => {
    const requested = setupData?.playerCount ?? ctx.numPlayers;
    // Defensive clamp: the engine only defines compositions for 5..11 seats.
    // Without this, a bogus createMatch payload would throw from deep inside
    // createGame and tear the whole server process down. The offending client
    // still gets a broken match, but the server stays up for everyone else.
    // Exception: when the host supplies factionCounts, the table is bypassed
    // so custom counts work for any total within the engine's range.
    const min = FtkGame.minPlayers ?? 5;
    const max = FtkGame.maxPlayers ?? 11;
    const playerCount = Math.min(max, Math.max(min, requested));
    const names =
      setupData?.names ??
      Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
    return createGame({
      seed: setupData?.seed ?? 0,
      settings: {
        playerCount,
        // Rooms are always built at full capacity — the target crew size is
        // retunable via setFactionConfig, so the seat COUNT must never be
        // the thing that forces a rebuild.
        seats: max,
        map: setupData?.map ?? 'short',
        fivePlayerTwoPirates: setupData?.fivePlayerTwoPirates ?? false,
        ...(setupData?.factionCounts ? { factionCounts: setupData.factionCounts } : {}),
      },
      names,
      map: SHORT_MAP,
    });
  },

  /** Everyone may act at any time; the engine enforces whose turn it really is. */
  turn: {
    activePlayers: ActivePlayers.ALL,
  },

  moves: {
    /** Pre-game: host flips the "开始游戏" switch. Exempt from the role-
     *  confirm gate (otherwise the host couldn't start at all). */
    hostStartGame: move((actor) => as('hostStartGame', actor), { ignoreStaleStateID: true }),

    /** Pre-game: a seat publishes its lobby display name into GameState.
     *  Exempt from the role-confirm gate so it fires as soon as the socket
     *  connects — without it, the live-view roster would show placeholder
     *  names forever. */
    syncName: move((actor, name) => as('syncName', actor, { name }), { ignoreStaleStateID: true }),

    /** Pre-game: a seat publishes its avatar id into GameState (mirrors
     *  syncName; exempt from the role-confirm gate for the same reason). */
    syncAvatar: move((actor, avatarId) => as('syncAvatar', actor, { avatarId }), { ignoreStaleStateID: true }),

    /** Pre-game: the host re-seals the faction breakdown in the waiting room
     *  (every team is re-dealt — legal while no role card has been seen).
     *  The optional second arg retunes the target crew size (5..11) without
     *  rebuilding the match. Exempt from the role-confirm gate: the host
     *  tunes the config exactly while everyone is still unconfirmed. */
    setFactionConfig: move((actor, factionCounts, nextCount) =>
      as('setFactionConfig', actor, {
        factionCounts,
        ...(nextCount !== undefined ? { nextCount } : {}),
      }), { ignoreStaleStateID: true }),

    /** Pre-game: the host clears an unclaimed/ghost seat so the room can
     *  start (see the engine's clearSeat). Exempt from the role-confirm
     *  gate for the same reason as setFactionConfig. */
    clearSeat: move((actor, target) => as('clearSeat', actor, { target }), { ignoreStaleStateID: true }),

    /** Pre-game: acknowledge the role card. Exempt from the role-confirm gate
     *  (see move() factory) — in fact, this is the ONLY move that is legal
     *  until every seat confirms. Also opts out of the stale-stateID check
     *  (like the sync* bridges): during the reveal phase every client is
     *  firing syncName/syncAvatar on connect, so the server's _stateID
     *  advances constantly — a confirm issued from a not-yet-resynced client
     *  would otherwise be silently dropped (bgio rejects, no error reaches
     *  the sender) and the game would deadlock with a player showing 已确认
     *  whose seat never registered. The reducer is idempotent, so applying
     *  against the latest state is safe. */
    confirmRole: move((actor) => as('confirmRole', actor), { ignoreStaleStateID: true }),

    appointTeam: move((actor, lieutenant, navigator) =>
      as('appointTeam', actor, { lieutenant, navigator })),
    mutinyPledge: move((actor, guns) => as('mutinyPledge', actor, { guns })),
    mutinyTieBreak: move((actor, standDown) => as('mutinyTieBreak', actor, { standDown })),

    navContribute: move((actor, keep, discard) => as('navContribute', actor, { keep, discard })),
    navLogbook: move((actor, discard) => as('navLogbook', actor, { discard })),
    denialOfCommand: move((actor) => as('denialOfCommand', actor)),
    emergencyNav: move((actor, navigator) => as('emergencyNav', actor, { navigator })),

    telescopeChoose: move((actor, target) => as('telescopeChoose', actor, { target })),
    telescopeDecide: move((actor, action) => as('telescopeDecide', actor, { action })),
    mermaidChoose: move((actor, target) => as('mermaidChoose', actor, { target })),
    mermaidAck: move((actor) => as('mermaidAck', actor)),

    mapActionCabinSearch: move((actor, target) => as('mapActionCabinSearch', actor, { target })),
    mapActionFeedKraken: move((actor, target) => as('mapActionFeedKraken', actor, { target })),

    // Rituals are the Cult Leader's moves — their actor is a hidden role, so
    // the args (conversion target, gun distribution) must not ride the
    // transport log. ritualAck has no args but stays redacted for uniformity.
    ritualConversion: move((actor, target) => as('ritualConversion', actor, { target }), { redact: true }),
    ritualGunsStash: move((actor, grants) => as('ritualGunsStash', actor, { grants }), { redact: true }),
    ritualAck: move((actor) => as('ritualAck', actor), { redact: true }),
  },

  /** The engine's whitelist projection is the only thing a client ever sees. */
  playerView: ({ G, playerID }) => {
    if (!isFtkGame(G)) return null as unknown;
    if (playerID === null || playerID === undefined) return spectatorView(G);
    return viewFor(G, idForIndex(Number(playerID)));
  },

  endIf: ({ G }) => (isFtkGame(G) && G.winner ? { winner: G.winner, reason: G.winReason } : undefined),
};

/** Re-exported so the server/client packages need only depend on @ftk/game. */
export { idForIndex as seatIdForIndex };
export const seatIndexForId = indexForId;

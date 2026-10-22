/**
 * The single information gate. `GameState` is the server's truth; clients only
 * ever see the result of `viewFor(state, viewer)`.
 *
 * Shadowing is a WHITELIST projection: every view field is constructed by
 * copying what the viewer may see. Secret fields (another player's `team`,
 * unrevealed mutiny pledges, held nav cards) are never copied — they do not
 * exist on the view type at all, so a leak is a compile error, not a runtime
 * omission.
 *
 * Purity requirement: boardgame.io calls `playerView` on both server and
 * client, possibly several times per update. This function must be pure and
 * idempotent — no mutation of `state`, no randomness, no I/O.
 */

import type {
  ArrowColor, Faction, FactionCounts, GameState, LogEntry, NavCardId, Pending, PhaseId,
  PlayerId, RitualCardId, Ship,
} from './state.js';
import { activeSeatIds } from './helpers.js';
import { effectiveFactionCounts } from './setup.js';

/* --------------------------- public sub-views --------------------------- */

/** Another player, as seen by anyone. Note the absence of `team`. */
export interface OtherPlayerView {
  id: PlayerId;
  seat: number;
  name: string;
  /** Index into the client's shared AVATARS table (-1 = none chosen yet). */
  avatar: number;
  alive: boolean;
  /** Bench seat: the room physically holds it, but it is beyond the target
   *  crew size, so nobody is dealt in there (pre-game only distinction). */
  benched: boolean;
  /** True once this seat's client completed its first socket sync (dispatched
   *  syncName). A joined-but-never-synced seat is a ghost — the waiting room
   *  shows it as an bootable 空位, and the host cannot start until it is
   *  cleared or the player returns. Public: it drives no secret. */
  synced: boolean;
  offDuty: boolean;
  declaredCult: boolean;
  unconvertible: boolean;
  guns: number;
  resumes: number;
}

export interface OfficersView {
  captain: PlayerId | null;
  lieutenant: PlayerId | null;
  navigator: PlayerId | null;
}

/** Mutiny pledges are hidden until `revealed`. */
export interface MutinyView {
  active: boolean;
  revealed: boolean;
  success: boolean;
  threshold: 3 | 4 | 5;
  newCaptain: PlayerId | null;
  /** Who has pledged, WITHOUT the gun counts (those stay secret until
   *  `revealed`) — who has and has not spoken up is public at a real table:
   *  you can see whose fists are still closed. */
  pledged: PlayerId[];
  /** Only populated once revealed. */
  pledges: Record<PlayerId, number> | null;
  /** Whether THIS viewer has already pledged. A viewer's own pledge is never
   *  hidden from them — without this the UI cannot tell that it is done with
   *  them and keeps offering the (now illegal) pledge again. */
  hasPledged: boolean;
}

export interface NavigationView {
  deckCount: number;
  discardCount: number;
  discardTop: NavCardId | null;
  /** Cards this viewer is entitled to hold (captain / lieutenant / navigator). */
  mine: NavCardId[] | null;
  /** Whether the viewer has already contributed this navigation. */
  hasActed: boolean;
  /** Everyone who has contributed so far (captain + lieutenant pick
   *  simultaneously, so the whole table can see 选牌中/已决定 per seat). */
  acted: PlayerId[];
  /** True once both captain and lieutenant have contributed (logbook is 2). */
  logbookReady: boolean;
  /** The player the navigation is currently waiting on, or null if none. */
  awaiting: PlayerId | null;
  /** Which navigation step is open right now. The logbook discard settles
   *  the course and applies the card in the same move — there is no reveal
   *  step for the captain any more. */
  stage: 'contribute' | 'logbook' | 'done';
  revealed: NavCardId | null;
}

export interface PlayerView {
  version: number;
  phase: PhaseId;
  round: number;
  mapId: 'short' | 'long';
  /** The viewer's own record, including their secret team. `roleConfirmed`
   *  flips true once this player has acknowledged their role card; until
   *  every seat confirms, non-`confirmRole` moves are gated out. */
  you: OtherPlayerView & {
    team: Faction;
    convertedAt: number | null;
    /** Who converted you (null unless converted mid-game). Only on your own
     *  view — this is how a newly-converted player learns who leads the cult. */
    convertedBy: PlayerId | null;
    cultLeader: boolean;
    roleConfirmed: boolean;
    /** Only the Cult Leader sees fellow cultists at game start (like Merlin's
     *  sight in Avalon). Empty for sailors / pirates / non-leader cultists. */
    knownCultists: PlayerId[];
    /** Starting teammates this viewer legitimately knows: a pirate's secret-
     *  gathering sight, or the leader's flock (same as knownCultists). A
     *  player converted MID-GAME also learns their converter (the Cult
     *  Leader) — the ritual pulled them into the flock. Empty otherwise. */
    teammates: PlayerId[];
  };
  others: OtherPlayerView[];
  /** Public: the faction breakdown this game is configured with — what the
   *  waiting-room config panel shows. Follows a host's `setFactionConfig`
   *  re-seal. Never secret. */
  factionCounts: FactionCounts;
  /** The target crew size. Room seats beyond this are `benched` players. */
  playerCount: number;
  /** Per-seat role-confirm status, in seatOrder. Lets the role-reveal screen
   *  show "X / Y 已准备" without a separate lobby poll. */
  roleConfirmations: { confirmed: number; total: number; bySeat: boolean[] };
  /** Whether the host has clicked "开始游戏". The waiting screen gates the
   *  transition to role-reveal on this. */
  hostStarted: boolean;
  ship: { spaceId: number; emergency: boolean };
  officers: OfficersView;
  /** Whose input the game is currently waiting on, and for what. `by` is the
   *  actor's id — except for secret-actor pendings (a ritual would out the
   *  Cult Leader), where it is null for everyone but the actor themself. */
  pending: { kind: Pending['kind']; by: PlayerId | null; isYou: boolean } | null;
  /** True if the viewer is the room host (may force-advance a stuck phase). */
  isHost: boolean;
  /** Private data attached to a pending that belongs to the viewer. */
  pendingData: Record<string, unknown> | null;
  /** Facts THIS viewer has privately learned (Cabin Search/Flogging results). */
  knowledge: { about: PlayerId; team: Faction; round: number }[];
  navigation: NavigationView;
  rituals: { remaining: number; revealed: RitualCardId[] };
  mutiny: MutinyView;
  gunSupply: number;
  winner: Faction | null;
  winReason: string | null;
  log: LogEntry[];
}

/* ------------------------------- helpers -------------------------------- */

function publicPlayer(state: GameState, id: PlayerId): OtherPlayerView {
  const p = state.players[id];
  if (!p) throw new Error(`viewFor: unknown player ${id}`);
  // Explicit field list — adding a secret to Player must NOT auto-leak here.
  return {
    id: p.id,
    seat: p.seat,
    name: p.name,
    avatar: p.avatar,
    alive: p.alive,
    benched: p.seat >= state.settings.playerCount,
    synced: state.syncedSeats.includes(id),
    offDuty: p.offDuty,
    declaredCult: p.declaredCult,
    unconvertible: p.unconvertible,
    guns: p.guns,
    resumes: p.resumes,
  };
}

/**
 * Which nav cards the viewer is legitimately holding right now. The captain
 * holds `captainCards`, the lieutenant `lieutenantCards`; the navigator — once
 * it is their turn — holds the logbook. Everyone else holds nothing.
 */
function heldCards(state: GameState, viewer: PlayerId): NavCardId[] | null {
  const { officers, navigation: n } = state;
  if (viewer === officers.navigator) return [...n.logbook];
  if (viewer === officers.captain) return [...n.captainCards];
  if (viewer === officers.lieutenant) return [...n.lieutenantCards];
  return null;
}

/* ------------------------------ the gate -------------------------------- */

export function viewFor(state: GameState, viewer: PlayerId): PlayerView {
  const you = state.players[viewer];
  if (!you) throw new Error(`viewFor: unknown viewer ${viewer}`);

  const others = state.seatOrder
    .filter((id) => id !== viewer)
    .map((id) => publicPlayer(state, id));

  // Cult Leader sight: at game start the leader sees every other cult member,
  // like Merlin's evil-vision in Avalon. Always empty for non-cult-leaders.
  const knownCultists: PlayerId[] = you.cultLeader
    ? state.seatOrder.filter((id) => id !== viewer && state.players[id]!.team === 'cult')
    : [];

  // Teammate sight. The Pirates hold their secret gathering before play
  // (p.8) — every pirate legitimately knows their fellow pirates from the
  // start. The Cult Leader likewise knows their flock (they perform every
  // conversion ritual themselves). A player converted mid-game learns their
  // converter — the Cult Leader — at the moment of conversion (the ritual
  // itself is face-up, the LEADER is the secret, and the converted player is
  // now inside the conspiracy). Everyone else knows nobody. The list rides
  // ONLY the viewer's own view, so it cannot leak to other seats.
  const teammates: PlayerId[] =
    you.team === 'pirate'
      ? state.seatOrder.filter((id) => id !== viewer && state.players[id]!.team === 'pirate')
      : you.cultLeader
        ? knownCultists
        : you.convertedBy
          ? [you.convertedBy].filter((id) => id !== viewer)
          : [];

  // Per-seat confirmation status for the role-reveal UI — active seats only;
  // bench seats hold no role card and must not block or inflate the count.
  const active = activeSeatIds(state);
  const bySeat = active.map((id) => state.confirmedRole.includes(id));
  const roleConfirmations = {
    confirmed: bySeat.filter(Boolean).length,
    total: active.length,
    bySeat,
  };

  return {
    version: state.version,
    phase: state.phase,
    round: state.round,
    mapId: state.mapId,
    you: {
      ...publicPlayer(state, viewer),
      team: you.team,
      convertedAt: you.convertedAt,
      convertedBy: you.convertedBy,
      cultLeader: you.cultLeader,
      roleConfirmed: state.confirmedRole.includes(viewer),
      knownCultists,
      teammates,
    },
    others,
    factionCounts: effectiveFactionCounts(state.settings),
    playerCount: state.settings.playerCount,
    roleConfirmations,
    hostStarted: state.hostStarted,
    ship: { ...state.ship },
    officers: { ...state.officers },
    pending: state.pending
      ? {
          kind: state.pending.kind,
          // A ritual's actor is the (secret) Cult Leader: naming `by` would out
          // them to the whole table. The ritual itself is public — the card is
          // flipped face up — only WHO acts on it stays hidden.
          by: state.pending.kind === 'ritual' && state.pending.by !== viewer
            ? null
            : state.pending.by,
          isYou: state.pending.by === viewer,
        }
      : null,
    isHost: state.host === viewer,
    pendingData:
      state.pending && state.pending.by === viewer ? { ...(state.pending.data ?? {}) } : null,
    knowledge: state.secrets
      .filter((k) => k.viewer === viewer)
      .map((k) => ({ about: k.about, team: k.team, round: k.round })),
    navigation: (() => {
      const n = state.navigation;
      const team = [state.officers.captain, state.officers.lieutenant]
        .filter((x): x is PlayerId => x !== null);
      // Simultaneous picking: the stage only moves to 'logbook' once BOTH
      // officers have contributed — there is no ordered waiting between them.
      const contributor = team.find((id) => !n.acted.includes(id)) ?? null;
      let stage: NavigationView['stage'] = 'done';
      let awaiting: PlayerId | null = null;
      if (state.phase === 'navigation') {
        if (contributor) { stage = 'contribute'; awaiting = contributor; }
        else if (n.logbook.length === 2) { stage = 'logbook'; awaiting = state.officers.navigator; }
      } else if (n.revealed !== null) {
        stage = 'done';
      }
      return {
        deckCount: n.deck.length,
        discardCount: n.discard.length,
        discardTop: n.discard.at(-1) ?? null,
        mine: heldCards(state, viewer),
        hasActed: n.acted.includes(viewer),
        acted: [...n.acted],
        logbookReady: n.logbook.length === 2,
        awaiting,
        stage,
        revealed: n.revealed,
      };
    })(),
    rituals: {
      remaining: state.rituals.deck.length,
      revealed: [...state.rituals.revealed],
    },
    mutiny: {
      active: state.mutiny.active,
      revealed: state.mutiny.revealed,
      success: state.mutiny.success,
      threshold: state.mutiny.threshold,
      newCaptain: state.mutiny.newCaptain,
      pledged: Object.keys(state.mutiny.pledges),
      pledges: state.mutiny.revealed
        ? { ...state.mutiny.pledges }
        : null,
      hasPledged: viewer in state.mutiny.pledges,
    },
    gunSupply: state.gunSupply,
    winner: state.winner,
    winReason: state.winReason,
    log: state.log.map((e) => ({ ...e })) as LogEntry[],
  };
}

/** Convenience for spectators / debug: a fully-public projection (no `you`). */
export function spectatorView(state: GameState): Omit<PlayerView, 'you'> {
  const anyId = state.seatOrder[0];
  if (!anyId) throw new Error('spectatorView: empty game');
  const { you: _you, ...rest } = viewFor(state, anyId);
  // A spectator has no seat, so they hold none of that seat's private knowledge.
  return { ...rest, knowledge: [], pendingData: null };
}

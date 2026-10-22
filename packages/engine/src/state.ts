/**
 * Authoritative game state for Feed the Kraken.
 *
 * This module is the single source of truth for hidden information. The
 * server holds a `GameState`; clients only ever receive a `PlayerView`, a
 * whitelist projection produced by `view.ts`. Secret fields live here and are
 * NEVER mutated in place — they are simply omitted from every other player's view.
 *
 * Pure data + types only: no boardgame.io import, no I/O, no RNG side effects.
 * Rules source: doc/ruleset_notes.md (consult it before changing anything).
 */

/* ================================ basics ================================ */

export type Faction = 'sailor' | 'pirate' | 'cult';
export type ArrowColor = 'yellow' | 'blue' | 'red';

/** Yellow = north, blue = east, red = west (rulebook p.11). */
export const ARROW_COLORS: readonly ArrowColor[] = ['yellow', 'blue', 'red'];

export type PlayerId = string;

/* ================================= map ================================== */

export type SpaceKind = 'normal' | 'start' | 'win-sailor' | 'win-pirate' | 'win-kraken';
/** 'magnify' = Cabin Search, 'octopus' = Feed the Kraken. */
export type SpaceIcon = 'none' | 'magnify' | 'octopus';

export interface Space {
  id: number;
  x: number;
  y: number;
  kind: SpaceKind;
  icon: SpaceIcon;
}

/** One printed arrow. Note (from the real board) that two colours may share
 *  an ordered pair — see MovementTable. */
export interface Arrow {
  from: number;
  color: ArrowColor;
  to: number;
}

export interface MapDef {
  id: 'short' | 'long';
  image: string;
  imageWidth: number;
  imageHeight: number;
  spaces: Space[];
  arrows: Arrow[];
}

/** `movement[spaceId][color]` = destination space. By construction this holds
 *  exactly three DISTINCT destinations per navigable space (duplicate-arrow
 *  collapses resolved at load time, yellow > blue > red), so a space may have
 *  two colours mapping to the same target across the raw data but not here. */
export type MovementTable = Record<number, Record<ArrowColor, number>>;

/* ============================== nav cards =============================== */

/**
 * Deck composition (rulebook pp.2/6). A card's identity encodes its colour,
 * because the colour is what drives movement — "Blue Drunk" and "Red Drunk"
 * are genuinely different cards with the same effect but different directions.
 */
export type NavCardId =
  | 'cultUprising'   // yellow, north
  | 'blueDrunk'      // blue, east
  | 'disarmed'       // blue, east
  | 'redDrunk'       // red, west
  | 'mermaid'        // red, west
  | 'telescope'      // red, west
  | 'armed';         // red, west (long journey only)

/** The rule effect, independent of colour. */
export type NavEffect =
  | 'cultUprising' | 'drunk' | 'disarmed' | 'mermaid' | 'telescope' | 'armed';

export interface NavCardDef {
  id: NavCardId;
  color: ArrowColor;
  effect: NavEffect;
  /** Copies in the Long Journey deck (23 cards total). */
  countLong: number;
  /** Copies in the Quick Journey deck (19; no Armed, one fewer Cult Uprising/blue Drunk). */
  countQuick: number;
}

export const NAV_CARDS: readonly NavCardDef[] = [
  { id: 'cultUprising', color: 'yellow', effect: 'cultUprising', countLong: 6, countQuick: 5 },
  { id: 'blueDrunk',    color: 'blue',   effect: 'drunk',        countLong: 4, countQuick: 3 },
  { id: 'disarmed',     color: 'blue',   effect: 'disarmed',     countLong: 2, countQuick: 2 },
  { id: 'redDrunk',     color: 'red',    effect: 'drunk',        countLong: 5, countQuick: 5 },
  { id: 'mermaid',      color: 'red',    effect: 'mermaid',      countLong: 2, countQuick: 2 },
  { id: 'telescope',    color: 'red',    effect: 'telescope',    countLong: 2, countQuick: 2 },
  { id: 'armed',        color: 'red',    effect: 'armed',        countLong: 2, countQuick: 0 },
];

export function navCard(id: NavCardId): NavCardDef {
  const c = NAV_CARDS.find((c) => c.id === id);
  if (!c) throw new Error(`unknown nav card ${id}`);
  return c;
}

/* ============================== rituals ================================= */

/** The 5 cult ritual cards (rulebook p.15). */
export type RitualCardId = 'conversion' | 'gunsStash' | 'cultCabinSearch';

export interface RitualCardDef {
  id: RitualCardId;
  count: number;
}

export const RITUAL_CARDS: readonly RitualCardDef[] = [
  { id: 'conversion',      count: 3 },
  { id: 'gunsStash',       count: 1 },
  { id: 'cultCabinSearch', count: 1 },
];

/* ============================ team setup ================================ */

export interface TeamComposition {
  players: number;
  sailor: number;
  pirate: number;
  cult: number;
}

/** Custom faction sizes the host can supply to override the TEAM_COMPOSITIONS
 *  table. Must satisfy sailor + pirate + cult === playerCount with sailor
 *  and pirate each >= 1 (there must be an officer corps and a mutiny threat).
 *  cult may be 0 for a "no cult" variant. */
export interface FactionCounts {
  sailor: number;
  pirate: number;
  cult: number;
}

/** Rulebook "TEAM COMPOSITIONS OVERVIEW" (pp.5/7). 5-player games vary and are
 *  a host choice (3S/1P or 2S/2P); the entry below is the 3S/1P variant. */
export const TEAM_COMPOSITIONS: readonly TeamComposition[] = [
  { players: 5,  sailor: 3, pirate: 1, cult: 1 },
  { players: 6,  sailor: 3, pirate: 2, cult: 1 },
  { players: 7,  sailor: 4, pirate: 2, cult: 1 },
  { players: 8,  sailor: 4, pirate: 3, cult: 1 },
  { players: 9,  sailor: 5, pirate: 3, cult: 1 },
  { players: 10, sailor: 5, pirate: 4, cult: 1 },
  { players: 11, sailor: 5, pirate: 4, cult: 2 },  // 1 Cult Leader + 1 Cultist
];

export interface GameSettings {
  /** The number of seats actually IN this game — the crew the roles were
   *  dealt to. The host may retune it pre-game via `setFactionConfig`. */
  playerCount: number;
  /** Total seats the room physically has. Rooms are built at maximum
   *  capacity (Avalon-style lobby: join freely, retune the target count
   *  later); seats beyond `playerCount` are inert placeholders (dead,
   *  nameless, roleless) that every living-player filter skips. Defaults
   *  to `playerCount` when absent, so tests and direct engine users keep
   *  the exact-sized tables. */
  seats?: number;
  map: 'short' | 'long';
  /** 5-player only: false = 3 Sailors / 1 Pirate, true = 2 Sailors / 2 Pirates.
   *  Ignored when `factionCounts` is supplied. */
  fivePlayerTwoPirates: boolean;
  /** Optional override: explicit sailor / pirate / cult counts. When set,
   *  the TEAM_COMPOSITIONS table and `fivePlayerTwoPirates` are bypassed. */
  factionCounts?: FactionCounts;
}

export const STARTING_GUNS = 3;

/** The box ships 40 guns in total; the general supply starts with whatever
 *  the starting hands don't already hold. */
export const GUN_SUPPLY_TOTAL = 40;

/* =============================== players ================================ */

export interface Player {
  id: PlayerId;
  seat: number;
  name: string;
  /** Public. Index into the client's shared AVATARS table (-1 = none yet). */
  avatar: number;
  /** SECRET. Rewritten in place when this player is Converted to Cult. */
  team: Faction;
  /** SECRET. True for the Cult Leader — the only player whose sacrifice wins the
   *  game for the Cult (and the only one who performs rituals). */
  cultLeader: boolean;
  /** Round index at which this player was converted, or null. */
  convertedAt: number | null;
  /** SECRET-to-the-converted. The Cult Leader who performed the conversion
   *  (null unless converted mid-game). Projected ONLY on the converted
   *  player's own view — plain cultists dealt in at start still know nobody. */
  convertedBy: PlayerId | null;
  /** Public except during a mutiny, when each player's contribution is hidden. */
  guns: number;
  /** Captain's résumés accumulate here (public). */
  resumes: number;
  /** false after jumping overboard / being fed to the Kraken. */
  alive: boolean;
  /** Off-duty sign: cannot be appointed lieutenant or navigator. */
  offDuty: boolean;
  /** True once examined by Cabin Search or Flogging — permanently unconvertible. */
  unconvertible: boolean;
  /** Public signal used in place of the tentacle gesture when searched as a Cultist. */
  declaredCult: boolean;
}

/* ============================= officers / ship ========================== */

export interface Officers {
  captain: PlayerId | null;
  lieutenant: PlayerId | null;
  navigator: PlayerId | null;
}

export interface Ship {
  spaceId: number;
  /** Set during a Denial of Command; cleared once a navigation succeeds. */
  emergency: boolean;
}

/* =============================== mutiny ================================= */

export type MutinyThreshold = 3 | 4 | 5;

export interface Mutiny {
  active: boolean;
  /** Guns each crew member (never the captain) fisted this round. */
  pledges: Record<PlayerId, number>;
  revealed: boolean;
  /** Pledged total >= threshold. */
  success: boolean;
  threshold: MutinyThreshold;
  newCaptain: PlayerId | null;
  /** Tie-break order: each element picks the next tied player to stand down. */
  tieOrder: PlayerId[];
}

/* ============================== navigation ============================== */

export interface Navigation {
  deck: NavCardId[];
  discard: NavCardId[];
  /** Captain's two drawn cards, before/after the lieutenant contributes. */
  captainCards: NavCardId[];
  lieutenantCards: NavCardId[];
  /** The two cards shuffled into the logbook (one from each), then one removed. */
  logbook: NavCardId[];
  /** The single card left in the logbook for the captain to reveal. */
  revealed: NavCardId | null;
  /** PlayerIds who have completed the current navigation step. */
  acted: PlayerId[];
  /** Which execution sub-steps of the revealed card have been applied. */
  applied: { move: boolean; mapAction: boolean; cardEffect: boolean; ritual: boolean };
}

/* =============================== phases ================================= */

/** The six-phase loop (rulebook p.9). */
export type PhaseId =
  | 'setup'
  | 'appointTeam'
  | 'loyalty'
  | 'navigation'
  | 'executeCard'
  | 'offDuty'
  | 'gameOver';

/** A sub-step within `executeCard` that is waiting on a specific player.
 *  Resolution order during a navigation: move (auto) → mapAction → cardEffect. */
export interface Pending {
  kind: 'mapAction' | 'cardEffect' | 'telescope' | 'mermaid' | 'ritual'
      | 'emergencyNav' | 'mutinyTie';
  by: PlayerId;
  data?: Record<string, unknown>;
}

/** A private fact one player has learned about another (Cabin Search, Flogging).
 *  SECRET to everyone but `viewer`. Stored centrally so `view.ts` can project
 *  exactly the viewer's own entries. */
export interface PrivateKnowledge {
  viewer: PlayerId;
  about: PlayerId;
  /** The team observed at the time of the search. */
  team: Faction;
  round: number;
}

/* ============================= public log =============================== */

export type LogEntry =
  | { t: 'round'; round: number; captain: PlayerId }
  | { t: 'officers'; lieutenant: PlayerId; navigator: PlayerId }
  | { t: 'mutiny'; total: number; success: boolean; newCaptain: PlayerId | null; pledges: Partial<Record<PlayerId, number>> }
  | { t: 'moved'; from: number; to: number; color: ArrowColor }
  | { t: 'card'; card: NavCardId; captain: PlayerId }
  | { t: 'ritual'; card: RitualCardId }
  | { t: 'ritualGuns'; grants: { to: PlayerId; guns: number }[] }
  | { t: 'mapAction'; kind: 'cabinSearch' | 'feedKraken'; actor: PlayerId; target: PlayerId }
  | { t: 'jump'; player: PlayerId }
  | { t: 'converted' }            // deliberately anonymous
  | { t: 'gameOver'; winner: Faction; reason: string };

/* ============================ top-level state =========================== */

export interface GameState {
  version: number;
  /** Deterministic RNG: (seed, ordered actions) fully determines a game. */
  seed: number;
  rngState: number;

  settings: GameSettings;
  mapId: 'short' | 'long';
  movement: MovementTable;
  /** Space metadata, needed to resolve map actions on arrival. */
  spaces: Record<number, Space>;

  phase: PhaseId;
  round: number;

  players: Record<PlayerId, Player>;
  /** Clockwise seat ring; index === Player.seat. Fixed for the whole game. */
  seatOrder: PlayerId[];
  /** The player allowed to force-advance a stuck phase (the room's host). */
  host: PlayerId;
  /** Players who have acknowledged their role card at game start. Until this
   *  set equals `seatOrder`, every non-`confirmRole` move is gated out. */
  confirmedRole: PlayerId[];
  /** Active seats whose client has completed its first socket sync (dispatched
   *  syncName at least once). A seat that joined the lobby but never showed up
   *  here is a GHOST: it holds a name in metadata, but no client will ever
   *  confirm its role card, so the start gate refuses to deal it in. */
  syncedSeats: PlayerId[];
  /** Host's explicit "开始游戏" gate. The waiting-room UI blocks the
   *  transition to role-reveal until this flips true, so the host can hold
   *  the start until everyone is actually at their keyboard. */
  hostStarted: boolean;

  ship: Ship;
  officers: Officers;
  navigation: Navigation;
  rituals: { deck: RitualCardId[]; revealed: RitualCardId[] };
  mutiny: Mutiny;
  /** Non-null while a phase is blocked waiting on a specific player. */
  pending: Pending | null;

  /** Map-action tokens consumed (in practice a space is never revisited). */
  consumed: number[];
  /** The general gun supply (40 guns total in the box). */
  gunSupply: number;

  log: LogEntry[];
  /** Private facts, one per (viewer, subject) search. Projected per viewer. */
  secrets: PrivateKnowledge[];
  winner: Faction | null;
  winReason: string | null;
  /** 最愚玩家 votes after game over: voter -> target. One vote each, final
   *  (no re-voting); tallied publicly once every active seat has voted. */
  funVotes: Record<PlayerId, PlayerId>;
}

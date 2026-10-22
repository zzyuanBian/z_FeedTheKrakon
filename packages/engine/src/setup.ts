/**
 * Initial game state. Deterministic given `seed` + `settings` + player names.
 *
 * Team dealing implements the rulebook's seat-order procedure (p.8): the
 * Captain card is set aside, the remaining team chips are shuffled, and the
 * holder of the Captain card becomes the first captain and receives a random
 * team. For the 5-player variable composition the host's choice is honoured
 * directly (no blind bag removal).
 */

import {
  GUN_SUPPLY_TOTAL, STARTING_GUNS, TEAM_COMPOSITIONS,
  type Faction, type FactionCounts, type GameSettings,
  type GameState, type Player, type PlayerId,
} from './state.js';
import { loadMap, type RawMap } from './map.js';
import { buildNavDeck, buildRitualDeck } from './decks.js';
import { makeRng, type Rng } from './rng.js';
import { mutinyThreshold } from './rules.js';

export interface NewGameOptions {
  seed: number;
  settings: GameSettings;
  /** Seat 0..N-1 in clockwise order. */
  names: string[];
  map: RawMap;
}

/* ------------------------- faction-count helpers ------------------------- */

/** Throw unless `fc` is a legal breakdown for `playerCount` seats: the two
 *  officer factions need >= 1 member each, cult may be 0, and the sum must
 *  fill every seat exactly. */
export function validateFactionCounts(fc: FactionCounts, playerCount: number): void {
  if (fc.sailor < 1) throw new Error(`factionCounts.sailor must be >= 1 (got ${fc.sailor})`);
  if (fc.pirate < 1) throw new Error(`factionCounts.pirate must be >= 1 (got ${fc.pirate})`);
  if (fc.cult < 0) throw new Error(`factionCounts.cult must be >= 0 (got ${fc.cult})`);
  if (fc.sailor + fc.pirate + fc.cult !== playerCount) {
    throw new Error(
      `factionCounts ${fc.sailor}+${fc.pirate}+${fc.cult} != playerCount ${playerCount}`,
    );
  }
}

/** The breakdown a game will actually use: the host override when present,
 *  otherwise the rulebook table (with the 5-player two-pirates variant). */
export function effectiveFactionCounts(settings: GameSettings): FactionCounts {
  if (settings.factionCounts) return { ...settings.factionCounts };
  const comp = TEAM_COMPOSITIONS.find((c) => c.players === settings.playerCount);
  if (!comp) throw new Error(`no rulebook composition for ${settings.playerCount} players`);
  const two = settings.fivePlayerTwoPirates && settings.playerCount === 5;
  return {
    sailor: two ? comp.sailor - 1 : comp.sailor,
    pirate: two ? comp.pirate + 1 : comp.pirate,
    cult: comp.cult,
  };
}

/** Rescale a breakdown for a smaller player count: keep the cult, split the
 *  rest roughly 60/40 sailor/pirate. Engine-side mirror of the waiting room's
 *  `scaleCounts` — used when a ghost cleanup shrinks the crew and the old
 *  breakdown no longer sums to the ring. */
export function rescaleCounts(fc: FactionCounts, count: number): FactionCounts {
  const cult = Math.min(fc.cult, Math.max(0, count - 2));
  const rest = Math.max(2, count - cult);
  const pirate = Math.max(1, Math.floor(rest * 0.4));
  return { sailor: rest - pirate, pirate, cult };
}

/** Deal one team to each seat using the rulebook's captain-card procedure
 *  (p.8): draw the captain index, shuffle the chips, set the captain's chip
 *  aside, then deal the rest in seat order. Returns the per-seat teams plus
 *  the index of the seat holding the Captain card (the first captain).
 *
 *  The draw order (int → shuffle → pick) is part of the engine's determinism
 *  contract — do not reorder. */
export function dealTeams(
  rng: Rng, playerCount: number, counts: FactionCounts,
): { teams: Faction[]; captainIndex: number } {
  const chips: Faction[] = [];
  for (let i = 0; i < counts.sailor; i++) chips.push('sailor');
  for (let i = 0; i < counts.pirate; i++) chips.push('pirate');
  for (let i = 0; i < counts.cult; i++) chips.push('cult');
  if (chips.length !== playerCount) {
    throw new Error(`dealTeams: ${chips.length} chips for ${playerCount} players`);
  }
  const captainIndex = rng.int(playerCount);
  const shuffled = rng.shuffle(chips);
  const captainChip = rng.pick(shuffled);
  // The captain takes one chip out; the rest are dealt to the other seats.
  const remaining = [...shuffled];
  remaining.splice(remaining.indexOf(captainChip), 1);
  let chipPos = 0;
  const teams = Array.from({ length: playerCount }, (_, seat) =>
    seat === captainIndex ? captainChip : remaining[chipPos++]!);
  return { teams, captainIndex };
}

/** Stamp a fresh deal onto an existing pre-game roster: rewrite each seat's
 *  secret team, reset conversion/declaration marks, re-flag the Cult Leader,
 *  and hand the Captain card to the new captain. Only legal while the game
 *  is still sealed (no role card has been projected) — callers assert that. */
export function applyDeal(s: GameState, teams: Faction[], captainIndex: number): void {
  s.seatOrder.forEach((id, seat) => {
    if (seat >= s.settings.playerCount) return; // inert bench seat — no chip
    const p = s.players[id]!;
    p.team = teams[seat]!;
    p.cultLeader = false;
    p.convertedAt = null;
    p.convertedBy = null;
    p.declaredCult = false;
  });
  // Designate one Cult player as the Cult Leader.
  const cultPlayers = s.seatOrder.filter((id) => s.players[id]!.team === 'cult');
  if (cultPlayers.length > 0) s.players[cultPlayers[0]!]!.cultLeader = true;
  const firstCaptain = s.seatOrder[captainIndex]!;
  s.officers.captain = firstCaptain;
  s.log = s.log.length > 0
    ? [{ t: 'round', round: s.round, captain: firstCaptain }]
    : s.log;
}

export function createGame(opts: NewGameOptions): GameState {
  const { seed, settings, names, map } = opts;
  if (names.length !== settings.playerCount) {
    throw new Error(`createGame: ${names.length} names for ${settings.playerCount} players`);
  }
  const comp = TEAM_COMPOSITIONS.find((c) => c.players === settings.playerCount);
  if (!comp && !settings.factionCounts) {
    throw new Error(`unsupported player count ${settings.playerCount}`);
  }

  const rng = makeRng(seed);
  const { def, movement } = loadMap(map);

  // --- team chips ---
  // Custom factionCounts (host override) takes precedence over the rulebook
  // table + fivePlayerTwoPirates variant. Validation catches bogus input
  // before we allocate anything.
  const counts = effectiveFactionCounts(settings);
  validateFactionCounts(counts, settings.playerCount);

  // --- captain card procedure (p.8) ---
  const { teams, captainIndex } = dealTeams(rng, settings.playerCount, counts);

  // Rooms are built at full capacity (`settings.seats`, defaulting to
  // playerCount): the first playerCount seats are the dealt crew, the rest
  // are inert placeholders. Dead seats flow through every living-player
  // filter (appointments, mutiny, targets, clockwise walks, victory) without
  // any special-casing — that is the whole trick.
  const seats = settings.seats ?? settings.playerCount;
  const seatOrder: PlayerId[] = [];
  const players: Record<PlayerId, Player> = {};
  for (let seat = 0; seat < seats; seat++) {
    const id = `p${seat + 1}`;
    seatOrder.push(id);
    const active = seat < settings.playerCount;
    players[id] = {
      id,
      seat,
      name: active ? names[seat]! : '',
      avatar: -1,
      team: active ? teams[seat]! : 'sailor',
      cultLeader: false,
      convertedAt: null,
      convertedBy: null,
      guns: active ? STARTING_GUNS : 0,
      resumes: 0,
      alive: active,
      offDuty: false,
      unconvertible: false,
      declaredCult: false,
    };
  }
  // Designate one Cult player as the Cult Leader.
  const cultPlayers = seatOrder.filter((id) => players[id]!.team === 'cult');
  if (cultPlayers.length > 0) players[cultPlayers[0]!]!.cultLeader = true;

  const firstCaptain = seatOrder[captainIndex]!;
  const startSpace = def.spaces.find((s) => s.kind === 'start');
  if (!startSpace) throw new Error('createGame: map has no start space');

  const state: GameState = {
    version: 1,
    seed,
    rngState: 0,
    settings,
    mapId: def.id,
    movement,
    spaces: Object.fromEntries(def.spaces.map((s) => [s.id, s])),
    phase: 'appointTeam',
    round: 1,
    players,
    seatOrder,
    host: seatOrder[0]!,
    confirmedRole: [],
    syncedSeats: [],
    hostStarted: false,
    ship: { spaceId: startSpace.id, emergency: false },
    officers: { captain: firstCaptain, lieutenant: null, navigator: null },
    navigation: {
      deck: buildNavDeck(def.id, rng),
      discard: [],
      captainCards: [],
      lieutenantCards: [],
      logbook: [],
      revealed: null,
      acted: [],
      applied: { move: false, mapAction: false, cardEffect: false, ritual: false },
    },
    rituals: { deck: buildRitualDeck(rng), revealed: [] },
    mutiny: {
      active: false,
      pledges: {},
      revealed: false,
      success: false,
      threshold: mutinyThreshold(settings.playerCount),
      newCaptain: null,
      tieOrder: [],
    },
    consumed: [],
    gunSupply: GUN_SUPPLY_TOTAL - STARTING_GUNS * settings.playerCount,
    pending: null,
    log: [{ t: 'round', round: 1, captain: firstCaptain }],
    secrets: [],
    winner: null,
    winReason: null,
    funVotes: {},
  };
  state.rngState = rng.state();
  return state;
}

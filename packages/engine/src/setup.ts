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
  STARTING_GUNS, TEAM_COMPOSITIONS, type Faction, type GameSettings, type GameState,
  type Player, type PlayerId,
} from './state.js';
import { loadMap, type RawMap } from './map.js';
import { buildNavDeck, buildRitualDeck } from './decks.js';
import { makeRng } from './rng.js';
import { mutinyThreshold } from './rules.js';

export interface NewGameOptions {
  seed: number;
  settings: GameSettings;
  /** Seat 0..N-1 in clockwise order. */
  names: string[];
  map: RawMap;
}

export function createGame(opts: NewGameOptions): GameState {
  const { seed, settings, names, map } = opts;
  if (names.length !== settings.playerCount) {
    throw new Error(`createGame: ${names.length} names for ${settings.playerCount} players`);
  }
  const comp = TEAM_COMPOSITIONS.find((c) => c.players === settings.playerCount);
  if (!comp) throw new Error(`unsupported player count ${settings.playerCount}`);

  const rng = makeRng(seed);
  const { def, movement } = loadMap(map);

  // --- team chips ---
  const chips: Faction[] = [];
  const sailorCount = settings.fivePlayerTwoPirates && settings.playerCount === 5
    ? comp.sailor - 1
    : comp.sailor;
  const pirateCount = settings.fivePlayerTwoPirates && settings.playerCount === 5
    ? comp.pirate + 1
    : comp.pirate;
  for (let i = 0; i < sailorCount; i++) chips.push('sailor');
  for (let i = 0; i < pirateCount; i++) chips.push('pirate');
  for (let i = 0; i < comp.cult; i++) chips.push('cult');
  if (chips.length !== settings.playerCount) {
    throw new Error(`chip count ${chips.length} != ${settings.playerCount}`);
  }

  // --- captain card procedure (p.8) ---
  const captainIndex = rng.int(settings.playerCount);
  const shuffledChips = rng.shuffle(chips);
  const captainChip = rng.pick(shuffledChips);
  // The captain takes one chip out; the rest are dealt to the other seats.
  const remaining = [...shuffledChips];
  remaining.splice(remaining.indexOf(captainChip), 1);
  let chipPos = 0;

  const seatOrder: PlayerId[] = [];
  const players: Record<PlayerId, Player> = {};
  for (let seat = 0; seat < settings.playerCount; seat++) {
    const id = `p${seat + 1}`;
    seatOrder.push(id);
    const team: Faction = seat === captainIndex ? captainChip : remaining[chipPos++]!;
    players[id] = {
      id,
      seat,
      name: names[seat]!,
      team,
      cultLeader: false,
      convertedAt: null,
      guns: STARTING_GUNS,
      resumes: 0,
      alive: true,
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
    gunSupply: 40 - STARTING_GUNS * settings.playerCount,
    pending: null,
    log: [{ t: 'round', round: 1, captain: firstCaptain }],
    secrets: [],
    winner: null,
    winReason: null,
  };
  state.rngState = rng.state();
  return state;
}

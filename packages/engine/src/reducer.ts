/**
 * The reducer: the single source of truth for game rules.
 *
 *   reduce(state, action) -> newState
 *
 * Pure and immutable: `state` is deep-cloned first, never mutated. Randomness
 * comes from `makeRng(state.rngState)` and is written back, so a game is
 * reproducible from (seed, ordered actions). boardgame.io never touches this
 * directly — @ftk/game wraps it.
 *
 * Rules source: doc/ruleset_notes.md. The six-phase loop (p.9):
 *   appointTeam → loyalty → navigation → executeCard → offDuty → (next round)
 */

import type { Action } from './actions.js';
import {
  GUN_SUPPLY_TOTAL, navCard, STARTING_GUNS,
  type GameState, type NavCardId, type PlayerId, type RitualCardId,
} from './state.js';
import {
  activeSeatIds, checkVictory, eligibleOfficers, endGame, grantGuns, livingPlayers, moveShip,
  takeGuns, walkClockwise,
} from './helpers.js';
import { makeRng, type Rng } from './rng.js';
import { mutinyThreshold, offDutyRoles } from './rules.js';
import { applyDeal, dealTeams, rescaleCounts, validateFactionCounts } from './setup.js';

/* ------------------------------ utilities ------------------------------- */

/** Deep clone. The state is pure JSON data, so a structural copy is exact. */
function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`illegal move: ${msg}`);
}

/** Run `fn` with a seeded Rng, then persist the advanced state back. */
function withRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const rng = makeRng(s.rngState);
  const out = fn(rng);
  s.rngState = rng.state();
  return out;
}

/** Draw `n` cards, reshuffling the discard back in when the deck runs low. */
function draw(s: GameState, n: number): NavCardId[] {
  const out: NavCardId[] = [];
  for (let i = 0; i < n; i++) {
    if (s.navigation.deck.length === 0) {
      s.navigation.deck = withRng(s, (rng) => rng.shuffle(s.navigation.discard));
      s.navigation.discard = [];
    }
    const card = s.navigation.deck.shift();
    if (card === undefined) throw new Error('draw: deck and discard are both empty');
    out.push(card);
  }
  return out;
}

function discardCard(s: GameState, card: NavCardId): void {
  s.navigation.discard.push(card);
}

/* ------------------------------- entry ---------------------------------- */

export function reduce(prev: GameState, action: Action): GameState {
  // After game over the only legal moves are the fun vote and the host's
  // escape hatch — everything else would mutate a finished game.
  if (prev.phase === 'gameOver' && action.type !== 'forceAdvance' && action.type !== 'funVote') {
    return prev;
  }
  const s = clone(prev);
  handle(s, action);
  return s;
}

function handle(s: GameState, a: Action): void {
  switch (a.type) {
    case 'confirmRole':       return confirmRole(s, a);
    case 'hostStartGame':     return hostStartGame(s, a);
    case 'syncName':          return syncName(s, a);
    case 'syncAvatar':        return syncAvatar(s, a);
    case 'setFactionConfig':  return setFactionConfig(s, a);
    case 'clearSeat':         return clearSeat(s, a);
    case 'appointTeam':     return appointTeam(s, a);
    case 'mutinyPledge':    return mutinyPledge(s, a);
    case 'mutinyTieBreak':  return mutinyTieBreak(s, a);
    case 'navContribute':   return navContribute(s, a);
    case 'navLogbook':      return navLogbook(s, a);
    case 'denialOfCommand': return denialOfCommand(s, a);
    case 'emergencyNav':    return emergencyNav(s, a);
    case 'telescopeChoose': return telescopeChoose(s, a);
    case 'telescopeDecide': return telescopeDecide(s, a);
    case 'mermaidChoose':   return mermaidChoose(s, a);
    case 'mermaidAck':      return mermaidAck(s, a);
    case 'mapActionCabinSearch': return mapActionCabinSearch(s, a);
    case 'mapActionFeedKraken':  return mapActionFeedKraken(s, a);
    case 'mapActionRevealAck':   return mapActionRevealAck(s, a);
    case 'ritualPick':      return ritualPick(s, a);
    case 'ritualConversion':return ritualConversion(s, a);
    case 'ritualGunsStash': return ritualGunsStash(s, a);
    case 'ritualAck':       return ritualAck(s, a);
    case 'forceAdvance':    return forceAdvance(s, a);
    case 'funVote':         return funVote(s, a);
  }
}

/* ======================== pre-game: role reveal ========================= */

/** Idempotent, phase-agnostic: just record that `actor` has acknowledged
 *  their role card. The "block other moves until everyone confirms" gate
 *  lives in @ftk/game's move filter, not here, so the reducer stays a
 *  pure record of facts. */
function confirmRole(s: GameState, a: Extract<Action, { type: 'confirmRole' }>): void {
  assert(s.players[a.actor], `unknown player ${a.actor}`);
  // Bench seats (beyond the target crew size) have no role card to confirm.
  // They may sit in the room and wait; if the host raises the count they
  // become active and confirm then.
  assert(seatIndex(a.actor) < s.settings.playerCount, 'bench seats have no role to confirm');
  if (!s.confirmedRole.includes(a.actor)) {
    s.confirmedRole.push(a.actor);
  }
}

/** Seat number ('p3' -> 2). Player ids are p<seat+1> by construction. */
function seatIndex(id: PlayerId): number {
  return Number(id.slice(1)) - 1;
}

/** Only the room host may flip the "开始游戏" switch. Idempotent: repeated
 *  clicks are no-ops, which keeps the move safe to retry on a laggy link. */
function hostStartGame(s: GameState, a: Extract<Action, { type: 'hostStartGame' }>): void {
  assert(a.actor === s.host, `only the host (${s.host}) may start; got ${a.actor}`);
  // Every active seat must have a LIVE client behind it (synced at least
  // once). A seat that joined the lobby but never synced is a ghost: no
  // client will ever confirm its role card and the whole table would
  // deadlock at "X / N 已确认". The host clears ghosts with clearSeat.
  const ghosts = activeSeatIds(s).filter((id) => !s.syncedSeats.includes(id));
  assert(
    ghosts.length === 0,
    `ghost seat(s) ${ghosts.join(', ')} never synced; clear them first`,
  );
  // ...and every active seat must still claim a name (a leaver's syncName('')
  // vacates it; the seat must be re-claimed or the count lowered).
  const unnamed = activeSeatIds(s).filter((id) => !s.players[id]!.name.trim());
  assert(
    unnamed.length === 0,
    `active seat(s) ${unnamed.join(', ')} have not claimed a name yet`,
  );
  s.hostStarted = true;
}

/** Copy a seat's lobby-side display name into GameState. bgio's joinMatch
 *  updates match metadata (what GET /games returns) but NOT the GameState
 *  the reducer owns — so without this bridge, the live-view roster would
 *  show the setup-time placeholder ("Player 1") forever. */
function syncName(s: GameState, a: Extract<Action, { type: 'syncName' }>): void {
  const p = s.players[a.actor];
  assert(p, `syncName: unknown actor ${a.actor}`);
  p.name = a.name;
  // First sync marks the seat as really present (a live client is listening).
  // Vacating via syncName('') keeps the flag — the seat WAS synced; it is the
  // name that left. Ghost detection keys off syncedSeats, not the name.
  if (!s.syncedSeats.includes(a.actor)) s.syncedSeats.push(a.actor);
}

/** Publish a seat's avatar id (mirrors syncName; see its note). Idempotent —
 *  re-sending the same id (e.g. on reconnect re-sync) is a no-op. */
function syncAvatar(s: GameState, a: Extract<Action, { type: 'syncAvatar' }>): void {
  const p = s.players[a.actor];
  assert(p, `syncAvatar: unknown actor ${a.actor}`);
  p.avatar = a.avatarId;
}

/** Pre-game only: the host re-seals the faction breakdown and every team is
 *  re-dealt from scratch (captain card included — it is part of the same
 *  deal). Legal precisely because no secret has ever been projected: not
 *  hostStarted and nobody has confirmed a role, so reshuffling identities
 *  leaks nothing. Seats and names are untouched; only the chips move.
 *
 *  `nextCount` retunes the target crew size in the same breath (Avalon-style
 *  lobby: the room never rebuilds, the host just redraws how many seats
 *  play). Growing activates previously-bench seats; shrinking benches the
 *  tail seats. Everything that scales with crew size (mutiny threshold, gun
 *  supply) is re-stamped here. */
function setFactionConfig(s: GameState, a: Extract<Action, { type: 'setFactionConfig' }>): void {
  assert(a.actor === s.host, `only the host (${s.host}) may change the config; got ${a.actor}`);
  assert(!s.hostStarted, 'the config is sealed once the game has started');
  assert(s.confirmedRole.length === 0, 'the config is sealed once roles are revealed');
  const nextCount = a.nextCount ?? s.settings.playerCount;
  // The engine's supported range mirrors the rulebook table (5..11).
  assert(nextCount >= 5 && nextCount <= 11, `player count ${nextCount} out of range (5..11)`);
  assert(nextCount <= s.seatOrder.length, `player count ${nextCount} exceeds the room's seats`);
  validateFactionCounts(a.factionCounts, nextCount);
  s.settings.playerCount = nextCount;
  s.settings.factionCounts = { ...a.factionCounts };
  const { teams, captainIndex } = withRng(s, (rng) =>
    dealTeams(rng, nextCount, a.factionCounts));
  applyDeal(s, teams, captainIndex);
  // Re-stamp everything that scales with the crew size. Growing the count
  // activates (revives) former bench seats; shrinking deactivates the tail.
  // Safe to write `alive` directly: the asserts above pin this to the strict
  // pre-game window, where nobody has died yet.
  for (const id of s.seatOrder) {
    const p = s.players[id]!;
    const active = seatIndex(id) < nextCount;
    p.alive = active;
    p.guns = active ? STARTING_GUNS : 0;
  }
  s.gunSupply = GUN_SUPPLY_TOTAL - STARTING_GUNS * nextCount;
  s.mutiny.threshold = mutinyThreshold(nextCount);
}

/** Pre-game: the host clears a GHOST seat — one whose client never synced, or
 *  which was vacated by a leaver's syncName(''). "Clearing" means removing it
 *  from the game entirely: the target crew size shrinks to drop the seat (and
 *  any other vacancies after it) from the active ring. This is the manual
 *  escape hatch for exactly the deadlock the start gate guards against: a
 *  seat no client will ever confirm. Host-only, strictly pre-game, same
 *  window as setFactionConfig.
 *
 *  Requires the ghost to be a TAIL vacancy: every active seat after it must
 *  also be unclaimed. Otherwise the host lowers the count with the stepper
 *  (a mid-ring shrink is a deliberate config act, not a cleanup). The
 *  breakdown is rescaled for the new size; teams are NOT re-dealt here —
 *  only the ring length changes, and the next deal (start/re-config) uses
 *  the shrunk ring. */
function clearSeat(s: GameState, a: Extract<Action, { type: 'clearSeat' }>): void {
  assert(a.actor === s.host, `only the host (${s.host}) may clear a seat`);
  assert(!s.hostStarted, 'seats cannot be cleared once the game has started');
  assert(s.confirmedRole.length === 0, 'seats cannot be cleared once roles are revealed');
  const p = s.players[a.target];
  assert(p, `clearSeat: unknown player ${a.target}`);
  assert(p.seat < s.settings.playerCount, 'clearSeat: seat is not in the active ring');
  // The ghost must be unclaimed: an occupied seat is someone's body — the
  // host has no business clearing it (and the crew size stepper is the tool
  // for asking a real player to leave).
  const claimed = s.players[a.target]!.name.trim() !== '' && s.syncedSeats.includes(a.target);
  assert(!claimed, 'clearSeat: seat is claimed by a live player');
  // Tail-vacancy requirement: every seat after the target must already be
  // unclaimed, so shrinking to the target's index strands nobody.
  const targetIdx = seatIndex(a.target);
  const after = s.seatOrder
    .slice(targetIdx + 1, s.settings.playerCount)
    .filter((id) => {
      const q = s.players[id]!;
      return q.name.trim() !== '' || s.syncedSeats.includes(id);
    });
  assert(after.length === 0, 'clearSeat: real players are seated after this ghost');
  // Shrink: the target and every vacancy after it leave the active ring. The
  // 5-player floor holds — a full table of ghosts is cleared one click at a
  // time down to the minimum, never below it.
  const nextCount = Math.max(5, targetIdx);
  assert(nextCount < s.settings.playerCount, 'clearSeat: shrink would strand claimed seats');
  s.settings.playerCount = nextCount;
  s.settings.factionCounts = rescaleCounts(
    s.settings.factionCounts ?? { sailor: 3, pirate: 2, cult: 1 },
    nextCount,
  );
  // Re-deal teams for the new ring (pre-game: nothing has been projected, so
  // reshuffling leaks nothing — the same licence setFactionConfig uses).
  const { teams, captainIndex } = withRng(s, (rng) =>
    dealTeams(rng, nextCount, s.settings.factionCounts!));
  applyDeal(s, teams, captainIndex);
  // Deactivate the vacated tail seats (the same stamping setFactionConfig
  // does): dead, no guns, no name — they are inert placeholders again.
  for (const id of s.seatOrder) {
    const q = s.players[id]!;
    const active = seatIndex(id) < nextCount;
    q.alive = active;
    q.guns = active ? STARTING_GUNS : 0;
    if (!active) {
      q.name = '';
      q.avatar = -1;
    }
  }
  s.gunSupply = GUN_SUPPLY_TOTAL - STARTING_GUNS * nextCount;
  s.mutiny.threshold = mutinyThreshold(nextCount);
}

/* ============================ phase 1: appoint ========================== */

function appointTeam(s: GameState, a: Extract<Action, { type: 'appointTeam' }>): void {
  assert(s.phase === 'appointTeam', 'not in appointTeam');
  assert(a.actor === s.officers.captain, 'only the captain appoints the team');
  assert(a.lieutenant !== a.actor && a.navigator !== a.actor, 'the captain cannot appoint himself');
  // p.12: below three living players an OPEN position is resolved randomly —
  // fate fills only what nobody can. A seat may be null ONLY when no
  // eligible candidate exists for it; while a candidate remains, the captain
  // must appoint them (fate is not a free pick).
  const eligible = new Set(eligibleOfficers(s));
  const candidatesLeft = (): Set<PlayerId> => {
    const left = new Set(eligible);
    if (a.lieutenant !== null) left.delete(a.lieutenant);
    if (a.navigator !== null) left.delete(a.navigator);
    return left;
  };
  if (a.lieutenant === null) {
    assert(candidatesLeft().size === 0, 'an eligible player remains — the lieutenant must be appointed');
  } else {
    assert(a.lieutenant !== a.navigator, 'lieutenant and navigator must differ');
    assert(eligible.has(a.lieutenant), 'lieutenant must be alive and on duty');
  }
  if (a.navigator === null) {
    assert(candidatesLeft().size === 0, 'an eligible player remains — the navigator must be appointed');
  } else {
    assert(a.navigator !== a.lieutenant, 'lieutenant and navigator must differ');
    assert(eligible.has(a.navigator), 'navigator must be alive and on duty');
  }

  s.officers.lieutenant = a.lieutenant;
  s.officers.navigator = a.navigator;
  s.log.push({ t: 'officers', lieutenant: a.lieutenant, navigator: a.navigator });

  // Phase 2: any crew member may mutiny (action 'mutinyPledge') or stand down
  // by pledging zero guns. Once every living seat has pledged, resolveMutiny
  // advances the phase.
  s.phase = 'loyalty';
  s.mutiny = {
    active: true, pledges: {}, revealed: false, success: false,
    threshold: mutinyThreshold(s.settings.playerCount), newCaptain: null, tieOrder: [],
  };
}

/* ============================ phase 2: mutiny =========================== */

function mutinyPledge(s: GameState, a: Extract<Action, { type: 'mutinyPledge' }>): void {
  assert(s.phase === 'loyalty' && s.mutiny.active, 'no mutiny in progress');
  assert(a.actor !== s.officers.captain, 'the captain does not pledge');
  assert(s.players[a.actor]!.alive, 'eliminated players do not pledge');
  assert(Number.isInteger(a.guns) && a.guns >= 0, 'bad gun count');
  assert(a.guns <= s.players[a.actor]!.guns, 'cannot pledge more guns than you have');
  assert(!(a.actor in s.mutiny.pledges), 'you already pledged');

  s.mutiny.pledges[a.actor] = a.guns;
  // Once every crew member has pledged, the fists open and the mutiny resolves.
  resolveMutiny(s);
}

/** All crew members (everyone but the captain) have pledged. */
function allPledged(s: GameState): boolean {
  return livingPlayers(s).every((id) => id === s.officers.captain || id in s.mutiny.pledges);
}

/** Resolve the mutiny once everyone has pledged. Returns true if it advanced. */
function resolveMutiny(s: GameState): boolean {
  if (!allPledged(s)) return false;
  const total = Object.values(s.mutiny.pledges).reduce((n, g) => n + g, 0);
  s.mutiny.revealed = true;
  const success = total >= s.mutiny.threshold;
  s.mutiny.success = success;

  if (!success) {
    // Failed: nobody loses guns; proceed to navigation with the team as appointed.
    s.log.push({ t: 'mutiny', total, success: false, newCaptain: null, pledges: { ...s.mutiny.pledges } });
    s.mutiny.active = false;
    beginNavigation(s);
    return true;
  }

  // Successful: every implied gun is discarded, then the top revealer wins.
  const max = Math.max(...Object.values(s.mutiny.pledges));
  const tied = s.seatOrder.filter((id) => s.mutiny.pledges[id] === max && max > 0);
  const leader = tied.find((id) => s.players[id]!.alive) ?? null;

  // Discard every revealed gun (all who showed >= 1).
  for (const id of livingPlayers(s)) {
    const g = s.mutiny.pledges[id] ?? 0;
    if (g > 0) takeGuns(s, id, g);
  }

  // "Off with the Tongue" cannot become captain — treated as 0 guns (Long map only).
  const eligibleWinners = tied.filter((id) => s.players[id]!.alive);

  if (eligibleWinners.length <= 1) {
    const newCaptain = eligibleWinners[0] ?? leader ?? s.officers.captain!;
    finishMutiny(s, total, newCaptain);
    return true;
  }
  // Tie: the outgoing captain picks who stands down, then that player picks, etc.
  s.mutiny.tieOrder = [];
  s.pending = { kind: 'mutinyTie', by: s.officers.captain!, data: { remaining: eligibleWinners } };
  return true;
}

function mutinyTieBreak(s: GameState, a: Extract<Action, { type: 'mutinyTieBreak' }>): void {
  assert(s.pending?.kind === 'mutinyTie', 'no tie to break');
  assert(a.actor === s.pending.by, 'not your turn to pick');
  const remaining = (s.pending.data!.remaining as PlayerId[]).filter((id) => id !== a.standDown);
  assert(remaining.length === (s.pending.data!.remaining as PlayerId[]).length - 1, 'pick a tied winner');
  s.mutiny.tieOrder.push(a.standDown);
  if (remaining.length <= 1) {
    const total = Object.values(s.mutiny.pledges).reduce((n, g) => n + g, 0);
    finishMutiny(s, total, remaining[0]!);
  } else {
    s.pending = { kind: 'mutinyTie', by: a.standDown, data: { remaining } };
  }
}

function finishMutiny(s: GameState, total: number, newCaptain: PlayerId): void {
  s.mutiny.newCaptain = newCaptain;
  s.mutiny.active = false;
  s.pending = null;
  s.log.push({ t: 'mutiny', total, success: true, newCaptain, pledges: { ...s.mutiny.pledges } });
  // New captain starts a fresh round (off-duty signs do NOT move on a mutiny).
  s.officers = { captain: newCaptain, lieutenant: null, navigator: null };
  s.round += 1;
  resetNavigation(s);
  s.phase = 'appointTeam';
  s.log.push({ t: 'round', round: s.round, captain: newCaptain });
}

/* ========================== phase 3: navigation ========================= */

function resetNavigation(s: GameState): void {
  s.navigation.captainCards = [];
  s.navigation.lieutenantCards = [];
  s.navigation.logbook = [];
  s.navigation.revealed = null;
  s.navigation.acted = [];
  s.navigation.applied = { move: false, mapAction: false, cardEffect: false, ritual: false };
}

/** Enter the navigation phase: the captain and lieutenant each draw two
 *  cards. A fate-seated round (officer is null, p.12) skips that draw —
 *  the contribution step fills the gap with the fate draw instead. */
function beginNavigation(s: GameState): void {
  resetNavigation(s);
  // Shuffle the draw+discard back only when fewer than 4 cards remain (p.11).
  const need = (s.officers.lieutenant !== null ? 2 : 0) + 2;
  if (s.navigation.deck.length < need) {
    s.navigation.deck = withRng(s, (rng) =>
      rng.shuffle([...s.navigation.deck, ...s.navigation.discard]));
    s.navigation.discard = [];
  }
  s.navigation.captainCards = draw(s, 2);
  s.navigation.lieutenantCards = s.officers.lieutenant !== null ? draw(s, 2) : [];
  s.phase = 'navigation';
}

function orderedTeam(s: GameState): PlayerId[] {
  const { captain, lieutenant } = s.officers;
  return [captain, lieutenant].filter((x): x is PlayerId => x !== null);
}

/** Officers still owing a contribution (captain + lieutenant pick at the
 *  same time — the logbook step opens only after both are in). */
function nextContributor(s: GameState): PlayerId | null {
  return orderedTeam(s).find((id) => !s.navigation.acted.includes(id)) ?? null;
}

function navContribute(s: GameState, a: Extract<Action, { type: 'navContribute' }>): void {
  assert(s.phase === 'navigation', 'not navigating');
  // Captain and lieutenant pick simultaneously — either may go first, and
  // neither waits on the other. Only the logbook step is strictly after both.
  assert(
    (a.actor === s.officers.captain || a.actor === s.officers.lieutenant) &&
      !s.navigation.acted.includes(a.actor),
    'not your turn to contribute',
  );
  const hand = a.actor === s.officers.captain ? s.navigation.captainCards : s.navigation.lieutenantCards;
  // Cards are identified by value, and the deck holds real duplicates (two
  // copies of the same navigation card). Keeping and discarding the same *type*
  // is legal when the hand holds two copies — the two physical cards are
  // interchangeable, so only the copies actually available matter.
  const copies = (card: NavCardId): number => hand.filter((c) => c === card).length;
  assert(
    a.keep === a.discard ? copies(a.keep) >= 2 : copies(a.keep) >= 1 && copies(a.discard) >= 1,
    'card not in your hand',
  );

  discardCard(s, a.discard);
  hand.splice(hand.indexOf(a.keep), 1);
  hand.splice(hand.indexOf(a.discard), 1);
  s.navigation.logbook.push(a.keep);
  s.navigation.acted.push(a.actor);

  // p.12: with no lieutenant aboard, fate replaces their decision — the
  // captain draws two face down, shuffles, one into the logbook (hidden),
  // one discarded face up. The discard is public: it lands on the discard
  // pile and the log announces which card hit the deep.
  if (
    s.navigation.logbook.length === 1 &&
    s.officers.lieutenant === null &&
    s.navigation.acted.includes(s.officers.captain!)
  ) {
    const { kept, discarded } = withRng(s, (rng) => {
      const two = draw(s, 2);
      const shuffled = rng.shuffle(two);
      return { kept: shuffled[0]!, discarded: shuffled[1]! };
    });
    s.navigation.logbook.push(kept);
    discardCard(s, discarded);
    s.log.push({ t: 'randomDraw', card: discarded });
  }

  if (s.navigation.logbook.length === 2) {
    // logbook is shuffled; the navigator (next in order) then discards one.
    s.navigation.logbook = makeRng(s.rngState).shuffle(s.navigation.logbook);
    // p.12: nobody left to resolve the logbook — fate settles the course
    // at once (synchronous, so no seat ever waits on a phantom navigator).
    if (s.officers.navigator === null) fateSettle(s);
  }
}

function navLogbook(s: GameState, a: Extract<Action, { type: 'navLogbook' }>): void {
  assert(s.phase === 'navigation', 'not navigating');
  assert(s.navigation.logbook.length === 2, 'logbook not ready');
  assert(a.actor === s.officers.navigator, 'only the navigator resolves the logbook');
  assert(s.navigation.logbook.includes(a.discard), 'card not in the logbook');

  discardCard(s, a.discard);
  s.navigation.logbook.splice(s.navigation.logbook.indexOf(a.discard), 1);
  s.navigation.revealed = s.navigation.logbook[0]!;
  // The discard settles the course — flip and apply the card immediately.
  // The captain's separate reveal step was pure ceremony (the settled card
  // was already public in the view) and only added a dead click.
  executeRevealed(s);
}

/** p.12: no navigator aboard — fate settles the course. Both cards are
 *  shuffled and one is discarded face up (public), the other executes. */
function fateSettle(s: GameState): void {
  assert(s.phase === 'navigation', 'not navigating');
  assert(s.navigation.logbook.length === 2, 'logbook not ready');
  assert(s.officers.navigator === null, 'a navigator is aboard');
  const { discarded, kept } = withRng(s, (rng) => {
    const shuffled = rng.shuffle(s.navigation.logbook);
    return { discarded: shuffled[0]!, kept: shuffled[1]! };
  });
  s.navigation.logbook = [kept];
  discardCard(s, discarded);
  s.log.push({ t: 'randomSettle', discarded, kept });
  s.navigation.revealed = kept;
  executeRevealed(s);
}

/** Apply the settled course card: résumé to the captain, move the ship, then
 *  the destination's map action / the card's own effect. */
function executeRevealed(s: GameState): void {
  assert(s.phase === 'navigation', 'not navigating');
  const card = s.navigation.revealed;
  assert(card !== null, 'no card to reveal');

  // The revealed card becomes the captain's résumé (public, permanent).
  s.players[s.officers.captain!]!.resumes += 1;
  s.log.push({ t: 'card', card, captain: s.officers.captain! });
  s.phase = 'executeCard';
  s.pending = null;

  // I. Move the ship.
  const color = navCard(card).color;
  moveShip(s, color);
  s.navigation.applied.move = true;
  if (checkVictory(s)) return;

  // II. Map action on the destination space, then III. card effect.
  afterMove(s, card);
}

/** Sequence II and III after the move, honouring the pending queue. */
function afterMove(s: GameState, card: NavCardId): void {
  const space = s.spaces[s.ship.spaceId]!;
  const needsMapAction = space.icon === 'octopus' || space.icon === 'magnify';
  if (needsMapAction && !s.navigation.applied.mapAction) {
    s.pending = { kind: 'mapAction', by: s.officers.captain!, data: { icon: space.icon, space: s.ship.spaceId } };
    return;
  }
  startCardEffect(s, card);
}

function startCardEffect(s: GameState, card: NavCardId): void {
  const eff = navCard(card).effect;
  s.navigation.applied.cardEffect = true;
  switch (eff) {
    case 'cultUprising':
      // Ritual is revealed at the end of the navigation.
      s.navigation.applied.ritual = false;
      revealRitual(s);
      return;
    case 'telescope':
      s.pending = { kind: 'telescope', by: s.officers.captain!, data: { step: 'choose' } };
      return;
    case 'mermaid':
      s.pending = { kind: 'mermaid', by: s.officers.captain!, data: { step: 'choose' } };
      return;
    case 'armed':
      // Fate-seated round (navigator is null): no one holds the post for the
      // effect to land on — the card fizzles (p.12: fate merely settles the
      // course; there is no crew member to arm).
      if (s.officers.navigator === null) { finishNavigation(s); return; }
      grantGuns(s, s.officers.navigator!, 1);
      finishNavigation(s);
      return;
    case 'disarmed':
      if (s.officers.navigator === null) { finishNavigation(s); return; }
      takeGuns(s, s.officers.navigator!, 1);
      finishNavigation(s);
      return;
    case 'drunk': {
      const newCaptain = drunkNext(s);
      s.officers = { captain: newCaptain, lieutenant: null, navigator: null };
      s.log.push({ t: 'round', round: s.round, captain: newCaptain });
      finishNavigation(s);
      return;
    }
  }
}

/** Drunk: captain moves clockwise to the living player with the fewest résumés. */
function drunkNext(s: GameState): PlayerId {
  const captain = s.officers.captain!;
  const others = walkClockwise(s, captain, (id) => s.players[id]!.alive);
  if (others.length === 0) return captain;
  const min = Math.min(...others.map((id) => s.players[id]!.resumes));
  return others.find((id) => s.players[id]!.resumes === min)!;
}

function finishNavigation(s: GameState): void {
  if (checkVictory(s)) return;
  s.pending = null;
  s.phase = 'offDuty';
  applyOffDuty(s);
}

/* --------------------------- card effects ------------------------------- */

function telescopeChoose(s: GameState, a: Extract<Action, { type: 'telescopeChoose' }>): void {
  assert(s.pending?.kind === 'telescope' && s.pending.by === a.actor, 'not your telescope');
  assert(a.target !== a.actor, 'choose another player');
  // The chosen player privately sees the top card of the draw pile.
  const top = s.navigation.deck[0];
  s.pending = {
    kind: 'telescope',
    by: a.target,
    data: { step: 'decide', deckTop: top ?? null },
  };
}

function telescopeDecide(s: GameState, a: Extract<Action, { type: 'telescopeDecide' }>): void {
  assert(s.pending?.kind === 'telescope' && s.pending.by === a.actor, 'not your telescope');
  const top = s.navigation.deck[0];
  if (a.action === 'discard' && top !== undefined) {
    s.navigation.deck.shift();
    discardCard(s, top);
  }
  finishNavigation(s);
}

function mermaidChoose(s: GameState, a: Extract<Action, { type: 'mermaidChoose' }>): void {
  assert(s.pending?.kind === 'mermaid' && s.pending.by === a.actor, 'not your mermaid');
  assert(a.target !== a.actor, 'choose another player');
  // The chosen player privately sees the last three discarded cards.
  const lastThree = s.navigation.discard.slice(-3);
  s.pending = { kind: 'mermaid', by: a.target, data: { step: 'ack', cards: lastThree } };
}

function mermaidAck(s: GameState, a: Extract<Action, { type: 'mermaidAck' }>): void {
  assert(s.pending?.kind === 'mermaid' && s.pending.by === a.actor, 'not your mermaid');
  finishNavigation(s);
}

/* ----------------------------- rituals ---------------------------------- */

function revealRitual(s: GameState): void {
  // House rule (differs from the manual's "reveal the top ritual card"):
  // the Cult Uprising lets the CAPTAIN pick which ritual to carry out from
  // the remaining deck. Two-step: this only OPENS the choice; ritualPick
  // applies it. No leader on board → the uprising fizzles (unchanged).
  const leader = s.seatOrder.find((id) => s.players[id]!.cultLeader && s.players[id]!.alive);
  if (!leader) { finishNavigation(s); return; }
  if (s.rituals.deck.length === 0) { finishNavigation(s); return; }
  // The pending's actor is the CAPTAIN here (they choose); once the card is
  // picked, openRitual re-points the pending at the LEADER (who acts in the
  // dark). `choosing: true` marks the pick window for the views.
  s.pending = {
    kind: 'ritual', by: s.officers.captain!,
    data: { step: 'chooseRitual' },
  };
}

/** The captain picked a ritual card — face-down SLOT choice: the view shows
 *  uniform backs, so the only thing that ever travels is the index; WHICH
 *  kind the slot holds lives in the reducer alone. Consume the slot, reveal
 *  the card publicly, and open the ritual (pending re-points to the leader). */
function ritualPick(s: GameState, a: Extract<Action, { type: 'ritualPick' }>): void {
  assert(s.pending?.kind === 'ritual' && s.pending.data?.['step'] === 'chooseRitual', 'not choosing a ritual');
  assert(a.actor === s.officers.captain, 'only the captain picks the ritual');
  assert(Number.isInteger(a.slot) && a.slot >= 0 && a.slot < s.rituals.deck.length,
    'picked slot is outside the ritual deck');
  const card = s.rituals.deck.splice(a.slot, 1)[0]!;
  s.rituals.revealed.push(card);
  s.log.push({ t: 'ritual', card });
  openRitual(s, card);
}

/** Open a specific ritual's pending + one-shot effects (cabin search
 *  secrets). Shared by ritualPick. */
function openRitual(s: GameState, card: RitualCardId): void {
  const leader = s.seatOrder.find((id) => s.players[id]!.cultLeader && s.players[id]!.alive)!;
  switch (card) {
    case 'conversion':
      s.pending = { kind: 'ritual', by: leader, data: { ritual: 'conversion' } };
      return;
    case 'gunsStash':
      s.pending = { kind: 'ritual', by: leader, data: { ritual: 'gunsStash' } };
      return;
    case 'cultCabinSearch':
      // Private to the Cult Leader: they learn the team of the navigation team.
      // Record each as private knowledge for the leader, then wait for the ack.
      for (const id of [s.officers.captain, s.officers.lieutenant, s.officers.navigator]) {
        if (!id) continue;
        s.secrets.push({ viewer: leader, about: id, team: s.players[id]!.team, round: s.round });
      }
      s.pending = { kind: 'ritual', by: leader, data: { ritual: 'cultCabinSearch' } };
      return;
  }
}

function ritualConversion(s: GameState, a: Extract<Action, { type: 'ritualConversion' }>): void {
  assert(s.pending?.kind === 'ritual' && s.pending.by === a.actor, 'not your ritual');
  const t = s.players[a.target];
  assert(t && t.alive, 'invalid target');
  assert(t.team !== 'cult', 'already a cultist');
  assert(!t.unconvertible, 'that player has been examined and is unconvertible');
  t.team = 'cult';
  t.convertedAt = s.round;
  // The converted player is told WHO leads the cult (projected only on their
  // own view; also surfaced to them via `teammates` — see view.ts).
  t.convertedBy = a.actor;
  s.log.push({ t: 'converted' });
  finishRitual(s);
}

function ritualGunsStash(s: GameState, a: Extract<Action, { type: 'ritualGunsStash' }>): void {
  assert(s.pending?.kind === 'ritual' && s.pending.by === a.actor, 'not your ritual');
  const total = a.grants.reduce((n, g) => n + g.guns, 0);
  assert(total === 3, 'must distribute exactly 3 guns');
  for (const g of a.grants) grantGuns(s, g.to, g.guns);
  // Public record: after the stash, everyone sees who received how many guns.
  s.log.push({ t: 'ritualGuns', grants: a.grants.map((g) => ({ to: g.to, guns: g.guns })) });
  finishRitual(s);
}

function ritualAck(s: GameState, a: Extract<Action, { type: 'ritualAck' }>): void {
  assert(s.pending?.kind === 'ritual' && s.pending.by === a.actor, 'not your ritual');
  finishRitual(s);
}

function finishRitual(s: GameState): void {
  s.navigation.applied.ritual = true;
  finishNavigation(s);
}

/* --------------------------- map actions -------------------------------- */

function mapActionCabinSearch(s: GameState, a: Extract<Action, { type: 'mapActionCabinSearch' }>): void {
  assert(s.pending?.kind === 'mapAction' && s.pending.by === a.actor, 'no cabin search');
  assert(a.target !== a.actor, 'choose another player');
  assert(s.players[a.target]!.alive, 'invalid target');
  // The captain privately learns the target's team (via the view); the target
  // is now permanently unconvertible.
  const target = s.players[a.target]!;
  target.unconvertible = true;
  if (target.team === 'cult') target.declaredCult = true;
  s.secrets.push({ viewer: a.actor, about: a.target, team: target.team, round: s.round });
  s.log.push({ t: 'mapAction', kind: 'cabinSearch', actor: a.actor, target: a.target });
  s.navigation.applied.mapAction = true;
  // Hold the rest of the navigation until the captain has READ the private
  // result: a reveal beat (only the captain's screen pops the identity).
  // `icon` rides along so the public CabinSearchNotice keeps its key while
  // the beat is live.
  s.pending = {
    kind: 'mapAction', by: a.actor,
    data: { step: 'reveal', kind: 'cabinSearch', target: a.target, icon: 'magnify' },
  };
}

function mapActionFeedKraken(s: GameState, a: Extract<Action, { type: 'mapActionFeedKraken' }>): void {
  assert(s.pending?.kind === 'mapAction' && s.pending.by === a.actor, 'no feed the kraken');
  assert(a.target !== a.actor, 'the captain cannot choose himself');
  const t = s.players[a.target];
  assert(t && t.alive, 'invalid target');
  t.alive = false;
  s.players[a.target]!.unconvertible = true;
  s.log.push({ t: 'mapAction', kind: 'feedKraken', actor: a.actor, target: a.target });
  s.navigation.applied.mapAction = true;
  // Same reveal beat as the cabin search: the captain sees whom they fed to
  // the Kraken (and their team) before the card effect follows. The cult-win
  // check runs on the ack — the table must not learn the outcome early.
  s.pending = {
    kind: 'mapAction', by: a.actor,
    data: { step: 'reveal', kind: 'feedKraken', target: a.target, icon: 'octopus' },
  };
}

/** The captain acknowledged the private result — resume the card effect. */
function mapActionRevealAck(s: GameState, a: Extract<Action, { type: 'mapActionRevealAck' }>): void {
  assert(s.pending?.kind === 'mapAction' && s.pending.data?.['step'] === 'reveal', 'no reveal to ack');
  assert(s.pending.by === a.actor, 'not your reveal');
  // Deferred cult-win check (feedKraken): now that the captain has read the
  // result, the outcome resolves publicly.
  const target = s.pending.data!['target'] as PlayerId;
  const kind = s.pending.data!['kind'] as 'cabinSearch' | 'feedKraken';
  s.pending = null;
  if (kind === 'feedKraken') {
    const t = s.players[target]!;
    if (t.cultLeader) { endGame(s, 'cult', '邪教首领被献祭给海怪'); return; }
  }
  startCardEffect(s, s.navigation.revealed!);
}

/* --------------------- denial of command / emergency -------------------- */

function denialOfCommand(s: GameState, a: Extract<Action, { type: 'denialOfCommand' }>): void {
  assert(s.phase === 'navigation', 'not navigating');
  assert(a.actor === s.officers.navigator, 'only the navigator may jump overboard');
  assert(s.navigation.logbook.length === 2, 'too late to refuse');
  // Discard both cards, eliminate the navigator, do NOT move, no résumé.
  for (const c of s.navigation.logbook) discardCard(s, c);
  s.navigation.logbook = [];
  s.navigation.revealed = null;
  s.players[a.actor]!.alive = false;
  s.log.push({ t: 'jump', player: a.actor });
  s.ship.emergency = true;
  s.phase = 'executeCard';
  s.pending = { kind: 'emergencyNav', by: s.officers.captain! };
}

function emergencyNav(s: GameState, a: Extract<Action, { type: 'emergencyNav' }>): void {
  assert(s.pending?.kind === 'emergencyNav' && s.pending.by === a.actor, 'not your call');
  // p.12: below three players nobody is left to appoint — fate takes the
  // helm directly (no player choice; the pending just dissolves).
  if (livingPlayers(s).length < 3) {
    s.officers.navigator = null;
    s.pending = null;
    s.log.push({ t: 'officers', lieutenant: s.officers.lieutenant, navigator: null });
    beginNavigation(s);
    return;
  }
  const nav = s.players[a.navigator];
  assert(nav && nav.alive, 'invalid emergency navigator');
  assert(a.navigator !== a.actor, 'the captain cannot navigate');
  // The navigation crew is captain + lieutenant + navigator — three distinct
  // people (p.12). Appointing the lieutenant would give one player both hands:
  // the view projects the navigator's logbook over their hand, so the
  // contribute step would show them a 0–1 card "hand" with no card to discard.
  assert(a.navigator !== s.officers.lieutenant, 'the lieutenant cannot double as emergency navigator');
  // The lieutenant stays; the emergency navigator may be off-duty and cannot be
  // mutinied. The previous navigation's cards were discarded with the jump, so
  // this is a fresh navigation: captain + lieutenant draw again.
  s.officers.navigator = a.navigator;
  s.pending = null;
  beginNavigation(s);
}

/* ============================ phase 4: off-duty ========================= */

function applyOffDuty(s: GameState): void {
  const roles = offDutyRoles(s.settings.playerCount);
  // Clear previous signs, then assign the roles involved in *this* navigation.
  for (const id of s.seatOrder) s.players[id]!.offDuty = false;
  const assign = (role: 'captain' | 'lieutenant' | 'navigator', id: PlayerId | null): void => {
    if (!roles.includes(role) || !id) return;
    const p = s.players[id]!;
    if (!p.alive) return;
    // A captain's own off-duty sign is inert, so don't bother marking it.
    if (role === 'captain') return;
    p.offDuty = true;
  };
  assign('captain', s.officers.captain);
  assign('lieutenant', s.officers.lieutenant);
  assign('navigator', s.officers.navigator);

  s.log.push({ t: 'round', round: s.round + 1, captain: s.officers.captain! });
  s.round += 1;
  resetNavigation(s);
  s.phase = 'appointTeam';
}

/* ======================= test-only AFK resolution ======================= */
/* forceAdvance is NOT registered as a bgio move (cut from the product), so
 * clients can never send it. It remains reachable only from direct reducer
 * calls — @ftk/engine's test helper autoResolve() uses it to deterministically
 * drain pendings without scripting every player's choice. */

function forceAdvance(s: GameState, a: Extract<Action, { type: 'forceAdvance' }>): void {
  assert(a.actor === s.host, 'only the host may force-advance');
  // Resolve any pending that is blocking on a specific player, then advance.
  if (s.pending) {
    const p = s.pending;
    switch (p.kind) {
      case 'mutinyTie':
        return mutinyTieBreak(s, { type: 'mutinyTieBreak', actor: p.by,
          standDown: (p.data!.remaining as PlayerId[])[0]! });
      case 'mapAction':
        // Reveal beat: just acknowledge it. Target-pick window: default the
        // captain's choice to a search on the next living player.
        if (p.data?.['step'] === 'reveal') {
          return mapActionRevealAck(s, { type: 'mapActionRevealAck', actor: p.by });
        }
        return mapActionCabinSearch(s, { type: 'mapActionCabinSearch', actor: p.by,
          target: livingPlayers(s).find((id) => id !== p.by)! });
      case 'telescope':
        if (p.data!.step === 'choose') return telescopeChoose(s, { type: 'telescopeChoose', actor: p.by,
          target: livingPlayers(s).find((id) => id !== p.by)! });
        return telescopeDecide(s, { type: 'telescopeDecide', actor: p.by, action: 'keep' });
      case 'mermaid':
        if (p.data!.step === 'choose') return mermaidChoose(s, { type: 'mermaidChoose', actor: p.by,
          target: livingPlayers(s).find((id) => id !== p.by)! });
        return mermaidAck(s, { type: 'mermaidAck', actor: p.by });
      case 'ritual':
        // Still in the pick window: default to the deck's TOP card type
        // (closest to the old random reveal); otherwise close the ritual.
        if (p.data?.['step'] === 'chooseRitual') {
          if (s.rituals.deck.length > 0) {
            return ritualPick(s, { type: 'ritualPick', actor: s.officers.captain!, slot: 0 });
          }
          finishNavigation(s);
          return;
        }
        return ritualAck(s, { type: 'ritualAck', actor: p.by });
      case 'emergencyNav':
        return emergencyNav(s, { type: 'emergencyNav', actor: p.by,
          navigator: livingPlayers(s).find((id) => id !== p.by)! });
      case 'cardEffect':
        return finishNavigation(s);
    }
  }

  switch (s.phase) {
    case 'loyalty': {
      for (const id of livingPlayers(s)) {
        if (id !== s.officers.captain && !(id in s.mutiny.pledges)) s.mutiny.pledges[id] = 0;
      }
      resolveMutiny(s);
      return;
    }
    case 'navigation': {
      const who = nextContributor(s);
      if (who) {
        const hand = who === s.officers.captain ? s.navigation.captainCards : s.navigation.lieutenantCards;
        navContribute(s, { type: 'navContribute', actor: who, keep: hand[0]!, discard: hand[1]! });
        return;
      }
      if (s.navigation.logbook.length === 2) {
        // A fate-seated navigator is resolved synchronously inside
        // navContribute, so reaching here means a real navigator is aboard.
        navLogbook(s, { type: 'navLogbook', actor: s.officers.navigator!, discard: s.navigation.logbook[0]! });
        return;
      }
      return;
    }
    default:
      throw new Error(`forceAdvance: nothing to advance in phase '${s.phase}'`);
  }
}

/* ========================= post-game: fun vote ========================== */

/** 最愚玩家 (most-foolish player) vote. Strictly post-game: one vote per
 *  active seat, target anyone but yourself, no re-voting. No rule effect —
 *  the tally lands in the view once every seat has spoken. */
function funVote(s: GameState, a: Extract<Action, { type: 'funVote' }>): void {
  assert(s.phase === 'gameOver', 'the fun vote opens only after game over');
  assert(s.players[a.actor]!.seat < s.settings.playerCount, 'bench seats do not vote');
  assert(a.actor !== a.target, 'you cannot vote for yourself');
  assert(s.players[a.target] !== undefined, 'unknown target');
  assert(!(a.actor in s.funVotes), 'your vote is final');
  s.funVotes[a.actor] = a.target;
}

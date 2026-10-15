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
import { navCard, type GameState, type NavCardId, type PlayerId } from './state.js';
import {
  checkVictory, eligibleOfficers, endGame, grantGuns, livingPlayers, moveShip,
  takeGuns, walkClockwise,
} from './helpers.js';
import { makeRng, type Rng } from './rng.js';
import { mutinyThreshold, offDutyRoles } from './rules.js';
import { applyDeal, dealTeams, validateFactionCounts } from './setup.js';

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
  if (prev.phase === 'gameOver' && action.type !== 'forceAdvance') return prev;
  const s = clone(prev);
  handle(s, action);
  return s;
}

function handle(s: GameState, a: Action): void {
  switch (a.type) {
    case 'confirmRole':       return confirmRole(s, a);
    case 'hostStartGame':     return hostStartGame(s, a);
    case 'syncName':          return syncName(s, a);
    case 'setFactionConfig':  return setFactionConfig(s, a);
    case 'appointTeam':     return appointTeam(s, a);
    case 'mutinyPledge':    return mutinyPledge(s, a);
    case 'mutinyTieBreak':  return mutinyTieBreak(s, a);
    case 'navContribute':   return navContribute(s, a);
    case 'navLogbook':      return navLogbook(s, a);
    case 'revealAndExecute':return revealAndExecute(s, a);
    case 'denialOfCommand': return denialOfCommand(s, a);
    case 'emergencyNav':    return emergencyNav(s, a);
    case 'telescopeChoose': return telescopeChoose(s, a);
    case 'telescopeDecide': return telescopeDecide(s, a);
    case 'mermaidChoose':   return mermaidChoose(s, a);
    case 'mermaidAck':      return mermaidAck(s, a);
    case 'mapActionCabinSearch': return mapActionCabinSearch(s, a);
    case 'mapActionFeedKraken':  return mapActionFeedKraken(s, a);
    case 'ritualConversion':return ritualConversion(s, a);
    case 'ritualGunsStash': return ritualGunsStash(s, a);
    case 'ritualAck':       return ritualAck(s, a);
    case 'forceAdvance':    return forceAdvance(s, a);
  }
}

/* ======================== pre-game: role reveal ========================= */

/** Idempotent, phase-agnostic: just record that `actor` has acknowledged
 *  their role card. The "block other moves until everyone confirms" gate
 *  lives in @ftk/game's move filter, not here, so the reducer stays a
 *  pure record of facts. */
function confirmRole(s: GameState, a: Extract<Action, { type: 'confirmRole' }>): void {
  assert(s.players[a.actor], `unknown player ${a.actor}`);
  if (!s.confirmedRole.includes(a.actor)) {
    s.confirmedRole.push(a.actor);
  }
}

/** Only the room host may flip the "开始游戏" switch. Idempotent: repeated
 *  clicks are no-ops, which keeps the move safe to retry on a laggy link. */
function hostStartGame(s: GameState, a: Extract<Action, { type: 'hostStartGame' }>): void {
  assert(a.actor === s.host, `only the host (${s.host}) may start; got ${a.actor}`);
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
}

/** Pre-game only: the host re-seals the faction breakdown and every team is
 *  re-dealt from scratch (captain card included — it is part of the same
 *  deal). Legal precisely because no secret has ever been projected: not
 *  hostStarted and nobody has confirmed a role, so reshuffling identities
 *  leaks nothing. Seats and names are untouched; only the chips move. */
function setFactionConfig(s: GameState, a: Extract<Action, { type: 'setFactionConfig' }>): void {
  assert(a.actor === s.host, `only the host (${s.host}) may change the config; got ${a.actor}`);
  assert(!s.hostStarted, 'the config is sealed once the game has started');
  assert(s.confirmedRole.length === 0, 'the config is sealed once roles are revealed');
  validateFactionCounts(a.factionCounts, s.settings.playerCount);
  s.settings.factionCounts = { ...a.factionCounts };
  const { teams, captainIndex } = withRng(s, (rng) =>
    dealTeams(rng, s.settings.playerCount, a.factionCounts));
  applyDeal(s, teams, captainIndex);
}

/* ============================ phase 1: appoint ========================== */

function appointTeam(s: GameState, a: Extract<Action, { type: 'appointTeam' }>): void {
  assert(s.phase === 'appointTeam', 'not in appointTeam');
  assert(a.actor === s.officers.captain, 'only the captain appoints the team');
  assert(a.lieutenant !== a.navigator, 'lieutenant and navigator must differ');
  assert(a.lieutenant !== a.actor && a.navigator !== a.actor, 'the captain cannot appoint himself');
  const eligible = new Set(eligibleOfficers(s));
  assert(eligible.has(a.lieutenant), 'lieutenant must be alive and on duty');
  assert(eligible.has(a.navigator), 'navigator must be alive and on duty');

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
    s.log.push({ t: 'mutiny', total, success: false, newCaptain: null });
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
  s.log.push({ t: 'mutiny', total, success: true, newCaptain });
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

/** Enter the navigation phase: captain and lieutenant each draw two cards. */
function beginNavigation(s: GameState): void {
  resetNavigation(s);
  // Shuffle the draw+discard back only when fewer than 4 cards remain (p.11).
  if (s.navigation.deck.length < 4) {
    s.navigation.deck = withRng(s, (rng) =>
      rng.shuffle([...s.navigation.deck, ...s.navigation.discard]));
    s.navigation.discard = [];
  }
  s.navigation.captainCards = draw(s, 2);
  s.navigation.lieutenantCards = draw(s, 2);
  s.phase = 'navigation';
}

function orderedTeam(s: GameState): PlayerId[] {
  const { captain, lieutenant } = s.officers;
  return [captain, lieutenant].filter((x): x is PlayerId => x !== null);
}

/** The first player who still has to act (contribute) in this navigation. */
function nextContributor(s: GameState): PlayerId | null {
  return orderedTeam(s).find((id) => !s.navigation.acted.includes(id)) ?? null;
}

function navContribute(s: GameState, a: Extract<Action, { type: 'navContribute' }>): void {
  assert(s.phase === 'navigation', 'not navigating');
  assert(nextContributor(s) === a.actor, 'not your turn to contribute');
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

  if (s.navigation.logbook.length === 2) {
    // logbook is shuffled; the navigator (next in order) then discards one.
    s.navigation.logbook = makeRng(s.rngState).shuffle(s.navigation.logbook);
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
}

function revealAndExecute(s: GameState, a: Extract<Action, { type: 'revealAndExecute' }>): void {
  assert(s.phase === 'navigation', 'not navigating');
  assert(a.actor === s.officers.captain, 'only the captain reveals');
  assert(s.navigation.revealed !== null, 'no card to reveal');
  const card = s.navigation.revealed;

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
      grantGuns(s, s.officers.navigator!, 1);
      finishNavigation(s);
      return;
    case 'disarmed':
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
  const rng = makeRng(s.rngState);
  const idx = rng.int(s.rituals.deck.length);
  const [card] = s.rituals.deck.splice(idx, 1);
  s.rngState = rng.state();
  if (card === undefined) return;
  s.rituals.revealed.push(card);
  s.log.push({ t: 'ritual', card });

  const leader = s.seatOrder.find((id) => s.players[id]!.cultLeader && s.players[id]!.alive);
  if (!leader) { finishNavigation(s); return; }

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
  s.log.push({ t: 'converted' });
  finishRitual(s);
}

function ritualGunsStash(s: GameState, a: Extract<Action, { type: 'ritualGunsStash' }>): void {
  assert(s.pending?.kind === 'ritual' && s.pending.by === a.actor, 'not your ritual');
  const total = a.grants.reduce((n, g) => n + g.guns, 0);
  assert(total === 3, 'must distribute exactly 3 guns');
  for (const g of a.grants) grantGuns(s, g.to, g.guns);
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
  s.pending = null;
  startCardEffect(s, s.navigation.revealed!);
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
  s.pending = null;
  // If the Cult Leader is fed to the Kraken, the Cult wins immediately.
  if (t.cultLeader) { endGame(s, 'cult', '邪教首领被献祭给海怪'); return; }
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
  const nav = s.players[a.navigator];
  assert(nav && nav.alive, 'invalid emergency navigator');
  assert(a.navigator !== a.actor, 'the captain cannot navigate');
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
        // Default the captain's choice to a Cabin Search on the next living player.
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
        navLogbook(s, { type: 'navLogbook', actor: s.officers.navigator!, discard: s.navigation.logbook[0]! });
        return;
      }
      if (s.navigation.revealed !== null) {
        revealAndExecute(s, { type: 'revealAndExecute', actor: s.officers.captain! });
      }
      return;
    }
    default:
      throw new Error(`forceAdvance: nothing to advance in phase '${s.phase}'`);
  }
}

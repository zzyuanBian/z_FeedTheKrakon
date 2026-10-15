/**
 * Player actions. The reducer (`reducer.ts`) is the only thing that reads
 * these; the boardgame.io moves in @ftk/game are thin, validated wrappers.
 *
 * `actor` is always the player the action is attributed to. The reducer checks
 * that the actor is actually allowed to take it in the current phase.
 */

import type { NavCardId, PlayerId, RitualCardId } from './state.js';

export type Action =
  /* pre-game: role reveal confirmation (Avalon-style gate before phase 1) */
  | { type: 'confirmRole'; actor: PlayerId }
  /* pre-game: host flips the "开始游戏" switch in the waiting room. Only the
   *  host (seat 0) may fire this; reducer asserts actor === state.host. */
  | { type: 'hostStartGame'; actor: PlayerId }
  /* pre-game: a seat writes its lobby-side display name into GameState. bgio
   *  keeps match-metadata names and GameState names in two separate stores;
   *  this action bridges them so the live-view roster shows real names. */
  | { type: 'syncName'; actor: PlayerId; name: string }
  /* phase 1 — appointing the navigation team */
  | { type: 'appointTeam'; actor: PlayerId; lieutenant: PlayerId; navigator: PlayerId }
  /* phase 2 — a question of loyalty */
  | { type: 'mutinyPledge'; actor: PlayerId; guns: number }
  | { type: 'mutinyTieBreak'; actor: PlayerId; standDown: PlayerId }
  /* phase 3 — the navigation */
  | { type: 'navContribute'; actor: PlayerId; keep: NavCardId; discard: NavCardId }
  | { type: 'navLogbook'; actor: PlayerId; discard: NavCardId }
  | { type: 'revealAndExecute'; actor: PlayerId }
  | { type: 'denialOfCommand'; actor: PlayerId }
  | { type: 'emergencyNav'; actor: PlayerId; navigator: PlayerId }
  /* phase 3.1 — executing the navigation card */
  | { type: 'telescopeChoose'; actor: PlayerId; target: PlayerId }
  | { type: 'telescopeDecide'; actor: PlayerId; action: 'keep' | 'discard' }
  | { type: 'mermaidChoose'; actor: PlayerId; target: PlayerId }
  | { type: 'mermaidAck'; actor: PlayerId }
  /* phase 3.1 II — map actions */
  | { type: 'mapActionCabinSearch'; actor: PlayerId; target: PlayerId }
  | { type: 'mapActionFeedKraken'; actor: PlayerId; target: PlayerId }
  /* cult rituals (after a Cult Uprising card) */
  | { type: 'ritualConversion'; actor: PlayerId; target: PlayerId }
  | { type: 'ritualGunsStash'; actor: PlayerId; grants: { to: PlayerId; guns: number }[] }
  | { type: 'ritualAck'; actor: PlayerId }
  /* host escape hatch for a stuck/AFK player */
  | { type: 'forceAdvance'; actor: PlayerId };

export type ActionType = Action['type'];

export type { NavCardId, PlayerId, RitualCardId };

/**
 * Client-side "what can I do now?" helpers.
 *
 * These decide only what to OFFER; the engine is the final authority and will
 * reject anything illegal. Everything is derived from the filtered
 * `PlayerView` plus the engine-provided `navigation.stage`/`awaiting`, so the
 * client never second-guesses the rules engine.
 */

import type { PlayerView, NavCardId, PlayerId } from '@ftk/engine';

/** Eligible appointees for the captain: alive, on duty, not the captain. */
export function eligibleTeam(view: PlayerView): PlayerId[] {
  return [view.you, ...view.others]
    .filter((p) => p.alive && !p.offDuty && p.id !== view.officers.captain)
    .map((p) => p.id);
}

/** True when the viewer is the captain appointing the team this round. */
export function iAmAppointing(view: PlayerView): boolean {
  return view.phase === 'appointTeam' && view.officers.captain === view.you.id;
}

/** True when the viewer still owes a mutiny pledge. */
export function iOweMutinyPledge(view: PlayerView): boolean {
  return (
    view.phase === 'loyalty' &&
    view.mutiny.active &&
    view.officers.captain !== view.you.id &&
    view.you.alive &&
    // The engine accepts exactly one pledge per player; once yours is in, the
    // panel must stop asking (the captain never pledges at all).
    !view.mutiny.hasPledged
  );
}

/** True when the navigation is waiting on the viewer to split two cards. */
export function iMustContribute(view: PlayerView): boolean {
  // `awaiting` is also the navigator during the logbook step, so the stage must
  // be checked too — otherwise the navigator is handed the contribute split and
  // every click is rejected (navContribute is not their move).
  return view.phase === 'navigation' && view.navigation.stage === 'contribute' &&
    view.navigation.awaiting === view.you.id;
}

/** True when the navigation is waiting on the viewer, as navigator, to resolve. */
export function iMustResolveLogbook(view: PlayerView): boolean {
  return view.phase === 'navigation' && view.navigation.stage === 'logbook' &&
    view.officers.navigator === view.you.id;
}

/** True when the navigator may still jump overboard (logbook seen, not resolved). */
export function iMayJumpOverboard(view: PlayerView): boolean {
  return view.phase === 'navigation' && view.navigation.logbookReady &&
    view.officers.navigator === view.you.id && !view.navigation.hasActed &&
    view.navigation.stage === 'logbook';
}

/** The cards the viewer may keep/discard right now (empty if not their turn). */
export function myContributableCards(view: PlayerView): NavCardId[] {
  if (!iMustContribute(view)) return [];
  return view.navigation.mine ?? [];
}

/** The logbook cards the navigator must choose between. */
export function myLogbook(view: PlayerView): NavCardId[] {
  if (!iMustResolveLogbook(view)) return [];
  return view.navigation.mine ?? [];
}

/** Everyone the viewer may pick as a target (not themselves, alive). */
export function pickableTargets(view: PlayerView, excludeSelf = true): PlayerId[] {
  const all = [view.you, ...view.others].filter((p) => p.alive).map((p) => p.id);
  return excludeSelf ? all.filter((id) => id !== view.you.id) : all;
}

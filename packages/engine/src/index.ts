/**
 * @ftk/engine — pure Feed the Kraken rules engine.
 *
 * Library entry point. No boardgame.io import anywhere in this package: the
 * boardgame.io shell lives in @ftk/game and calls into these pure functions.
 */

export * from './state.js';
export * from './map.js';
export * from './rules.js';
export * from './decks.js';
export * from './rng.js';
export * from './helpers.js';
export * from './setup.js';
export * from './view.js';
export * from './actions.js';
export * from './reducer.js';
export { SHORT_MAP } from './content/index.js';

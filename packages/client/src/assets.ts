/**
 * Static asset URLs. The board image is copied into `public/maps/` at build
 * time (see packages/client/public). The downscaled jpg from the labelling tool
 * is the source of truth for coordinates.
 */

/** Base path honours a non-root deploy (e.g. Nginx sub-path). */
const BASE = import.meta.env.BASE_URL ?? '/';

export const MAP_IMAGE_URL = `${BASE}maps/short.jpg`;

/** Top-down ship marker (outsourced art, head-up), drawn on the board. */
export const SHIP_URL = `${BASE}img/ship.png`;

/** Flintlock pistol (outsourced art, muzzle-left) for the mutiny UI:
 *  roster/log badges, pledge buttons, and the selected (gold) button state. */
export const GUN_URL = `${BASE}img/gun.png`;
export const GUN_BUTTON_URL = `${BASE}img/gun-button.png`;
export const GUN_SELECTED_URL = `${BASE}img/gun-selected.png`;

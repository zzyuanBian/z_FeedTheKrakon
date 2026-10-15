/**
 * Runtime configuration. In dev, Vite proxies /games + /socket.io to the game
 * server, so the client is same-origin. In production the client is served by
 * @ftk/server behind Nginx, also same-origin. An override is available for
 * staging (e.g. a separate API host).
 */

const env = import.meta.env as Record<string, string | undefined>;

/** Absolute origin of the game server, or '' when same-origin. */
export const SERVER_ORIGIN = env.VITE_FTK_SERVER ?? '';

/** bgio game name; must match FtkGame.name. */
export const GAME_NAME = 'feed-the-kraken';

/** Player limits, mirrored from the shell for the lobby UI. */
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 11;

export const STORAGE_KEY = 'ftk.session.v1';

/** Chinese display labels for engine ids. Kept in one place so the UI reads
 *  consistently and the rules stay close to their doc/ruleset_notes.md names. */

import type { ArrowColor, Faction, NavCardId, RitualCardId } from '@ftk/engine';

export const FACTION_LABEL: Record<Faction, string> = {
  sailor: '水手',
  pirate: '海盗',
  cult: '邪教',
};

export const FACTION_ICON: Record<Faction, string> = {
  sailor: '⚓',
  pirate: '☠️',
  cult: '🐙',
};

export const COLOR_LABEL: Record<ArrowColor, string> = {
  yellow: '北 · 黄',
  blue: '东 · 蓝',
  red: '西 · 红',
};

/** Arrow glyphs on nav cards. The custom map journeys upward toward the win
 *  medallions at the top, so east/west are drawn as NE/NW diagonals to match
 *  what a move actually looks like on the board. */
export const COLOR_GLYPH: Record<ArrowColor, string> = {
  yellow: '↑',
  blue: '↗',
  red: '↖',
};

export const NAV_CARD_LABEL: Record<NavCardId, string> = {
  cultUprising: '邪教起义',
  blueDrunk: '蓝色醉汉',
  redDrunk: '红色醉汉',
  disarmed: '解除武装',
  mermaid: '美人鱼',
  telescope: '望远镜',
  armed: '武装',
};

/** One-line rule reminder per nav card, shown as the hover tooltip. */
export const NAV_CARD_HINT: Record<NavCardId, string> = {
  cultUprising: '航行结束时进行一次邪教仪式：船长必须公开一张仪式牌',
  blueDrunk: '现任船长卸任，由履历最少的下一顺位玩家接任船长',
  redDrunk: '现任船长卸任，由履历最少的下一顺位玩家接任船长',
  disarmed: '领航员必须从个人枪库弃掉 1 把枪（如有）',
  mermaid: '船长指定一名玩家，其暗中查看最近弃掉的 3 张航海牌',
  telescope: '船长指定一名玩家，其查看牌堆顶的 1 张航海牌，可放回或弃掉',
  armed: '领航员从公枪库获得 1 把枪（仅远程航行图使用）',
};

export const RITUAL_LABEL: Record<RitualCardId, string> = {
  conversion: '邪教皈依',
  gunsStash: '邪教囤枪',
  cultCabinSearch: '邪教船舱搜查',
};

/** One-line rule reminder per ritual card, shown on the 5s pre-veil peek. */
export const RITUAL_HINT: Record<RitualCardId, string> = {
  conversion: '邪教首领暗中指定一名玩家——其当即被同化为邪教徒',
  gunsStash: '邪教首领暗中把 3 把枪分给任意玩家（可给自己），随后分配公开',
  cultCabinSearch: '邪教首领暗中查明船长、大副、领航员三人的阵营',
};

export const PHASE_LABEL: Record<string, string> = {
  setup: '准备',
  appointTeam: '任命船员',
  loyalty: '忠诚提问',
  navigation: '航行',
  executeCard: '执行航海卡',
  offDuty: '歇班',
  gameOver: '游戏结束',
};

/** ── 开场序章 (StoryPrologue) ────────────────────────────────────────────
 *  The per-game cold open, shown during the shared launch countdown. Three
 *  beats read in order (typewriter + fade); the last line names the game.
 *  Kept here so the story stays editable next to the rest of the copy. */
export const PROLOGUE_STANZAS: readonly string[] = [
  '风暴散去，星图尽毁。「海燕号」在无边的黑海上漂流，桅顶的灯是唯一的光。',
  '老水手说，这片海域之下沉睡着古老的存在。它饥饿，它在等。唯有回到人类的航线，才能活着离开。',
  '可登船名册上藏着名字——并非每个人，都想回家。有人揣着另一张海图，有人听见了海底的低语。睁大眼睛，别让这艘船，喂了海怪。',
];

/** The role card's faction whisper (RoleReveal): one line per team, spoken
 *  to the player alone right after they see their secret identity. The cult
 *  leader gets their own — the flock line already shows their known cultists. */
export const ROLE_WHISPER: Record<Faction, string> = {
  sailor: '你攥紧了船票。无论海底藏着什么——你要回家。',
  pirate: '回家？这艘船才是家。让它永远航行下去。',
  cult: '低语早已找到你。它很饿。',
};

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

export const PHASE_LABEL: Record<string, string> = {
  setup: '准备',
  appointTeam: '任命船员',
  loyalty: '忠诚提问',
  navigation: '航行',
  executeCard: '执行航海卡',
  offDuty: '歇班',
  gameOver: '游戏结束',
};

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

export const COLOR_GLYPH: Record<ArrowColor, string> = {
  yellow: '↑',
  blue: '→',
  red: '←',
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
  offDuty: '轮休',
  gameOver: '游戏结束',
};

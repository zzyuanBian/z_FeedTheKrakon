/**
 * The ritual-card art for one ritual kind — `cards/ritual-<id>.jpg`, cropped
 * from the tabletop scans (octopus + magnifying glasses = 邪教船舱搜查,
 * octopus + pistols = 邪教囤枪, tentacle-bound fist = 邪教皈依). Mirrors
 * NavCardFace: a square window, the art fills it, the Chinese name rides on
 * a bottom gradient band. The width is set by the modifier class each
 * mounting site picks (--peek / --veil / --panel / --notice).
 */

import type { RitualCardId } from '@ftk/engine';
import { RITUAL_LABEL } from './labels.js';

export function RitualFace({ card, className }: { card: RitualCardId; className?: string }) {
  return (
    <div className={'ritualface' + (className ? ` ${className}` : '')} title={RITUAL_LABEL[card]}>
      <img className="ritualface__art" src={`cards/ritual-${card}.jpg`} alt="" draggable={false} />
      <span className="ritualface__label">{RITUAL_LABEL[card]}</span>
    </div>
  );
}

/**
 * The board: a hand-labelled map image with an overlay of spaces and the ship.
 *
 * The engine ships space coordinates in the ORIGINAL image's pixel space
 * (`imageWidth` x `imageHeight`, ~9900px). The displayed image is a downscaled
 * copy, so we render everything in a fixed viewBox of the space coordinate
 * system and let SVG scale it — no per-pixel maths in JS, and the ship lands in
 * the right place regardless of screen size.
 */

import { useMemo } from 'react';
import type { PlayerView, Space } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL } from './assets.js';

/** A loaded map as the engine exposes it after `loadMap`. */
interface LoadedForRender {
  spaces: Space[];
  imageWidth: number;
  imageHeight: number;
  startId: number;
}

const ICON_EMOJI: Record<string, string> = {
  magnify: '🔍', // Cabin Search
  octopus: '🐙', // Feed the Kraken
  none: '',
};

const KIND_LABEL: Record<string, string> = {
  start: '起点',
  'win-sailor': '水手胜利',
  'win-pirate': '海盗胜利',
  'win-kraken': '海怪',
};

export interface BoardProps {
  view: PlayerView;
  /** Highlight a space (e.g. a legal destination preview). */
  highlight?: number | null;
  onPickSpace?: (id: number) => void;
}

/** Build a renderable snapshot from the bundled map (stable for now). */
function useBoard(): LoadedForRender {
  return useMemo(() => {
    const spaces = SHORT_MAP.spaces.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      kind: s.kind as Space['kind'],
      icon: s.icon as Space['icon'],
    }));
    const start = spaces.find((s) => s.kind === 'start');
    return {
      spaces,
      imageWidth: SHORT_MAP.imageWidth,
      imageHeight: SHORT_MAP.imageHeight,
      startId: start?.id ?? spaces[0]!.id,
    };
  }, []);
}

export function Board({ view, highlight, onPickSpace }: BoardProps) {
  const map = useBoard();
  const { spaceId } = view.ship;

  return (
    <div className="board">
      <svg
        className="board__svg"
        viewBox={`0 0 ${map.imageWidth} ${map.imageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="海图"
      >
        <image
          href={MAP_IMAGE_URL}
          x={0}
          y={0}
          width={map.imageWidth}
          height={map.imageHeight}
        />
        {map.spaces.map((s) => {
          const isShip = s.id === spaceId;
          const isHi = highlight === s.id;
          const terminal = KIND_LABEL[s.kind];
          return (
            <g
              key={s.id}
              className={
                'space' +
                (isShip ? ' space--ship' : '') +
                (isHi ? ' space--hl' : '') +
                (terminal ? ' space--terminal' : '')
              }
              onClick={onPickSpace ? () => onPickSpace(s.id) : undefined}
            >
              {(isShip || terminal) && (
                <circle className="space__ring" cx={s.x} cy={s.y} r={190} />
              )}
              <text className="space__label" x={s.x} y={s.y + 30} textAnchor="middle">
                {s.icon !== 'none' ? ICON_EMOJI[s.icon] : terminal ? '' : s.id}
              </text>
            </g>
          );
        })}
        {view.ship.emergency && (
          <text
            className="board__banner"
            x={map.imageWidth / 2}
            y={180}
            textAnchor="middle"
          >
            ⚠ 紧急航行
          </text>
        )}
      </svg>
    </div>
  );
}

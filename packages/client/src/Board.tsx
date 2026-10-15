/**
 * The board: the map image with a single overlay — a ship marker showing
 * where the fleet currently sits.
 *
 * The engine ships space coordinates in the ORIGINAL image's pixel space
 * (`imageWidth` x `imageHeight`). The displayed image is a downscaled copy,
 * so we render everything in a fixed viewBox of the space coordinate system
 * and let SVG scale it — no per-pixel maths in JS.
 *
 * Deliberately nothing else: the map art already paints the route arrows,
 * the Cabin Search / Feed the Kraken marks, and the win-space medallions.
 * Number labels and rings on top of that read as clutter, so the overlay
 * is just the ship.
 */

import type { PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL } from './assets.js';

export interface BoardProps {
  view: PlayerView;
}

export function Board({ view }: BoardProps) {
  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);

  return (
    <div className="board">
      <svg
        className="board__svg"
        viewBox={`0 0 ${SHORT_MAP.imageWidth} ${SHORT_MAP.imageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="海图"
      >
        <image
          href={MAP_IMAGE_URL}
          x={0}
          y={0}
          width={SHORT_MAP.imageWidth}
          height={SHORT_MAP.imageHeight}
        />
        {ship && (
          <text
            className="board__ship"
            x={ship.x}
            y={ship.y + 60}
            textAnchor="middle"
          >
            ⛵
          </text>
        )}
        {view.ship.emergency && (
          <text
            className="board__banner"
            x={SHORT_MAP.imageWidth / 2}
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

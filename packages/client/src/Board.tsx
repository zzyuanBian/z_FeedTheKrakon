/**
 * The board: the map image with a single overlay — a ship marker showing
 * where the fleet currently sits.
 *
 * The engine ships space coordinates in the ORIGINAL image's pixel space
 * (`imageWidth` x `imageHeight`). The displayed image is a downscaled copy,
 * so we render everything in a fixed viewBox of the space coordinate system
 * and let SVG scale it — no per-pixel maths in JS.
 *
 * The map JPEG is ~2.3 MB; an SVG <image> paints it progressively, which
 * reads as the board assembling line by line. Instead we preload + decode
 * it off-DOM and hold a themed overlay until the bitmap is ready — one
 * clean reveal, nothing half-drawn. The decoded copy sits in the browser
 * cache, so the subsequent <image> paints in a single frame.
 *
 * Deliberately nothing else: the map art already paints the route arrows,
 * the Cabin Search / Feed the Kraken marks, and the win-space medallions.
 * Number labels and rings on top of that read as clutter, so the overlay
 * is just the ship.
 */

import { useEffect, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL } from './assets.js';

export interface BoardProps {
  view: PlayerView;
}

/* One decode per browser session, hot across remounts (module-level). */
let mapReady = false;
let mapDecode: Promise<void> | null = null;
function decodeMap(url: string): Promise<void> {
  mapDecode ??= new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => { mapReady = true; resolve(); };
    img.onload = () => {
      // decode() waits for full pixel decode, not just download; if the
      // browser lacks it (or rejects), onload's bitmap is good enough.
      try { img.decode?.().then(done, done); } catch { done(); }
    };
    img.onerror = () => done(); // show the board even if loading failed
    img.src = url;
  });
  return mapDecode;
}

export function Board({ view }: BoardProps) {
  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);
  const [ready, setReady] = useState(mapReady);

  useEffect(() => {
    if (mapReady) return;
    let alive = true;
    void decodeMap(MAP_IMAGE_URL).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="board">
      <svg
        className="board__svg"
        viewBox={`0 0 ${SHORT_MAP.imageWidth} ${SHORT_MAP.imageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="海图"
      >
        {ready && (
          <>
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
          </>
        )}
      </svg>
      {!ready && (
        <div className="board__loading" role="status">
          <span className="board__loading-glyph" aria-hidden="true">⚓</span>
          <span className="board__loading-text">墨迹未干，海图正在展开…</span>
        </div>
      )}
    </div>
  );
}

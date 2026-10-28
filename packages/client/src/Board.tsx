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
import { MAP_IMAGE_URL, SHIP_URL } from './assets.js';

/* The marker is centred on the space and sized in map-space units (the map
 * paints at ~1/3 scale, so 660 units ≈ 220 jpg px on screen). */
const SHIP_SIZE = 660;

export interface BoardProps {
  view: PlayerView;
  /** Mobile only: tapping the board opens the full-screen MapViewer. */
  onExpand?: (() => void) | undefined;
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

export function Board({ view, onExpand }: BoardProps) {
  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);
  const [ready, setReady] = useState(mapReady);

  useEffect(() => {
    if (mapReady) return;
    let alive = true;
    void decodeMap(MAP_IMAGE_URL).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  return (
    <div className={'board' + (onExpand ? ' board--tappable' : '')}>
      <svg
        className="board__svg"
        viewBox={`0 0 ${SHORT_MAP.imageWidth} ${SHORT_MAP.imageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="海图"
        onClick={onExpand}
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
              <>
                {/* 呼吸红圈: a pulsing ring under the ship so the marker
                    reads at phone scale (the sprite alone used to get lost
                    in the map art). SVG scales the ring with the map; CSS
                    owns the breathing (transform-box keeps the pulse
                    centred on the ring, not the viewBox origin). */}
                <circle
                  className="board__ship-ring"
                  cx={ship.x}
                  cy={ship.y}
                  r={SHIP_SIZE * 0.72}
                />
                <image
                  className="board__ship"
                  href={SHIP_URL}
                  x={ship.x - SHIP_SIZE / 2}
                  y={ship.y - SHIP_SIZE / 2}
                  width={SHIP_SIZE}
                  height={SHIP_SIZE}
                />
              </>
            )}
            {view.ship.emergency && (
              <text
                className="board__banner"
                x={SHORT_MAP.imageWidth / 2}
                // Baseline must clear the glyph height (300px font): at the
                // old y=180 the caps towered ~120px above the viewBox top
                // edge and got clipped. 320 = ascent + a little air.
                y={320}
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
      {onExpand && ready && (
        <button type="button" className="board__expand" onClick={onExpand} aria-label="放大海图">
          ⛶ 放大
        </button>
      )}
    </div>
  );
}

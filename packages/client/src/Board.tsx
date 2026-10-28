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
 * Highlight rings: the art's magnifier / kraken marks are painted very
 * faint (physical copies get wooden tokens on top). The art itself stays
 * untouched — a soft halo under each mark lifts it out of the sea at
 * screen scale, and removing the overlay restores the original scan.
 *
 * 海图展开 (first-entry animation): when `firstEntry` is set — the board
 * mounted by the prologue's ⚓ 登船 click, not a refresh — the map plays a
 * folded-chart reveal: a centre sliver unrolls sideways under a moving
 * crease highlight, a warm lamplight sweep brings the colour up from sepia
 * dusk, and the ship drops in last. Pure CSS (one class swap per stage on
 * the wrapper div + two overlay layers); the jpg itself is untouched, and
 * `prefers-reduced-motion` skips straight to the lit board.
 */

import { useEffect, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL, SHIP_URL } from './assets.js';

/* The marker is centred on the space and sized in map-space units (the map
 * paints at ~1/3 scale, so 660 units ≈ 220 jpg px on screen). */
const SHIP_SIZE = 660;

/* 淡淡的高亮光圈: centres of the art's five small marks (3 magnifiers =
 * Cabin Search, 2 octopuses = Feed the Kraken), in viewBox units — measured
 * from the jpg (2200×2197) and scaled ×4.5 into the 9900×9887 space. */
const MARK_HALOS: readonly { x: number; y: number }[] = [
  { x: 2601, y: 5508 }, // magnifier, west of the central island
  { x: 3784, y: 6224 }, // magnifier, south-west sea
  { x: 6116, y: 6201 }, // magnifier, south-east sea
  { x: 3744, y: 3551 }, // octopus, north-west sea
  { x: 6075, y: 3596 }, // octopus, north-east sea
];
const HALO_R = 340; // mark radius is ~315 units; a little air reads as a halo

export interface BoardProps {
  view: PlayerView;
  /** Mobile only: tapping the board opens the full-screen MapViewer. */
  onExpand?: (() => void) | undefined;
  /** True only for the board mounted by the prologue's ⚓ 登船 click: play
   *  the folded-chart reveal once, then settle into the plain board. */
  firstEntry?: boolean | undefined;
}

/** Stages of the first-entry reveal: the unroll (crease sweep + clip
 *  widening), then the lamp sweep (colour wakes up), then done — overlays
 *  unmount and the board is the plain everyday one. Timing mirrors the CSS
 *  ( unfold 1100ms → lamp 900ms overlapping from 700ms → settle ~1900ms). */
const UNFOLD_MS = 1100;
const LAMP_MS = 900;
const SETTLE_MS = 700; // lamp starts this deep into the unfold

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

export function Board({ view, onExpand, firstEntry }: BoardProps) {
  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);
  const [ready, setReady] = useState(mapReady);
  // Reveal stage: 'folded' → (UNFOLD_MS) → 'lamp' → (LAMP_MS) → 'done'.
  // Non-first entries start at 'done' and never mount the overlays.
  const [stage, setStage] = useState<'folded' | 'lamp' | 'done'>(
    firstEntry ? 'folded' : 'done',
  );

  useEffect(() => {
    if (mapReady) return;
    let alive = true;
    void decodeMap(MAP_IMAGE_URL).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (stage === 'folded') {
      const t = window.setTimeout(() => setStage('lamp'), UNFOLD_MS - SETTLE_MS);
      return () => window.clearTimeout(t);
    }
    if (stage === 'lamp') {
      const t = window.setTimeout(() => setStage('done'), LAMP_MS);
      return () => window.clearTimeout(t);
    }
  }, [stage]);

  const reveal =
    stage === 'folded' ? ' board--folded' : stage === 'lamp' ? ' board--lamp' : '';

  return (
    <div className={'board' + reveal + (onExpand ? ' board--tappable' : '')}>
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
              className="board__map"
              href={MAP_IMAGE_URL}
              x={0}
              y={0}
              width={SHORT_MAP.imageWidth}
              height={SHORT_MAP.imageHeight}
            />
            {stage !== 'done' && (
              <g className="board__reveal-fx" aria-hidden="true">
                {/* 折痕高光: a narrow vertical band riding the unroll edge. */}
                <rect
                  className="board__crease"
                  x={0}
                  y={0}
                  width={SHORT_MAP.imageWidth * 0.16}
                  height={SHORT_MAP.imageHeight}
                />
                {/* 灯光扫过: a wide soft gradient bringing warmth from the left. */}
                <rect
                  className="board__lamp"
                  x={-SHORT_MAP.imageWidth * 0.5}
                  y={0}
                  width={SHORT_MAP.imageWidth * 0.5}
                  height={SHORT_MAP.imageHeight}
                />
              </g>
            )}
            {/* Halos UNDER the ship layer, over the art: a faint warm glow
                that lifts each faint mark out of the sea without repainting
                it (CSS owns the look; delete the group to restore the bare
                scan). */}
            <g aria-hidden="true">
              {MARK_HALOS.map((h) => (
                <circle key={`${h.x}:${h.y}`} className="board__mark-halo" cx={h.x} cy={h.y} r={HALO_R} />
              ))}
            </g>
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
                  className={'board__ship' + (stage !== 'done' ? ' board__ship--late' : '')}
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

/**
 * 海图放大镜 (mobile map viewer). The mobile board band is only ~38vh —
 * route arrows and space marks are unreadably small. Tapping the board
 * opens this full-screen viewer: the same SVG map with a LIVE viewBox that
 * pinch-zoom (two fingers), drag-pan (one finger), double-tap and the +/−
 * buttons all drive. Ship marker + 紧急航行 banner ride along so the
 * viewer answers "where are we" too.
 *
 * Zoom maths: viewBox = [x, y, w, h] in map-space. Zooming by factor k
 * around a map-space point (cx, cy): new w/h = w/k, h/k, and x/y shift so
 * (cx, cy) stays at the same relative position inside the window. Panning
 * converts screen px to map units via the on-screen scale (w / clientWidth).
 * The window always keeps the SCREEN's aspect ratio (clamping rescales h
 * from w and the viewport), so `meet` fills the screen at every zoom —
 * scaling the axes to independent floors once let deep zooms letterbox the
 * map into a small centred band ("the map disappeared"). Zoom spans
 * 1× (fit) to 4×; the fit window may overflow the map on its long axis,
 * so x/y clamp ranges stretch past the map edge by as much on that side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL, SHIP_URL } from './assets.js';
import { MARK_HALOS, HALO_R } from './Board.js';

const SHIP_SIZE = 660; // same marker sizing as the board
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Box { x: number; y: number; w: number; h: number; }

/** The fit-to-window viewBox (zoom = 1) for a portrait/landscape viewport.
 *  Reads the same viewport source as clampBox — a mismatched pair would
 *  letterbox the fit view by a few px of browser chrome. */
function fitBox(): Box {
  const el = document.documentElement;
  const vw = el.clientWidth;
  const vh = el.clientHeight;
  const mw = SHORT_MAP.imageWidth;
  const mh = SHORT_MAP.imageHeight;
  // meet: the larger scale wins so the whole map stays visible.
  const scale = Math.min(vw / mw, vh / mh);
  const w = vw / scale;
  const h = vh / scale;
  return { x: (mw - w) / 2, y: (mh - h) / 2, w, h };
}

/** Window width for a raw zoom candidate, held to [1..4]× zoom. */
const limitedW = (w: number): number => {
  const mw = SHORT_MAP.imageWidth;
  return Math.min(mw, Math.max(mw / MAX_ZOOM, w));
};

/** Clamp a box's position, re-deriving its height from the viewport's
 *  aspect. The window always keeps the SCREEN's aspect: `meet` then fills
 *  the screen at every zoom and the screen↔map conversions stay exact.
 *  (Scaling w and h to independent floors — the old clamp — distorted the
 *  aspect once zoomed deep, and `meet` answered by letterboxing the map
 *  into a small centred band: "zoom in enough and the map disappears".)
 *  At low zoom the window may legitimately overflow the map on the long
 *  axis (the zoom-1 fit does exactly that), so x/y ranges extend past the
 *  map edge just as far on that side. */
function clampBox(b: Box): Box {
  const mw = SHORT_MAP.imageWidth;
  const mh = SHORT_MAP.imageHeight;
  const w = limitedW(b.w);
  const h = (w * document.documentElement.clientHeight) / document.documentElement.clientWidth;
  const xHi = mw - w;
  const yHi = mh - h;
  return {
    w, h,
    x: Math.min(Math.max(b.x, Math.min(0, xHi)), Math.max(0, xHi)),
    y: Math.min(Math.max(b.y, Math.min(0, yHi)), Math.max(0, yHi)),
  };
}

/** Zoom by k around the map-space point under screen position (sx, sy). */
function zoomAt(b: Box, k: number, sx: number, sy: number): Box {
  const el = document.documentElement;
  const px = (sx / el.clientWidth) * b.w + b.x;
  const py = (sy / el.clientHeight) * b.h + b.y;
  // Learn the post-clamp window FIRST, then anchor it under the finger —
  // clamping after anchoring would let the zoom caps drift the anchor.
  const { w, h } = clampBox({ ...b, w: b.w / k, h: b.h / k });
  return clampBox({
    w, h,
    x: px - (sx / el.clientWidth) * w,
    y: py - (sy / el.clientHeight) * h,
  });
}

export function MapViewer({ view, onClose }: { view: PlayerView; onClose: () => void }) {
  const [box, setBoxState] = useState<Box>(fitBox);
  // Gesture reads the CURRENT box synchronously — React state commits a
  // beat later, and a pinch move arriving inside that gap would read a
  // half-written window (the old `box: null!` round-trip).
  const boxRef = useRef<Box>(box);
  const applyBox = useCallback((next: Box) => {
    boxRef.current = next;
    setBoxState(next);
  }, []);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Gesture scratch (refs — no re-render per move event).
  const mode = useRef<'none' | 'pan' | 'pinch'>('none');
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const taps = useRef<{ t: number; x: number; y: number } | null>(null);

  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);
  const zoom = SHORT_MAP.imageWidth / box.w;

  // Landscape→portrait rotations / browser chrome resizes refit the window.
  useEffect(() => {
    const on = () => applyBox(fitBox());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [applyBox]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Gesture blocking is touch-action:none (CSS); React's touch listeners
    // are passive, so a preventDefault() here would only log a warning.
    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      mode.current = 'pan';
      last.current = { x: t.clientX, y: t.clientY };
      // Double-tap to zoom: two taps <300ms apart, both single-finger.
      const now = Date.now();
      const prev = taps.current;
      taps.current = { t: now, x: t.clientX, y: t.clientY };
      if (prev && now - prev.t < 300 &&
          Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 40) {
        taps.current = null;
        const cx = t.clientX;
        const cy = t.clientY;
        const z = SHORT_MAP.imageWidth / boxRef.current.w;
        applyBox(z > 1.5 ? fitBox() : zoomAt(boxRef.current, 2, cx, cy));
        mode.current = 'none';
      }
    } else if (e.touches.length >= 2) {
      mode.current = 'pinch';
      const a = e.touches[0]!;
      const b2 = e.touches[1]!;
      pinch.current = {
        dist: Math.hypot(a.clientX - b2.clientX, a.clientY - b2.clientY),
        cx: (a.clientX + b2.clientX) / 2,
        cy: (a.clientY + b2.clientY) / 2,
      };
    }
  }, [applyBox]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (mode.current === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - last.current.x;
      const dy = t.clientY - last.current.y;
      last.current = { x: t.clientX, y: t.clientY };
      const el = document.documentElement;
      const b = boxRef.current;
      applyBox(clampBox({ ...b, x: b.x - (dx / el.clientWidth) * b.w, y: b.y - (dy / el.clientHeight) * b.h }));
    } else if (mode.current === 'pinch' && e.touches.length >= 2 && pinch.current) {
      const a = e.touches[0]!;
      const b2 = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b2.clientX, a.clientY - b2.clientY);
      const k = dist / pinch.current.dist;
      if (k > 0.9 && k < 1.1) return; // jitter guard
      applyBox(zoomAt(boxRef.current, k, pinch.current.cx, pinch.current.cy));
    }
  }, [applyBox]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) { mode.current = 'none'; pinch.current = null; }
    else if (e.touches.length === 1) {
      // A finger lifted from a pinch: resume panning from the survivor.
      mode.current = 'pan';
      const t = e.touches[0]!;
      last.current = { x: t.clientX, y: t.clientY };
      pinch.current = null;
    }
  }, []);

  const btnZoom = (k: number) =>
    applyBox(zoomAt(boxRef.current, k, document.documentElement.clientWidth / 2, document.documentElement.clientHeight / 2));

  return (
    <div className="mapviewer" role="dialog" aria-label="海图放大">
      <svg
        ref={svgRef}
        className="mapviewer__svg"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: 'none' }}
      >
        <image href={MAP_IMAGE_URL} x={0} y={0} width={SHORT_MAP.imageWidth} height={SHORT_MAP.imageHeight} />
        {/* Same mark halos as the in-page board — the zoom view exists to
            read the faint marks, so the glow must ride along. */}
        <g aria-hidden="true">
          {MARK_HALOS.map((h) => (
            <circle key={`${h.x}:${h.y}`} className="board__mark-halo" cx={h.x} cy={h.y} r={HALO_R} />
          ))}
        </g>
        {ship && (
          <image
            className="board__ship mapviewer__ship"
            href={SHIP_URL}
            x={ship.x - SHIP_SIZE / 2}
            y={ship.y - SHIP_SIZE / 2}
            width={SHIP_SIZE}
            height={SHIP_SIZE}
          />
        )}
        {view.ship.emergency && (
          <text
            className="board__banner"
            x={SHORT_MAP.imageWidth / 2}
            // Same clip fix as Board: baseline clears the 300px ascent.
            y={320}
            textAnchor="middle"
          >
            ⚠ 紧急航行
          </text>
        )}
      </svg>

      <div className="mapviewer__hud">
        <span className="mapviewer__zoom">{Math.round(zoom * 10) / 10}×</span>
        <button type="button" className="mapviewer__btn" onClick={() => btnZoom(1.5)} aria-label="放大">＋</button>
        <button type="button" className="mapviewer__btn" onClick={() => btnZoom(1 / 1.5)} aria-label="缩小">－</button>
        <button type="button" className="mapviewer__btn" onClick={() => applyBox(fitBox())} aria-label="复位">⤾</button>
        <button type="button" className="mapviewer__btn mapviewer__btn--close" onClick={onClose} aria-label="关闭">
          ✕ 收起海图
        </button>
      </div>
      <p className="mapviewer__tip">双指缩放 · 单指拖动 · 双击放大</p>
    </div>
  );
}

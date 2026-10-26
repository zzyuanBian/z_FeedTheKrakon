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
 * Everything is clamped to the map rect; zoom spans 1× (fit) to 4×.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@ftk/engine';
import { SHORT_MAP } from '@ftk/engine';
import { MAP_IMAGE_URL, SHIP_URL } from './assets.js';

const SHIP_SIZE = 660; // same marker sizing as the board
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Box { x: number; y: number; w: number; h: number; }

/** The fit-to-window viewBox (zoom = 1) for a portrait/landscape viewport. */
function fitBox(): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = SHORT_MAP.imageWidth;
  const mh = SHORT_MAP.imageHeight;
  // meet: the larger scale wins so the whole map stays visible.
  const scale = Math.min(vw / mw, vh / mh);
  const w = vw / scale;
  const h = vh / scale;
  return { x: (mw - w) / 2, y: (mh - h) / 2, w, h };
}

const clampBox = (b: Box): Box => {
  const mw = SHORT_MAP.imageWidth;
  const mh = SHORT_MAP.imageHeight;
  const w = Math.min(mw, Math.max(mw / MAX_ZOOM, b.w));
  const h = Math.min(mh, Math.max(mh / MAX_ZOOM, b.h));
  return {
    w, h,
    x: Math.min(mw - w, Math.max(0, b.x)),
    y: Math.min(mh - h, Math.max(0, b.y)),
  };
};

/** Zoom by k around the map-space point under screen position (sx, sy). */
function zoomAt(b: Box, k: number, sx: number, sy: number): Box {
  const el = document.documentElement;
  const px = (sx / el.clientWidth) * b.w + b.x;
  const py = (sy / el.clientHeight) * b.h + b.y;
  const w = b.w / k;
  const h = b.h / k;
  return clampBox({
    w, h,
    x: px - (sx / el.clientWidth) * w,
    y: py - (sy / el.clientHeight) * h,
  });
}

export function MapViewer({ view, onClose }: { view: PlayerView; onClose: () => void }) {
  const [box, setBox] = useState<Box>(fitBox);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Gesture scratch (refs — no re-render per move event).
  const mode = useRef<'none' | 'pan' | 'pinch'>('none');
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinch = useRef<{ dist: number; cx: number; cy: number; box: Box } | null>(null);
  const taps = useRef<{ t: number; x: number; y: number } | null>(null);

  const ship = SHORT_MAP.spaces.find((s) => s.id === view.ship.spaceId);
  const zoom = SHORT_MAP.imageWidth / box.w;

  // Landscape→portrait rotations / browser chrome resizes refit the window.
  useEffect(() => {
    const on = () => setBox(fitBox());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
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
        setBox((b) => {
          const z = SHORT_MAP.imageWidth / b.w;
          return z > 1.5 ? fitBox() : zoomAt(b, 2, cx, cy);
        });
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
        box: null!, // filled by the updater below
      };
      setBox((cur) => { pinch.current!.box = cur; return cur; });
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (mode.current === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - last.current.x;
      const dy = t.clientY - last.current.y;
      last.current = { x: t.clientX, y: t.clientY };
      setBox((b) => {
        const el = document.documentElement;
        return clampBox({ ...b, x: b.x - (dx / el.clientWidth) * b.w, y: b.y - (dy / el.clientHeight) * b.h });
      });
    } else if (mode.current === 'pinch' && e.touches.length >= 2 && pinch.current) {
      const a = e.touches[0]!;
      const b2 = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b2.clientX, a.clientY - b2.clientY);
      const k = dist / pinch.current.dist;
      if (k > 0.9 && k < 1.1) return; // jitter guard
      setBox(() => zoomAt(pinch.current!.box, k, pinch.current!.cx, pinch.current!.cy));
    }
  }, []);

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

  const btnZoom = (k: number) => setBox((b) => zoomAt(b, k, window.innerWidth / 2, window.innerHeight / 2));

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
            y={180}
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
        <button type="button" className="mapviewer__btn" onClick={() => setBox(fitBox())} aria-label="复位">⤾</button>
        <button type="button" className="mapviewer__btn mapviewer__btn--close" onClick={onClose} aria-label="关闭">
          ✕ 收起海图
        </button>
      </div>
      <p className="mapviewer__tip">双指缩放 · 单指拖动 · 双击放大</p>
    </div>
  );
}

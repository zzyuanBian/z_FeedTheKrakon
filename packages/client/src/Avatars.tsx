/**
 * Crew avatars, ported from the Avalon reference (D:\Code\mytest
 * client/src/components/Avatars.tsx): a fixed id→portrait table, a random
 * picker, and an <AvatarImage> component. The Avalon art is replaced with
 * the project's own 10 crew portraits (images/avatars → public/avatars,
 * served at /avatars/avatar-<id>.jpg).
 *
 * An avatar is picked once when a player joins the lobby (random, avoiding
 * ids already used in the room) and rides the session; the id is bridged
 * into GameState via the `syncAvatar` move so every seat can render it.
 */

import { useRef, useState } from 'react';

const AVATAR_FILES = [
  '01_captain_edmund',
  '02_navigator_vera',
  '03_veteran_captain_hackett',
  '04_scholar_levin',
  '05_priestess_lilith',
  '06_first_mate_bax',
  '07_mechanic_amy',
  '08_lookout_jack',
  '09_cthulhu_follower',
  '10_sea_dog_compass',
] as const;

/** Display names for the portraits (alt/title text only). */
export const AVATARS: { id: number; name: string }[] = [
  { id: 0, name: '埃德蒙船长' },
  { id: 1, name: '领航员薇拉' },
  { id: 2, name: '老船长哈克特' },
  { id: 3, name: '学者列文' },
  { id: 4, name: '祭司莉莉丝' },
  { id: 5, name: '大副巴克斯' },
  { id: 6, name: '机械师艾米' },
  { id: 7, name: '瞭望员杰克' },
  { id: 8, name: '邪教徒' },
  { id: 9, name: '海狗罗盘' },
];

export function getAvatar(id: number): { id: number; name: string } {
  return AVATARS[id] ?? { id: 0, name: AVATARS[0]?.name ?? '船员' };
}

export function avatarSrc(id: number): string {
  const idx = id >= 0 && id < AVATAR_FILES.length ? id : 0;
  // 128px JPEG (~9KB each): the largest portrait ever displayed is the 44px
  // lobby picker (88px on a 2x screen), so 128 has headroom to spare. The
  // original 313px PNGs weighed ~200KB apiece — 2MB for the set, which made
  // the lobby portraits pop in one by one on a cold cache.
  return `/avatars/avatar-${idx}.jpg`;
}

/** Pick a random avatar id, avoiding ids already claimed in this room. When
 *  all 10 are taken (12-player room at the margin), fall back to any id. */
export function pickAvatarId(taken: Iterable<number>): number {
  const used = new Set(taken);
  const free = AVATARS.map((a) => a.id).filter((id) => !used.has(id));
  const pool = free.length ? free : AVATARS.map((a) => a.id);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// Preload all avatar images to avoid flash on render.
export function preloadAvatars(): void {
  AVATARS.forEach((av) => {
    const img = new Image();
    img.src = avatarSrc(av.id);
  });
}

/** Circular portrait. Sizes are plain pixel strings so the component stays
 *  free of any utility-CSS dependency (the Avalon original used tailwind).
 *  While the JPEG decodes (cold cache, e.g. shared-link joiners) the element
 *  carries `avatar-img--loading`: CSS paints a themed disc + shimmer there,
 *  swapped for the real photo the moment onLoad lands. A ref complete-check
 *  covers portraits that finish before React attaches the handler. */
export function AvatarImage({
  avatarId,
  size = 36,
  title,
  className,
}: {
  avatarId: number;
  /** Diameter in px. */
  size?: number;
  title?: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  if (imgRef.current?.complete && imgRef.current.naturalWidth > 0 && !loaded) {
    setLoaded(true);
  }
  return (
    <img
      ref={imgRef}
      src={avatarSrc(avatarId)}
      alt={getAvatar(avatarId).name}
      title={title}
      className={
        'avatar-img'
        + (loaded ? '' : ' avatar-img--loading')
        + (className ? ` ${className}` : '')
      }
      style={{ width: size, height: size }}
      draggable={false}
      loading="eager"
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  );
}

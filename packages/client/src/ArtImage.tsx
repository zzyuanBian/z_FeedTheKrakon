/**
 * Art glyphs (non-avatar imagery): the treasure-map cutout on the CTA
 * buttons and the three faction wax seals in the waiting-room config.
 *
 * Loading UX mirrors AvatarImage: until the PNG is decoded the element
 * carries `art-img--loading`, and CSS paints a themed placeholder there
 * (quiet disc, no shimmer — these are small decorations, not portraits).
 * A ref complete-check covers images that finish decoding before React
 * attaches the onLoad handler (cold cache with a warm HTTP cache).
 */

import { useRef, useState } from 'react';

export function ArtImage({
  src,
  size = 38,
  title,
  className,
}: {
  src: string;
  /** Square side in px. */
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
      src={src}
      alt=""
      title={title}
      className={
        'art-img'
        + (loaded ? '' : ' art-img--loading')
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

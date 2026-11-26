import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../lib/config';
import { useSettings } from '../store/useSettings';

function hashHue(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

/** GIF e WEBP podem ser animados; os outros formatos sempre ficam parados. */
function mayBeAnimated(url: string): boolean {
  return /\.(gif|webp)(\?|$)/i.test(url);
}

/**
 * Mostra a imagem parada (primeiro quadro) desenhando num canvas, e a versão
 * animada quando `animate` for verdadeiro.
 */
function StillOrAnimatedImage({
  src,
  animate,
  className,
  alt,
}: {
  src: string;
  animate: boolean;
  className: string;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const animated = mayBeAnimated(src);

  useEffect(() => {
    if (!animated) return;
    setFrameReady(false);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      setFrameReady(true);
    };
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src, animated]);

  if (!animated || animate) {
    return <img src={src} alt={alt} className={className} draggable={false} />;
  }
  return (
    <>
      <canvas ref={canvasRef} className={`${className} ${frameReady ? '' : 'hidden'}`} aria-label={alt} />
      {!frameReady && <img src={src} alt={alt} className={className} draggable={false} />}
    </>
  );
}

interface AvatarProps {
  url: string | null | undefined;
  name: string;
  size?: number;
  /** Força animar (por exemplo, ao passar o mouse sobre a mensagem inteira). */
  animate?: boolean;
  speaking?: boolean;
  status?: 'online' | 'offline' | null;
  className?: string;
}

export function Avatar({
  url,
  name,
  size = 32,
  animate = false,
  speaking = false,
  status = null,
  className = '',
}: AvatarProps) {
  const [hovered, setHovered] = useState(false);
  const alwaysAnimate = useSettings((s) => s.animateAvatars === 'always');
  const fullUrl = mediaUrl(url);
  const shouldAnimate = alwaysAnimate || animate || hovered;
  const dot = Math.max(8, Math.round(size * 0.3));

  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {fullUrl ? (
        <StillOrAnimatedImage
          src={fullUrl}
          animate={shouldAnimate}
          alt={name}
          className={`h-full w-full rounded-full object-cover ${
            speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#2b2d31]' : ''
          }`}
        />
      ) : (
        <span
          className={`flex h-full w-full items-center justify-center rounded-full font-bold text-white ${
            speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#2b2d31]' : ''
          }`}
          style={{
            backgroundColor: `hsl(${hashHue(name)} 45% 38%)`,
            fontSize: Math.max(10, Math.round(size * 0.38)),
          }}
        >
          {getInitials(name)}
        </span>
      )}
      {status && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-[#2b2d31] ${
            status === 'online' ? 'bg-emerald-400' : 'bg-zinc-500'
          }`}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  );
}

export function ProfileBanner({
  url,
  name,
  height = 96,
  animate = true,
}: {
  url: string | null | undefined;
  name: string;
  height?: number;
  animate?: boolean;
}) {
  const fullUrl = mediaUrl(url);
  if (!fullUrl) {
    return (
      <div
        className="w-full"
        style={{ height, background: `linear-gradient(135deg, hsl(${hashHue(name)} 50% 32%), #1e1f22)` }}
      />
    );
  }
  return (
    <div className="w-full overflow-hidden bg-[#1e1f22]" style={{ height }}>
      <StillOrAnimatedImage src={fullUrl} animate={animate} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

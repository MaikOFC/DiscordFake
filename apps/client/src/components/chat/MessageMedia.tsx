import { useEffect, useState } from 'react';
import type { LinkPreview, MessageAttachment } from '@nexusvoice/shared';
import { mediaUrl } from '../../lib/config';
import { isDesktop, openExternal } from '../../lib/desktop';
import { ExternalLink, youtubeId } from '../../lib/markdown';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
      role="dialog"
      aria-label="Imagem ampliada"
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void openExternal(src);
        }}
        className="absolute bottom-6 cursor-pointer rounded-md bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
      >
        Abrir no navegador
      </button>
    </div>
  );
}

function ZoomableImage({ src, onLoad }: { src: string; onLoad?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block cursor-zoom-in">
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          className="max-h-72 max-w-full rounded-lg border border-zinc-800 object-contain sm:max-w-sm"
        />
      </button>
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

function FileCard({ attachment, url }: { attachment: MessageAttachment; url: string }) {
  return (
    <div className="flex max-w-sm items-center gap-3 rounded-lg border border-zinc-700/80 bg-[#2b2d31] px-3 py-2">
      <span className="text-2xl" aria-hidden>
        📄
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-sky-300">{attachment.fileName}</div>
        <div className="text-[11px] text-zinc-500">{formatBytes(attachment.size)}</div>
      </div>
      {isDesktop ? (
        <button
          type="button"
          onClick={() => void openExternal(url)}
          className="shrink-0 cursor-pointer rounded bg-zinc-700 px-2 py-1 text-[11px] text-zinc-100 hover:bg-zinc-600"
        >
          Baixar
        </button>
      ) : (
        <a
          href={url}
          download={attachment.fileName}
          className="shrink-0 rounded bg-zinc-700 px-2 py-1 text-[11px] text-zinc-100 hover:bg-zinc-600"
        >
          Baixar
        </a>
      )}
    </div>
  );
}

export function AttachmentList({
  attachments,
  onMediaLoad,
}: {
  attachments: MessageAttachment[];
  onMediaLoad?: () => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {attachments.map((attachment) => {
        const url = mediaUrl(attachment.url) ?? '';
        if (attachment.mimeType.startsWith('image/')) {
          return <ZoomableImage key={attachment.id} src={url} onLoad={onMediaLoad} />;
        }
        if (attachment.mimeType.startsWith('video/')) {
          return (
            <video
              key={attachment.id}
              src={url}
              controls
              preload="metadata"
              onLoadedMetadata={onMediaLoad}
              className="max-h-80 max-w-full rounded-lg border border-zinc-800 bg-black sm:max-w-md"
            />
          );
        }
        if (attachment.mimeType.startsWith('audio/')) {
          return (
            <div
              key={attachment.id}
              className="max-w-sm rounded-lg border border-zinc-700/80 bg-[#2b2d31] p-2"
            >
              <div className="mb-1 truncate text-xs text-zinc-300">{attachment.fileName}</div>
              <audio src={url} controls preload="metadata" className="w-full" />
            </div>
          );
        }
        return <FileCard key={attachment.id} attachment={attachment} url={url} />;
      })}
    </div>
  );
}

const IMAGE_URL = /^https:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?$/i;
const INTERNAL_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|26\.|169\.254\.)/;

/** Links diretos para imagem ou GIF (Tenor, Giphy, Imgur...) aparecem como imagem. */
export function inlineImageUrls(content: string): string[] {
  const found = content.match(/https:\/\/[^\s<>"'`]+/gi) ?? [];
  const result: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?)\]]+$/, '');
    try {
      if (IMAGE_URL.test(url) && !INTERNAL_HOST.test(new URL(url).hostname)) result.push(url);
    } catch {
      // URL quebrada: ignora.
    }
    if (result.length >= 2) break;
  }
  return result;
}

export function InlineImages({ urls, onMediaLoad }: { urls: string[]; onMediaLoad?: () => void }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {urls.map((url) => (
        <ZoomableImage key={url} src={url} onLoad={onMediaLoad} />
      ))}
    </div>
  );
}

export function LinkPreviewList({
  previews,
  skipUrls,
}: {
  previews: LinkPreview[];
  skipUrls: string[];
}) {
  const visible = previews.filter((p) => !skipUrls.includes(p.url));
  if (visible.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {visible.map((preview) => {
        const isVideo = youtubeId(preview.url) !== null;
        return (
          <div
            key={preview.url}
            className="max-w-md overflow-hidden rounded-lg border-l-4 border-emerald-600/70 bg-[#2b2d31] p-3"
          >
            {preview.siteName && (
              <div className="text-[11px] text-zinc-400">{preview.siteName}</div>
            )}
            <div className="mt-0.5 text-sm font-semibold">
              <ExternalLink href={preview.url}>{preview.title}</ExternalLink>
            </div>
            {preview.description && (
              <p className="mt-1 line-clamp-3 text-xs text-zinc-300">{preview.description}</p>
            )}
            {preview.imageUrl && (
              <button
                type="button"
                onClick={() => void openExternal(preview.url)}
                className="relative mt-2 block cursor-pointer"
              >
                <img
                  src={preview.imageUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`rounded-md object-cover ${isVideo ? 'max-h-56 w-full' : 'max-h-40'}`}
                />
                {isVideo && (
                  <span className="absolute inset-0 flex items-center justify-center text-4xl drop-shadow-lg">
                    ▶️
                  </span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

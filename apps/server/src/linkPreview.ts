import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { LinkPreview } from '@nexusvoice/shared';

const MAX_URLS_PER_MESSAGE = 3;
const MAX_HTML_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

const cache = new Map<string, { at: number; preview: LinkPreview | null }>();

/** Faixas que nunca devem ser acessadas: rede local, loopback, Radmin (26.x), CGNAT/Tailscale etc. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 26 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIP(ip: string): boolean {
  if (isIP(ip) === 4) return isBlockedIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isBlockedIPv4(lower.slice(7));
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff')
  );
}

/**
 * Resolve o DNS e recusa IPs internos. Usar isso dentro da própria conexão evita o truque
 * de um domínio que responde um IP na checagem e outro na hora de conectar.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0);
      return;
    }
    const list = addresses as LookupAddress[];
    const allowed = list.filter((a) => !isBlockedIP(a.address));
    if (allowed.length === 0 || allowed.length !== list.length) {
      callback(new Error('Endereço bloqueado para prévia de link.'), '', 0);
      return;
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, allowed);
    } else {
      callback(null, allowed[0]!.address, allowed[0]!.family);
    }
  });
};

function fetchHtml(url: URL, redirectsLeft: number): Promise<{ html: string; finalUrl: URL } | null> {
  return new Promise((resolve) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      resolve(null);
      return;
    }
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedIP(url.hostname.replace(/^\[|\]$/g, ''))) {
      resolve(null);
      return;
    }
    if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) {
      resolve(null);
      return;
    }

    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requester(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'NexusVoiceLinkPreview/1.0 (+bot)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          try {
            const next = new URL(res.headers.location, url);
            void fetchHtml(next, redirectsLeft - 1).then(resolve);
          } catch {
            resolve(null);
          }
          return;
        }
        const type = String(res.headers['content-type'] ?? '');
        if (status !== 200 || !type.includes('text/html')) {
          res.resume();
          resolve(null);
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_HTML_BYTES) {
            req.destroy();
            resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url }));
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function readMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeEntities(match[1]);
    }
  }
  return null;
}

async function buildPreview(rawUrl: string): Promise<LinkPreview | null> {
  const cached = cache.get(rawUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.preview;
  }

  let preview: LinkPreview | null = null;
  try {
    const result = await fetchHtml(new URL(rawUrl), MAX_REDIRECTS);
    if (result) {
      const head = result.html.slice(0, MAX_HTML_BYTES);
      const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
      const title = readMeta(head, ['og:title', 'twitter:title']) ?? (titleTag ? decodeEntities(titleTag) : null);
      const description = readMeta(head, ['og:description', 'twitter:description', 'description']) ?? '';
      const image = readMeta(head, ['og:image', 'twitter:image']);
      let imageUrl: string | null = null;
      if (image) {
        try {
          const resolved = new URL(image, result.finalUrl);
          const host = resolved.hostname.replace(/^\[|\]$/g, '');
          const internal = host === 'localhost' || (isIP(host) !== 0 && isBlockedIP(host));
          imageUrl = resolved.protocol === 'https:' && !internal ? resolved.toString() : null;
        } catch {
          imageUrl = null;
        }
      }
      if (title) {
        preview = {
          url: rawUrl,
          title: title.slice(0, 200),
          description: description.slice(0, 300),
          imageUrl,
          siteName: readMeta(head, ['og:site_name'])?.slice(0, 80) ?? result.finalUrl.hostname,
        };
      }
    }
  } catch {
    preview = null;
  }

  cache.set(rawUrl, { at: Date.now(), preview });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return preview;
}

export function extractUrls(content: string): string[] {
  const found = content.match(URL_PATTERN) ?? [];
  const unique: string[] = [];
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:!?)\]]+$/, '');
    if (!unique.includes(cleaned)) unique.push(cleaned);
    if (unique.length >= MAX_URLS_PER_MESSAGE) break;
  }
  return unique;
}

export async function buildLinkPreviews(content: string): Promise<LinkPreview[]> {
  const urls = extractUrls(content);
  const previews = await Promise.all(urls.map((url) => buildPreview(url)));
  return previews.filter((p): p is LinkPreview => p !== null);
}

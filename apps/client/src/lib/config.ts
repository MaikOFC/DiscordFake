/**
 * Endereço do servidor NexusVoice. Fica salvo no aparelho e pode ser trocado na
 * tela de login, assim o mesmo app serve para o PC de quem hospeda (localhost)
 * e para os amigos (por exemplo, o IP do Radmin de quem hospeda).
 */

const SERVER_URL_KEY = 'nexusvoice:serverUrl';
const DEFAULT_PORT = '3001';

export const DEFAULT_SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';

/** Repositório usado para procurar versões novas do app de desktop. */
export const UPDATE_REPO = 'MaikOFC/NexusVoice';

/** Aceita "26.1.2.3", "26.1.2.3:3001" ou "http://..." e devolve uma URL completa. */
export function normalizeServerUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.port && url.protocol === 'http:' && !/:\d+$/.test(url.host)) {
      url.port = DEFAULT_PORT;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function getServerUrl(): string {
  try {
    const saved = localStorage.getItem(SERVER_URL_KEY);
    if (saved) return normalizeServerUrl(saved) ?? DEFAULT_SERVER_URL;
  } catch {
    // Sem acesso ao localStorage: usa o padrão.
  }
  return DEFAULT_SERVER_URL;
}

export function saveServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url);
  } catch {
    // Ignora: o app continua funcionando com o endereço em memória.
  }
}

/** Transforma o caminho de mídia que vem do servidor (/uploads/...) em URL completa. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getServerUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}

function tokenKey(serverUrl: string): string {
  return `nexusvoice:token:${serverUrl}`;
}

/** O token de login fica separado por servidor, para trocar de servidor sem perder o outro. */
export function getSavedToken(serverUrl = getServerUrl()): string | null {
  try {
    return localStorage.getItem(tokenKey(serverUrl));
  } catch {
    return null;
  }
}

export function saveToken(token: string | null, serverUrl = getServerUrl()): void {
  try {
    if (token) localStorage.setItem(tokenKey(serverUrl), token);
    else localStorage.removeItem(tokenKey(serverUrl));
  } catch {
    // Ignora.
  }
}

/** Lê um JSON do localStorage sem quebrar se estiver corrompido ou bloqueado. */
export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignora.
  }
}

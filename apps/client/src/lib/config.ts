/**
 * Endereço do servidor NexusVoice. Fica salvo no aparelho e pode ser trocado na
 * tela de login, assim o mesmo app serve para o PC de quem hospeda (localhost),
 * para os amigos pelo Radmin (o IP de quem hospeda) e para o servidor na nuvem
 * (um domínio com HTTPS).
 */

const SERVER_URL_KEY = 'nexusvoice:serverUrl';
const DEFAULT_PORT = '3001';

function defaultServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Versão web aberta pelo domínio do servidor na nuvem: o servidor é o próprio site.
  if (
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    !('__TAURI_INTERNALS__' in window) &&
    window.location.protocol === 'https:'
  ) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

export const DEFAULT_SERVER_URL = defaultServerUrl();

/** Repositório usado para procurar versões novas do app de desktop. */
export const UPDATE_REPO = 'MaikOFC/NexusVoice';

/**
 * IP, localhost ou nome da rede de casa (sem ponto ou terminando em .local):
 * servidor no PC de alguém, sem HTTPS, na porta 3001.
 */
function isLocalAddress(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.startsWith('[') ||
    !hostname.includes('.') ||
    hostname.endsWith('.local')
  );
}

/**
 * Aceita "26.1.2.3", "26.1.2.3:3001", "nexusvoice.duckdns.org" ou "http(s)://..."
 * e devolve uma URL completa. IP sem porta ganha a 3001; domínio sem
 * "http://" na frente vira HTTPS.
 */
export function normalizeServerUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
    try {
      const probe = new URL(`http://${value}`);
      value = isLocalAddress(probe.hostname) || probe.port ? `http://${value}` : `https://${value}`;
    } catch {
      return null;
    }
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

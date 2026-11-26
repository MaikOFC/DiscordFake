import type {
  ActionResult,
  AuthResult,
  HealthResponse,
  MessageAttachment,
  PublicUser,
  VoiceTokenPayload,
} from '@nexusvoice/shared';
import { getSavedToken, getServerUrl } from './config';

const REQUEST_TIMEOUT_MS = 15000;
const OFFLINE_ERROR =
  'Não foi possível falar com o servidor. Confira o endereço e se ele está ligado.';

let onUnauthorized: (() => void) | null = null;

/** O socket.ts registra aqui o que fazer quando o servidor disser que a sessão expirou. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  baseUrl?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ActionResult<T>> {
  const baseUrl = options.baseUrl ?? getServerUrl();
  const headers: Record<string, string> = {};
  if (options.auth !== false) {
    const token = getSavedToken(baseUrl);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => null)) as ActionResult<T> | null;
    if (response.status === 401 && options.auth !== false) {
      onUnauthorized?.();
    }
    if (!json) {
      return { ok: false, error: `O servidor respondeu com erro (${response.status}).` };
    }
    return json;
  } catch {
    return { ok: false, error: OFFLINE_ERROR };
  } finally {
    clearTimeout(timer);
  }
}

/** Confere se o endereço é mesmo de um servidor NexusVoice. */
export async function checkServer(baseUrl: string): Promise<ActionResult<HealthResponse>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    const json = (await response.json()) as HealthResponse;
    if (json.app !== 'NexusVoice') {
      return { ok: false, error: 'Esse endereço não é de um servidor NexusVoice.' };
    }
    if ((json.apiVersion ?? 1) < 2) {
      return {
        ok: false,
        error: 'O servidor está desatualizado. Peça para quem hospeda atualizar o NexusVoice.',
      };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: OFFLINE_ERROR };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  register: (baseUrl: string, username: string, password: string, displayName: string) =>
    request<AuthResult>('/api/auth/register', {
      method: 'POST',
      body: { username, password, displayName },
      auth: false,
      baseUrl,
    }),
  login: (baseUrl: string, username: string, password: string) =>
    request<AuthResult>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
      baseUrl,
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),
  updateProfile: (patch: { displayName?: string; bio?: string }) =>
    request<PublicUser>('/api/profile', { method: 'PATCH', body: patch }),
  uploadProfileImage: (kind: 'avatar' | 'banner', file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<PublicUser>(`/api/profile/${kind}`, { method: 'POST', form });
  },
  removeProfileImage: (kind: 'avatar' | 'banner') =>
    request<PublicUser>(`/api/profile/${kind}`, { method: 'DELETE' }),
  voiceToken: (channelId: string) =>
    request<VoiceTokenPayload>('/api/voice/token', { method: 'POST', body: { channelId } }),
};

/** Envia um anexo mostrando o progresso (fetch não informa progresso de envio). */
export function uploadAttachment(
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<ActionResult<MessageAttachment>>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ActionResult<MessageAttachment>>((resolve) => {
    const baseUrl = getServerUrl();
    xhr.open('POST', `${baseUrl}/api/uploads`);
    const token = getSavedToken(baseUrl);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as ActionResult<MessageAttachment>);
      } catch {
        resolve({ ok: false, error: `Falha ao enviar (${xhr.status}).` });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: OFFLINE_ERROR });
    xhr.onabort = () => resolve({ ok: false, error: 'Envio cancelado.' });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
}

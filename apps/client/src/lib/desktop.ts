/**
 * Ponte com o app de desktop (Tauri). No navegador, cada função cai num
 * comportamento equivalente ou simplesmente não faz nada.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { CustomGame, HotkeyBinding } from '../store/useSettings';

export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function setGlobalHotkeys(
  ptt: HotkeyBinding | null,
  mute: HotkeyBinding | null,
  deafen: HotkeyBinding | null,
): Promise<void> {
  if (!isDesktop) return;
  await invoke('set_hotkeys', {
    ptt: ptt?.code ?? null,
    mute: mute?.code ?? null,
    deafen: deafen?.code ?? null,
  }).catch(() => undefined);
}

let capturingKey = false;

/** Enquanto a pessoa escolhe um atalho, o Esc não deve fechar janelas do app. */
export function isCapturingKey(): boolean {
  return capturingKey;
}

/** Espera a próxima tecla ou botão do mouse. Devolve null se apertar Esc. */
export async function captureGlobalKey(): Promise<HotkeyBinding | null> {
  capturingKey = true;
  try {
    if (!isDesktop) return await captureBrowserKey();
    return await new Promise((resolve) => {
      let unlisten: UnlistenFn | null = null;
      void listen<{ code: number | null; name: string | null }>('hotkey-captured', (event) => {
        unlisten?.();
        const { code, name } = event.payload;
        resolve(code !== null && name ? { code, name } : null);
      }).then((fn) => {
        unlisten = fn;
        void invoke('start_key_capture');
      });
    });
  } finally {
    // Solta no próximo ciclo, depois que o Esc da captura já passou pelos outros ouvintes.
    setTimeout(() => {
      capturingKey = false;
    }, 0);
  }
}

export function cancelKeyCapture(): void {
  if (isDesktop) void invoke('cancel_key_capture').catch(() => undefined);
}

/** Converte o botão do mouse do navegador para o mesmo código usado no Windows. */
export function mouseButtonToCode(button: number): number | null {
  if (button === 1) return 0x04;
  if (button === 3) return 0x05;
  if (button === 4) return 0x06;
  return null;
}

export function codeName(code: number, fallback: string): string {
  if (code === 0x04) return 'Botão do meio do mouse';
  if (code === 0x05) return 'Mouse 4';
  if (code === 0x06) return 'Mouse 5';
  return fallback;
}

function captureBrowserKey(): Promise<HotkeyBinding | null> {
  return new Promise((resolve) => {
    const finish = (value: HotkeyBinding | null): void => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        finish(null);
        return;
      }
      const name = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      finish({ code: event.keyCode, name });
    };
    const onMouse = (event: MouseEvent): void => {
      const code = mouseButtonToCode(event.button);
      if (code !== null) {
        event.preventDefault();
        finish({ code, name: codeName(code, '') });
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
  });
}

export function onDesktopEvent<T>(name: string, handler: (payload: T) => void): () => void {
  if (!isDesktop) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void listen<T>(name, (event) => handler(event.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export async function getCurrentGame(): Promise<string | null> {
  if (!isDesktop) return null;
  return invoke<string | null>('get_current_game').catch(() => null);
}

export async function configureGameDetection(enabled: boolean, games: CustomGame[]): Promise<void> {
  if (!isDesktop) return;
  await invoke('set_game_detection', { enabled }).catch(() => undefined);
  await invoke('set_custom_games', { games }).catch(() => undefined);
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (!isDesktop) return;
  await invoke('set_close_to_tray', { enabled }).catch(() => undefined);
}

export async function quitApp(): Promise<void> {
  if (isDesktop) await invoke('quit_app').catch(() => undefined);
}

/** Abre links fora do app (no navegador padrão), nunca dentro da janela do NexusVoice. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isDesktop) {
    await openUrl(url).catch(() => undefined);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function showNotification(title: string, body: string): Promise<void> {
  try {
    if (isDesktop) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (granted) sendNotification({ title, body });
      return;
    }
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // Notificação é um extra: se falhar, o app segue normal.
  }
}

export async function getAutostart(): Promise<boolean> {
  if (!isDesktop) return false;
  return isEnabled().catch(() => false);
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isDesktop) return;
  await (enabled ? enable() : disable()).catch(() => undefined);
}

export async function getAppVersion(): Promise<string | null> {
  if (!isDesktop) return null;
  return getVersion().catch(() => null);
}

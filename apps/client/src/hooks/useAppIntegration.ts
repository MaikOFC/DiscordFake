import { useEffect } from 'react';
import {
  configureGameDetection,
  getCurrentGame,
  isDesktop,
  mouseButtonToCode,
  onDesktopEvent,
  setCloseToTray,
  setGlobalHotkeys,
} from '../lib/desktop';
import { emitActivity } from '../services/socket';
import { checkForUpdates } from '../services/updates';
import { setPushToTalk, toggleDeafen, toggleMicrophoneMute } from '../services/voice';
import { useAppStore } from '../store/useAppStore';
import { getSettings, useSettings } from '../store/useSettings';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runHotkeyAction(action: string): void {
  if (action === 'toggle-mute') void toggleMicrophoneMute();
  else if (action === 'toggle-deafen') void toggleDeafen();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Liga o app ao sistema: foco da janela, atalhos, bandeja, jogos e atualizações. */
export function useAppIntegration(): void {
  const setWindowFocused = useAppStore((s) => s.setWindowFocused);
  const pruneTyping = useAppStore((s) => s.pruneTyping);
  const setGameActivity = useAppStore((s) => s.setGameActivity);

  const voiceMode = useSettings((s) => s.voiceMode);
  const pttKey = useSettings((s) => s.pttKey);
  const muteKey = useSettings((s) => s.muteKey);
  const deafenKey = useSettings((s) => s.deafenKey);
  const closeToTray = useSettings((s) => s.closeToTray);
  const gameDetection = useSettings((s) => s.gameDetection);
  const customGames = useSettings((s) => s.customGames);
  const checkUpdates = useSettings((s) => s.checkUpdates);

  useEffect(() => {
    const onFocus = (): void => setWindowFocused(true);
    const onBlur = (): void => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const timer = setInterval(pruneTyping, 2000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      clearInterval(timer);
    };
  }, [setWindowFocused, pruneTyping]);

  // Atalhos globais (só no app de desktop).
  useEffect(() => {
    void setGlobalHotkeys(voiceMode === 'ptt' ? pttKey : null, muteKey, deafenKey);
  }, [voiceMode, pttKey, muteKey, deafenKey]);

  useEffect(() => {
    void setCloseToTray(closeToTray);
  }, [closeToTray]);

  useEffect(() => {
    void configureGameDetection(gameDetection, customGames);
  }, [gameDetection, customGames]);

  useEffect(() => {
    const updateGame = (game: string | null): void => {
      setGameActivity(game);
      emitActivity(game);
    };
    const offs = [
      onDesktopEvent<boolean>('ptt', (pressed) => setPushToTalk(pressed)),
      onDesktopEvent<string>('hotkey', runHotkeyAction),
      onDesktopEvent<string>('tray-action', runHotkeyAction),
      onDesktopEvent<string | null>('game-activity', updateGame),
    ];
    void getCurrentGame().then((game) => {
      if (game) updateGame(game);
    });
    return () => offs.forEach((off) => off());
  }, [setGameActivity]);

  // No navegador não existe atalho global: os atalhos valem com a janela em foco.
  useEffect(() => {
    if (isDesktop) return;
    const matches = (code: number): 'ptt' | 'mute' | 'deafen' | null => {
      const s = getSettings();
      if (s.voiceMode === 'ptt' && s.pttKey?.code === code) return 'ptt';
      if (s.muteKey?.code === code) return 'mute';
      if (s.deafenKey?.code === code) return 'deafen';
      return null;
    };
    const handle = (code: number, down: boolean, typing: boolean, repeat: boolean): void => {
      const kind = matches(code);
      if (!kind) return;
      if (kind === 'ptt') {
        setPushToTalk(down);
        return;
      }
      if (down && !repeat && !typing) runHotkeyAction(kind === 'mute' ? 'toggle-mute' : 'toggle-deafen');
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      const typing = isTypingTarget(e.target) && e.key.length === 1;
      if (typing && matches(e.keyCode) === 'ptt') return;
      handle(e.keyCode, true, typing, e.repeat);
    };
    const onKeyUp = (e: KeyboardEvent): void => handle(e.keyCode, false, false, false);
    const onMouseDown = (e: MouseEvent): void => {
      const code = mouseButtonToCode(e.button);
      if (code !== null) handle(code, true, false, false);
    };
    const onMouseUp = (e: MouseEvent): void => {
      const code = mouseButtonToCode(e.button);
      if (code !== null) handle(code, false, false, false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop || !checkUpdates) return;
    void checkForUpdates();
    const timer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkUpdates]);
}

import { create } from 'zustand';
import { readStoredJson, writeStoredJson } from '../lib/config';

const SETTINGS_KEY = 'nexusvoice:settings';

export interface HotkeyBinding {
  /** Código de tecla virtual do Windows (o mesmo usado pelo atalho global). */
  code: number;
  name: string;
}

export type NoiseSuppressionMode = 'off' | 'browser' | 'rnnoise';
export type VoiceMode = 'voice' | 'ptt';
export type AudioQuality = 'voice' | 'music';
export type NotificationMode = 'mentions' | 'all' | 'off';

export interface CustomGame {
  exe: string;
  name: string;
}

export interface Settings {
  noiseSuppression: NoiseSuppressionMode;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Volume do microfone em %, de 0 a 200. */
  inputGain: number;
  /** Corta o microfone quando o som fica abaixo do limite (sensibilidade). */
  gateEnabled: boolean;
  gateThresholdDb: number;
  voiceMode: VoiceMode;
  pttKey: HotkeyBinding | null;
  pttReleaseMs: number;
  muteKey: HotkeyBinding | null;
  deafenKey: HotkeyBinding | null;
  audioQuality: AudioQuality;
  soundsEnabled: boolean;
  soundVolume: number;
  notifications: NotificationMode;
  closeToTray: boolean;
  gameDetection: boolean;
  customGames: CustomGame[];
  animateAvatars: 'hover' | 'always';
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  noiseSuppression: 'rnnoise',
  echoCancellation: true,
  autoGainControl: true,
  inputGain: 100,
  gateEnabled: false,
  gateThresholdDb: -50,
  voiceMode: 'voice',
  pttKey: null,
  pttReleaseMs: 200,
  muteKey: null,
  deafenKey: null,
  audioQuality: 'voice',
  soundsEnabled: true,
  soundVolume: 50,
  notifications: 'mentions',
  closeToTray: true,
  gameDetection: true,
  customGames: [],
  animateAvatars: 'hover',
  checkUpdates: true,
};

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...readStoredJson<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  update: (patch) => {
    set(patch);
    const { update: _u, reset: _r, ...values } = { ...get(), ...patch };
    writeStoredJson(SETTINGS_KEY, values);
  },
  reset: () => {
    set(DEFAULT_SETTINGS);
    writeStoredJson(SETTINGS_KEY, DEFAULT_SETTINGS);
  },
}));

export function getSettings(): Settings {
  return useSettings.getState();
}

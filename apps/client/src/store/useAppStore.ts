import { create } from 'zustand';
import type {
  ChatMessage,
  ServerDetails,
  UserSession,
  VoicePresenceUser,
} from '@nexusvoice/shared';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type VoiceStatus = 'idle' | 'connecting' | 'connected';
export type ScreenResolution = '720p' | '1080p';
export type ScreenFps = 30 | 60;

export interface VoiceParticipantInfo {
  userId: string;
  nickname: string;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isLocal: boolean;
}

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

const USER_ID_STORAGE_KEY = 'nexusvoice:userId';
const NICKNAME_STORAGE_KEY = 'nexusvoice:nickname';
const AUDIO_INPUT_STORAGE_KEY = 'nexusvoice:audioInputId';
const AUDIO_OUTPUT_STORAGE_KEY = 'nexusvoice:audioOutputId';

/**
 * Gera e guarda um ID único por aba no sessionStorage.
 * Diferente do localStorage, o sessionStorage NÃO é compartilhado entre abas,
 * evitando que duas abas do mesmo PC usem a mesma identidade.
 */
export function getOrCreateTabUserId(): string {
  const existing = sessionStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing && existing.trim().length >= 8) {
    return existing;
  }

  const created =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  sessionStorage.setItem(USER_ID_STORAGE_KEY, created);
  return created;
}

export function getSavedNickname(): string {
  return localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
}

export function saveNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
}

export function getSavedAudioInputId(): string {
  return localStorage.getItem(AUDIO_INPUT_STORAGE_KEY) ?? '';
}

export function saveAudioInputId(deviceId: string): void {
  localStorage.setItem(AUDIO_INPUT_STORAGE_KEY, deviceId);
}

export function getSavedAudioOutputId(): string {
  return localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY) ?? '';
}

export function saveAudioOutputId(deviceId: string): void {
  localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, deviceId);
}

function resolveSelection(
  servers: ServerDetails[],
  currentServerId: string | null,
  currentChannelId: string | null,
): { activeServerId: string | null; activeChannelId: string | null } {
  const activeServer =
    servers.find((s) => s.id === currentServerId) ?? servers[0] ?? null;
  if (!activeServer) {
    return { activeServerId: null, activeChannelId: null };
  }

  const channelStillExists = activeServer.channels.some(
    (c) => c.id === currentChannelId,
  );
  const activeChannelId = channelStillExists
    ? currentChannelId
    : (activeServer.channels[0]?.id ?? null);

  return {
    activeServerId: activeServer.id,
    activeChannelId,
  };
}

function mergeUniqueMessages(
  olderOrExisting: ChatMessage[],
  newer: ChatMessage[],
): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const msg of [...olderOrExisting, ...newer]) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      merged.push(msg);
    }
  }
  return merged;
}

function groupPresenceByServer(
  users: VoicePresenceUser[],
): Record<string, VoicePresenceUser[]> {
  const grouped: Record<string, VoicePresenceUser[]> = {};
  for (const user of users) {
    const list = grouped[user.serverId] ?? [];
    list.push(user);
    grouped[user.serverId] = list;
  }
  return grouped;
}

interface AppState {
  userId: string;
  nickname: string;
  socketId: string | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  onlineUsers: UserSession[];
  servers: ServerDetails[];
  activeServerId: string | null;
  activeChannelId: string | null;
  messagesByChannel: Record<string, ChatMessage[]>;
  hasMoreByChannel: Record<string, boolean>;
  loadedChannels: Record<string, boolean>;
  loadingHistoryChannelId: string | null;

  voiceStatus: VoiceStatus;
  voiceServerId: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  isMicMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  screenResolution: ScreenResolution;
  screenFps: ScreenFps;
  focusedScreenUserId: string | null;
  voiceError: string | null;
  voiceParticipants: VoiceParticipantInfo[];
  speakingUserIds: string[];
  participantVolumes: Record<string, number>;
  audioInputDevices: AudioDeviceOption[];
  audioOutputDevices: AudioDeviceOption[];
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  voicePresenceByServer: Record<string, VoicePresenceUser[]>;

  setNickname: (nickname: string) => void;
  setConnecting: () => void;
  setIdentified: (
    user: UserSession,
    onlineUsers: UserSession[],
    servers: ServerDetails[],
    voicePresence: VoicePresenceUser[],
  ) => void;
  setOnlineUsers: (onlineUsers: UserSession[]) => void;
  upsertServer: (server: ServerDetails, select?: boolean) => void;
  removeServer: (serverId: string) => void;
  selectServer: (serverId: string) => void;
  selectChannel: (channelId: string) => void;
  setLoadingHistory: (channelId: string | null) => void;
  setChannelHistory: (
    channelId: string,
    messages: ChatMessage[],
    hasMore: boolean,
    prepend: boolean,
  ) => void;
  addMessage: (message: ChatMessage) => void;

  setVoiceConnecting: (
    serverId: string,
    channelId: string,
    channelName: string,
  ) => void;
  setVoiceConnected: (
    serverId: string,
    channelId: string,
    channelName: string,
    isMicMuted: boolean,
    isDeafened: boolean,
    participants: VoiceParticipantInfo[],
  ) => void;
  setVoiceParticipants: (participants: VoiceParticipantInfo[]) => void;
  setMicMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setCameraOn: (enabled: boolean) => void;
  setScreenSharing: (enabled: boolean) => void;
  setScreenQuality: (resolution: ScreenResolution, fps: ScreenFps) => void;
  setFocusedScreenUserId: (userId: string | null) => void;
  setSpeakingUserIds: (userIds: string[]) => void;
  setParticipantVolume: (userId: string, volume: number) => void;
  setAudioDevices: (
    inputs: AudioDeviceOption[],
    outputs: AudioDeviceOption[],
  ) => void;
  setSelectedAudioInputId: (deviceId: string) => void;
  setSelectedAudioOutputId: (deviceId: string) => void;
  setServerVoicePresence: (serverId: string, users: VoicePresenceUser[]) => void;
  setVoiceError: (message: string | null) => void;
  resetVoiceState: (errorMessage?: string | null) => void;

  setDisconnected: (reason?: string) => void;
  setError: (message: string) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  userId: getOrCreateTabUserId(),
  nickname: getSavedNickname(),
  socketId: null,
  connectionStatus: 'disconnected',
  errorMessage: null,
  onlineUsers: [],
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  messagesByChannel: {},
  hasMoreByChannel: {},
  loadedChannels: {},
  loadingHistoryChannelId: null,

  voiceStatus: 'idle',
  voiceServerId: null,
  voiceChannelId: null,
  voiceChannelName: null,
  isMicMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  screenResolution: '720p',
  screenFps: 30,
  focusedScreenUserId: null,
  voiceError: null,
  voiceParticipants: [],
  speakingUserIds: [],
  participantVolumes: {},
  audioInputDevices: [],
  audioOutputDevices: [],
  selectedAudioInputId: getSavedAudioInputId(),
  selectedAudioOutputId: getSavedAudioOutputId(),
  voicePresenceByServer: {},

  setNickname: (nickname) => set({ nickname }),
  setConnecting: () =>
    set({ connectionStatus: 'connecting', errorMessage: null }),
  setIdentified: (user, onlineUsers, servers, voicePresence) =>
    set((state) => {
      const selection = resolveSelection(
        servers,
        state.activeServerId,
        state.activeChannelId,
      );
      return {
        userId: user.userId,
        nickname: user.nickname,
        socketId: user.socketId,
        connectionStatus: 'connected',
        errorMessage: null,
        onlineUsers,
        servers,
        voicePresenceByServer: groupPresenceByServer(voicePresence),
        ...selection,
      };
    }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
  upsertServer: (server, select = false) =>
    set((state) => {
      const exists = state.servers.some((s) => s.id === server.id);
      const nextServers = exists
        ? state.servers.map((s) => (s.id === server.id ? server : s))
        : [...state.servers, server];

      const selection = resolveSelection(
        nextServers,
        select ? server.id : state.activeServerId,
        select ? (server.channels[0]?.id ?? null) : state.activeChannelId,
      );

      return {
        servers: nextServers,
        ...selection,
      };
    }),
  removeServer: (serverId) =>
    set((state) => {
      const nextServers = state.servers.filter((s) => s.id !== serverId);
      const selection = resolveSelection(
        nextServers,
        state.activeServerId === serverId ? null : state.activeServerId,
        state.activeServerId === serverId ? null : state.activeChannelId,
      );
      const nextPresence = { ...state.voicePresenceByServer };
      delete nextPresence[serverId];
      return {
        servers: nextServers,
        voicePresenceByServer: nextPresence,
        ...selection,
      };
    }),
  selectServer: (serverId) =>
    set((state) => resolveSelection(state.servers, serverId, null)),
  selectChannel: (channelId) => set({ activeChannelId: channelId }),
  setLoadingHistory: (channelId) => set({ loadingHistoryChannelId: channelId }),
  setChannelHistory: (channelId, messages, hasMore, prepend) =>
    set((state) => {
      const existing = state.messagesByChannel[channelId] ?? [];
      const nextMessages = prepend
        ? mergeUniqueMessages(messages, existing)
        : mergeUniqueMessages(messages, []);
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: nextMessages,
        },
        hasMoreByChannel: {
          ...state.hasMoreByChannel,
          [channelId]: hasMore,
        },
        loadedChannels: {
          ...state.loadedChannels,
          [channelId]: true,
        },
        loadingHistoryChannelId:
          state.loadingHistoryChannelId === channelId
            ? null
            : state.loadingHistoryChannelId,
      };
    }),
  addMessage: (message) =>
    set((state) => {
      const existing = state.messagesByChannel[message.channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [message.channelId]: [...existing, message],
        },
      };
    }),

  setVoiceConnecting: (serverId, channelId, channelName) =>
    set({
      voiceStatus: 'connecting',
      voiceServerId: serverId,
      voiceChannelId: channelId,
      voiceChannelName: channelName,
      voiceError: null,
    }),
  setVoiceConnected: (
    serverId,
    channelId,
    channelName,
    isMicMuted,
    isDeafened,
    participants,
  ) =>
    set({
      voiceStatus: 'connected',
      voiceServerId: serverId,
      voiceChannelId: channelId,
      voiceChannelName: channelName,
      isMicMuted,
      isDeafened,
      voiceParticipants: participants,
    }),
  setVoiceParticipants: (participants) =>
    set({ voiceParticipants: participants }),
  setMicMuted: (muted) => set({ isMicMuted: muted }),
  setDeafened: (deafened) => set({ isDeafened: deafened }),
  setCameraOn: (enabled) => set({ isCameraOn: enabled }),
  setScreenSharing: (enabled) => set({ isScreenSharing: enabled }),
  setScreenQuality: (screenResolution, screenFps) =>
    set({ screenResolution, screenFps }),
  setFocusedScreenUserId: (focusedScreenUserId) =>
    set({ focusedScreenUserId }),
  setSpeakingUserIds: (userIds) => set({ speakingUserIds: userIds }),
  setParticipantVolume: (userId, volume) =>
    set((state) => ({
      participantVolumes: {
        ...state.participantVolumes,
        [userId]: volume,
      },
    })),
  setAudioDevices: (inputs, outputs) =>
    set({
      audioInputDevices: inputs,
      audioOutputDevices: outputs,
    }),
  setSelectedAudioInputId: (deviceId) =>
    set({ selectedAudioInputId: deviceId }),
  setSelectedAudioOutputId: (deviceId) =>
    set({ selectedAudioOutputId: deviceId }),
  setServerVoicePresence: (serverId, users) =>
    set((state) => ({
      voicePresenceByServer: {
        ...state.voicePresenceByServer,
        [serverId]: users,
      },
    })),
  setVoiceError: (message) => set({ voiceError: message }),
  resetVoiceState: (errorMessage = null) =>
    set({
      voiceStatus: 'idle',
      voiceServerId: null,
      voiceChannelId: null,
      voiceChannelName: null,
      isMicMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      focusedScreenUserId: null,
      voiceParticipants: [],
      speakingUserIds: [],
      voiceError: errorMessage,
    }),

  setDisconnected: (reason) =>
    set({
      socketId: null,
      connectionStatus: 'disconnected',
      onlineUsers: [],
      servers: [],
      activeServerId: null,
      activeChannelId: null,
      messagesByChannel: {},
      hasMoreByChannel: {},
      loadedChannels: {},
      loadingHistoryChannelId: null,
      voiceStatus: 'idle',
      voiceServerId: null,
      voiceChannelId: null,
      voiceChannelName: null,
      isMicMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      focusedScreenUserId: null,
      voiceParticipants: [],
      speakingUserIds: [],
      voicePresenceByServer: {},
      voiceError: null,
      errorMessage: reason ?? null,
    }),
  setError: (message) =>
    set({
      connectionStatus: 'error',
      errorMessage: message,
    }),
  clearError: () => set({ errorMessage: null }),
}));

import { create } from 'zustand';
import type {
  ChatMessage,
  PublicUser,
  ServerDetails,
  VoicePresenceUser,
} from '@nexusvoice/shared';
import { readStoredJson, writeStoredJson } from '../lib/config';

export type ConnectionStatus =
  | 'signedOut'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
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

export interface TypingEntry {
  nickname: string;
  until: number;
}

const AUDIO_INPUT_STORAGE_KEY = 'nexusvoice:audioInputId';
const AUDIO_OUTPUT_STORAGE_KEY = 'nexusvoice:audioOutputId';
const LAST_READ_KEY = 'nexusvoice:lastRead';
const LAST_SELECTION_KEY = 'nexusvoice:lastSelection';

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignora.
  }
}

export const getSavedAudioInputId = (): string => readString(AUDIO_INPUT_STORAGE_KEY);
export const saveAudioInputId = (id: string): void => writeString(AUDIO_INPUT_STORAGE_KEY, id);
export const getSavedAudioOutputId = (): string => readString(AUDIO_OUTPUT_STORAGE_KEY);
export const saveAudioOutputId = (id: string): void => writeString(AUDIO_OUTPUT_STORAGE_KEY, id);

/** Data da última vez que a pessoa viu cada canal (para o aviso de não lido). */
const lastReadByChannel: Record<string, string> = readStoredJson(LAST_READ_KEY, {});

function markChannelReadStorage(channelId: string, at = new Date().toISOString()): void {
  lastReadByChannel[channelId] = at;
  writeStoredJson(LAST_READ_KEY, lastReadByChannel);
}

function computeUnread(servers: ServerDetails[], activeChannelId: string | null): Record<string, boolean> {
  const unread: Record<string, boolean> = {};
  for (const server of servers) {
    for (const channel of server.channels) {
      if (channel.type !== 'text' || !channel.lastMessageAt || channel.id === activeChannelId) continue;
      const lastRead = lastReadByChannel[channel.id];
      if (!lastRead || channel.lastMessageAt > lastRead) {
        unread[channel.id] = true;
      }
    }
  }
  return unread;
}

function resolveSelection(
  servers: ServerDetails[],
  currentServerId: string | null,
  currentChannelId: string | null,
): { activeServerId: string | null; activeChannelId: string | null } {
  const activeServer = servers.find((s) => s.id === currentServerId) ?? servers[0] ?? null;
  if (!activeServer) {
    return { activeServerId: null, activeChannelId: null };
  }

  const channelStillExists = activeServer.channels.some((c) => c.id === currentChannelId);
  const firstText = activeServer.channels.find((c) => c.type === 'text');
  const activeChannelId = channelStillExists
    ? currentChannelId
    : (firstText?.id ?? activeServer.channels[0]?.id ?? null);

  writeStoredJson(LAST_SELECTION_KEY, { serverId: activeServer.id, channelId: activeChannelId });
  return { activeServerId: activeServer.id, activeChannelId };
}

function mergeUniqueMessages(older: ChatMessage[], newer: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const msg of [...older, ...newer]) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      merged.push(msg);
    }
  }
  return merged;
}

function groupPresenceByServer(users: VoicePresenceUser[]): Record<string, VoicePresenceUser[]> {
  const grouped: Record<string, VoicePresenceUser[]> = {};
  for (const user of users) {
    const list = grouped[user.serverId] ?? [];
    list.push(user);
    grouped[user.serverId] = list;
  }
  return grouped;
}

export interface ProfileCardTarget {
  userId: string;
  serverId: string | null;
  x: number;
  y: number;
}

export interface UpdateInfo {
  version: string;
  url: string;
}

interface AppState {
  me: PublicUser | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  servers: ServerDetails[];
  activeServerId: string | null;
  activeChannelId: string | null;
  messagesByChannel: Record<string, ChatMessage[]>;
  hasMoreByChannel: Record<string, boolean>;
  loadedChannels: Record<string, boolean>;
  loadingHistoryChannelId: string | null;
  unreadChannels: Record<string, boolean>;
  mentionCounts: Record<string, number>;
  typingByChannel: Record<string, Record<string, TypingEntry>>;
  windowFocused: boolean;

  voiceStatus: VoiceStatus;
  voiceServerId: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  isMicMuted: boolean;
  isDeafened: boolean;
  isPttPressed: boolean;
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

  gameActivity: string | null;
  updateInfo: UpdateInfo | null;
  profileCard: ProfileCardTarget | null;
  settingsOpen: boolean;

  setConnecting: () => void;
  setReconnecting: () => void;
  setSessionReady: (
    user: PublicUser,
    servers: ServerDetails[],
    voicePresence: VoicePresenceUser[],
    isReconnect: boolean,
  ) => void;
  setMe: (user: PublicUser) => void;
  setSignedOut: (message?: string | null) => void;
  upsertServer: (server: ServerDetails, select?: boolean) => void;
  removeServer: (serverId: string) => void;
  selectServer: (serverId: string) => void;
  selectChannel: (channelId: string) => void;
  markChannelRead: (channelId: string) => void;
  setLoadingHistory: (channelId: string | null) => void;
  setChannelHistory: (
    channelId: string,
    messages: ChatMessage[],
    hasMore: boolean,
    prepend: boolean,
  ) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (message: ChatMessage) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  setTyping: (channelId: string, userId: string, nickname: string) => void;
  clearTyping: (channelId: string, userId: string) => void;
  pruneTyping: () => void;
  setWindowFocused: (focused: boolean) => void;

  setVoiceConnecting: (serverId: string, channelId: string, channelName: string) => void;
  setVoiceReconnecting: (reconnecting: boolean) => void;
  setVoiceConnected: (
    serverId: string,
    channelId: string,
    channelName: string,
    isMicMuted: boolean,
    isDeafened: boolean,
  ) => void;
  setVoiceParticipants: (participants: VoiceParticipantInfo[]) => void;
  setMicMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setPttPressed: (pressed: boolean) => void;
  setCameraOn: (enabled: boolean) => void;
  setScreenSharing: (enabled: boolean) => void;
  setScreenQuality: (resolution: ScreenResolution, fps: ScreenFps) => void;
  setFocusedScreenUserId: (userId: string | null) => void;
  setSpeakingUserIds: (userIds: string[]) => void;
  setParticipantVolume: (userId: string, volume: number) => void;
  setAudioDevices: (inputs: AudioDeviceOption[], outputs: AudioDeviceOption[]) => void;
  setSelectedAudioInputId: (deviceId: string) => void;
  setSelectedAudioOutputId: (deviceId: string) => void;
  setServerVoicePresence: (serverId: string, users: VoicePresenceUser[]) => void;
  setVoiceError: (message: string | null) => void;
  resetVoiceState: (errorMessage?: string | null) => void;

  setGameActivity: (activity: string | null) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  openProfileCard: (target: ProfileCardTarget | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setError: (message: string | null) => void;
}

const savedSelection = readStoredJson<{ serverId: string | null; channelId: string | null }>(
  LAST_SELECTION_KEY,
  { serverId: null, channelId: null },
);

const emptyChatState = {
  servers: [] as ServerDetails[],
  messagesByChannel: {},
  hasMoreByChannel: {},
  loadedChannels: {},
  loadingHistoryChannelId: null,
  unreadChannels: {},
  mentionCounts: {},
  typingByChannel: {},
};

const emptyVoiceState = {
  voiceStatus: 'idle' as VoiceStatus,
  voiceServerId: null,
  voiceChannelId: null,
  voiceChannelName: null,
  isMicMuted: false,
  isDeafened: false,
  isPttPressed: false,
  isCameraOn: false,
  isScreenSharing: false,
  focusedScreenUserId: null,
  voiceParticipants: [],
  speakingUserIds: [],
};

export const useAppStore = create<AppState>((set) => ({
  me: null,
  connectionStatus: 'signedOut',
  errorMessage: null,
  activeServerId: savedSelection.serverId,
  activeChannelId: savedSelection.channelId,
  ...emptyChatState,
  windowFocused: typeof document === 'undefined' ? true : document.hasFocus(),

  ...emptyVoiceState,
  screenResolution: '720p',
  screenFps: 30,
  voiceError: null,
  participantVolumes: {},
  audioInputDevices: [],
  audioOutputDevices: [],
  selectedAudioInputId: getSavedAudioInputId(),
  selectedAudioOutputId: getSavedAudioOutputId(),
  voicePresenceByServer: {},

  gameActivity: null,
  updateInfo: null,
  profileCard: null,
  settingsOpen: false,

  setConnecting: () => set({ connectionStatus: 'connecting', errorMessage: null }),
  setReconnecting: () =>
    set((state) => (state.me ? { connectionStatus: 'reconnecting' } : { connectionStatus: 'connecting' })),
  setSessionReady: (user, servers, voicePresence, isReconnect) =>
    set((state) => {
      const selection = resolveSelection(servers, state.activeServerId, state.activeChannelId);
      return {
        me: user,
        connectionStatus: 'connected',
        errorMessage: null,
        servers,
        voicePresenceByServer: groupPresenceByServer(voicePresence),
        unreadChannels: computeUnread(servers, selection.activeChannelId),
        // Depois de uma queda, o histórico em memória pode ter buracos: recarrega ao abrir.
        ...(isReconnect ? { messagesByChannel: {}, hasMoreByChannel: {}, loadedChannels: {} } : {}),
        ...selection,
      };
    }),
  setMe: (user) => set({ me: user }),
  setSignedOut: (message = null) =>
    set({
      me: null,
      connectionStatus: 'signedOut',
      errorMessage: message,
      ...emptyChatState,
      ...emptyVoiceState,
      voicePresenceByServer: {},
      profileCard: null,
      settingsOpen: false,
    }),
  upsertServer: (server, select = false) =>
    set((state) => {
      const exists = state.servers.some((s) => s.id === server.id);
      const nextServers = exists
        ? state.servers.map((s) => (s.id === server.id ? server : s))
        : [...state.servers, server];
      const selection = resolveSelection(
        nextServers,
        select ? server.id : state.activeServerId,
        select ? null : state.activeChannelId,
      );
      return { servers: nextServers, ...selection };
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
      return { servers: nextServers, voicePresenceByServer: nextPresence, ...selection };
    }),
  selectServer: (serverId) => set((state) => resolveSelection(state.servers, serverId, null)),
  selectChannel: (channelId) =>
    set((state) => {
      const selection = resolveSelection(state.servers, state.activeServerId, channelId);
      markChannelReadStorage(channelId);
      const unreadChannels = { ...state.unreadChannels };
      const mentionCounts = { ...state.mentionCounts };
      delete unreadChannels[channelId];
      delete mentionCounts[channelId];
      return { ...selection, unreadChannels, mentionCounts };
    }),
  markChannelRead: (channelId) =>
    set((state) => {
      markChannelReadStorage(channelId);
      if (!state.unreadChannels[channelId] && !state.mentionCounts[channelId]) return state;
      const unreadChannels = { ...state.unreadChannels };
      const mentionCounts = { ...state.mentionCounts };
      delete unreadChannels[channelId];
      delete mentionCounts[channelId];
      return { unreadChannels, mentionCounts };
    }),
  setLoadingHistory: (channelId) => set({ loadingHistoryChannelId: channelId }),
  setChannelHistory: (channelId, messages, hasMore, prepend) =>
    set((state) => {
      const existing = state.messagesByChannel[channelId] ?? [];
      const nextMessages = prepend
        ? mergeUniqueMessages(messages, existing)
        : mergeUniqueMessages(messages, []);
      return {
        messagesByChannel: { ...state.messagesByChannel, [channelId]: nextMessages },
        hasMoreByChannel: { ...state.hasMoreByChannel, [channelId]: hasMore },
        loadedChannels: { ...state.loadedChannels, [channelId]: true },
        loadingHistoryChannelId:
          state.loadingHistoryChannelId === channelId ? null : state.loadingHistoryChannelId,
      };
    }),
  addMessage: (message) =>
    set((state) => {
      const existing = state.messagesByChannel[message.channelId];
      const isMine = message.authorId === state.me?.id;
      const isViewing = state.activeChannelId === message.channelId && state.windowFocused;
      const patch: Partial<AppState> = {};

      // Só junta na lista se o canal já foi carregado; senão o histórico completo vem ao abrir.
      if (existing) {
        if (existing.some((m) => m.id === message.id)) return state;
        patch.messagesByChannel = {
          ...state.messagesByChannel,
          [message.channelId]: [...existing, message],
        };
      }

      if (isMine || isViewing) {
        markChannelReadStorage(message.channelId, message.createdAt);
      } else {
        patch.unreadChannels = { ...state.unreadChannels, [message.channelId]: true };
        if (state.me && message.mentions.includes(state.me.id)) {
          patch.mentionCounts = {
            ...state.mentionCounts,
            [message.channelId]: (state.mentionCounts[message.channelId] ?? 0) + 1,
          };
        }
      }

      // Quem mandou mensagem parou de digitar.
      const typing = state.typingByChannel[message.channelId];
      if (typing?.[message.authorId]) {
        const nextTyping = { ...typing };
        delete nextTyping[message.authorId];
        patch.typingByChannel = { ...state.typingByChannel, [message.channelId]: nextTyping };
      }

      // Atualiza a data da última mensagem do canal.
      patch.servers = state.servers.map((server) =>
        server.id !== message.serverId
          ? server
          : {
              ...server,
              channels: server.channels.map((c) =>
                c.id === message.channelId ? { ...c, lastMessageAt: message.createdAt } : c,
              ),
            },
      );
      return patch;
    }),
  updateMessage: (message) =>
    set((state) => {
      const existing = state.messagesByChannel[message.channelId];
      if (!existing) return state;
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [message.channelId]: existing.map((m) => (m.id === message.id ? message : m)),
        },
      };
    }),
  removeMessage: (channelId, messageId) =>
    set((state) => {
      const existing = state.messagesByChannel[channelId];
      if (!existing) return state;
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: existing
            .filter((m) => m.id !== messageId)
            .map((m) =>
              m.replyTo && 'authorId' in m.replyTo && m.replyTo.id === messageId
                ? { ...m, replyTo: { id: messageId, deleted: true as const } }
                : m,
            ),
        },
      };
    }),
  setTyping: (channelId, userId, nickname) =>
    set((state) => ({
      typingByChannel: {
        ...state.typingByChannel,
        [channelId]: {
          ...(state.typingByChannel[channelId] ?? {}),
          [userId]: { nickname, until: Date.now() + 6000 },
        },
      },
    })),
  clearTyping: (channelId, userId) =>
    set((state) => {
      const current = state.typingByChannel[channelId];
      if (!current?.[userId]) return state;
      const next = { ...current };
      delete next[userId];
      return { typingByChannel: { ...state.typingByChannel, [channelId]: next } };
    }),
  pruneTyping: () =>
    set((state) => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, Record<string, TypingEntry>> = {};
      for (const [channelId, users] of Object.entries(state.typingByChannel)) {
        const kept: Record<string, TypingEntry> = {};
        for (const [userId, entry] of Object.entries(users)) {
          if (entry.until > now) kept[userId] = entry;
          else changed = true;
        }
        next[channelId] = kept;
      }
      return changed ? { typingByChannel: next } : state;
    }),
  setWindowFocused: (focused) =>
    set((state) => {
      if (focused && state.activeChannelId) {
        markChannelReadStorage(state.activeChannelId);
        const unreadChannels = { ...state.unreadChannels };
        const mentionCounts = { ...state.mentionCounts };
        delete unreadChannels[state.activeChannelId];
        delete mentionCounts[state.activeChannelId];
        return { windowFocused: true, unreadChannels, mentionCounts };
      }
      return { windowFocused: focused };
    }),

  setVoiceConnecting: (serverId, channelId, channelName) =>
    set({
      voiceStatus: 'connecting',
      voiceServerId: serverId,
      voiceChannelId: channelId,
      voiceChannelName: channelName,
      voiceError: null,
    }),
  setVoiceReconnecting: (reconnecting) =>
    set((state) =>
      state.voiceStatus === 'idle'
        ? state
        : { voiceStatus: reconnecting ? 'reconnecting' : 'connected' },
    ),
  setVoiceConnected: (serverId, channelId, channelName, isMicMuted, isDeafened) =>
    set({
      voiceStatus: 'connected',
      voiceServerId: serverId,
      voiceChannelId: channelId,
      voiceChannelName: channelName,
      isMicMuted,
      isDeafened,
    }),
  setVoiceParticipants: (participants) => set({ voiceParticipants: participants }),
  setMicMuted: (muted) => set({ isMicMuted: muted }),
  setDeafened: (deafened) => set({ isDeafened: deafened }),
  setPttPressed: (pressed) => set({ isPttPressed: pressed }),
  setCameraOn: (enabled) => set({ isCameraOn: enabled }),
  setScreenSharing: (enabled) => set({ isScreenSharing: enabled }),
  setScreenQuality: (screenResolution, screenFps) => set({ screenResolution, screenFps }),
  setFocusedScreenUserId: (focusedScreenUserId) => set({ focusedScreenUserId }),
  setSpeakingUserIds: (userIds) => set({ speakingUserIds: userIds }),
  setParticipantVolume: (userId, volume) =>
    set((state) => ({ participantVolumes: { ...state.participantVolumes, [userId]: volume } })),
  setAudioDevices: (inputs, outputs) =>
    set({ audioInputDevices: inputs, audioOutputDevices: outputs }),
  setSelectedAudioInputId: (deviceId) => set({ selectedAudioInputId: deviceId }),
  setSelectedAudioOutputId: (deviceId) => set({ selectedAudioOutputId: deviceId }),
  setServerVoicePresence: (serverId, users) =>
    set((state) => ({
      voicePresenceByServer: { ...state.voicePresenceByServer, [serverId]: users },
    })),
  setVoiceError: (message) => set({ voiceError: message }),
  resetVoiceState: (errorMessage = null) => set({ ...emptyVoiceState, voiceError: errorMessage }),

  setGameActivity: (gameActivity) => set({ gameActivity }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  openProfileCard: (profileCard) => set({ profileCard }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setError: (errorMessage) => set({ errorMessage }),
}));

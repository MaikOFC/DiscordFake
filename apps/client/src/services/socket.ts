import { io, type Socket } from 'socket.io-client';
import type {
  ActionResult,
  Channel,
  ChannelType,
  ChatMessage,
  ClientToServerEvents,
  MessageHistoryResult,
  ServerDetails,
  ServerToClientEvents,
} from '@nexusvoice/shared';
import { saveNickname, useAppStore } from '../store/useAppStore';
import { leaveVoiceChannel } from './voice';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// Toda a lógica do Socket.IO fica aqui, separada dos componentes React.
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  SERVER_URL,
  {
    autoConnect: false,
  },
);

let listenersRegistered = false;

function sendIdentify(): void {
  const { userId, nickname } = useAppStore.getState();
  const trimmedNickname = nickname.trim();

  if (trimmedNickname.length < 2 || trimmedNickname.length > 32) {
    useAppStore
      .getState()
      .setError('O nickname deve ter entre 2 e 32 caracteres.');
    return;
  }

  socket.emit(
    'session:identify',
    { userId, nickname: trimmedNickname },
    (result) => {
      if (!result.ok) {
        useAppStore
          .getState()
          .setError(result.error ?? 'Não foi possível identificar sua sessão.');
      }
    },
  );
}

function ensureListeners(): void {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;

  socket.on('connect', () => {
    sendIdentify();
  });

  socket.on('session:ready', ({ user, onlineUsers, servers, voicePresence }) => {
    useAppStore
      .getState()
      .setIdentified(user, onlineUsers, servers, voicePresence);

    // Se já estivermos em chamada após uma reconexão breve do socket, reanuncia presença.
    const { voiceStatus, voiceChannelId, isMicMuted, isDeafened } =
      useAppStore.getState();
    if (voiceStatus === 'connected' && voiceChannelId) {
      emitJoinVoicePresence(voiceChannelId, isMicMuted, isDeafened);
    }
  });

  socket.on('users:online', ({ onlineUsers }) => {
    useAppStore.getState().setOnlineUsers(onlineUsers);
  });

  socket.on('server:updated', ({ server }) => {
    useAppStore.getState().upsertServer(server);
  });

  socket.on('server:deleted', ({ serverId }) => {
    const { voiceServerId } = useAppStore.getState();
    if (voiceServerId === serverId) {
      void leaveVoiceChannel();
    }
    useAppStore.getState().removeServer(serverId);
  });

  socket.on('message:new', ({ message }) => {
    useAppStore.getState().addMessage(message);
  });

  socket.on('presence:updated', ({ serverId, users }) => {
    useAppStore.getState().setServerVoicePresence(serverId, users);
  });

  socket.on('server:error', ({ message }) => {
    useAppStore.getState().setError(message);
  });

  socket.on('connect_error', () => {
    useAppStore
      .getState()
      .setError(
        'Não foi possível conectar ao servidor. Verifique se ele está rodando.',
      );
  });

  socket.on('disconnect', (reason) => {
    const message =
      reason === 'io client disconnect'
        ? undefined
        : 'Conexão com o servidor foi perdida. Tentando reconectar...';
    useAppStore.getState().setDisconnected(message);
  });
}

export function connectWithNickname(rawNickname: string): void {
  const nickname = rawNickname.trim();
  if (nickname.length < 2 || nickname.length > 32) {
    useAppStore
      .getState()
      .setError('O nickname deve ter entre 2 e 32 caracteres.');
    return;
  }

  saveNickname(nickname);
  useAppStore.getState().setNickname(nickname);
  useAppStore.getState().setConnecting();

  ensureListeners();

  if (socket.connected) {
    sendIdentify();
  } else {
    socket.connect();
  }
}

export function disconnectSocket(): void {
  void leaveVoiceChannel();
  socket.disconnect();
  useAppStore.getState().setDisconnected();
}

export function createServer(
  name: string,
): Promise<ActionResult<ServerDetails>> {
  return new Promise((resolve) => {
    socket.emit('server:create', { name }, (result) => {
      if (result.ok && result.data) {
        useAppStore.getState().upsertServer(result.data, true);
      }
      resolve(result);
    });
  });
}

export function joinServerByInvite(
  inviteCode: string,
): Promise<ActionResult<ServerDetails>> {
  return new Promise((resolve) => {
    socket.emit('server:join', { inviteCode }, (result) => {
      if (result.ok && result.data) {
        useAppStore.getState().upsertServer(result.data, true);
      }
      resolve(result);
    });
  });
}

export function deleteServer(serverId: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    socket.emit('server:delete', { serverId }, (result) => {
      if (result.ok) {
        useAppStore.getState().removeServer(serverId);
      }
      resolve(result);
    });
  });
}

export function createChannel(
  serverId: string,
  name: string,
  type: ChannelType,
): Promise<ActionResult<Channel>> {
  return new Promise((resolve) => {
    socket.emit('channel:create', { serverId, name, type }, (result) => {
      if (result.ok && result.data) {
        useAppStore.getState().selectChannel(result.data.id);
      }
      resolve(result);
    });
  });
}

export function deleteChannel(
  serverId: string,
  channelId: string,
): Promise<ActionResult> {
  return new Promise((resolve) => {
    socket.emit('channel:delete', { serverId, channelId }, (result) => {
      resolve(result);
    });
  });
}

export function loadChannelMessages(
  channelId: string,
  beforeMessageId?: string,
): Promise<ActionResult<MessageHistoryResult>> {
  useAppStore.getState().setLoadingHistory(channelId);
  return new Promise((resolve) => {
    socket.emit(
      'message:list',
      { channelId, before: beforeMessageId, limit: 30 },
      (result) => {
        if (result.ok && result.data) {
          useAppStore
            .getState()
            .setChannelHistory(
              channelId,
              result.data.messages,
              result.data.hasMore,
              Boolean(beforeMessageId),
            );
        } else {
          useAppStore.getState().setLoadingHistory(null);
        }
        resolve(result);
      },
    );
  });
}

export function sendTextMessage(
  channelId: string,
  content: string,
): Promise<ActionResult<ChatMessage>> {
  return new Promise((resolve) => {
    socket.emit('message:send', { channelId, content }, (result) => {
      if (result.ok && result.data) {
        useAppStore.getState().addMessage(result.data);
      }
      resolve(result);
    });
  });
}

export function emitJoinVoicePresence(
  channelId: string,
  isMuted: boolean,
  isDeafened: boolean,
): void {
  if (!socket.connected) return;
  socket.emit('presence:join_voice', { channelId, isMuted, isDeafened });
}

export function emitUpdateVoicePresence(patch: {
  isMuted?: boolean;
  isDeafened?: boolean;
  isCameraOn?: boolean;
  isScreenSharing?: boolean;
}): void {
  if (!socket.connected) return;
  socket.emit('presence:update_voice', patch);
}

export function emitLeaveVoicePresence(): void {
  if (!socket.connected) return;
  socket.emit('presence:leave_voice');
}

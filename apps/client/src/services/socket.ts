import { io, type Socket } from 'socket.io-client';
import type {
  ActionResult,
  AuthResult,
  Channel,
  ChannelType,
  ChatMessage,
  ClientToServerEvents,
  MessageHistoryResult,
  ServerDetails,
  ServerToClientEvents,
} from '@nexusvoice/shared';
import { api, setUnauthorizedHandler } from '../lib/api';
import { getSavedToken, getServerUrl, saveServerUrl, saveToken } from '../lib/config';
import { showNotification } from '../lib/desktop';
import { playSound } from '../lib/sounds';
import { useAppStore } from '../store/useAppStore';
import { getSettings } from '../store/useSettings';
import { leaveVoiceChannel, rejoinVoiceAfterReconnect } from './voice';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Toda a lógica do Socket.IO fica aqui, separada dos componentes React.
let socket: AppSocket | null = null;
let hasBeenReady = false;

function describeMessage(message: ChatMessage): string {
  if (message.content) return message.content.slice(0, 140);
  if (message.attachments.length > 0) return 'Enviou um arquivo';
  return '';
}

function handleIncomingMessage(message: ChatMessage): void {
  const state = useAppStore.getState();
  const me = state.me;
  state.addMessage(message);
  if (!me || message.authorId === me.id) return;

  const isMention = message.mentions.includes(me.id);
  const isViewing = state.activeChannelId === message.channelId && state.windowFocused;
  const mode = getSettings().notifications;

  if (isMention && !isViewing) {
    playSound('mention');
  }
  const shouldNotify = !state.windowFocused && (mode === 'all' || (mode === 'mentions' && isMention));
  if (shouldNotify) {
    const server = state.servers.find((s) => s.id === message.serverId);
    const channel = server?.channels.find((c) => c.id === message.channelId);
    const where = channel ? ` em #${channel.name}` : '';
    void showNotification(`${message.authorNickname}${where}`, describeMessage(message));
  }
}

function registerListeners(s: AppSocket): void {
  s.on('session:ready', ({ user, servers, voicePresence }) => {
    const isReconnect = hasBeenReady;
    hasBeenReady = true;
    useAppStore.getState().setSessionReady(user, servers, voicePresence, isReconnect);
    rejoinVoiceAfterReconnect();
    // O servidor esquece a atividade quando a conexão cai: manda de novo.
    const game = useAppStore.getState().gameActivity;
    if (game) s.emit('presence:activity', { activity: game });
  });

  s.on('session:user', ({ user }) => {
    useAppStore.getState().setMe(user);
  });

  s.on('server:updated', ({ server }) => {
    useAppStore.getState().upsertServer(server);
  });

  s.on('server:deleted', ({ serverId }) => {
    if (useAppStore.getState().voiceServerId === serverId) {
      void leaveVoiceChannel();
    }
    useAppStore.getState().removeServer(serverId);
  });

  s.on('message:new', ({ message }) => handleIncomingMessage(message));
  s.on('message:updated', ({ message }) => useAppStore.getState().updateMessage(message));
  s.on('message:deleted', ({ channelId, messageId }) =>
    useAppStore.getState().removeMessage(channelId, messageId),
  );

  s.on('typing:update', ({ channelId, userId, nickname }) => {
    useAppStore.getState().setTyping(channelId, userId, nickname);
  });

  s.on('presence:updated', ({ serverId, users }) => {
    useAppStore.getState().setServerVoicePresence(serverId, users);
  });

  s.on('server:error', ({ message }) => {
    useAppStore.getState().setError(message);
  });

  s.on('connect_error', (error) => {
    if (error.message === 'unauthorized') {
      void signOut('Sua sessão expirou. Entre de novo.');
      return;
    }
    const state = useAppStore.getState();
    if (state.me) {
      state.setReconnecting();
    } else {
      // Abrindo o app já logado: continua tentando e avisa na tela de espera.
      state.setError('O servidor não respondeu. Tentando de novo...');
    }
  });

  s.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return;
    // O Socket.IO tenta reconectar sozinho. A tela continua igual, só aparece o aviso.
    useAppStore.getState().setReconnecting();
    if (reason === 'io server disconnect') {
      s.connect();
    }
  });
}

function connectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();

  const token = getSavedToken();
  if (!token) {
    useAppStore.getState().setSignedOut();
    return;
  }

  hasBeenReady = false;
  useAppStore.getState().setConnecting();
  socket = io(getServerUrl(), {
    auth: { token },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    transports: ['websocket', 'polling'],
  });
  registerListeners(socket);
}

setUnauthorizedHandler(() => {
  void signOut('Sua sessão expirou. Entre de novo.');
});

/** Ao abrir o app: se já tem login salvo para este servidor, entra direto. */
export function resumeSession(): void {
  if (getSavedToken()) {
    connectSocket();
  }
}

export async function signIn(
  serverUrl: string,
  mode: 'login' | 'register',
  username: string,
  password: string,
  displayName: string,
): Promise<ActionResult<AuthResult>> {
  const result =
    mode === 'login'
      ? await api.login(serverUrl, username, password)
      : await api.register(serverUrl, username, password, displayName);
  if (result.ok && result.data) {
    saveServerUrl(serverUrl);
    saveToken(result.data.token, serverUrl);
    connectSocket();
  }
  return result;
}

/** Para de tentar conectar e volta para o login, sem apagar o login salvo. */
export function cancelConnection(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  hasBeenReady = false;
  useAppStore.getState().setSignedOut();
}

export async function signOut(message: string | null = null): Promise<void> {
  await leaveVoiceChannel();
  const token = getSavedToken();
  if (token && !message) {
    await api.logout();
  }
  saveToken(null);
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  hasBeenReady = false;
  useAppStore.getState().setSignedOut(message);
}

function emitWithAck<T>(
  emit: (s: AppSocket, ack: (result: ActionResult<T>) => void) => void,
): Promise<ActionResult<T>> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: 'Sem conexão com o servidor. Tentando reconectar...' });
      return;
    }
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'O servidor demorou para responder. Tente de novo.' }),
      10000,
    );
    emit(socket, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

export async function createServer(name: string): Promise<ActionResult<ServerDetails>> {
  const result = await emitWithAck<ServerDetails>((s, ack) => s.emit('server:create', { name }, ack));
  if (result.ok && result.data) useAppStore.getState().upsertServer(result.data, true);
  return result;
}

export async function joinServerByInvite(inviteCode: string): Promise<ActionResult<ServerDetails>> {
  const result = await emitWithAck<ServerDetails>((s, ack) =>
    s.emit('server:join', { inviteCode }, ack),
  );
  if (result.ok && result.data) useAppStore.getState().upsertServer(result.data, true);
  return result;
}

export async function leaveServer(serverId: string): Promise<ActionResult> {
  if (useAppStore.getState().voiceServerId === serverId) {
    await leaveVoiceChannel();
  }
  const result = await emitWithAck<undefined>((s, ack) => s.emit('server:leave', { serverId }, ack));
  if (result.ok) useAppStore.getState().removeServer(serverId);
  return result;
}

export async function deleteServer(serverId: string): Promise<ActionResult> {
  const result = await emitWithAck<undefined>((s, ack) => s.emit('server:delete', { serverId }, ack));
  if (result.ok) useAppStore.getState().removeServer(serverId);
  return result;
}

export async function createChannel(
  serverId: string,
  name: string,
  type: ChannelType,
): Promise<ActionResult<Channel>> {
  const result = await emitWithAck<Channel>((s, ack) =>
    s.emit('channel:create', { serverId, name, type }, ack),
  );
  if (result.ok && result.data && type === 'text') {
    useAppStore.getState().selectChannel(result.data.id);
  }
  return result;
}

export function deleteChannel(serverId: string, channelId: string): Promise<ActionResult> {
  return emitWithAck<undefined>((s, ack) => s.emit('channel:delete', { serverId, channelId }, ack));
}

export async function loadChannelMessages(
  channelId: string,
  beforeMessageId?: string,
): Promise<ActionResult<MessageHistoryResult>> {
  useAppStore.getState().setLoadingHistory(channelId);
  const result = await emitWithAck<MessageHistoryResult>((s, ack) =>
    s.emit('message:list', { channelId, before: beforeMessageId, limit: 30 }, ack),
  );
  if (result.ok && result.data) {
    useAppStore
      .getState()
      .setChannelHistory(channelId, result.data.messages, result.data.hasMore, Boolean(beforeMessageId));
  } else {
    useAppStore.getState().setLoadingHistory(null);
  }
  return result;
}

export async function sendTextMessage(
  channelId: string,
  content: string,
  replyToId?: string,
  attachmentIds?: string[],
): Promise<ActionResult<ChatMessage>> {
  const result = await emitWithAck<ChatMessage>((s, ack) =>
    s.emit('message:send', { channelId, content, replyToId, attachmentIds }, ack),
  );
  if (result.ok && result.data) useAppStore.getState().addMessage(result.data);
  return result;
}

export async function editTextMessage(
  messageId: string,
  content: string,
): Promise<ActionResult<ChatMessage>> {
  const result = await emitWithAck<ChatMessage>((s, ack) =>
    s.emit('message:edit', { messageId, content }, ack),
  );
  if (result.ok && result.data) useAppStore.getState().updateMessage(result.data);
  return result;
}

export async function deleteTextMessage(message: ChatMessage): Promise<ActionResult> {
  const result = await emitWithAck<undefined>((s, ack) =>
    s.emit('message:delete', { messageId: message.id }, ack),
  );
  if (result.ok) useAppStore.getState().removeMessage(message.channelId, message.id);
  return result;
}

export function emitTyping(channelId: string): void {
  if (socket?.connected) socket.emit('typing:start', { channelId });
}

export function emitActivity(activity: string | null): void {
  if (socket?.connected) socket.emit('presence:activity', { activity });
}

export function emitJoinVoicePresence(channelId: string, isMuted: boolean, isDeafened: boolean): void {
  if (socket?.connected) socket.emit('presence:join_voice', { channelId, isMuted, isDeafened });
}

export function emitUpdateVoicePresence(patch: {
  isMuted?: boolean;
  isDeafened?: boolean;
  isCameraOn?: boolean;
  isScreenSharing?: boolean;
}): void {
  if (socket?.connected) socket.emit('presence:update_voice', patch);
}

export function emitLeaveVoicePresence(): void {
  if (socket?.connected) socket.emit('presence:leave_voice');
}

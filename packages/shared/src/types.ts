/**
 * Tipos compartilhados entre servidor e cliente.
 * Este pacote tem apenas tipos (importados com `import type`, sem etapa de build).
 */

/** Resposta da rota de teste do servidor (/ e /api/health). */
export interface HealthResponse {
  ok: boolean;
  app: string;
  message: string;
  timestamp: string;
}

/** Sessão de uma aba conectada ao servidor. */
export interface UserSession {
  /** ID único gerado por aba no sessionStorage. */
  userId: string;
  /** Nome de exibição guardado no localStorage. */
  nickname: string;
  /** ID atual da conexão Socket.IO. */
  socketId: string;
}

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  createdAt: string;
}

export interface ServerMember {
  userId: string;
  nickname: string;
  joinedAt: string;
  online: boolean;
}

export interface ServerDetails {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
  channels: Channel[];
  members: ServerMember[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  serverId: string;
  authorId: string;
  authorNickname: string;
  content: string;
  createdAt: string;
}

export interface MessageHistoryResult {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface VoiceTokenPayload {
  token: string;
  url: string;
  roomName: string;
  channelName: string;
  serverId: string;
}

export interface VoicePresenceUser {
  userId: string;
  nickname: string;
  serverId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
}

/** Resposta padrão de confirmação para eventos do cliente. */
export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Resposta padrão de identificação de sessão. */
export interface IdentifyResult {
  ok: boolean;
  error?: string;
  user?: UserSession;
}

/** Eventos que o servidor envia para o cliente via Socket.IO. */
export interface ServerToClientEvents {
  'server:welcome': (payload: { socketId: string; message: string }) => void;
  'session:ready': (payload: {
    user: UserSession;
    onlineUsers: UserSession[];
    servers: ServerDetails[];
    voicePresence: VoicePresenceUser[];
  }) => void;
  'users:online': (payload: { onlineUsers: UserSession[] }) => void;
  'server:updated': (payload: { server: ServerDetails }) => void;
  'server:deleted': (payload: { serverId: string }) => void;
  'message:new': (payload: { message: ChatMessage }) => void;
  'presence:updated': (payload: {
    serverId: string;
    users: VoicePresenceUser[];
  }) => void;
  'server:error': (payload: { message: string }) => void;
}

/** Eventos que o cliente envia para o servidor via Socket.IO. */
export interface ClientToServerEvents {
  'session:identify': (
    payload: { userId: string; nickname: string },
    ack?: (result: IdentifyResult) => void,
  ) => void;
  'server:create': (
    payload: { name: string },
    ack?: (result: ActionResult<ServerDetails>) => void,
  ) => void;
  'server:join': (
    payload: { inviteCode: string },
    ack?: (result: ActionResult<ServerDetails>) => void,
  ) => void;
  'server:delete': (
    payload: { serverId: string },
    ack?: (result: ActionResult) => void,
  ) => void;
  'channel:create': (
    payload: { serverId: string; name: string; type: ChannelType },
    ack?: (result: ActionResult<Channel>) => void,
  ) => void;
  'channel:delete': (
    payload: { serverId: string; channelId: string },
    ack?: (result: ActionResult) => void,
  ) => void;
  'message:list': (
    payload: { channelId: string; before?: string; limit?: number },
    ack?: (result: ActionResult<MessageHistoryResult>) => void,
  ) => void;
  'message:send': (
    payload: { channelId: string; content: string },
    ack?: (result: ActionResult<ChatMessage>) => void,
  ) => void;
  'presence:join_voice': (
    payload: { channelId: string; isMuted: boolean; isDeafened: boolean },
    ack?: (result: ActionResult) => void,
  ) => void;
  'presence:update_voice': (payload: {
    isMuted?: boolean;
    isDeafened?: boolean;
    isCameraOn?: boolean;
    isScreenSharing?: boolean;
  }) => void;
  'presence:leave_voice': () => void;
  'client:ping': (ack: (ok: boolean) => void) => void;
}

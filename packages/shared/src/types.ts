/**
 * Tipos compartilhados entre servidor e cliente.
 * Quase tudo aqui é tipo (`import type`). A exceção é `LIMITS`, um objeto comum
 * que servidor e cliente importam direto do .ts, sem etapa de build.
 */

/** Resposta da rota de teste do servidor (/ e /api/health). */
export interface HealthResponse {
  ok: boolean;
  app: string;
  message: string;
  timestamp: string;
  /** Versão da API. O cliente usa para saber se o endereço digitado é mesmo um servidor NexusVoice. */
  apiVersion: number;
}

/** Limites usados pelo servidor e repetidos no cliente para avisar antes de enviar. */
export const LIMITS = {
  usernameMin: 3,
  usernameMax: 20,
  passwordMin: 8,
  passwordMax: 128,
  displayNameMin: 2,
  displayNameMax: 32,
  bioMax: 190,
  serverNameMin: 2,
  serverNameMax: 50,
  channelNameMin: 1,
  channelNameMax: 32,
  messageMax: 2000,
  attachmentsPerMessage: 4,
  attachmentMaxBytes: 10 * 1024 * 1024,
  avatarMaxBytes: 8 * 1024 * 1024,
  bannerMaxBytes: 10 * 1024 * 1024,
  activityMax: 64,
} as const;

/** Perfil público de uma conta. As URLs de mídia são caminhos relativos ao servidor (ex.: /uploads/x.gif). */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  createdAt: string;
  /** Data da última mensagem do canal (só canais de texto). Usado para marcar canal não lido. */
  lastMessageAt: string | null;
}

export interface ServerMember extends PublicUser {
  /** Igual ao displayName. Mantido para não quebrar o código que já usava `nickname`. */
  nickname: string;
  joinedAt: string;
  online: boolean;
  /** Jogo ou atividade detectada pelo app de desktop (ex.: "VALORANT"). */
  activity: string | null;
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

export interface MessageAttachment {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MessageReplyPreview {
  id: string;
  authorId: string;
  authorNickname: string;
  /** Começo do texto da mensagem respondida. */
  content: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string | null;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  serverId: string;
  authorId: string;
  authorNickname: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  /** Mensagem que esta responde. `deleted` quando a original foi apagada. */
  replyTo: MessageReplyPreview | { id: string; deleted: true } | null;
  attachments: MessageAttachment[];
  /** IDs das pessoas marcadas com @usuario. */
  mentions: string[];
  linkPreviews: LinkPreview[];
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
  avatarUrl: string | null;
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

/** Eventos que o servidor envia para o cliente via Socket.IO. */
export interface ServerToClientEvents {
  'session:ready': (payload: {
    user: PublicUser;
    servers: ServerDetails[];
    voicePresence: VoicePresenceUser[];
  }) => void;
  /** O próprio perfil mudou (por exemplo, em outra janela). */
  'session:user': (payload: { user: PublicUser }) => void;
  'server:updated': (payload: { server: ServerDetails }) => void;
  'server:deleted': (payload: { serverId: string }) => void;
  'message:new': (payload: { message: ChatMessage }) => void;
  'message:updated': (payload: { message: ChatMessage }) => void;
  'message:deleted': (payload: { serverId: string; channelId: string; messageId: string }) => void;
  'typing:update': (payload: {
    serverId: string;
    channelId: string;
    userId: string;
    nickname: string;
  }) => void;
  'presence:updated': (payload: { serverId: string; users: VoicePresenceUser[] }) => void;
  'server:error': (payload: { message: string }) => void;
}

/** Eventos que o cliente envia para o servidor via Socket.IO. */
export interface ClientToServerEvents {
  'server:create': (
    payload: { name: string },
    ack?: (result: ActionResult<ServerDetails>) => void,
  ) => void;
  'server:join': (
    payload: { inviteCode: string },
    ack?: (result: ActionResult<ServerDetails>) => void,
  ) => void;
  'server:leave': (payload: { serverId: string }, ack?: (result: ActionResult) => void) => void;
  'server:delete': (payload: { serverId: string }, ack?: (result: ActionResult) => void) => void;
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
    payload: {
      channelId: string;
      content: string;
      replyToId?: string;
      attachmentIds?: string[];
    },
    ack?: (result: ActionResult<ChatMessage>) => void,
  ) => void;
  'message:edit': (
    payload: { messageId: string; content: string },
    ack?: (result: ActionResult<ChatMessage>) => void,
  ) => void;
  'message:delete': (payload: { messageId: string }, ack?: (result: ActionResult) => void) => void;
  'typing:start': (payload: { channelId: string }) => void;
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
  'presence:activity': (payload: { activity: string | null }) => void;
  'client:ping': (ack: (ok: boolean) => void) => void;
}

/** Dados que o servidor guarda em cada conexão Socket.IO depois de conferir o token. */
export interface SocketData {
  userId: string;
}

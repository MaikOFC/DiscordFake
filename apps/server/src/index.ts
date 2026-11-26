import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  HealthResponse,
  ServerToClientEvents,
  UserSession,
} from '@nexusvoice/shared';
import {
  clearRateLimitForSocket,
  createTextMessage,
  listChannelMessages,
} from './chat.js';
import { dbPath } from './db.js';
import { createVoiceTokenForMember } from './livekit.js';
import {
  clearVoicePresenceForChannel,
  clearVoicePresenceForServer,
  getVoicePresenceForServer,
  getVoicePresenceForServers,
  joinVoicePresence,
  leaveVoicePresence,
  updateVoicePresence,
} from './presence.js';
import {
  createChannel,
  createServer,
  deleteChannel,
  deleteServer,
  getServerDetails,
  getServersForUser,
  getUserServerIds,
  joinServerByInvite,
  syncMemberNickname,
} from './servers.js';

// Carrega o arquivo .env da raiz do projeto, se ele existir.
const rootEnvPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 32;
const USER_ID_MIN = 8;
const USER_ID_MAX = 64;

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: CLIENT_ORIGIN,
  credentials: true,
});

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
  fastify.server,
  {
    cors: {
      origin: CLIENT_ORIGIN,
      credentials: true,
    },
  },
);

// Guarda os usuários identificados por socket.id para evitar fantasmas ao desconectar.
const onlineSessions = new Map<string, UserSession>();

function getOnlineUsers(): UserSession[] {
  return Array.from(onlineSessions.values());
}

function getOnlineUserIds(): Set<string> {
  const ids = new Set<string>();
  for (const session of onlineSessions.values()) {
    ids.add(session.userId);
  }
  return ids;
}

function serverRoom(serverId: string): string {
  return `server:${serverId}`;
}

function broadcastServerUpdate(serverId: string): void {
  const server = getServerDetails(serverId, getOnlineUserIds());
  if (server) {
    io.to(serverRoom(serverId)).emit('server:updated', { server });
  }
}

function broadcastVoicePresence(serverId: string): void {
  const users = getVoicePresenceForServer(serverId);
  io.to(serverRoom(serverId)).emit('presence:updated', { serverId, users });
}

io.on('connection', (socket) => {
  fastify.log.info({ socketId: socket.id }, 'Cliente conectado no Socket.IO');

  socket.emit('server:welcome', {
    socketId: socket.id,
    message: 'Conectado ao NexusVoice!',
  });

  socket.on('session:identify', (payload, ack) => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.userId !== 'string' ||
      typeof payload.nickname !== 'string'
    ) {
      const error = 'Dados de identificação inválidos.';
      ack?.({ ok: false, error });
      socket.emit('server:error', { message: error });
      return;
    }

    const userId = payload.userId.trim();
    const nickname = payload.nickname.trim();

    if (userId.length < USER_ID_MIN || userId.length > USER_ID_MAX) {
      const error = 'ID da aba inválido.';
      ack?.({ ok: false, error });
      socket.emit('server:error', { message: error });
      return;
    }

    if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
      const error = `O nickname deve ter entre ${NICKNAME_MIN} e ${NICKNAME_MAX} caracteres.`;
      ack?.({ ok: false, error });
      socket.emit('server:error', { message: error });
      return;
    }

    const user: UserSession = {
      userId,
      nickname,
      socketId: socket.id,
    };

    onlineSessions.set(socket.id, user);
    syncMemberNickname(userId, nickname);

    const serverIds = getUserServerIds(userId);
    for (const serverId of serverIds) {
      void socket.join(serverRoom(serverId));
    }

    const onlineIds = getOnlineUserIds();
    const servers = getServersForUser(userId, onlineIds);
    const voicePresence = getVoicePresenceForServers(serverIds);
    const onlineUsers = getOnlineUsers();

    fastify.log.info(
      { socketId: socket.id, userId, nickname },
      'Sessão identificada',
    );

    ack?.({ ok: true, user });
    socket.emit('session:ready', { user, onlineUsers, servers, voicePresence });
    io.emit('users:online', { onlineUsers });

    for (const serverId of serverIds) {
      broadcastServerUpdate(serverId);
    }
  });

  socket.on('server:create', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos para criar servidor.' });
      return;
    }

    const result = createServer(
      payload.name,
      session.userId,
      session.nickname,
      getOnlineUserIds(),
    );
    if (result.ok && result.data) {
      void socket.join(serverRoom(result.data.id));
    }
    ack?.(result);
  });

  socket.on('server:join', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.inviteCode !== 'string'
    ) {
      ack?.({ ok: false, error: 'Código de convite inválido.' });
      return;
    }

    const result = joinServerByInvite(
      payload.inviteCode,
      session.userId,
      session.nickname,
      getOnlineUserIds(),
    );
    if (result.ok && result.data) {
      void socket.join(serverRoom(result.data.id));
      broadcastServerUpdate(result.data.id);
      socket.emit('presence:updated', {
        serverId: result.data.id,
        users: getVoicePresenceForServer(result.data.id),
      });
    }
    ack?.(result);
  });

  socket.on('server:delete', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.serverId !== 'string'
    ) {
      ack?.({ ok: false, error: 'Dados inválidos.' });
      return;
    }

    const result = deleteServer(payload.serverId, session.userId);
    if (result.ok) {
      clearVoicePresenceForServer(payload.serverId);
      const room = serverRoom(payload.serverId);
      io.to(room).emit('server:deleted', { serverId: payload.serverId });
      io.in(room).socketsLeave(room);
    }
    ack?.(result);
  });

  socket.on('channel:create', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.serverId !== 'string' ||
      typeof payload.name !== 'string' ||
      (payload.type !== 'text' && payload.type !== 'voice')
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para criar canal.' });
      return;
    }

    const result = createChannel(
      payload.serverId,
      payload.name,
      payload.type,
      session.userId,
    );
    if (result.ok) {
      broadcastServerUpdate(payload.serverId);
    }
    ack?.(result);
  });

  socket.on('channel:delete', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.serverId !== 'string' ||
      typeof payload.channelId !== 'string'
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para apagar canal.' });
      return;
    }

    const result = deleteChannel(
      payload.serverId,
      payload.channelId,
      session.userId,
    );
    if (result.ok) {
      const affectedServer = clearVoicePresenceForChannel(payload.channelId);
      if (affectedServer) {
        broadcastVoicePresence(affectedServer);
      }
      broadcastServerUpdate(payload.serverId);
    }
    ack?.(result);
  });

  socket.on('message:list', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.channelId !== 'string' ||
      (payload.before !== undefined && typeof payload.before !== 'string') ||
      (payload.limit !== undefined && typeof payload.limit !== 'number')
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para carregar histórico.' });
      return;
    }

    const result = listChannelMessages(
      payload.channelId,
      session.userId,
      payload.before,
      payload.limit,
    );
    ack?.(result);
  });

  socket.on('message:send', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.channelId !== 'string' ||
      typeof payload.content !== 'string'
    ) {
      ack?.({ ok: false, error: 'Mensagem malformada.' });
      return;
    }

    const result = createTextMessage(
      socket.id,
      payload.channelId,
      payload.content,
      session.userId,
      session.nickname,
    );

    if (result.ok && result.data) {
      io.to(serverRoom(result.data.serverId)).emit('message:new', {
        message: result.data,
      });
    }
    ack?.(result);
  });

  socket.on('presence:join_voice', (payload, ack) => {
    const session = onlineSessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Sessão não identificada.' });
      return;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.channelId !== 'string' ||
      typeof payload.isMuted !== 'boolean' ||
      typeof payload.isDeafened !== 'boolean'
    ) {
      ack?.({ ok: false, error: 'Dados de presença inválidos.' });
      return;
    }

    const { result, affectedServerIds } = joinVoicePresence(
      session,
      payload.channelId,
      payload.isMuted,
      payload.isDeafened,
    );
    for (const serverId of affectedServerIds) {
      broadcastVoicePresence(serverId);
    }
    ack?.(result);
  });

  socket.on('presence:update_voice', (payload) => {
    if (!onlineSessions.has(socket.id) || !payload || typeof payload !== 'object') {
      return;
    }
    const serverId = updateVoicePresence(socket.id, payload);
    if (serverId) {
      broadcastVoicePresence(serverId);
    }
  });

  socket.on('presence:leave_voice', () => {
    const serverId = leaveVoicePresence(socket.id);
    if (serverId) {
      broadcastVoicePresence(serverId);
    }
  });

  socket.on('client:ping', (ack) => {
    ack(true);
  });

  socket.on('disconnect', (reason) => {
    clearRateLimitForSocket(socket.id);
    const leftServerId = leaveVoicePresence(socket.id);
    const removedSession = onlineSessions.get(socket.id);
    onlineSessions.delete(socket.id);
    fastify.log.info({ socketId: socket.id, reason }, 'Cliente desconectado');

    if (leftServerId) {
      broadcastVoicePresence(leftServerId);
    }
    if (removedSession) {
      io.emit('users:online', { onlineUsers: getOnlineUsers() });
      const serverIds = getUserServerIds(removedSession.userId);
      for (const serverId of serverIds) {
        broadcastServerUpdate(serverId);
      }
    }
  });
});

function buildHealthResponse(): HealthResponse {
  return {
    ok: true,
    app: 'NexusVoice',
    message: 'Servidor NexusVoice rodando!',
    timestamp: new Date().toISOString(),
  };
}

fastify.get('/', async () => buildHealthResponse());
fastify.get('/api/health', async () => buildHealthResponse());

fastify.post('/api/voice/token', async (request, reply) => {
  const body = request.body as Record<string, unknown> | null | undefined;
  const channelId =
    body && typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const userId =
    body && typeof body.userId === 'string' ? body.userId.trim() : '';

  if (!channelId || !userId) {
    return reply.code(400).send({
      ok: false,
      error: 'Informe channelId e userId para entrar na chamada.',
    });
  }

  const result = await createVoiceTokenForMember(channelId, userId);
  return reply.code(result.statusCode).send(result.body);
});

fastify.log.info({ dbPath }, 'Banco SQLite inicializado');

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}

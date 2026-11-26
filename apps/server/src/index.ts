import './env.js';
import { networkInterfaces } from 'node:os';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  LIMITS,
  type ClientToServerEvents,
  type HealthResponse,
  type PublicUser,
  type ServerToClientEvents,
  type SocketData,
} from '@nexusvoice/shared';
import {
  allowLoginAttempt,
  changePassword,
  getPublicUser,
  getUserIdByToken,
  getUserRow,
  loginUser,
  readBearerToken,
  registerUser,
  revokeToken,
  validateDisplayName,
} from './auth.js';
import { startBackupSchedule } from './backup.js';
import {
  clearRateLimitForSocket,
  createTextMessage,
  deleteTextMessage,
  editTextMessage,
  listChannelMessages,
  saveLinkPreviews,
} from './chat.js';
import { db, dbPath } from './db.js';
import { buildLinkPreviews } from './linkPreview.js';
import { createVoiceTokenForMember } from './livekit.js';
import {
  clearVoicePresenceForChannel,
  clearVoicePresenceForServer,
  getVoicePresenceForServer,
  getVoicePresenceForServers,
  joinVoicePresence,
  leaveVoicePresence,
  refreshVoicePresenceUser,
  removeUserFromServerVoice,
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
  leaveServer,
  syncMemberNickname,
  type MemberStatusLookup,
} from './servers.js';
import {
  cleanupOrphanAttachments,
  createPendingAttachment,
  deleteStoredFile,
  detectFileType,
  serveUpload,
  storeFile,
} from './uploads.js';

const API_VERSION = 2;
const PORT = Number(process.env.PORT ?? 3001);
const TYPING_THROTTLE_MS = 2500;

/**
 * Endereços que podem usar a API pelo navegador: o .env (CLIENT_ORIGIN, pode ter
 * vários separados por vírgula), o app de desktop e o Vite em qualquer IP deste PC.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
  ]);
  for (const item of (process.env.CLIENT_ORIGIN ?? '').split(',')) {
    const trimmed = item.trim().replace(/\/$/, '');
    if (trimmed) origins.add(trimmed);
  }
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4') {
        origins.add(`http://${info.address}:5173`);
      }
    }
  }
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  // Sem Origin: pedido que não veio de um navegador (curl, o próprio app nativo).
  return !origin || allowedOrigins.has(origin);
}

const fastify = Fastify({
  logger: true,
  trustProxy: false,
});

await fastify.register(cors, {
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

await fastify.register(multipart, {
  limits: {
    files: 1,
    fields: 4,
    fileSize: LIMITS.bannerMaxBytes,
  },
});

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
  fastify.server,
  {
    cors: {
      origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
    },
    maxHttpBufferSize: 64 * 1024,
  },
);

// ---------- Quem está online (em memória) ----------

const socketsByUser = new Map<string, Set<string>>();
const activityBySocket = new Map<string, string | null>();
const lastTypingBySocket = new Map<string, number>();

const memberStatus: MemberStatusLookup = (userId) => {
  const sockets = socketsByUser.get(userId);
  if (!sockets || sockets.size === 0) {
    return { online: false, activity: null };
  }
  let activity: string | null = null;
  for (const socketId of sockets) {
    activity = activityBySocket.get(socketId) ?? activity;
  }
  return { online: true, activity };
};

function serverRoom(serverId: string): string {
  return `server:${serverId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function broadcastServerUpdate(serverId: string): void {
  const server = getServerDetails(serverId, memberStatus);
  if (server) {
    io.to(serverRoom(serverId)).emit('server:updated', { server });
  }
}

function broadcastVoicePresence(serverId: string): void {
  const users = getVoicePresenceForServer(serverId);
  io.to(serverRoom(serverId)).emit('presence:updated', { serverId, users });
}

function broadcastUserServers(userId: string): void {
  for (const serverId of getUserServerIds(userId)) {
    broadcastServerUpdate(serverId);
  }
}

/** Avisa todo mundo que um perfil mudou (nome, avatar, banner, bio). */
function broadcastProfileChange(user: PublicUser): void {
  io.to(userRoom(user.id)).emit('session:user', { user });
  broadcastUserServers(user.id);
  for (const serverId of refreshVoicePresenceUser(user.id)) {
    broadcastVoicePresence(serverId);
  }
}

// ---------- Socket.IO ----------

// Antes de aceitar a conexão, confere o token da conta. Sem token válido, nada de socket.
io.use((socket, next) => {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const token = typeof auth?.token === 'string' ? auth.token : '';
  const userId = getUserIdByToken(token);
  if (!userId) {
    next(new Error('unauthorized'));
    return;
  }
  socket.data.userId = userId;
  next();
});

function currentUser(socket: AppSocket): PublicUser | null {
  return getPublicUser(socket.data.userId);
}

io.on('connection', (socket: AppSocket) => {
  const userId = socket.data.userId;
  const me = currentUser(socket);
  if (!me) {
    socket.disconnect(true);
    return;
  }

  const sockets = socketsByUser.get(userId) ?? new Set<string>();
  const wasOffline = sockets.size === 0;
  sockets.add(socket.id);
  socketsByUser.set(userId, sockets);

  const serverIds = getUserServerIds(userId);
  void socket.join(userRoom(userId));
  for (const serverId of serverIds) {
    void socket.join(serverRoom(serverId));
  }

  fastify.log.info({ socketId: socket.id, userId }, 'Conta conectada');

  socket.emit('session:ready', {
    user: me,
    servers: getServersForUser(userId, memberStatus),
    voicePresence: getVoicePresenceForServers(serverIds),
  });

  if (wasOffline) {
    broadcastUserServers(userId);
  }

  socket.on('server:create', (payload, ack) => {
    const user = currentUser(socket);
    if (!user || !payload || typeof payload.name !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos para criar servidor.' });
      return;
    }
    const result = createServer(payload.name, user.id, user.displayName, memberStatus);
    if (result.ok && result.data) {
      io.in(userRoom(user.id)).socketsJoin(serverRoom(result.data.id));
    }
    ack?.(result);
  });

  socket.on('server:join', (payload, ack) => {
    const user = currentUser(socket);
    if (!user || !payload || typeof payload.inviteCode !== 'string') {
      ack?.({ ok: false, error: 'Código de convite inválido.' });
      return;
    }
    const result = joinServerByInvite(payload.inviteCode, user.id, user.displayName, memberStatus);
    if (result.ok && result.data) {
      io.in(userRoom(user.id)).socketsJoin(serverRoom(result.data.id));
      broadcastServerUpdate(result.data.id);
      socket.emit('presence:updated', {
        serverId: result.data.id,
        users: getVoicePresenceForServer(result.data.id),
      });
    }
    ack?.(result);
  });

  socket.on('server:leave', (payload, ack) => {
    if (!payload || typeof payload.serverId !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos.' });
      return;
    }
    const result = leaveServer(payload.serverId, userId);
    if (result.ok) {
      io.in(userRoom(userId)).socketsLeave(serverRoom(payload.serverId));
      if (removeUserFromServerVoice(userId, payload.serverId)) {
        broadcastVoicePresence(payload.serverId);
      }
      broadcastServerUpdate(payload.serverId);
    }
    ack?.(result);
  });

  socket.on('server:delete', (payload, ack) => {
    if (!payload || typeof payload.serverId !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos.' });
      return;
    }
    const result = deleteServer(payload.serverId, userId);
    if (result.ok) {
      clearVoicePresenceForServer(payload.serverId);
      const room = serverRoom(payload.serverId);
      io.to(room).emit('server:deleted', { serverId: payload.serverId });
      io.in(room).socketsLeave(room);
    }
    ack?.(result);
  });

  socket.on('channel:create', (payload, ack) => {
    if (
      !payload ||
      typeof payload.serverId !== 'string' ||
      typeof payload.name !== 'string' ||
      (payload.type !== 'text' && payload.type !== 'voice')
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para criar canal.' });
      return;
    }
    const result = createChannel(payload.serverId, payload.name, payload.type, userId);
    if (result.ok) {
      broadcastServerUpdate(payload.serverId);
    }
    ack?.(result);
  });

  socket.on('channel:delete', (payload, ack) => {
    if (
      !payload ||
      typeof payload.serverId !== 'string' ||
      typeof payload.channelId !== 'string'
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para apagar canal.' });
      return;
    }
    const result = deleteChannel(payload.serverId, payload.channelId, userId);
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
    if (
      !payload ||
      typeof payload.channelId !== 'string' ||
      (payload.before !== undefined && typeof payload.before !== 'string') ||
      (payload.limit !== undefined && typeof payload.limit !== 'number')
    ) {
      ack?.({ ok: false, error: 'Dados inválidos para carregar histórico.' });
      return;
    }
    ack?.(listChannelMessages(payload.channelId, userId, payload.before, payload.limit));
  });

  socket.on('message:send', (payload, ack) => {
    const user = currentUser(socket);
    const attachmentIds = payload?.attachmentIds;
    if (
      !user ||
      !payload ||
      typeof payload.channelId !== 'string' ||
      typeof payload.content !== 'string' ||
      (payload.replyToId !== undefined && typeof payload.replyToId !== 'string') ||
      (attachmentIds !== undefined &&
        (!Array.isArray(attachmentIds) || attachmentIds.some((id) => typeof id !== 'string')))
    ) {
      ack?.({ ok: false, error: 'Mensagem malformada.' });
      return;
    }

    const result = createTextMessage(
      socket.id,
      {
        channelId: payload.channelId,
        content: payload.content,
        replyToId: payload.replyToId,
        attachmentIds,
      },
      user.id,
      user.displayName,
    );

    if (result.ok && result.data) {
      const message = result.data;
      io.to(serverRoom(message.serverId)).emit('message:new', { message });
      void attachLinkPreviews(message.id, message.serverId, message.content);
    }
    ack?.(result);
  });

  socket.on('message:edit', (payload, ack) => {
    if (!payload || typeof payload.messageId !== 'string' || typeof payload.content !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos para editar.' });
      return;
    }
    const result = editTextMessage(socket.id, payload.messageId, payload.content, userId);
    if (result.ok && result.data) {
      const message = result.data;
      io.to(serverRoom(message.serverId)).emit('message:updated', { message });
      void attachLinkPreviews(message.id, message.serverId, message.content);
    }
    ack?.(result);
  });

  socket.on('message:delete', (payload, ack) => {
    if (!payload || typeof payload.messageId !== 'string') {
      ack?.({ ok: false, error: 'Dados inválidos para apagar.' });
      return;
    }
    const result = deleteTextMessage(payload.messageId, userId);
    if (result.ok && result.data) {
      io.to(serverRoom(result.data.serverId)).emit('message:deleted', {
        serverId: result.data.serverId,
        channelId: result.data.channelId,
        messageId: payload.messageId,
      });
    }
    ack?.({ ok: result.ok, error: result.error });
  });

  socket.on('typing:start', (payload) => {
    if (!payload || typeof payload.channelId !== 'string') return;
    const now = Date.now();
    const last = lastTypingBySocket.get(socket.id) ?? 0;
    if (now - last < TYPING_THROTTLE_MS) return;
    lastTypingBySocket.set(socket.id, now);

    const channel = db
      .prepare(
        `SELECT c.server_id FROM channels c
         JOIN server_members m ON m.server_id = c.server_id AND m.user_id = ?
         WHERE c.id = ? AND c.type = 'text'`,
      )
      .get(userId, payload.channelId) as { server_id: string } | undefined;
    const user = currentUser(socket);
    if (!channel || !user) return;

    socket.to(serverRoom(channel.server_id)).emit('typing:update', {
      serverId: channel.server_id,
      channelId: payload.channelId,
      userId,
      nickname: user.displayName,
    });
  });

  socket.on('presence:join_voice', (payload, ack) => {
    if (
      !payload ||
      typeof payload.channelId !== 'string' ||
      typeof payload.isMuted !== 'boolean' ||
      typeof payload.isDeafened !== 'boolean'
    ) {
      ack?.({ ok: false, error: 'Dados de presença inválidos.' });
      return;
    }
    const { result, affectedServerIds } = joinVoicePresence(
      socket.id,
      userId,
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
    if (!payload || typeof payload !== 'object') return;
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

  socket.on('presence:activity', (payload) => {
    const raw = payload?.activity;
    const activity =
      typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, LIMITS.activityMax) : null;
    if ((activityBySocket.get(socket.id) ?? null) === activity) return;
    activityBySocket.set(socket.id, activity);
    broadcastUserServers(userId);
  });

  socket.on('client:ping', (ack) => {
    if (typeof ack === 'function') ack(true);
  });

  socket.on('disconnect', (reason) => {
    clearRateLimitForSocket(socket.id);
    lastTypingBySocket.delete(socket.id);
    activityBySocket.delete(socket.id);
    const leftServerId = leaveVoicePresence(socket.id);

    const userSockets = socketsByUser.get(userId);
    userSockets?.delete(socket.id);
    const nowOffline = !userSockets || userSockets.size === 0;
    if (nowOffline) socketsByUser.delete(userId);

    fastify.log.info({ socketId: socket.id, reason }, 'Conta desconectada');

    if (leftServerId) {
      broadcastVoicePresence(leftServerId);
    }
    broadcastUserServers(userId);
  });
});

/** Busca as prévias de link depois de mandar a mensagem, para não atrasar o envio. */
async function attachLinkPreviews(messageId: string, serverId: string, content: string): Promise<void> {
  if (!/https?:\/\//i.test(content)) return;
  const previews = await buildLinkPreviews(content);
  if (previews.length === 0) return;
  const updated = saveLinkPreviews(messageId, previews);
  if (updated) {
    io.to(serverRoom(serverId)).emit('message:updated', { message: updated });
  }
}

// ---------- HTTP ----------

function buildHealthResponse(): HealthResponse {
  return {
    ok: true,
    app: 'NexusVoice',
    message: 'Servidor NexusVoice rodando!',
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
  };
}

/** Lê a conta pelo token do cabeçalho. Responde 401 e devolve null se não tiver. */
async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const userId = getUserIdByToken(readBearerToken(request.headers.authorization));
  if (!userId) {
    await reply.code(401).send({ ok: false, error: 'Sua sessão expirou. Entre de novo.' });
    return null;
  }
  return userId;
}

const uploadsByUser = new Map<string, number[]>();
function allowUpload(userId: string): boolean {
  const now = Date.now();
  const recent = (uploadsByUser.get(userId) ?? []).filter((ts) => now - ts < 10 * 60 * 1000);
  if (recent.length >= 40) {
    uploadsByUser.set(userId, recent);
    return false;
  }
  recent.push(now);
  uploadsByUser.set(userId, recent);
  return true;
}

/** Lê o arquivo enviado e responde com erro amigável se passar do tamanho. */
async function readUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  maxBytes: number,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  try {
    const part = await request.file({ limits: { fileSize: maxBytes } });
    if (!part) {
      await reply.code(400).send({ ok: false, error: 'Nenhum arquivo enviado.' });
      return null;
    }
    const buffer = await part.toBuffer();
    return { buffer, fileName: part.filename || 'arquivo' };
  } catch {
    const mb = Math.round(maxBytes / (1024 * 1024));
    await reply.code(413).send({ ok: false, error: `O arquivo passa do limite de ${mb} MB.` });
    return null;
  }
}

fastify.get('/', async () => buildHealthResponse());
fastify.get('/api/health', async () => buildHealthResponse());

fastify.post('/api/auth/register', async (request, reply) => {
  if (!allowLoginAttempt(request.ip)) {
    return reply.code(429).send({ ok: false, error: 'Muitas tentativas. Espere alguns minutos.' });
  }
  const result = await registerUser(request.body);
  return reply.code(result.ok ? 200 : 400).send(result);
});

fastify.post('/api/auth/login', async (request, reply) => {
  if (!allowLoginAttempt(request.ip)) {
    return reply.code(429).send({ ok: false, error: 'Muitas tentativas. Espere alguns minutos.' });
  }
  const result = await loginUser(request.body);
  return reply.code(result.ok ? 200 : 401).send(result);
});

fastify.post('/api/auth/logout', async (request) => {
  const token = readBearerToken(request.headers.authorization);
  if (token) revokeToken(token);
  return { ok: true };
});

fastify.get('/api/auth/me', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return reply;
  return { ok: true, data: getPublicUser(userId) };
});

fastify.post('/api/auth/password', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return reply;
  const result = await changePassword(userId, request.body);
  return reply.code(result.ok ? 200 : 400).send(result);
});

fastify.patch('/api/profile', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return reply;
  const body = (request.body ?? {}) as Record<string, unknown>;

  if (body.displayName !== undefined) {
    const name = validateDisplayName(body.displayName);
    if (typeof name !== 'string') return reply.code(400).send(name);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
    syncMemberNickname(userId, name);
  }
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > LIMITS.bioMax) {
      return reply.code(400).send({ ok: false, error: `A bio pode ter até ${LIMITS.bioMax} caracteres.` });
    }
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(body.bio.trim(), userId);
  }

  const user = getPublicUser(userId);
  if (user) broadcastProfileChange(user);
  return { ok: true, data: user };
});

for (const kind of ['avatar', 'banner'] as const) {
  const column = kind === 'avatar' ? 'avatar_file' : 'banner_file';
  const maxBytes = kind === 'avatar' ? LIMITS.avatarMaxBytes : LIMITS.bannerMaxBytes;

  fastify.post(`/api/profile/${kind}`, async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    if (!allowUpload(userId)) {
      return reply.code(429).send({ ok: false, error: 'Muitos envios seguidos. Espere um pouco.' });
    }
    const upload = await readUpload(request, reply, maxBytes);
    if (!upload) return reply;

    const type = detectFileType(upload.buffer, upload.fileName);
    if (!type.isImage) {
      return reply.code(400).send({ ok: false, error: 'Use uma imagem PNG, JPG, GIF ou WEBP.' });
    }

    const stored = await storeFile(upload.buffer, type.ext);
    const previous = getUserRow(userId)?.[column] ?? null;
    db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(stored, userId);
    await deleteStoredFile(previous);

    const user = getPublicUser(userId);
    if (user) broadcastProfileChange(user);
    return { ok: true, data: user };
  });

  fastify.delete(`/api/profile/${kind}`, async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    const previous = getUserRow(userId)?.[column] ?? null;
    db.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?`).run(userId);
    await deleteStoredFile(previous);
    const user = getPublicUser(userId);
    if (user) broadcastProfileChange(user);
    return { ok: true, data: user };
  });
}

fastify.post('/api/uploads', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return reply;
  if (!allowUpload(userId)) {
    return reply.code(429).send({ ok: false, error: 'Muitos envios seguidos. Espere um pouco.' });
  }
  const upload = await readUpload(request, reply, LIMITS.attachmentMaxBytes);
  if (!upload) return reply;
  const attachment = await createPendingAttachment(userId, upload.buffer, upload.fileName);
  return { ok: true, data: attachment };
});

fastify.get<{ Params: { name: string } }>('/uploads/:name', serveUpload);

fastify.post('/api/voice/token', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return reply;
  const body = request.body as Record<string, unknown> | null | undefined;
  const channelId = body && typeof body.channelId === 'string' ? body.channelId.trim() : '';
  if (!channelId) {
    return reply.code(400).send({ ok: false, error: 'Informe o canal de voz.' });
  }
  const result = await createVoiceTokenForMember(channelId, userId, request.host);
  return reply.code(result.statusCode).send(result.body);
});

fastify.log.info({ dbPath }, 'Banco SQLite inicializado');

startBackupSchedule((msg, error) => {
  if (error) fastify.log.error({ err: error }, msg);
  else fastify.log.info(msg);
});

setInterval(() => {
  void cleanupOrphanAttachments();
}, 30 * 60 * 1000).unref();

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}

import { randomUUID } from 'node:crypto';
import type {
  ActionResult,
  ChannelType,
  ChatMessage,
  MessageHistoryResult,
} from '@nexusvoice/shared';
import { db } from './db.js';

const MESSAGE_MIN_LENGTH = 1;
const MESSAGE_MAX_LENGTH = 2000;
const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 50;

const RATE_LIMIT_MAX_MESSAGES = 5;
const RATE_LIMIT_WINDOW_MS = 5000;

interface ChannelLookupRow {
  id: string;
  server_id: string;
  type: ChannelType;
}

interface MessageRow {
  id: string;
  channel_id: string;
  server_id: string;
  author_id: string;
  author_nickname: string;
  content: string;
  created_at: string;
}

// Guarda os horários recentes de envio por conexão (socket.id) para limitar spam.
const messageTimestampsBySocket = new Map<string, number[]>();

export function clearRateLimitForSocket(socketId: string): void {
  messageTimestampsBySocket.delete(socketId);
}

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const previous = messageTimestampsBySocket.get(socketId) ?? [];
  const recent = previous.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_MESSAGES) {
    messageTimestampsBySocket.set(socketId, recent);
    return false;
  }

  recent.push(now);
  messageTimestampsBySocket.set(socketId, recent);
  return true;
}

function getAuthorizedTextChannel(
  channelId: string,
  userId: string,
): ActionResult<ChannelLookupRow> {
  const channel = db
    .prepare('SELECT id, server_id, type FROM channels WHERE id = ?')
    .get(channelId) as ChannelLookupRow | undefined;

  if (!channel) {
    return { ok: false, error: 'Canal não encontrado.' };
  }

  if (channel.type !== 'text') {
    return { ok: false, error: 'Este canal não é um canal de texto.' };
  }

  const membership = db
    .prepare(
      'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
    )
    .get(channel.server_id, userId);

  if (!membership) {
    return { ok: false, error: 'Você não é membro deste servidor.' };
  }

  return { ok: true, data: channel };
}

function mapRowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    serverId: row.server_id,
    authorId: row.author_id,
    authorNickname: row.author_nickname,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function listChannelMessages(
  channelId: string,
  userId: string,
  beforeMessageId?: string,
  requestedLimit?: number,
): ActionResult<MessageHistoryResult> {
  const auth = getAuthorizedTextChannel(channelId, userId);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, Math.floor(requestedLimit ?? DEFAULT_PAGE_LIMIT)),
  );

  let rows: MessageRow[];

  if (beforeMessageId) {
    // Usar o rowid da mensagem evita pular ou duplicar mensagens com o mesmo milissegundo.
    const anchor = db
      .prepare('SELECT rowid FROM messages WHERE id = ? AND channel_id = ?')
      .get(beforeMessageId, channelId) as { rowid: number } | undefined;

    if (!anchor) {
      return { ok: true, data: { messages: [], hasMore: false } };
    }

    rows = db
      .prepare(
        `SELECT id, channel_id, server_id, author_id, author_nickname, content, created_at
         FROM messages
         WHERE channel_id = ? AND rowid < ?
         ORDER BY rowid DESC
         LIMIT ?`,
      )
      .all(channelId, anchor.rowid, limit + 1) as MessageRow[];
  } else {
    rows = db
      .prepare(
        `SELECT id, channel_id, server_id, author_id, author_nickname, content, created_at
         FROM messages
         WHERE channel_id = ?
         ORDER BY rowid DESC
         LIMIT ?`,
      )
      .all(channelId, limit + 1) as MessageRow[];
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  // Inverte para exibir da mais antiga para a mais recente na tela.
  const messages = pageRows.reverse().map(mapRowToMessage);

  return {
    ok: true,
    data: { messages, hasMore },
  };
}

export function createTextMessage(
  socketId: string,
  channelId: string,
  rawContent: string,
  authorId: string,
  authorNickname: string,
): ActionResult<ChatMessage> {
  const auth = getAuthorizedTextChannel(channelId, authorId);
  if (!auth.ok || !auth.data) {
    return { ok: false, error: auth.error };
  }

  const content = rawContent.trim();
  if (content.length < MESSAGE_MIN_LENGTH) {
    return { ok: false, error: 'A mensagem não pode estar vazia.' };
  }

  if (content.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `A mensagem não pode passar de ${MESSAGE_MAX_LENGTH} caracteres (você enviou ${content.length}).`,
    };
  }

  if (!checkRateLimit(socketId)) {
    return {
      ok: false,
      error:
        'Calma! Você atingiu o limite de 5 mensagens a cada 5 segundos. Aguarde um instante.',
    };
  }

  const message: ChatMessage = {
    id: randomUUID(),
    channelId,
    serverId: auth.data.server_id,
    authorId,
    authorNickname,
    content,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO messages (id, channel_id, server_id, author_id, author_nickname, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.channelId,
    message.serverId,
    message.authorId,
    message.authorNickname,
    message.content,
    message.createdAt,
  );

  return { ok: true, data: message };
}

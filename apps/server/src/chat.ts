import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  type ActionResult,
  type ChannelType,
  type ChatMessage,
  type LinkPreview,
  type MessageHistoryResult,
} from '@nexusvoice/shared';
import { db } from './db.js';
import { isServerMember } from './servers.js';
import {
  claimAttachments,
  collectAttachmentFiles,
  countClaimableAttachments,
  deleteStoredFile,
  getAttachmentsForMessages,
} from './uploads.js';

const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 50;
const MAX_MENTIONS = 20;
const REPLY_PREVIEW_LENGTH = 120;

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
  current_nickname: string | null;
  content: string;
  created_at: string;
  edited_at: string | null;
  reply_to_id: string | null;
  mentions: string;
  link_previews: string;
}

interface ReplyRow {
  id: string;
  author_id: string;
  author_nickname: string;
  current_nickname: string | null;
  content: string;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.server_id, m.author_id, m.author_nickname,
         u.display_name AS current_nickname, m.content, m.created_at, m.edited_at,
         m.reply_to_id, m.mentions, m.link_previews
  FROM messages m
  LEFT JOIN users u ON u.id = m.author_id`;

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

const RATE_LIMIT_ERROR =
  'Calma! Você atingiu o limite de 5 mensagens a cada 5 segundos. Aguarde um instante.';

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

  if (!isServerMember(channel.server_id, userId)) {
    return { ok: false, error: 'Você não é membro deste servidor.' };
  }

  return { ok: true, data: channel };
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** Transforma linhas do banco em mensagens completas (com anexos e resposta) em poucas consultas. */
function hydrateMessages(rows: MessageRow[]): ChatMessage[] {
  const attachments = getAttachmentsForMessages(rows.map((r) => r.id));

  const replyIds = Array.from(
    new Set(rows.map((r) => r.reply_to_id).filter((id): id is string => Boolean(id))),
  );
  const replies = new Map<string, ReplyRow>();
  if (replyIds.length > 0) {
    const placeholders = replyIds.map(() => '?').join(',');
    const replyRows = db
      .prepare(
        `SELECT m.id, m.author_id, m.author_nickname, u.display_name AS current_nickname, m.content
         FROM messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.id IN (${placeholders})`,
      )
      .all(...replyIds) as ReplyRow[];
    for (const reply of replyRows) {
      replies.set(reply.id, reply);
    }
  }

  return rows.map((row) => {
    let replyTo: ChatMessage['replyTo'] = null;
    if (row.reply_to_id) {
      const original = replies.get(row.reply_to_id);
      replyTo = original
        ? {
            id: original.id,
            authorId: original.author_id,
            authorNickname: original.current_nickname ?? original.author_nickname,
            content: original.content.slice(0, REPLY_PREVIEW_LENGTH),
          }
        : { id: row.reply_to_id, deleted: true };
    }

    return {
      id: row.id,
      channelId: row.channel_id,
      serverId: row.server_id,
      authorId: row.author_id,
      authorNickname: row.current_nickname ?? row.author_nickname,
      content: row.content,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      replyTo,
      attachments: attachments.get(row.id) ?? [],
      mentions: parseJsonArray<string>(row.mentions),
      linkPreviews: parseJsonArray<LinkPreview>(row.link_previews),
    };
  });
}

export function getMessage(messageId: string): ChatMessage | null {
  const row = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(messageId) as
    MessageRow | undefined;
  return row ? (hydrateMessages([row])[0] ?? null) : null;
}

/** Acha quem foi marcado com @usuario, só entre os membros daquele servidor. */
function findMentions(serverId: string, content: string): string[] {
  const usernames = new Set<string>();
  for (const match of content.matchAll(/(^|[^\w@])@([a-zA-Z0-9_.]{3,20})/g)) {
    if (match[2]) usernames.add(match[2].toLowerCase());
    if (usernames.size >= MAX_MENTIONS) break;
  }
  if (usernames.size === 0) return [];

  const stmt = db.prepare(
    `SELECT u.id FROM users u
     JOIN server_members sm ON sm.user_id = u.id
     WHERE sm.server_id = ? AND u.username = ? COLLATE NOCASE`,
  );
  const ids: string[] = [];
  for (const username of usernames) {
    const row = stmt.get(serverId, username) as { id: string } | undefined;
    if (row) ids.push(row.id);
  }
  return ids;
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
        `${MESSAGE_SELECT}
         WHERE m.channel_id = ? AND m.rowid < ?
         ORDER BY m.rowid DESC
         LIMIT ?`,
      )
      .all(channelId, anchor.rowid, limit + 1) as MessageRow[];
  } else {
    rows = db
      .prepare(
        `${MESSAGE_SELECT}
         WHERE m.channel_id = ?
         ORDER BY m.rowid DESC
         LIMIT ?`,
      )
      .all(channelId, limit + 1) as MessageRow[];
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  // Inverte para exibir da mais antiga para a mais recente na tela.
  const messages = hydrateMessages(pageRows.reverse());

  return {
    ok: true,
    data: { messages, hasMore },
  };
}

export interface SendMessageInput {
  channelId: string;
  content: string;
  replyToId?: string;
  attachmentIds?: string[];
}

export function createTextMessage(
  socketId: string,
  input: SendMessageInput,
  authorId: string,
  authorNickname: string,
): ActionResult<ChatMessage> {
  const auth = getAuthorizedTextChannel(input.channelId, authorId);
  if (!auth.ok || !auth.data) {
    return { ok: false, error: auth.error };
  }

  const content = input.content.trim();
  const attachmentIds = Array.from(new Set(input.attachmentIds ?? []));

  if (attachmentIds.length > LIMITS.attachmentsPerMessage) {
    return {
      ok: false,
      error: `Mande no máximo ${LIMITS.attachmentsPerMessage} arquivos por mensagem.`,
    };
  }

  if (content.length === 0 && attachmentIds.length === 0) {
    return { ok: false, error: 'A mensagem não pode estar vazia.' };
  }

  if (content.length > LIMITS.messageMax) {
    return {
      ok: false,
      error: `A mensagem não pode passar de ${LIMITS.messageMax} caracteres (você enviou ${content.length}).`,
    };
  }

  if (countClaimableAttachments(authorId, attachmentIds) !== attachmentIds.length) {
    return {
      ok: false,
      error: 'Um dos arquivos não foi encontrado. Tente anexar de novo.',
    };
  }

  let replyToId: string | null = null;
  if (input.replyToId) {
    const original = db
      .prepare('SELECT id FROM messages WHERE id = ? AND channel_id = ?')
      .get(input.replyToId, input.channelId) as { id: string } | undefined;
    if (!original) {
      return { ok: false, error: 'A mensagem que você quer responder não existe mais.' };
    }
    replyToId = original.id;
  }

  if (!checkRateLimit(socketId)) {
    return { ok: false, error: RATE_LIMIT_ERROR };
  }

  const id = randomUUID();
  const mentions = findMentions(auth.data.server_id, content);

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, channel_id, server_id, author_id, author_nickname, content, created_at, reply_to_id, mentions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.channelId,
      auth.data!.server_id,
      authorId,
      authorNickname,
      content,
      new Date().toISOString(),
      replyToId,
      JSON.stringify(mentions),
    );
    claimAttachments(authorId, attachmentIds, id);
  });
  insert();

  const message = getMessage(id);
  return message ? { ok: true, data: message } : { ok: false, error: 'Erro ao salvar a mensagem.' };
}

export function editTextMessage(
  socketId: string,
  messageId: string,
  rawContent: string,
  userId: string,
): ActionResult<ChatMessage> {
  const existing = getMessage(messageId);
  if (!existing) {
    return { ok: false, error: 'Mensagem não encontrada.' };
  }
  if (existing.authorId !== userId) {
    return { ok: false, error: 'Você só pode editar as suas mensagens.' };
  }

  const content = rawContent.trim();
  if (content.length === 0 && existing.attachments.length === 0) {
    return { ok: false, error: 'A mensagem não pode ficar vazia. Para tirar, apague.' };
  }
  if (content.length > LIMITS.messageMax) {
    return {
      ok: false,
      error: `A mensagem não pode passar de ${LIMITS.messageMax} caracteres.`,
    };
  }
  if (content === existing.content) {
    return { ok: true, data: existing };
  }
  if (!checkRateLimit(socketId)) {
    return { ok: false, error: RATE_LIMIT_ERROR };
  }

  const mentions = findMentions(existing.serverId, content);
  db.prepare(
    `UPDATE messages SET content = ?, edited_at = ?, mentions = ?, link_previews = '[]' WHERE id = ?`,
  ).run(content, new Date().toISOString(), JSON.stringify(mentions), messageId);

  const updated = getMessage(messageId);
  return updated ? { ok: true, data: updated } : { ok: false, error: 'Erro ao editar.' };
}

/** Apaga uma mensagem. Pode o autor ou o dono do servidor. */
export function deleteTextMessage(
  messageId: string,
  userId: string,
): ActionResult<{ serverId: string; channelId: string }> {
  const row = db
    .prepare(
      `SELECT m.author_id, m.server_id, m.channel_id, s.owner_id
       FROM messages m JOIN servers s ON s.id = m.server_id
       WHERE m.id = ?`,
    )
    .get(messageId) as
    { author_id: string; server_id: string; channel_id: string; owner_id: string } | undefined;

  if (!row) {
    return { ok: false, error: 'Mensagem não encontrada.' };
  }
  if (row.author_id !== userId && row.owner_id !== userId) {
    return { ok: false, error: 'Você só pode apagar as suas mensagens.' };
  }

  const files = collectAttachmentFiles('message', messageId);
  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
  for (const file of files) {
    void deleteStoredFile(file);
  }
  return { ok: true, data: { serverId: row.server_id, channelId: row.channel_id } };
}

export function saveLinkPreviews(messageId: string, previews: LinkPreview[]): ChatMessage | null {
  const info = db
    .prepare('UPDATE messages SET link_previews = ? WHERE id = ?')
    .run(JSON.stringify(previews), messageId);
  return info.changes > 0 ? getMessage(messageId) : null;
}

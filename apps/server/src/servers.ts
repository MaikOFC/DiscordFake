import { randomBytes, randomUUID } from 'node:crypto';
import {
  LIMITS,
  type ActionResult,
  type Channel,
  type ChannelType,
  type ServerDetails,
  type ServerMember,
} from '@nexusvoice/shared';
import { mediaUrl } from './auth.js';
import { db } from './db.js';
import { collectAttachmentFiles, deleteStoredFile } from './uploads.js';

interface ServerRow {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  created_at: string;
}

interface ChannelRow {
  id: string;
  server_id: string;
  name: string;
  type: ChannelType;
  created_at: string;
  last_message_at: string | null;
}

interface MemberRow {
  user_id: string;
  joined_at: string;
  username: string;
  display_name: string;
  avatar_file: string | null;
  banner_file: string | null;
  bio: string;
}

/** Diz se alguém está online agora e o que está jogando. Vem da memória do index.ts. */
export type MemberStatusLookup = (userId: string) => {
  online: boolean;
  activity: string | null;
};

function generateInviteCode(): string {
  // Alfabeto sem caracteres ambíguos (0/O, 1/I) para facilitar digitar/ler o convite.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) {
    code += alphabet[b % alphabet.length];
  }
  return code;
}

function createUniqueInviteCode(): string {
  const checkStmt = db.prepare('SELECT 1 FROM servers WHERE invite_code = ?');
  for (let i = 0; i < 10; i++) {
    const candidate = generateInviteCode();
    if (!checkStmt.get(candidate)) {
      return candidate;
    }
  }
  return randomUUID().slice(0, 8).toUpperCase();
}

export function getServerDetails(
  serverId: string,
  status: MemberStatusLookup,
): ServerDetails | null {
  const server = db
    .prepare('SELECT id, name, invite_code, owner_id, created_at FROM servers WHERE id = ?')
    .get(serverId) as ServerRow | undefined;

  if (!server) {
    return null;
  }

  const channelRows = db
    .prepare(
      `SELECT c.id, c.server_id, c.name, c.type, c.created_at,
              (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
       FROM channels c
       WHERE c.server_id = ?
       ORDER BY c.type ASC, c.position ASC, c.created_at ASC`,
    )
    .all(serverId) as ChannelRow[];

  // JOIN com users: membros antigos (IDs de aba, de antes das contas) não aparecem mais.
  const memberRows = db
    .prepare(
      `SELECT m.user_id, m.joined_at, u.username, u.display_name, u.avatar_file, u.banner_file, u.bio
       FROM server_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.server_id = ?
       ORDER BY m.joined_at ASC`,
    )
    .all(serverId) as MemberRow[];

  const channels: Channel[] = channelRows.map((c) => ({
    id: c.id,
    serverId: c.server_id,
    name: c.name,
    type: c.type,
    createdAt: c.created_at,
    lastMessageAt: c.type === 'text' ? c.last_message_at : null,
  }));

  const members: ServerMember[] = memberRows.map((m) => {
    const current = status(m.user_id);
    return {
      id: m.user_id,
      username: m.username,
      displayName: m.display_name,
      nickname: m.display_name,
      avatarUrl: mediaUrl(m.avatar_file),
      bannerUrl: mediaUrl(m.banner_file),
      bio: m.bio,
      joinedAt: m.joined_at,
      online: current.online,
      activity: current.online ? current.activity : null,
    };
  });

  return {
    id: server.id,
    name: server.name,
    inviteCode: server.invite_code,
    ownerId: server.owner_id,
    createdAt: server.created_at,
    channels,
    members,
  };
}

export function getUserServerIds(userId: string): string[] {
  const rows = db
    .prepare('SELECT server_id FROM server_members WHERE user_id = ?')
    .all(userId) as Array<{ server_id: string }>;
  return rows.map((r) => r.server_id);
}

export function getServersForUser(userId: string, status: MemberStatusLookup): ServerDetails[] {
  const result: ServerDetails[] = [];
  for (const id of getUserServerIds(userId)) {
    const details = getServerDetails(id, status);
    if (details) {
      result.push(details);
    }
  }
  return result;
}

export function isServerMember(serverId: string, userId: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?')
      .get(serverId, userId),
  );
}

/** Mantém a coluna antiga `nickname` igual ao nome de exibição da conta. */
export function syncMemberNickname(userId: string, nickname: string): void {
  db.prepare('UPDATE server_members SET nickname = ? WHERE user_id = ?').run(nickname, userId);
}

export function createServer(
  rawName: string,
  ownerId: string,
  ownerNickname: string,
  status: MemberStatusLookup,
): ActionResult<ServerDetails> {
  const name = rawName.trim();
  if (name.length < LIMITS.serverNameMin || name.length > LIMITS.serverNameMax) {
    return {
      ok: false,
      error: `O nome do servidor deve ter entre ${LIMITS.serverNameMin} e ${LIMITS.serverNameMax} caracteres.`,
    };
  }

  const serverId = randomUUID();
  const inviteCode = createUniqueInviteCode();
  const now = new Date().toISOString();

  const insertTransaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO servers (id, name, invite_code, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(serverId, name, inviteCode, ownerId, now);

    db.prepare(
      `INSERT INTO server_members (server_id, user_id, nickname, joined_at)
       VALUES (?, ?, ?, ?)`,
    ).run(serverId, ownerId, ownerNickname, now);

    // Todo servidor novo começa com um canal de texto e um de voz prontos.
    const insertChannel = db.prepare(
      `INSERT INTO channels (id, server_id, name, type, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertChannel.run(randomUUID(), serverId, 'geral', 'text', 0, now);
    insertChannel.run(randomUUID(), serverId, 'Geral', 'voice', 1, now);
  });

  insertTransaction();

  const details = getServerDetails(serverId, status);
  if (!details) {
    return { ok: false, error: 'Erro ao carregar o servidor criado.' };
  }

  return { ok: true, data: details };
}

export function joinServerByInvite(
  rawInviteCode: string,
  userId: string,
  nickname: string,
  status: MemberStatusLookup,
): ActionResult<ServerDetails> {
  const inviteCode = rawInviteCode.trim().toUpperCase();
  if (!inviteCode) {
    return { ok: false, error: 'Digite um código de convite válido.' };
  }

  const server = db.prepare('SELECT id FROM servers WHERE invite_code = ?').get(inviteCode) as
    { id: string } | undefined;

  if (!server) {
    return {
      ok: false,
      error: 'Código de convite inválido ou servidor não encontrado.',
    };
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO server_members (server_id, user_id, nickname, joined_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id, user_id) DO UPDATE SET nickname = excluded.nickname`,
  ).run(server.id, userId, nickname, now);

  const details = getServerDetails(server.id, status);
  if (!details) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  return { ok: true, data: details };
}

export function leaveServer(serverId: string, userId: string): ActionResult {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId) as
    { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }
  if (server.owner_id === userId) {
    return {
      ok: false,
      error: 'O dono não pode sair do próprio servidor. Se quiser, apague o servidor.',
    };
  }

  const info = db
    .prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
    .run(serverId, userId);
  if (info.changes === 0) {
    return { ok: false, error: 'Você não é membro deste servidor.' };
  }
  return { ok: true };
}

export function deleteServer(serverId: string, requesterId: string): ActionResult {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId) as
    { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  if (server.owner_id !== requesterId) {
    return {
      ok: false,
      error: 'Apenas o dono pode apagar este servidor.',
    };
  }

  const files = collectAttachmentFiles('server', serverId);
  db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
  for (const file of files) {
    void deleteStoredFile(file);
  }
  return { ok: true };
}

export function createChannel(
  serverId: string,
  rawName: string,
  type: ChannelType,
  requesterId: string,
): ActionResult<Channel> {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId) as
    { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  if (server.owner_id !== requesterId) {
    return {
      ok: false,
      error: 'Apenas o dono do servidor pode criar canais.',
    };
  }

  const name = rawName.trim();
  if (name.length < LIMITS.channelNameMin || name.length > LIMITS.channelNameMax) {
    return {
      ok: false,
      error: `O nome do canal deve ter entre ${LIMITS.channelNameMin} e ${LIMITS.channelNameMax} caracteres.`,
    };
  }

  const countRow = db
    .prepare('SELECT COUNT(*) AS total FROM channels WHERE server_id = ?')
    .get(serverId) as { total: number };

  const channel: Channel = {
    id: randomUUID(),
    serverId,
    name,
    type,
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
  };

  db.prepare(
    `INSERT INTO channels (id, server_id, name, type, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    channel.id,
    channel.serverId,
    channel.name,
    channel.type,
    countRow.total,
    channel.createdAt,
  );

  return { ok: true, data: channel };
}

export function deleteChannel(
  serverId: string,
  channelId: string,
  requesterId: string,
): ActionResult {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId) as
    { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  if (server.owner_id !== requesterId) {
    return {
      ok: false,
      error: 'Apenas o dono do servidor pode apagar canais.',
    };
  }

  const files = collectAttachmentFiles('channel', channelId);
  const info = db
    .prepare('DELETE FROM channels WHERE id = ? AND server_id = ?')
    .run(channelId, serverId);

  if (info.changes === 0) {
    return { ok: false, error: 'Canal não encontrado.' };
  }

  for (const file of files) {
    void deleteStoredFile(file);
  }
  return { ok: true };
}

import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ActionResult,
  Channel,
  ChannelType,
  ServerDetails,
  ServerMember,
} from '@nexusvoice/shared';
import { db } from './db.js';

const SERVER_NAME_MIN = 2;
const SERVER_NAME_MAX = 50;
const CHANNEL_NAME_MIN = 1;
const CHANNEL_NAME_MAX = 32;

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
}

interface MemberRow {
  user_id: string;
  nickname: string;
  joined_at: string;
}

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
  const checkStmt = db.prepare(
    'SELECT 1 FROM servers WHERE invite_code = ?',
  );
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
  onlineUserIds: Set<string>,
): ServerDetails | null {
  const server = db
    .prepare(
      'SELECT id, name, invite_code, owner_id, created_at FROM servers WHERE id = ?',
    )
    .get(serverId) as ServerRow | undefined;

  if (!server) {
    return null;
  }

  const channelRows = db
    .prepare(
      `SELECT id, server_id, name, type, created_at
       FROM channels
       WHERE server_id = ?
       ORDER BY type ASC, position ASC, created_at ASC`,
    )
    .all(serverId) as ChannelRow[];

  const memberRows = db
    .prepare(
      `SELECT user_id, nickname, joined_at
       FROM server_members
       WHERE server_id = ?
       ORDER BY joined_at ASC`,
    )
    .all(serverId) as MemberRow[];

  const channels: Channel[] = channelRows.map((c) => ({
    id: c.id,
    serverId: c.server_id,
    name: c.name,
    type: c.type,
    createdAt: c.created_at,
  }));

  const members: ServerMember[] = memberRows.map((m) => ({
    userId: m.user_id,
    nickname: m.nickname,
    joinedAt: m.joined_at,
    online: onlineUserIds.has(m.user_id),
  }));

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

export function getServersForUser(
  userId: string,
  onlineUserIds: Set<string>,
): ServerDetails[] {
  const serverIds = getUserServerIds(userId);
  const result: ServerDetails[] = [];
  for (const id of serverIds) {
    const details = getServerDetails(id, onlineUserIds);
    if (details) {
      result.push(details);
    }
  }
  return result;
}

export function syncMemberNickname(userId: string, nickname: string): void {
  db.prepare(
    'UPDATE server_members SET nickname = ? WHERE user_id = ?',
  ).run(nickname, userId);
}

export function createServer(
  rawName: string,
  ownerId: string,
  ownerNickname: string,
  onlineUserIds: Set<string>,
): ActionResult<ServerDetails> {
  const name = rawName.trim();
  if (name.length < SERVER_NAME_MIN || name.length > SERVER_NAME_MAX) {
    return {
      ok: false,
      error: `O nome do servidor deve ter entre ${SERVER_NAME_MIN} e ${SERVER_NAME_MAX} caracteres.`,
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

  const details = getServerDetails(serverId, onlineUserIds);
  if (!details) {
    return { ok: false, error: 'Erro ao carregar o servidor criado.' };
  }

  return { ok: true, data: details };
}

export function joinServerByInvite(
  rawInviteCode: string,
  userId: string,
  nickname: string,
  onlineUserIds: Set<string>,
): ActionResult<ServerDetails> {
  const inviteCode = rawInviteCode.trim().toUpperCase();
  if (!inviteCode) {
    return { ok: false, error: 'Digite um código de convite válido.' };
  }

  const server = db
    .prepare('SELECT id FROM servers WHERE invite_code = ?')
    .get(inviteCode) as { id: string } | undefined;

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

  const details = getServerDetails(server.id, onlineUserIds);
  if (!details) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  return { ok: true, data: details };
}

export function deleteServer(
  serverId: string,
  requesterId: string,
): ActionResult {
  const server = db
    .prepare('SELECT owner_id FROM servers WHERE id = ?')
    .get(serverId) as { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  if (server.owner_id !== requesterId) {
    return {
      ok: false,
      error: 'Apenas o dono pode apagar este servidor.',
    };
  }

  db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
  return { ok: true };
}

export function createChannel(
  serverId: string,
  rawName: string,
  type: ChannelType,
  requesterId: string,
): ActionResult<Channel> {
  const server = db
    .prepare('SELECT owner_id FROM servers WHERE id = ?')
    .get(serverId) as { owner_id: string } | undefined;

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
  if (name.length < CHANNEL_NAME_MIN || name.length > CHANNEL_NAME_MAX) {
    return {
      ok: false,
      error: `O nome do canal deve ter entre ${CHANNEL_NAME_MIN} e ${CHANNEL_NAME_MAX} caracteres.`,
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
  const server = db
    .prepare('SELECT owner_id FROM servers WHERE id = ?')
    .get(serverId) as { owner_id: string } | undefined;

  if (!server) {
    return { ok: false, error: 'Servidor não encontrado.' };
  }

  if (server.owner_id !== requesterId) {
    return {
      ok: false,
      error: 'Apenas o dono do servidor pode apagar canais.',
    };
  }

  const info = db
    .prepare('DELETE FROM channels WHERE id = ? AND server_id = ?')
    .run(channelId, serverId);

  if (info.changes === 0) {
    return { ok: false, error: 'Canal não encontrado.' };
  }

  return { ok: true };
}

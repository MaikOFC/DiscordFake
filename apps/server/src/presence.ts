import type {
  ActionResult,
  ChannelType,
  UserSession,
  VoicePresenceUser,
} from '@nexusvoice/shared';
import { db } from './db.js';

interface ChannelLookupRow {
  id: string;
  server_id: string;
  type: ChannelType;
}

// Guarda em qual canal de voz cada conexão (socket.id) está.
// Quando o socket cai ou fecha a aba, apagamos daqui para não sobrar fantasma.
const voiceBySocket = new Map<string, VoicePresenceUser>();

export function getVoicePresenceForServer(
  serverId: string,
): VoicePresenceUser[] {
  const users: VoicePresenceUser[] = [];
  for (const entry of voiceBySocket.values()) {
    if (entry.serverId === serverId) {
      users.push(entry);
    }
  }
  return users;
}

export function getVoicePresenceForServers(
  serverIds: string[],
): VoicePresenceUser[] {
  const allowed = new Set(serverIds);
  const users: VoicePresenceUser[] = [];
  for (const entry of voiceBySocket.values()) {
    if (allowed.has(entry.serverId)) {
      users.push(entry);
    }
  }
  return users;
}

export function joinVoicePresence(
  session: UserSession,
  channelId: string,
  isMuted: boolean,
  isDeafened: boolean,
): { result: ActionResult; affectedServerIds: string[] } {
  const channel = db
    .prepare('SELECT id, server_id, type FROM channels WHERE id = ?')
    .get(channelId) as ChannelLookupRow | undefined;

  if (!channel || channel.type !== 'voice') {
    return {
      result: { ok: false, error: 'Canal de voz não encontrado.' },
      affectedServerIds: [],
    };
  }

  const membership = db
    .prepare(
      'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
    )
    .get(channel.server_id, session.userId);

  if (!membership) {
    return {
      result: { ok: false, error: 'Você não é membro deste servidor.' },
      affectedServerIds: [],
    };
  }

  const affected = new Set<string>();
  const previous = voiceBySocket.get(session.socketId);
  if (previous) {
    affected.add(previous.serverId);
  }

  voiceBySocket.set(session.socketId, {
    userId: session.userId,
    nickname: session.nickname,
    serverId: channel.server_id,
    channelId: channel.id,
    isMuted,
    isDeafened,
    isCameraOn: false,
    isScreenSharing: false,
  });

  affected.add(channel.server_id);
  return {
    result: { ok: true },
    affectedServerIds: Array.from(affected),
  };
}

export function updateVoicePresence(
  socketId: string,
  patch: {
    isMuted?: boolean;
    isDeafened?: boolean;
    isCameraOn?: boolean;
    isScreenSharing?: boolean;
  },
): string | null {
  const current = voiceBySocket.get(socketId);
  if (!current) {
    return null;
  }

  voiceBySocket.set(socketId, {
    ...current,
    isMuted:
      typeof patch.isMuted === 'boolean' ? patch.isMuted : current.isMuted,
    isDeafened:
      typeof patch.isDeafened === 'boolean'
        ? patch.isDeafened
        : current.isDeafened,
    isCameraOn:
      typeof patch.isCameraOn === 'boolean'
        ? patch.isCameraOn
        : current.isCameraOn,
    isScreenSharing:
      typeof patch.isScreenSharing === 'boolean'
        ? patch.isScreenSharing
        : current.isScreenSharing,
  });

  return current.serverId;
}

export function leaveVoicePresence(socketId: string): string | null {
  const existing = voiceBySocket.get(socketId);
  if (!existing) {
    return null;
  }
  voiceBySocket.delete(socketId);
  return existing.serverId;
}

export function clearVoicePresenceForChannel(channelId: string): string | null {
  let affectedServerId: string | null = null;
  for (const [socketId, entry] of voiceBySocket.entries()) {
    if (entry.channelId === channelId) {
      affectedServerId = entry.serverId;
      voiceBySocket.delete(socketId);
    }
  }
  return affectedServerId;
}

export function clearVoicePresenceForServer(serverId: string): void {
  for (const [socketId, entry] of voiceBySocket.entries()) {
    if (entry.serverId === serverId) {
      voiceBySocket.delete(socketId);
    }
  }
}

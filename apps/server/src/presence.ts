import type { ActionResult, ChannelType, VoicePresenceUser } from '@nexusvoice/shared';
import { getPublicUser } from './auth.js';
import { db } from './db.js';
import { isServerMember } from './servers.js';

interface ChannelLookupRow {
  id: string;
  server_id: string;
  type: ChannelType;
}

// Guarda em qual canal de voz cada conexão (socket.id) está.
// Quando o socket cai ou fecha o app, apagamos daqui para não sobrar fantasma.
const voiceBySocket = new Map<string, VoicePresenceUser>();

export function getVoicePresenceForServer(serverId: string): VoicePresenceUser[] {
  const users: VoicePresenceUser[] = [];
  for (const entry of voiceBySocket.values()) {
    if (entry.serverId === serverId) {
      users.push(entry);
    }
  }
  return users;
}

export function getVoicePresenceForServers(serverIds: string[]): VoicePresenceUser[] {
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
  socketId: string,
  userId: string,
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

  const user = getPublicUser(userId);
  if (!user || !isServerMember(channel.server_id, userId)) {
    return {
      result: { ok: false, error: 'Você não é membro deste servidor.' },
      affectedServerIds: [],
    };
  }

  const affected = new Set<string>();

  // A mesma conta só fica em um canal de voz por vez, mesmo com duas janelas abertas.
  for (const [otherSocket, entry] of voiceBySocket.entries()) {
    if (entry.userId === userId && otherSocket !== socketId) {
      voiceBySocket.delete(otherSocket);
      affected.add(entry.serverId);
    }
  }

  const previous = voiceBySocket.get(socketId);
  if (previous) {
    affected.add(previous.serverId);
  }

  voiceBySocket.set(socketId, {
    userId,
    nickname: user.displayName,
    avatarUrl: user.avatarUrl,
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
    isMuted: typeof patch.isMuted === 'boolean' ? patch.isMuted : current.isMuted,
    isDeafened: typeof patch.isDeafened === 'boolean' ? patch.isDeafened : current.isDeafened,
    isCameraOn: typeof patch.isCameraOn === 'boolean' ? patch.isCameraOn : current.isCameraOn,
    isScreenSharing:
      typeof patch.isScreenSharing === 'boolean' ? patch.isScreenSharing : current.isScreenSharing,
  });

  return current.serverId;
}

/** Atualiza nome e avatar de quem está em chamada depois de uma mudança no perfil. */
export function refreshVoicePresenceUser(userId: string): string[] {
  const user = getPublicUser(userId);
  const affected = new Set<string>();
  if (!user) return [];
  for (const [socketId, entry] of voiceBySocket.entries()) {
    if (entry.userId === userId) {
      voiceBySocket.set(socketId, {
        ...entry,
        nickname: user.displayName,
        avatarUrl: user.avatarUrl,
      });
      affected.add(entry.serverId);
    }
  }
  return Array.from(affected);
}

export function leaveVoicePresence(socketId: string): string | null {
  const existing = voiceBySocket.get(socketId);
  if (!existing) {
    return null;
  }
  voiceBySocket.delete(socketId);
  return existing.serverId;
}

/** Tira uma pessoa da voz de um servidor (por exemplo, quando ela sai do servidor). */
export function removeUserFromServerVoice(userId: string, serverId: string): boolean {
  let removed = false;
  for (const [socketId, entry] of voiceBySocket.entries()) {
    if (entry.userId === userId && entry.serverId === serverId) {
      voiceBySocket.delete(socketId);
      removed = true;
    }
  }
  return removed;
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

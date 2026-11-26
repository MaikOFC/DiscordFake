import { AccessToken } from 'livekit-server-sdk';
import type { ActionResult, ChannelType, VoiceTokenPayload } from '@nexusvoice/shared';
import { db } from './db.js';

interface ChannelRow {
  id: string;
  server_id: string;
  name: string;
  type: ChannelType;
}

interface MemberRow {
  nickname: string;
}

export interface CreateVoiceTokenResult {
  statusCode: number;
  body: ActionResult<VoiceTokenPayload>;
}

/**
 * Gera um token do LiveKit somente depois de confirmar no SQLite que o usuário
 * realmente é membro do servidor dono daquele canal de voz.
 */
export async function createVoiceTokenForMember(
  channelId: string,
  userId: string,
): Promise<CreateVoiceTokenResult> {
  const livekitUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!livekitUrl || !apiKey || !apiSecret) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error:
          'Configuração do LiveKit ausente no arquivo .env do servidor.',
      },
    };
  }

  const channel = db
    .prepare('SELECT id, server_id, name, type FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow | undefined;

  if (!channel) {
    return {
      statusCode: 404,
      body: { ok: false, error: 'Canal de voz não encontrado.' },
    };
  }

  if (channel.type !== 'voice') {
    return {
      statusCode: 400,
      body: { ok: false, error: 'Este canal não é um canal de voz.' },
    };
  }

  const member = db
    .prepare(
      'SELECT nickname FROM server_members WHERE server_id = ? AND user_id = ?',
    )
    .get(channel.server_id, userId) as MemberRow | undefined;

  if (!member) {
    return {
      statusCode: 403,
      body: {
        ok: false,
        error: 'Acesso negado: você não é membro deste servidor.',
      },
    };
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    name: member.nickname,
    ttl: '2h',
  });

  token.addGrant({
    roomJoin: true,
    room: channel.id,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const jwt = await token.toJwt();

  return {
    statusCode: 200,
    body: {
      ok: true,
      data: {
        token: jwt,
        url: livekitUrl,
        roomName: channel.id,
        channelName: channel.name,
        serverId: channel.server_id,
      },
    },
  };
}

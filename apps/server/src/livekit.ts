import { AccessToken } from 'livekit-server-sdk';
import type { ActionResult, ChannelType, VoiceTokenPayload } from '@nexusvoice/shared';
import { getPublicUser } from './auth.js';
import { db } from './db.js';
import { isServerMember } from './servers.js';

interface ChannelRow {
  id: string;
  server_id: string;
  name: string;
  type: ChannelType;
}

export interface CreateVoiceTokenResult {
  statusCode: number;
  body: ActionResult<VoiceTokenPayload>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Descobre o endereço do LiveKit que o cliente deve usar.
 *
 * Se o .env aponta para localhost mas a pessoa chegou por outro endereço
 * (o IP do Radmin, por exemplo), troca só o host. Assim o mesmo .env serve
 * para quem está no PC do servidor e para quem entra pela rede.
 */
export function resolveLivekitUrl(configured: string | undefined, requestHost: string): string {
  const fallback = `ws://localhost:${process.env.LIVEKIT_PORT ?? '7880'}`;
  const raw = configured && configured !== 'auto' ? configured : fallback;
  try {
    const url = new URL(raw);
    const clientHost = requestHost.replace(/:\d+$/, '');
    if (LOCAL_HOSTS.has(url.hostname) && clientHost && !LOCAL_HOSTS.has(clientHost)) {
      url.hostname = clientHost;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/**
 * Gera um token do LiveKit somente depois de confirmar no SQLite que a conta
 * realmente é membro do servidor dono daquele canal de voz.
 */
export async function createVoiceTokenForMember(
  channelId: string,
  userId: string,
  requestHost: string,
): Promise<CreateVoiceTokenResult> {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!apiKey || !apiSecret) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error: 'Configuração do LiveKit ausente no arquivo .env do servidor.',
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

  const user = getPublicUser(userId);
  if (!user || !isServerMember(channel.server_id, userId)) {
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
    name: user.displayName,
    ttl: '6h',
  });

  token.addGrant({
    roomJoin: true,
    room: channel.id,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      data: {
        token: await token.toJwt(),
        url: resolveLivekitUrl(process.env.LIVEKIT_URL?.trim(), requestHost),
        roomName: channel.id,
        channelName: channel.name,
        serverId: channel.server_id,
      },
    },
  };
}

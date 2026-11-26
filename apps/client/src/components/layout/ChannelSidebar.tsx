import { useState, type ReactNode } from 'react';
import type { Channel, ChannelType, ServerDetails } from '@nexusvoice/shared';
import { deleteChannel, deleteServer, leaveServer } from '../../services/socket';
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  toggleCamera,
  toggleDeafen,
  toggleMicrophoneMute,
  toggleScreenShare,
} from '../../services/voice';
import { useAppStore } from '../../store/useAppStore';
import { useSettings } from '../../store/useSettings';
import { Avatar } from '../Avatar';
import { openProfileAt } from '../ProfileCard';

function IconButton({
  title,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-sm transition ${
        danger
          ? 'text-red-400 hover:bg-red-500/15'
          : active
            ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
            : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function ServerHeader({ server, isOwner }: { server: ServerDetails; isOwner: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(server.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function runConfirm(): Promise<void> {
    const result = confirm === 'delete' ? await deleteServer(server.id) : await leaveServer(server.id);
    setConfirm(null);
    setMenuOpen(false);
    if (!result.ok) setError(result.error ?? 'Não deu certo.');
  }

  return (
    <div className="relative border-b border-zinc-900/80 shadow-sm">
      <button
        type="button"
        onClick={() => {
          setMenuOpen((v) => !v);
          setConfirm(null);
          setError(null);
        }}
        className="flex h-12 w-full cursor-pointer items-center justify-between px-4 text-left hover:bg-zinc-700/30"
      >
        <span className="truncate text-sm font-bold text-white">{server.name}</span>
        <span className="text-xs text-zinc-400">{menuOpen ? '✕' : '▾'}</span>
      </button>

      {menuOpen && (
        <div className="absolute top-12 right-2 left-2 z-30 space-y-1 rounded-lg border border-zinc-700 bg-[#111214] p-2 text-xs shadow-xl">
          <div className="flex items-center justify-between gap-2 rounded-md bg-[#1e1f22] px-2 py-1.5">
            <span className="text-zinc-400">
              Convite: <code className="font-mono font-semibold text-emerald-400">{server.inviteCode}</code>
            </span>
            <button
              type="button"
              onClick={() => void copyInvite()}
              className="cursor-pointer rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-100 hover:bg-zinc-600"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <div className="px-2 py-1 text-zinc-500">{isOwner ? 'Você é o dono deste servidor.' : 'Você é membro.'}</div>
          {!confirm ? (
            <button
              type="button"
              onClick={() => setConfirm(isOwner ? 'delete' : 'leave')}
              className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-red-300 hover:bg-red-500/15"
            >
              {isOwner ? 'Apagar servidor' : 'Sair do servidor'}
            </button>
          ) : (
            <div className="space-y-1.5 rounded-md border border-red-500/40 bg-red-500/10 p-2">
              <p className="text-red-200">
                {confirm === 'delete'
                  ? `Apagar "${server.name}" para todo mundo? Isso não tem volta.`
                  : `Sair de "${server.name}"? Para voltar você precisa do convite.`}
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void runConfirm()}
                  className="flex-1 cursor-pointer rounded bg-red-600 py-1 font-semibold text-white hover:bg-red-500"
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="flex-1 cursor-pointer rounded bg-zinc-700 py-1 text-zinc-200 hover:bg-zinc-600"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {error && <p className="px-2 text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

function VoicePanel() {
  const voiceStatus = useAppStore((s) => s.voiceStatus);
  const voiceChannelName = useAppStore((s) => s.voiceChannelName);
  const voiceServerId = useAppStore((s) => s.voiceServerId);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const servers = useAppStore((s) => s.servers);
  const isCameraOn = useAppStore((s) => s.isCameraOn);
  const isScreenSharing = useAppStore((s) => s.isScreenSharing);
  const isPttPressed = useAppStore((s) => s.isPttPressed);
  const voiceError = useAppStore((s) => s.voiceError);
  const selectServer = useAppStore((s) => s.selectServer);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const voiceMode = useSettings((s) => s.voiceMode);
  const pttKey = useSettings((s) => s.pttKey);

  if (voiceStatus === 'idle' && !voiceError) return null;
  const serverName = servers.find((s) => s.id === voiceServerId)?.name;

  return (
    <div className="border-t border-zinc-900/80 bg-[#232428] px-2 py-2 text-xs">
      {voiceStatus !== 'idle' && (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => {
                if (voiceServerId) selectServer(voiceServerId);
                if (voiceChannelId) selectChannel(voiceChannelId);
              }}
              className="min-w-0 cursor-pointer text-left"
            >
              <div
                className={`font-semibold ${
                  voiceStatus === 'connected' ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {voiceStatus === 'connected'
                  ? 'Voz conectada'
                  : voiceStatus === 'reconnecting'
                    ? 'Reconectando à voz...'
                    : 'Conectando à voz...'}
              </div>
              <div className="truncate text-[11px] text-zinc-400 hover:underline">
                {voiceChannelName}
                {serverName ? ` / ${serverName}` : ''}
              </div>
            </button>
            <IconButton title="Desconectar da voz" onClick={() => void leaveVoiceChannel()} danger>
              ✆
            </IconButton>
          </div>
          {voiceStatus === 'connected' && (
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => void toggleCamera()}
                className={`cursor-pointer rounded-md py-1 text-[11px] font-medium ${
                  isCameraOn ? 'bg-emerald-600 text-white' : 'bg-zinc-700/70 text-zinc-200 hover:bg-zinc-600'
                }`}
              >
                {isCameraOn ? 'Câmera ligada' : 'Câmera'}
              </button>
              <button
                type="button"
                onClick={() => void toggleScreenShare()}
                className={`cursor-pointer rounded-md py-1 text-[11px] font-medium ${
                  isScreenSharing ? 'bg-emerald-600 text-white' : 'bg-zinc-700/70 text-zinc-200 hover:bg-zinc-600'
                }`}
              >
                {isScreenSharing ? 'Tela ligada' : 'Tela'}
              </button>
            </div>
          )}
          {voiceStatus === 'connected' && voiceMode === 'ptt' && (
            <div
              className={`mt-1.5 rounded px-1.5 py-0.5 text-center text-[10px] ${
                isPttPressed ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500'
              }`}
            >
              {isPttPressed
                ? 'Transmitindo'
                : pttKey
                  ? `Segure ${pttKey.name} para falar`
                  : 'Escolha a tecla do push-to-talk nas configurações'}
            </div>
          )}
        </>
      )}
      {voiceError && <p className="mt-1.5 px-1 text-[11px] text-red-300">{voiceError}</p>}
    </div>
  );
}

function UserPanel() {
  const me = useAppStore((s) => s.me);
  const isMicMuted = useAppStore((s) => s.isMicMuted);
  const isDeafened = useAppStore((s) => s.isDeafened);
  const voiceStatus = useAppStore((s) => s.voiceStatus);
  const gameActivity = useAppStore((s) => s.gameActivity);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const activeServerId = useAppStore((s) => s.activeServerId);
  if (!me) return null;
  const inCall = voiceStatus === 'connected';

  return (
    <div className="flex items-center gap-1 bg-[#232428] px-2 py-2">
      <button
        type="button"
        onClick={(e) => openProfileAt(me.id, activeServerId, e)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-zinc-700/50"
      >
        <Avatar url={me.avatarUrl} name={me.displayName} size={32} status="online" />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-white">{me.displayName}</div>
          <div className="truncate text-[10px] text-zinc-400">
            {gameActivity ? `Jogando ${gameActivity}` : `@${me.username}`}
          </div>
        </div>
      </button>
      {inCall && (
        <>
          <IconButton title={isMicMuted ? 'Desmutar' : 'Mutar'} onClick={() => void toggleMicrophoneMute()} active={isMicMuted}>
            {isMicMuted ? '🔇' : '🎙️'}
          </IconButton>
          <IconButton title={isDeafened ? 'Voltar a ouvir' : 'Ensurdecer'} onClick={() => void toggleDeafen()} active={isDeafened}>
            {isDeafened ? '🙉' : '🎧'}
          </IconButton>
        </>
      )}
      <IconButton title="Configurações" onClick={() => setSettingsOpen(true)}>
        ⚙
      </IconButton>
    </div>
  );
}

interface ChannelSidebarProps {
  server: ServerDetails | null;
  onCreateChannel: (type: ChannelType) => void;
}

export function ChannelSidebar({ server, onCreateChannel }: ChannelSidebarProps) {
  const me = useAppStore((s) => s.me);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const unread = useAppStore((s) => s.unreadChannels);
  const mentions = useAppStore((s) => s.mentionCounts);
  const voiceStatus = useAppStore((s) => s.voiceStatus);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const speakingUserIds = useAppStore((s) => s.speakingUserIds);
  const presence = useAppStore((s) => (server ? s.voicePresenceByServer[server.id] : undefined));
  const [error, setError] = useState<string | null>(null);

  const isOwner = Boolean(server && me && server.ownerId === me.id);
  const textChannels = server?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels = server?.channels.filter((c) => c.type === 'voice') ?? [];

  async function handleDeleteChannel(channel: Channel): Promise<void> {
    if (!server) return;
    setError(null);
    const result = await deleteChannel(server.id, channel.id);
    if (!result.ok) setError(result.error ?? 'Não foi possível apagar o canal.');
  }

  function CategoryHeader({ label, type }: { label: string; type: ChannelType }) {
    return (
      <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        <span>{label}</span>
        {isOwner && (
          <button
            type="button"
            title={`Criar ${type === 'text' ? 'canal de texto' : 'canal de voz'}`}
            onClick={() => onCreateChannel(type)}
            className="cursor-pointer rounded px-1 text-base leading-none text-zinc-400 hover:text-white"
          >
            +
          </button>
        )}
      </div>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-[#2b2d31]">
      {server ? (
        <>
          <ServerHeader server={server} isOwner={isOwner} />
          <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            <div>
              <CategoryHeader label="Canais de texto" type="text" />
              <ul className="space-y-0.5">
                {textChannels.map((channel) => {
                  const isSelected = channel.id === activeChannelId;
                  const isUnread = Boolean(unread[channel.id]) && !isSelected;
                  const mentionCount = mentions[channel.id] ?? 0;
                  return (
                    <li
                      key={channel.id}
                      className={`group relative flex items-center rounded-md px-2 py-1.5 text-sm ${
                        isSelected
                          ? 'bg-zinc-600/50 text-white'
                          : isUnread
                            ? 'font-semibold text-white hover:bg-zinc-700/40'
                            : 'text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200'
                      }`}
                    >
                      {isUnread && <span className="absolute -left-2 h-2 w-1 rounded-r bg-white" />}
                      <button
                        type="button"
                        onClick={() => selectChannel(channel.id)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                      >
                        <span className="text-zinc-500">#</span>
                        <span className="truncate">{channel.name}</span>
                      </button>
                      {mentionCount > 0 && (
                        <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {mentionCount}
                        </span>
                      )}
                      {isOwner && (
                        <button
                          type="button"
                          title="Apagar canal"
                          onClick={() => void handleDeleteChannel(channel)}
                          className="ml-1 hidden cursor-pointer rounded px-1 text-xs text-zinc-400 hover:text-red-400 group-hover:inline-block"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <CategoryHeader label="Canais de voz" type="voice" />
              <ul className="space-y-0.5">
                {voiceChannels.map((channel) => {
                  const isSelected = channel.id === activeChannelId;
                  const people = (presence ?? []).filter((u) => u.channelId === channel.id);
                  const connectedHere = voiceStatus !== 'idle' && voiceChannelId === channel.id;
                  return (
                    <li key={channel.id}>
                      <div
                        className={`group flex items-center rounded-md px-2 py-1.5 text-sm ${
                          isSelected ? 'bg-zinc-600/50 text-white' : 'text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectChannel(channel.id);
                            void joinVoiceChannel(server.id, channel.id, channel.name);
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                        >
                          <span className="text-xs">🔊</span>
                          <span className="truncate">{channel.name}</span>
                          {connectedHere && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-400" />}
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            title="Apagar canal"
                            onClick={() => void handleDeleteChannel(channel)}
                            className="ml-1 hidden cursor-pointer rounded px-1 text-xs text-zinc-400 hover:text-red-400 group-hover:inline-block"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {people.length > 0 && (
                        <ul className="mt-0.5 mb-1 space-y-0.5 pl-6">
                          {people.map((person) => {
                            const speaking = speakingUserIds.includes(person.userId);
                            return (
                              <li key={person.userId}>
                                <button
                                  type="button"
                                  onClick={(e) => openProfileAt(person.userId, server.id, e)}
                                  className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs text-zinc-300 hover:bg-zinc-700/40"
                                >
                                  <Avatar url={person.avatarUrl} name={person.nickname} size={22} speaking={speaking} />
                                  <span className={`min-w-0 flex-1 truncate ${speaking ? 'text-white' : ''}`}>
                                    {person.nickname}
                                  </span>
                                  <span className="shrink-0 text-[10px]">
                                    {person.isScreenSharing ? '🖥️' : ''}
                                    {person.isCameraOn ? '📷' : ''}
                                    {person.isDeafened ? '🙉' : person.isMuted ? '🔇' : ''}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {error && <p className="px-2 text-[11px] text-red-300">{error}</p>}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-center px-4 text-center text-xs text-zinc-400">
          Nenhum servidor ainda. Crie um ou entre com um código de convite!
        </div>
      )}

      <VoicePanel />
      <UserPanel />
    </aside>
  );
}

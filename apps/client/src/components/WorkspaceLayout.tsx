import { useEffect, useState } from 'react';
import type { Channel, ChannelType } from '@nexusvoice/shared';
import {
  deleteChannel,
  deleteServer,
  disconnectSocket,
} from '../services/socket';
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  refreshAudioDevices,
  selectAudioInputDevice,
  selectAudioOutputDevice,
  setScreenShareQuality,
  toggleCamera,
  toggleDeafen,
  toggleMicrophoneMute,
  toggleScreenShare,
} from '../services/voice';
import {
  useAppStore,
  type ScreenFps,
  type ScreenResolution,
} from '../store/useAppStore';
import { ChannelModal } from './ChannelModal';
import { ChatPanel } from './ChatPanel';
import { ServerModal } from './ServerModal';
import { VideoGrid } from './VideoGrid';

function getServerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function WorkspaceLayout() {
  const userId = useAppStore((state) => state.userId);
  const nickname = useAppStore((state) => state.nickname);
  const servers = useAppStore((state) => state.servers);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const activeChannelId = useAppStore((state) => state.activeChannelId);
  const selectServer = useAppStore((state) => state.selectServer);
  const selectChannel = useAppStore((state) => state.selectChannel);

  const voiceStatus = useAppStore((state) => state.voiceStatus);
  const voiceChannelId = useAppStore((state) => state.voiceChannelId);
  const voiceChannelName = useAppStore((state) => state.voiceChannelName);
  const isMicMuted = useAppStore((state) => state.isMicMuted);
  const isDeafened = useAppStore((state) => state.isDeafened);
  const isCameraOn = useAppStore((state) => state.isCameraOn);
  const isScreenSharing = useAppStore((state) => state.isScreenSharing);
  const screenResolution = useAppStore((state) => state.screenResolution);
  const screenFps = useAppStore((state) => state.screenFps);
  const voiceError = useAppStore((state) => state.voiceError);
  const voiceParticipants = useAppStore((state) => state.voiceParticipants);
  const speakingUserIds = useAppStore((state) => state.speakingUserIds);
  const audioInputDevices = useAppStore((state) => state.audioInputDevices);
  const audioOutputDevices = useAppStore((state) => state.audioOutputDevices);
  const selectedAudioInputId = useAppStore(
    (state) => state.selectedAudioInputId,
  );
  const selectedAudioOutputId = useAppStore(
    (state) => state.selectedAudioOutputId,
  );
  const voicePresenceByServer = useAppStore(
    (state) => state.voicePresenceByServer,
  );

  const [serverModalMode, setServerModalMode] = useState<
    'create' | 'join' | null
  >(null);
  const [channelModalType, setChannelModalType] = useState<ChannelType | null>(
    null,
  );
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeServer =
    servers.find((server) => server.id === activeServerId) ?? null;
  const activeChannel =
    activeServer?.channels.find((channel) => channel.id === activeChannelId) ??
    null;

  const isOwner = activeServer?.ownerId === userId;
  const textChannels =
    activeServer?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels =
    activeServer?.channels.filter((c) => c.type === 'voice') ?? [];
  const serverPresence = activeServer
    ? (voicePresenceByServer[activeServer.id] ?? [])
    : [];

  useEffect(() => {
    void refreshAudioDevices();
  }, []);

  async function handleCopyInvite(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      setCopiedInvite(false);
    }
  }

  async function handleDeleteChannel(channel: Channel): Promise<void> {
    if (!activeServer) return;
    setActionError(null);
    const result = await deleteChannel(activeServer.id, channel.id);
    if (!result.ok) {
      setActionError(result.error ?? 'Não foi possível apagar o canal.');
    }
  }

  async function handleDeleteServer(): Promise<void> {
    if (!activeServer) return;
    setActionError(null);
    const result = await deleteServer(activeServer.id);
    setConfirmDeleteServer(false);
    if (!result.ok) {
      setActionError(result.error ?? 'Não foi possível apagar o servidor.');
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1e1f22] text-zinc-100">
      {/* Barra lateral esquerda: lista de servidores */}
      <aside className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-zinc-800/80 bg-[#1e1f22] py-3">
        {servers.map((server) => {
          const isActive = server.id === activeServer?.id;
          return (
            <button
              key={server.id}
              type="button"
              title={server.name}
              onClick={() => {
                selectServer(server.id);
                setConfirmDeleteServer(false);
                setActionError(null);
              }}
              className={`group relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl text-xs font-bold transition ${
                isActive
                  ? 'rounded-xl bg-emerald-600 text-white'
                  : 'bg-[#2b2d31] text-zinc-200 hover:rounded-xl hover:bg-emerald-600/80 hover:text-white'
              }`}
            >
              {getServerInitials(server.name)}
            </button>
          );
        })}

        <button
          type="button"
          title="Criar servidor ou entrar com convite"
          onClick={() => setServerModalMode('create')}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-zinc-600 bg-[#2b2d31] text-xl font-semibold text-emerald-400 transition hover:rounded-xl hover:border-emerald-500 hover:bg-emerald-600 hover:text-white"
        >
          +
        </button>
      </aside>

      {/* Barra de canais do servidor ativo */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-[#2b2d31]">
        {activeServer ? (
          <>
            <div className="border-b border-zinc-800/80 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-bold text-white">
                  {activeServer.name}
                </h2>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    isOwner
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-zinc-700 text-zinc-300'
                  }`}
                >
                  {isOwner ? 'Dono' : 'Membro'}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-[#1e1f22] px-2 py-1 text-[11px]">
                <span className="text-zinc-400">
                  Convite:{' '}
                  <code className="font-mono font-semibold text-emerald-400">
                    {activeServer.inviteCode}
                  </code>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyInvite(activeServer.inviteCode)}
                  className="cursor-pointer rounded bg-zinc-700/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-600"
                >
                  {copiedInvite ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
              {/* Canais de texto */}
              <div>
                <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <span>Canais de texto</span>
                  {isOwner && (
                    <button
                      type="button"
                      title="Criar canal de texto"
                      onClick={() => setChannelModalType('text')}
                      className="cursor-pointer rounded px-1 text-sm leading-none text-zinc-300 hover:bg-zinc-700 hover:text-white"
                    >
                      +
                    </button>
                  )}
                </div>

                <ul className="space-y-0.5">
                  {textChannels.map((channel) => {
                    const isSelected = channel.id === activeChannel?.id;
                    return (
                      <li
                        key={channel.id}
                        className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                          isSelected
                            ? 'bg-zinc-700/80 text-white'
                            : 'text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => selectChannel(channel.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                        >
                          <span className="text-zinc-500">#</span>
                          <span className="truncate">{channel.name}</span>
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            title="Apagar canal"
                            onClick={() => void handleDeleteChannel(channel)}
                            className="hidden cursor-pointer rounded px-1 text-xs text-zinc-400 hover:text-red-400 group-hover:inline-block"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Canais de voz + lista de quem está em cada canal */}
              <div>
                <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <span>Canais de voz</span>
                  {isOwner && (
                    <button
                      type="button"
                      title="Criar canal de voz"
                      onClick={() => setChannelModalType('voice')}
                      className="cursor-pointer rounded px-1 text-sm leading-none text-zinc-300 hover:bg-zinc-700 hover:text-white"
                    >
                      +
                    </button>
                  )}
                </div>

                <ul className="space-y-1">
                  {voiceChannels.map((channel) => {
                    const isSelected = channel.id === activeChannel?.id;
                    const inChannel = serverPresence.filter(
                      (u) => u.channelId === channel.id,
                    );
                    const isConnectedHere =
                      voiceStatus === 'connected' &&
                      voiceChannelId === channel.id;

                    return (
                      <li key={channel.id}>
                        <div
                          className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                            isSelected
                              ? 'bg-zinc-700/80 text-white'
                              : 'text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              selectChannel(channel.id);
                              if (activeServer) {
                                void joinVoiceChannel(
                                  activeServer.id,
                                  channel.id,
                                  channel.name,
                                );
                              }
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                          >
                            <span className="text-xs">🔊</span>
                            <span className="truncate">{channel.name}</span>
                            {isConnectedHere && (
                              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                            )}
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              title="Apagar canal"
                              onClick={() => void handleDeleteChannel(channel)}
                              className="hidden cursor-pointer rounded px-1 text-xs text-zinc-400 hover:text-red-400 group-hover:inline-block"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {inChannel.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5 pl-6 pr-2">
                            {inChannel.map((person) => {
                              const isSpeaking = speakingUserIds.includes(
                                person.userId,
                              );
                              return (
                                <li
                                  key={person.userId}
                                  className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs ${
                                    isSpeaking
                                      ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50'
                                      : 'text-zinc-400'
                                  }`}
                                >
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span
                                      className={`h-2 w-2 shrink-0 rounded-full ${
                                        isSpeaking
                                          ? 'bg-emerald-400'
                                          : 'bg-zinc-600'
                                      }`}
                                    />
                                    <span className="truncate">
                                      {person.nickname}
                                    </span>
                                  </div>
                                  <span className="shrink-0 text-[10px]">
                                    {person.isScreenSharing ? '🖥️ ' : ''}
                                    {person.isCameraOn ? '📷 ' : ''}
                                    {person.isDeafened
                                      ? '🔇🎧'
                                      : person.isMuted
                                        ? '🔇'
                                        : ''}
                                  </span>
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

              {!isOwner && (
                <p className="px-2 text-[11px] text-zinc-500">
                  Somente o dono do servidor pode criar ou apagar canais.
                </p>
              )}

              {isOwner && (
                <div className="border-t border-zinc-800/80 px-2 pt-3">
                  {!confirmDeleteServer ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteServer(true)}
                      className="w-full cursor-pointer rounded-md border border-red-500/30 px-2 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
                    >
                      Apagar servidor
                    </button>
                  ) : (
                    <div className="space-y-1.5 rounded-md border border-red-500/40 bg-red-500/10 p-2">
                      <p className="text-[11px] text-red-200">
                        Apagar mesmo &ldquo;{activeServer.name}&rdquo;?
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDeleteServer()}
                          className="flex-1 cursor-pointer rounded bg-red-600 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                        >
                          Sim, apagar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteServer(false)}
                          className="flex-1 cursor-pointer rounded bg-zinc-700 py-1 text-[11px] text-zinc-200 hover:bg-zinc-600"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-center px-4 text-center text-xs text-zinc-400">
            Nenhum servidor ainda. Crie um ou entre com um código de convite!
          </div>
        )}

        {/* Barra de controles de voz */}
        {(voiceStatus !== 'idle' || voiceError) && (
          <div className="border-t border-zinc-800 bg-[#232428] px-3 py-2 text-xs">
            {voiceStatus !== 'idle' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 font-semibold text-emerald-400">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate">
                      {voiceStatus === 'connecting'
                        ? 'Conectando à voz...'
                        : `Voz: ${voiceChannelName}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void leaveVoiceChannel()}
                    className="shrink-0 cursor-pointer rounded bg-red-600/85 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-500"
                  >
                    Sair
                  </button>
                </div>

                {voiceStatus === 'connected' && (
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleMicrophoneMute()}
                      className={`cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        isMicMuted
                          ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                          : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                      }`}
                    >
                      {isMicMuted ? 'Mutado' : 'Mic ON'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleDeafen()}
                      className={`cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        isDeafened
                          ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                          : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                      }`}
                    >
                      {isDeafened ? 'Surdo' : 'Ouvir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleCamera()}
                      className={`cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        isCameraOn
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                      }`}
                    >
                      {isCameraOn ? 'Câmera ON' : 'Câmera'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleScreenShare()}
                      className={`cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        isScreenSharing
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                      }`}
                    >
                      {isScreenSharing ? 'Tela ON' : 'Tela'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAudioSettings((prev) => !prev);
                        void refreshAudioDevices();
                      }}
                      className={`col-span-2 cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        showAudioSettings
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                      }`}
                    >
                      Dispositivos de áudio
                    </button>
                  </div>
                )}

                {showAudioSettings && voiceStatus === 'connected' && (
                  <div className="space-y-2 rounded-lg border border-zinc-700/80 bg-[#1e1f22] p-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] uppercase text-zinc-400">
                        Microfone
                      </label>
                      <select
                        value={selectedAudioInputId}
                        onChange={(e) =>
                          void selectAudioInputDevice(e.target.value)
                        }
                        className="w-full rounded border border-zinc-700 bg-[#2b2d31] px-1.5 py-1 text-[11px] text-zinc-100 outline-none"
                      >
                        <option value="">Padrão do sistema</option>
                        {audioInputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] uppercase text-zinc-400">
                        Saída de áudio
                      </label>
                      <select
                        value={selectedAudioOutputId}
                        onChange={(e) =>
                          void selectAudioOutputDevice(e.target.value)
                        }
                        className="w-full rounded border border-zinc-700 bg-[#2b2d31] px-1.5 py-1 text-[11px] text-zinc-100 outline-none"
                      >
                        <option value="">Padrão do sistema</option>
                        {audioOutputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
            {voiceError && (
              <p className="mt-1.5 text-[11px] text-red-300">{voiceError}</p>
            )}
          </div>
        )}

        {/* Rodapé com dados desta aba */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-[#232428] px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              <span className="truncate text-xs font-semibold text-white">
                {nickname}
              </span>
            </div>
            <div className="truncate font-mono text-[10px] text-zinc-500">
              ID: {userId.slice(0, 8)}...
            </div>
          </div>

          <button
            type="button"
            onClick={disconnectSocket}
            className="shrink-0 cursor-pointer rounded bg-zinc-700/80 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-600"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Área principal */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#313338]">
        {activeServer ? (
          <>
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {activeChannel ? (
                  <>
                    <span className="text-zinc-400">
                      {activeChannel.type === 'text' ? '#' : '🔊'}
                    </span>
                    <span>{activeChannel.name}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">Selecione um canal</span>
                )}
              </div>
              <span className="text-xs text-zinc-400">
                {activeServer.members.length}{' '}
                {activeServer.members.length === 1 ? 'membro' : 'membros'}
              </span>
            </header>

            {actionError && (
              <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {actionError}
              </div>
            )}

            {activeChannel?.type === 'text' ? (
              <ChatPanel channel={activeChannel} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
                {activeChannel ? (
                  voiceStatus === 'connected' &&
                  voiceChannelId === activeChannel.id ? (
                    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-between gap-4">
                      {/* Cabeçalho da chamada */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                            Chamada ativa ({voiceParticipants.length})
                          </span>
                          <h3 className="text-lg font-bold text-white">
                            🔊 {activeChannel.name}
                          </h3>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void toggleMicrophoneMute()}
                            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              isMicMuted
                                ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                                : 'bg-zinc-700 text-white hover:bg-zinc-600'
                            }`}
                          >
                            {isMicMuted
                              ? 'Desmutar microfone'
                              : 'Mutar microfone'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleDeafen()}
                            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              isDeafened
                                ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                                : 'bg-zinc-700 text-white hover:bg-zinc-600'
                            }`}
                          >
                            {isDeafened ? 'Desensurdecer' : 'Ensurdecer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleCamera()}
                            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              isCameraOn
                                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                : 'bg-zinc-700 text-white hover:bg-zinc-600'
                            }`}
                          >
                            {isCameraOn ? 'Desligar câmera' : 'Ligar câmera'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleScreenShare()}
                            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              isScreenSharing
                                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                : 'bg-zinc-700 text-white hover:bg-zinc-600'
                            }`}
                          >
                            {isScreenSharing
                              ? 'Parar tela'
                              : 'Compartilhar tela'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void leaveVoiceChannel()}
                            className="cursor-pointer rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
                          >
                            Desconectar
                          </button>
                        </div>
                      </div>

                      {/* Qualidade do compartilhamento de tela */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-[#2b2d31] px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-300">
                            Qualidade da tela:
                          </span>
                          <select
                            value={screenResolution}
                            disabled={isScreenSharing}
                            onChange={(e) =>
                              setScreenShareQuality(
                                e.target.value as ScreenResolution,
                                screenFps,
                              )
                            }
                            className="rounded border border-zinc-700 bg-[#1e1f22] px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-60"
                          >
                            <option value="720p">720p (mais leve)</option>
                            <option value="1080p">1080p (Full HD)</option>
                          </select>
                          <select
                            value={screenFps}
                            disabled={isScreenSharing}
                            onChange={(e) =>
                              setScreenShareQuality(
                                screenResolution,
                                Number(e.target.value) as ScreenFps,
                              )
                            }
                            className="rounded border border-zinc-700 bg-[#1e1f22] px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-60"
                          >
                            <option value={30}>30 FPS</option>
                            <option value={60}>60 FPS</option>
                          </select>
                        </div>
                        <span className="text-[11px] text-zinc-400">
                          {isScreenSharing
                            ? 'Pare e compartilhe de novo para mudar a qualidade.'
                            : 'No Windows, o áudio do sistema só vai ao compartilhar a tela inteira.'}
                        </span>
                      </div>

                      {voiceError && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          {voiceError}
                        </div>
                      )}

                      {/* Grade de vídeos / avatares dos participantes */}
                      <div className="flex flex-1 items-center">
                        <VideoGrid serverId={activeServer.id} />
                      </div>

                      {/* Seleção de microfone e saída de áudio */}
                      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-[#2b2d31] p-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase text-zinc-400">
                            Microfone
                          </label>
                          <select
                            value={selectedAudioInputId}
                            onChange={(e) =>
                              void selectAudioInputDevice(e.target.value)
                            }
                            className="w-full rounded-md border border-zinc-700 bg-[#1e1f22] px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                          >
                            <option value="">Padrão do sistema</option>
                            {audioInputDevices.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase text-zinc-400">
                            Saída de áudio
                          </label>
                          <select
                            value={selectedAudioOutputId}
                            onChange={(e) =>
                              void selectAudioOutputDevice(e.target.value)
                            }
                            className="w-full rounded-md border border-zinc-700 bg-[#1e1f22] px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                          >
                            <option value="">Padrão do sistema</option>
                            {audioOutputDevices.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="w-full max-w-md rounded-xl border border-zinc-700/60 bg-[#2b2d31] p-6 text-center shadow-lg">
                        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                          Canal de Voz
                        </div>
                        <h3 className="mt-1 text-xl font-bold text-white">
                          🔊 {activeChannel.name}
                        </h3>
                        <p className="mt-2 text-sm text-zinc-400">
                          Clique abaixo para entrar na chamada de voz e vídeo
                          deste canal.
                        </p>
                        <button
                          type="button"
                          disabled={voiceStatus === 'connecting'}
                          onClick={() =>
                            void joinVoiceChannel(
                              activeServer.id,
                              activeChannel.id,
                              activeChannel.name,
                            )
                          }
                          className="mt-4 cursor-pointer rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                        >
                          {voiceStatus === 'connecting'
                            ? 'Conectando...'
                            : 'Entrar no canal de voz'}
                        </button>
                        {voiceError && (
                          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                            {voiceError}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-sm text-zinc-400">
                      Este servidor ainda não tem canais.
                      {isOwner ? ' Crie um canal no menu à esquerda.' : ''}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-zinc-700/60 bg-[#2b2d31] p-6 text-center shadow-xl">
              <h1 className="text-xl font-bold text-white">
                Bem-vindo ao NexusVoice, {nickname}!
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Para começar, crie o seu próprio servidor ou entre em um usando
                um código de convite.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => setServerModalMode('create')}
                  className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Criar servidor
                </button>
                <button
                  type="button"
                  onClick={() => setServerModalMode('join')}
                  className="cursor-pointer rounded-lg border border-zinc-600 bg-[#1e1f22] px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-700"
                >
                  Entrar com convite
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Lista de membros à direita */}
      {activeServer && (
        <aside className="hidden w-52 shrink-0 border-l border-zinc-800/80 bg-[#2b2d31] p-3 md:block">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Membros — {activeServer.members.length}
          </h3>
          <ul className="space-y-1.5">
            {activeServer.members.map((member) => {
              const memberIsOwner = member.userId === activeServer.ownerId;
              const isMe = member.userId === userId;
              return (
                <li
                  key={member.userId}
                  className="flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        member.online ? 'bg-emerald-400' : 'bg-zinc-600'
                      }`}
                    />
                    <span
                      className={`truncate ${
                        member.online ? 'text-zinc-100' : 'text-zinc-500'
                      }`}
                    >
                      {member.nickname}
                      {isMe ? ' (você)' : ''}
                    </span>
                  </div>
                  {memberIsOwner && (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-300">
                      Dono
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      {serverModalMode && (
        <ServerModal
          initialMode={serverModalMode}
          onClose={() => setServerModalMode(null)}
        />
      )}

      {channelModalType && activeServer && (
        <ChannelModal
          serverId={activeServer.id}
          initialType={channelModalType}
          onClose={() => setChannelModalType(null)}
        />
      )}
    </div>
  );
}

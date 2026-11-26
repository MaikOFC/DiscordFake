import { useState } from 'react';
import type { ChannelType } from '@nexusvoice/shared';
import { openExternal } from '../lib/desktop';
import { useAppStore } from '../store/useAppStore';
import { ChannelModal } from './ChannelModal';
import { ChatPanel } from './ChatPanel';
import { ChannelSidebar } from './layout/ChannelSidebar';
import { MemberList } from './layout/MemberList';
import { ServerRail } from './layout/ServerRail';
import { VoiceStage } from './layout/VoiceStage';
import { ProfileCard } from './ProfileCard';
import { ServerModal } from './ServerModal';
import { SettingsModal } from './settings/SettingsModal';

function TopBanners() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);

  return (
    <>
      {connectionStatus === 'reconnecting' && (
        <div className="bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-amber-950">
          Conexão com o servidor perdida. Tentando reconectar...
        </div>
      )}
      {updateInfo && (
        <div className="flex items-center justify-center gap-3 bg-emerald-700 px-4 py-1 text-xs text-white">
          <span>A versão {updateInfo.version} do NexusVoice está disponível.</span>
          <button
            type="button"
            onClick={() => void openExternal(updateInfo.url)}
            className="cursor-pointer rounded bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30"
          >
            Baixar
          </button>
          <button
            type="button"
            onClick={() => setUpdateInfo(null)}
            className="cursor-pointer px-1 text-white/80 hover:text-white"
            title="Fechar"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export function WorkspaceLayout() {
  const me = useAppStore((s) => s.me);
  const servers = useAppStore((s) => s.servers);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const activeChannelId = useAppStore((s) => s.activeChannelId);

  const [serverModalMode, setServerModalMode] = useState<'create' | 'join' | null>(null);
  const [channelModalType, setChannelModalType] = useState<ChannelType | null>(null);

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;
  const activeChannel = activeServer?.channels.find((c) => c.id === activeChannelId) ?? null;
  const isOwner = Boolean(activeServer && me && activeServer.ownerId === me.id);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1f22] text-zinc-100">
      <TopBanners />
      <div className="flex min-h-0 flex-1">
        <ServerRail onAddServer={() => setServerModalMode('create')} />
        <ChannelSidebar server={activeServer} onCreateChannel={setChannelModalType} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#313338]">
          {activeServer ? (
            <>
              <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-900/80 px-4 shadow-sm">
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

              {activeChannel?.type === 'text' ? (
                <ChatPanel channel={activeChannel} server={activeServer} />
              ) : activeChannel?.type === 'voice' ? (
                <VoiceStage server={activeServer} channel={activeChannel} />
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-zinc-400">
                    Este servidor ainda não tem canais.
                    {isOwner ? ' Crie um canal no menu à esquerda.' : ''}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-md rounded-xl border border-zinc-700/60 bg-[#2b2d31] p-6 text-center shadow-xl">
                <h1 className="text-xl font-bold text-white">
                  Bem-vindo ao NexusVoice, {me?.displayName}!
                </h1>
                <p className="mt-2 text-sm text-zinc-400">
                  Para começar, crie o seu próprio servidor ou entre em um usando um código de
                  convite.
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

        {activeServer && <MemberList server={activeServer} />}
      </div>

      {serverModalMode && (
        <ServerModal initialMode={serverModalMode} onClose={() => setServerModalMode(null)} />
      )}
      {channelModalType && activeServer && (
        <ChannelModal
          serverId={activeServer.id}
          initialType={channelModalType}
          onClose={() => setChannelModalType(null)}
        />
      )}
      <ProfileCard />
      <SettingsModal />
    </div>
  );
}

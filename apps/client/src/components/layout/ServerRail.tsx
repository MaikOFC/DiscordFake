import { useAppStore } from '../../store/useAppStore';
import { getInitials } from '../Avatar';

export function ServerRail({ onAddServer }: { onAddServer: () => void }) {
  const servers = useAppStore((s) => s.servers);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const selectServer = useAppStore((s) => s.selectServer);
  const unread = useAppStore((s) => s.unreadChannels);
  const mentions = useAppStore((s) => s.mentionCounts);

  return (
    <aside className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-[#1e1f22] py-3">
      {servers.map((server) => {
        const isActive = server.id === activeServerId;
        const channelIds = server.channels.map((c) => c.id);
        const hasUnread = channelIds.some((id) => unread[id]);
        const mentionTotal = channelIds.reduce((sum, id) => sum + (mentions[id] ?? 0), 0);
        return (
          <div key={server.id} className="relative flex w-full justify-center">
            <span
              className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r bg-white transition-all ${
                isActive ? 'h-9' : hasUnread ? 'h-2' : 'h-0'
              }`}
            />
            <button
              type="button"
              title={server.name}
              onClick={() => selectServer(server.id)}
              className={`relative flex h-12 w-12 cursor-pointer items-center justify-center text-sm font-bold transition-all ${
                isActive
                  ? 'rounded-2xl bg-emerald-600 text-white'
                  : 'rounded-3xl bg-[#313338] text-zinc-200 hover:rounded-2xl hover:bg-emerald-600 hover:text-white'
              }`}
            >
              {getInitials(server.name)}
              {mentionTotal > 0 && (
                <span className="absolute -right-1 -bottom-1 min-w-5 rounded-full border-[3px] border-[#1e1f22] bg-red-500 px-1 text-center text-[10px] leading-4 font-bold text-white">
                  {mentionTotal > 99 ? '99+' : mentionTotal}
                </span>
              )}
            </button>
          </div>
        );
      })}

      <div className="mx-auto h-0.5 w-8 rounded bg-zinc-700/80" />
      <button
        type="button"
        title="Criar servidor ou entrar com convite"
        onClick={onAddServer}
        className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-3xl bg-[#313338] text-2xl text-emerald-400 transition-all hover:rounded-2xl hover:bg-emerald-600 hover:text-white"
      >
        +
      </button>
    </aside>
  );
}

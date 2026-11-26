import type { ServerDetails, ServerMember } from '@nexusvoice/shared';
import { useAppStore } from '../../store/useAppStore';
import { Avatar } from '../Avatar';
import { openProfileAt } from '../ProfileCard';

function MemberRow({ member, server, isMe }: { member: ServerMember; server: ServerDetails; isMe: boolean }) {
  const myActivity = useAppStore((s) => s.gameActivity);
  const activity = isMe ? myActivity : member.activity;
  return (
    <li>
      <button
        type="button"
        onClick={(e) => openProfileAt(member.id, server.id, e)}
        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-700/40 ${
          member.online || isMe ? '' : 'opacity-45'
        }`}
      >
        <Avatar url={member.avatarUrl} name={member.displayName} size={32} status={member.online || isMe ? 'online' : 'offline'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm text-zinc-100">{member.displayName}</span>
            {member.id === server.ownerId && (
              <span title="Dono do servidor" className="text-xs text-amber-300">
                ♛
              </span>
            )}
          </div>
          {activity && member.online !== false && (
            <div className="truncate text-[11px] text-zinc-400">Jogando {activity}</div>
          )}
        </div>
      </button>
    </li>
  );
}

export function MemberList({ server }: { server: ServerDetails }) {
  const me = useAppStore((s) => s.me);
  const online = server.members.filter((m) => m.online || m.id === me?.id);
  const offline = server.members.filter((m) => !m.online && m.id !== me?.id);

  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto bg-[#2b2d31] px-2 py-4 lg:block">
      <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        Online: {online.length}
      </h3>
      <ul className="mb-4 space-y-0.5">
        {online.map((member) => (
          <MemberRow key={member.id} member={member} server={server} isMe={member.id === me?.id} />
        ))}
      </ul>
      {offline.length > 0 && (
        <>
          <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Offline: {offline.length}
          </h3>
          <ul className="space-y-0.5">
            {offline.map((member) => (
              <MemberRow key={member.id} member={member} server={server} isMe={false} />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

import { useEffect, useRef } from 'react';
import type { PublicUser, ServerMember } from '@nexusvoice/shared';
import { useAppStore } from '../store/useAppStore';
import { Avatar, ProfileBanner } from './Avatar';

const CARD_WIDTH = 300;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Cartão de perfil que abre ao clicar no nome ou avatar de alguém. */
export function ProfileCard() {
  const target = useAppStore((s) => s.profileCard);
  const close = useAppStore((s) => s.openProfileCard);
  const servers = useAppStore((s) => s.servers);
  const me = useAppStore((s) => s.me);
  const myActivity = useAppStore((s) => s.gameActivity);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
    };
    const onClick = (e: MouseEvent): void => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) close(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [target, close]);

  if (!target) return null;

  const server = servers.find((s) => s.id === target.serverId);
  let member: (PublicUser & Partial<ServerMember>) | undefined = server?.members.find(
    (m) => m.id === target.userId,
  );
  if (!member) {
    for (const s of servers) {
      member = s.members.find((m) => m.id === target.userId);
      if (member) break;
    }
  }
  const isMe = me?.id === target.userId;
  if (!member && isMe && me) member = me;
  if (!member) return null;

  const activity = isMe ? myActivity : (member.activity ?? null);
  const left = Math.max(8, Math.min(target.x, window.innerWidth - CARD_WIDTH - 8));
  const top = Math.max(8, Math.min(target.y, window.innerHeight - 380));

  return (
    <div
      ref={cardRef}
      className="fixed z-[60] overflow-hidden rounded-xl border border-zinc-700 bg-[#232428] shadow-2xl"
      style={{ left, top, width: CARD_WIDTH }}
    >
      <ProfileBanner url={member.bannerUrl} name={member.displayName} height={100} />
      <div className="px-4 pb-4">
        <div className="-mt-10 mb-2">
          <div className="inline-block rounded-full border-[5px] border-[#232428]">
            <Avatar
              url={member.avatarUrl}
              name={member.displayName}
              size={76}
              animate
              status={member.online === undefined ? null : member.online || isMe ? 'online' : 'offline'}
            />
          </div>
        </div>
        <div className="rounded-lg bg-[#1e1f22] p-3">
          <div className="text-lg font-bold leading-tight text-white">{member.displayName}</div>
          <div className="text-xs text-zinc-400">@{member.username}</div>

          {activity && (
            <div className="mt-2 rounded-md bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300">
              🎮 Jogando <span className="font-semibold">{activity}</span>
            </div>
          )}

          {member.bio && (
            <div className="mt-3 border-t border-zinc-700/70 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Sobre mim</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-200">{member.bio}</p>
            </div>
          )}

          {member.joinedAt && (
            <div className="mt-3 border-t border-zinc-700/70 pt-2 text-[11px] text-zinc-400">
              Membro desde {formatDate(member.joinedAt)}
              {server && server.ownerId === member.id ? ' · dono do servidor' : ''}
            </div>
          )}

          {isMe && (
            <button
              type="button"
              onClick={() => {
                close(null);
                setSettingsOpen(true);
              }}
              className="mt-3 w-full cursor-pointer rounded-md bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Editar perfil
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Abre o cartão de perfil na posição do clique. */
export function openProfileAt(userId: string, serverId: string | null, event: { clientX: number; clientY: number }): void {
  useAppStore.getState().openProfileCard({ userId, serverId, x: event.clientX + 12, y: event.clientY - 40 });
}

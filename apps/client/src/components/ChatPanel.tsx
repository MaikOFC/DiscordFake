import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type { Channel, ChatMessage, ServerDetails } from '@nexusvoice/shared';
import type { MarkdownContext } from '../lib/markdown';
import { loadChannelMessages } from '../services/socket';
import { useAppStore } from '../store/useAppStore';
import { Composer, type ComposerHandle } from './chat/Composer';
import { MessageItem } from './chat/MessageItem';

const EMPTY_MESSAGES: ChatMessage[] = [];
const GROUP_WINDOW_MS = 7 * 60 * 1000;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function TypingIndicator({ channelId, myId }: { channelId: string; myId: string }) {
  const typing = useAppStore((s) => s.typingByChannel[channelId]);
  const names = Object.entries(typing ?? {})
    .filter(([userId, entry]) => userId !== myId && entry.until > Date.now())
    .map(([, entry]) => entry.nickname);

  let text = '';
  if (names.length === 1) text = `${names[0]} está digitando...`;
  else if (names.length === 2) text = `${names[0]} e ${names[1]} estão digitando...`;
  else if (names.length > 2) text = 'Várias pessoas estão digitando...';

  return <div className="h-5 truncate px-5 text-[11px] text-zinc-400">{text}</div>;
}

interface ChatPanelProps {
  channel: Channel;
  server: ServerDetails;
}

export function ChatPanel({ channel, server }: ChatPanelProps) {
  const me = useAppStore((s) => s.me);
  const messages = useAppStore((s) => s.messagesByChannel[channel.id] ?? EMPTY_MESSAGES);
  const hasMore = useAppStore((s) => s.hasMoreByChannel[channel.id] ?? false);
  const isLoaded = useAppStore((s) => s.loadedChannels[channel.id] ?? false);
  const isLoadingHistory = useAppStore((s) => s.loadingHistoryChannelId === channel.id);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const markChannelRead = useAppStore((s) => s.markChannelRead);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  const stickToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);

  const myId = me?.id ?? '';
  const isOwner = server.ownerId === myId;
  const membersById = useMemo(
    () => new Map(server.members.map((m) => [m.id, m])),
    [server.members],
  );

  const markdown = useMemo<MarkdownContext>(() => {
    const byUsername = new Map(server.members.map((m) => [m.username.toLowerCase(), m]));
    return {
      resolveMention: (username) => {
        const member = byUsername.get(username.toLowerCase());
        return member ? { displayName: member.displayName, isMe: member.id === myId } : null;
      },
    };
  }, [server.members, myId]);

  // Carrega as mensagens mais recentes ao abrir um canal ainda não carregado (ou depois de reconectar).
  useEffect(() => {
    setReplyTo(null);
    setEditingId(null);
    stickToBottomRef.current = true;
    prevScrollHeightRef.current = null;
    if (!isLoaded && connectionStatus === 'connected') {
      void loadChannelMessages(channel.id);
    }
  }, [channel.id, isLoaded, connectionStatus]);

  const windowFocused = useAppStore((s) => s.windowFocused);
  useEffect(() => {
    if (windowFocused) markChannelRead(channel.id);
  }, [channel.id, messages.length, windowFocused, markChannelRead]);

  const keepBottom = useCallback(() => {
    const container = listRef.current;
    if (container && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Ajusta o scroll após atualizar a lista (mantém posição ao carregar antigas ou desce nas novas).
  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    if (prevScrollHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
      return;
    }
    keepBottom();
  }, [messages, channel.id, keepBottom]);

  async function handleLoadOlder(): Promise<void> {
    if (isLoadingHistory || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    const container = listRef.current;
    if (container) prevScrollHeightRef.current = container.scrollHeight;
    stickToBottomRef.current = false;
    await loadChannelMessages(channel.id, oldest.id);
  }

  function handleScroll(): void {
    const container = listRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
    if (container.scrollTop <= 32 && hasMore && !isLoadingHistory) {
      void handleLoadOlder();
    }
  }

  const jumpTo = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-1', 'ring-emerald-500/60');
    setTimeout(() => el.classList.remove('ring-1', 'ring-emerald-500/60'), 1600);
  }, []);

  const handleReply = useCallback((message: ChatMessage) => {
    setEditingId(null);
    setReplyTo(message);
  }, []);

  const handleStartEdit = useCallback((messageId: string | null) => {
    setEditingId(messageId);
    if (!messageId) composerRef.current?.focus();
  }, []);

  function editLastOwnMessage(): void {
    const last = [...messages].reverse().find((m) => m.authorId === myId);
    if (last) setEditingId(last.id);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) composerRef.current?.addFiles(files);
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto pt-4 pb-2">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              disabled={isLoadingHistory}
              onClick={() => void handleLoadOlder()}
              className="cursor-pointer rounded-md border border-zinc-700 bg-[#2b2d31] px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-60"
            >
              {isLoadingHistory
                ? 'Carregando mensagens antigas...'
                : 'Carregar mensagens mais antigas'}
            </button>
          </div>
        )}

        {!hasMore && isLoaded && (
          <div className="mx-4 mb-2 border-b border-zinc-800/80 pb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-3xl text-zinc-300">
              #
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">Bem-vindo a #{channel.name}!</h2>
            <p className="text-sm text-zinc-400">Este é o começo do canal.</p>
          </div>
        )}

        {!isLoaded && (
          <div className="py-6 text-center text-xs text-zinc-400">Carregando mensagens...</div>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
          const compact =
            !newDay &&
            !message.replyTo &&
            previous?.authorId === message.authorId &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              GROUP_WINDOW_MS;

          return (
            <div key={message.id}>
              {newDay && (
                <div className="mx-4 my-3 flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
                  <span className="h-px flex-1 bg-zinc-700/70" />
                  {formatDay(message.createdAt)}
                  <span className="h-px flex-1 bg-zinc-700/70" />
                </div>
              )}
              <MessageItem
                message={message}
                compact={compact}
                author={membersById.get(message.authorId)}
                myId={myId}
                canDelete={message.authorId === myId || isOwner}
                isEditing={editingId === message.id}
                serverId={server.id}
                markdown={markdown}
                onReply={handleReply}
                onStartEdit={handleStartEdit}
                onJumpTo={jumpTo}
                onMediaLoad={keepBottom}
              />
            </div>
          );
        })}
      </div>

      <Composer
        ref={composerRef}
        channel={channel}
        members={server.members}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          stickToBottomRef.current = true;
          keepBottom();
        }}
        onEditLast={editLastOwnMessage}
      />
      <TypingIndicator channelId={channel.id} myId={myId} />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-500/10 text-sm font-semibold text-emerald-200">
          Solte para anexar em #{channel.name}
        </div>
      )}
    </div>
  );
}

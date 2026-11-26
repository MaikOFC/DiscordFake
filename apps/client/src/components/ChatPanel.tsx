import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { Channel } from '@nexusvoice/shared';
import { loadChannelMessages, sendTextMessage } from '../services/socket';
import { useAppStore } from '../store/useAppStore';

const MESSAGE_MAX_LENGTH = 2000;
const EMPTY_MESSAGES: never[] = [];

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ChatPanelProps {
  channel: Channel;
}

export function ChatPanel({ channel }: ChatPanelProps) {
  const userId = useAppStore((state) => state.userId);
  const messages = useAppStore(
    (state) => state.messagesByChannel[channel.id] ?? EMPTY_MESSAGES,
  );
  const hasMore = useAppStore(
    (state) => state.hasMoreByChannel[channel.id] ?? false,
  );
  const isLoaded = useAppStore(
    (state) => state.loadedChannels[channel.id] ?? false,
  );
  const isLoadingHistory = useAppStore(
    (state) => state.loadingHistoryChannelId === channel.id,
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);

  // Carrega as mensagens mais recentes ao abrir um canal ainda não carregado.
  useEffect(() => {
    setSendError(null);
    shouldScrollToBottomRef.current = true;
    prevScrollHeightRef.current = null;
    if (!isLoaded) {
      void loadChannelMessages(channel.id);
    }
  }, [channel.id, isLoaded]);

  // Ajusta o scroll após atualizar a lista (mantém posição ao carregar antigas ou desce nas novas).
  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;

    if (prevScrollHeightRef.current !== null) {
      const delta = container.scrollHeight - prevScrollHeightRef.current;
      container.scrollTop += delta;
      prevScrollHeightRef.current = null;
      return;
    }

    if (shouldScrollToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, channel.id]);

  async function handleLoadOlder(): Promise<void> {
    if (isLoadingHistory || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;

    const container = listRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
    }
    shouldScrollToBottomRef.current = false;
    await loadChannelMessages(channel.id, oldest.id);
  }

  function handleScroll(): void {
    const container = listRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldScrollToBottomRef.current = distanceFromBottom < 80;

    if (container.scrollTop <= 32 && hasMore && !isLoadingHistory) {
      void handleLoadOlder();
    }
  }

  async function submitMessage(): Promise<void> {
    if (sending) return;
    setSendError(null);

    const content = draft;
    if (content.trim().length === 0) {
      return;
    }

    setSending(true);
    shouldScrollToBottomRef.current = true;
    const result = await sendTextMessage(channel.id, content);
    setSending(false);

    if (!result.ok) {
      setSendError(result.error ?? 'Não foi possível enviar a mensagem.');
      return;
    }

    setDraft('');
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  const trimmedLength = draft.trim().length;
  const isOverLimit = trimmedLength > MESSAGE_MAX_LENGTH;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Área de mensagens */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {hasMore && (
          <div className="flex justify-center pb-1">
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
          <div className="border-b border-zinc-800/80 pb-3 text-xs text-zinc-500">
            Início do histórico do canal{' '}
            <span className="font-semibold text-zinc-300">#{channel.name}</span>.
          </div>
        )}

        {isLoadingHistory && !isLoaded && (
          <div className="py-6 text-center text-xs text-zinc-400">
            Carregando mensagens...
          </div>
        )}

        {isLoaded && messages.length === 0 && (
          <div className="py-8 text-center text-sm text-zinc-400">
            Nenhuma mensagem ainda em #{channel.name}. Mande a primeira!
          </div>
        )}

        {messages.map((message) => {
          const isMine = message.authorId === userId;
          return (
            <div
              key={message.id}
              className="group rounded-lg px-2 py-1.5 transition hover:bg-[#2b2d31]/70"
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-semibold ${
                    isMine ? 'text-emerald-400' : 'text-white'
                  }`}
                >
                  {message.authorNickname}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {formatTime(message.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-200">
                {message.content}
              </p>
            </div>
          );
        })}
      </div>

      {/* Caixa de envio */}
      <form
        onSubmit={handleFormSubmit}
        className="shrink-0 border-t border-zinc-800/80 bg-[#313338] px-4 py-3"
      >
        {sendError && (
          <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
            {sendError}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-zinc-700/80 bg-[#2b2d31] p-2 focus-within:border-emerald-500">
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (sendError) setSendError(null);
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={`Conversar em #${channel.name} (Enter envia, Shift+Enter quebra linha)`}
            className="max-h-36 min-h-[36px] flex-1 resize-y bg-transparent px-1 py-1 text-sm text-white placeholder-zinc-500 outline-none"
          />

          <div className="flex shrink-0 items-center gap-2 pb-0.5">
            <span
              className={`text-[11px] tabular-nums ${
                isOverLimit ? 'font-semibold text-red-400' : 'text-zinc-500'
              }`}
            >
              {trimmedLength}/{MESSAGE_MAX_LENGTH}
            </span>
            <button
              type="submit"
              disabled={sending || trimmedLength === 0}
              className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

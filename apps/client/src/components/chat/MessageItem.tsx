import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { LIMITS, type ChatMessage, type ServerMember } from '@nexusvoice/shared';
import { renderMarkdown, type MarkdownContext } from '../../lib/markdown';
import { deleteTextMessage, editTextMessage } from '../../services/socket';
import { Avatar } from '../Avatar';
import { openProfileAt } from '../ProfileCard';
import { AttachmentList, InlineImages, LinkPreviewList, inlineImageUrls } from './MessageMedia';

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
}

interface MessageItemProps {
  message: ChatMessage;
  compact: boolean;
  author: ServerMember | undefined;
  myId: string;
  canDelete: boolean;
  isEditing: boolean;
  serverId: string;
  markdown: MarkdownContext;
  onReply: (message: ChatMessage) => void;
  onStartEdit: (messageId: string | null) => void;
  onJumpTo: (messageId: string) => void;
  onMediaLoad: () => void;
}

function MessageItemBase({
  message,
  compact,
  author,
  myId,
  canDelete,
  isEditing,
  serverId,
  markdown,
  onReply,
  onStartEdit,
  onJumpTo,
  onMediaLoad,
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [editError, setEditError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  const isMine = message.authorId === myId;
  const mentionsMe = message.mentions.includes(myId);
  const name = author?.displayName ?? message.authorNickname;
  const imageUrls = inlineImageUrls(message.content);

  useEffect(() => {
    if (isEditing) {
      setEditDraft(message.content);
      setEditError(null);
    }
  }, [isEditing, message.content]);

  // Foco imediato (sem esperar o próximo quadro) para a primeira tecla já cair na edição.
  useLayoutEffect(() => {
    const el = editRef.current;
    if (isEditing && el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditing]);

  async function saveEdit(): Promise<void> {
    const result = await editTextMessage(message.id, editDraft);
    if (!result.ok) {
      setEditError(result.error ?? 'Não foi possível editar.');
      return;
    }
    onStartEdit(null);
  }

  function handleEditKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onStartEdit(null);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveEdit();
    }
  }

  async function handleDelete(skipConfirm: boolean): Promise<void> {
    if (!skipConfirm && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    await deleteTextMessage(message);
  }

  const openProfile = (event: MouseEvent): void => openProfileAt(message.authorId, serverId, event);

  return (
    <div
      id={`msg-${message.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
      className={`group relative rounded-md px-3 transition ${compact ? 'py-0.5' : 'mt-3 pt-1.5 pb-0.5'} ${
        mentionsMe
          ? 'border-l-2 border-amber-400 bg-amber-500/10 hover:bg-amber-500/15'
          : 'hover:bg-[#2b2d31]/70'
      }`}
    >
      {message.replyTo && (
        <button
          type="button"
          onClick={() => message.replyTo && onJumpTo(message.replyTo.id)}
          className="mb-0.5 ml-12 flex max-w-full cursor-pointer items-center gap-1.5 truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
        >
          <span className="text-zinc-600">╭</span>
          {'deleted' in message.replyTo ? (
            <span className="italic">Mensagem original apagada</span>
          ) : (
            <>
              <span className="font-semibold text-zinc-300">@{message.replyTo.authorNickname}</span>
              <span className="truncate">{message.replyTo.content || 'Anexo'}</span>
            </>
          )}
        </button>
      )}

      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {!compact ? (
            <button type="button" onClick={openProfile} className="cursor-pointer">
              <Avatar url={author?.avatarUrl} name={name} size={40} animate={hovered} />
            </button>
          ) : (
            <span className="invisible block pt-1 text-right text-[10px] text-zinc-500 group-hover:visible">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!compact && (
            <div className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={openProfile}
                className={`cursor-pointer text-sm font-semibold hover:underline ${
                  isMine ? 'text-emerald-400' : 'text-white'
                }`}
              >
                {name}
              </button>
              <span className="text-[11px] text-zinc-500" title={formatFullDate(message.createdAt)}>
                {formatTime(message.createdAt)}
              </span>
            </div>
          )}

          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={editRef}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={handleEditKey}
                maxLength={LIMITS.messageMax}
                rows={Math.min(8, Math.max(1, editDraft.split('\n').length))}
                className="w-full resize-none rounded-lg border border-zinc-700 bg-[#1e1f22] px-2 py-1.5 text-sm text-white outline-none focus:border-emerald-500"
              />
              <div className="mt-1 text-[11px] text-zinc-400">
                Esc para cancelar · Enter para salvar
                {editError && <span className="ml-2 text-red-300">{editError}</span>}
              </div>
            </div>
          ) : (
            message.content && (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                {renderMarkdown(message.content, markdown)}
                {message.editedAt && (
                  <span
                    className="ml-1 text-[10px] text-zinc-500"
                    title={formatFullDate(message.editedAt)}
                  >
                    (editado)
                  </span>
                )}
              </div>
            )
          )}

          <AttachmentList attachments={message.attachments} onMediaLoad={onMediaLoad} />
          <InlineImages urls={imageUrls} onMediaLoad={onMediaLoad} />
          <LinkPreviewList previews={message.linkPreviews} skipUrls={imageUrls} />
        </div>
      </div>

      {hovered && !isEditing && (
        <div className="absolute -top-3 right-3 flex items-center gap-0.5 rounded-md border border-zinc-700 bg-[#2b2d31] p-0.5 shadow-lg">
          <button
            type="button"
            title="Responder"
            onClick={() => onReply(message)}
            className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            ↩ Responder
          </button>
          {isMine && (
            <button
              type="button"
              title="Editar"
              onClick={() => onStartEdit(message.id)}
              className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
            >
              ✎ Editar
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              title="Apagar (Shift + clique apaga sem perguntar)"
              onClick={(e) => void handleDelete(e.shiftKey)}
              className={`cursor-pointer rounded px-1.5 py-0.5 text-xs ${
                confirmDelete ? 'bg-red-600 text-white' : 'text-red-300 hover:bg-red-500/20'
              }`}
            >
              {confirmDelete ? 'Apagar mesmo?' : '🗑 Apagar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageItem = memo(MessageItemBase);

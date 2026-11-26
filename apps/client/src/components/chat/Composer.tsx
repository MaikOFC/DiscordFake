import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { LIMITS, type Channel, type ChatMessage, type MessageAttachment, type ServerMember } from '@nexusvoice/shared';
import { uploadAttachment } from '../../lib/api';
import { emitTyping, sendTextMessage } from '../../services/socket';
import { Avatar } from '../Avatar';
import { formatBytes } from './MessageMedia';

interface PendingUpload {
  localId: string;
  file: File;
  progress: number;
  result: MessageAttachment | null;
  error: string | null;
  cancel: () => void;
}

/** Rascunhos por canal: trocar de canal não apaga o que a pessoa estava escrevendo. */
const drafts = new Map<string, string>();

const TYPING_EMIT_EVERY_MS = 2500;

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
  focus: () => void;
}

interface ComposerProps {
  channel: Channel;
  members: ServerMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSent: () => void;
  onEditLast: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { channel, members, replyTo, onCancelReply, onSent, onEditLast },
  ref,
) {
  const [draft, setDraft] = useState(drafts.get(channel.id) ?? '');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingRef = useRef(0);

  useEffect(() => {
    setDraft(drafts.get(channel.id) ?? '');
    setUploads((current) => {
      current.forEach((u) => u.cancel());
      return [];
    });
    setError(null);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }, [channel.id]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const mentionOptions =
    mentionQuery === null
      ? []
      : members
          .filter((m) => {
            const q = mentionQuery.toLowerCase();
            return m.username.toLowerCase().startsWith(q) || m.displayName.toLowerCase().includes(q);
          })
          .slice(0, 8);

  function updateDraft(value: string): void {
    setDraft(value);
    drafts.set(channel.id, value);
    if (error) setError(null);
    const now = Date.now();
    if (value.trim() && now - lastTypingRef.current > TYPING_EMIT_EVERY_MS) {
      lastTypingRef.current = now;
      emitTyping(channel.id);
    }
  }

  function detectMention(value: string, caret: number): void {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([a-zA-Z0-9_.]{0,20})$/.exec(before);
    setMentionQuery(match ? (match[2] ?? '') : null);
    setMentionIndex(0);
  }

  function insertMention(member: ServerMember): void {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([a-zA-Z0-9_.]{0,20})$/, `@${member.username} `);
    const next = before + draft.slice(caret);
    updateDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function addFiles(files: File[]): void {
    setError(null);
    const room = LIMITS.attachmentsPerMessage - uploads.length;
    if (room <= 0) {
      setError(`Máximo de ${LIMITS.attachmentsPerMessage} arquivos por mensagem.`);
      return;
    }
    for (const file of files.slice(0, room)) {
      if (file.size > LIMITS.attachmentMaxBytes) {
        setError(`"${file.name}" passa do limite de ${formatBytes(LIMITS.attachmentMaxBytes)}.`);
        continue;
      }
      const localId = crypto.randomUUID();
      const { promise, cancel } = uploadAttachment(file, (progress) =>
        setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, progress } : u))),
      );
      setUploads((list) => [...list, { localId, file, progress: 0, result: null, error: null, cancel }]);
      void promise.then((result) =>
        setUploads((list) =>
          list.map((u) =>
            u.localId === localId
              ? { ...u, progress: 1, result: result.data ?? null, error: result.ok ? null : (result.error ?? 'Falhou.') }
              : u,
          ),
        ),
      );
    }
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textareaRef.current?.focus() }));

  const uploading = uploads.some((u) => !u.result && !u.error);
  const readyAttachments = uploads.filter((u) => u.result).map((u) => u.result!);
  const trimmedLength = draft.trim().length;

  async function submit(): Promise<void> {
    if (sending || uploading) return;
    if (trimmedLength === 0 && readyAttachments.length === 0) return;
    if (trimmedLength > LIMITS.messageMax) {
      setError(`A mensagem passa de ${LIMITS.messageMax} caracteres.`);
      return;
    }
    setSending(true);
    const result = await sendTextMessage(
      channel.id,
      draft,
      replyTo?.id,
      readyAttachments.map((a) => a.id),
    );
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível enviar a mensagem.');
      return;
    }
    updateDraft('');
    drafts.delete(channel.id);
    setUploads([]);
    onCancelReply();
    onSent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const option = mentionOptions[mentionIndex];
        if (option) insertMention(option);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === 'ArrowUp' && draft.length === 0) {
      event.preventDefault();
      onEditLast();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    updateDraft(event.target.value);
    detectMention(event.target.value, event.target.selectionStart);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  }

  return (
    <div className="shrink-0 px-4 pb-1">
      {error && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-zinc-700/80 bg-[#383a40] focus-within:border-emerald-500">
        {mentionOptions.length > 0 && (
          <div className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-lg border border-zinc-700 bg-[#2b2d31] shadow-xl">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Membros
            </div>
            {mentionOptions.map((member, index) => (
              <button
                key={member.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(member);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === mentionIndex ? 'bg-zinc-700/70 text-white' : 'text-zinc-300'
                }`}
              >
                <Avatar url={member.avatarUrl} name={member.displayName} size={22} />
                <span className="font-medium">{member.displayName}</span>
                <span className="text-xs text-zinc-500">@{member.username}</span>
              </button>
            ))}
          </div>
        )}

        {replyTo && (
          <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-zinc-700/80 bg-[#2b2d31] px-3 py-1.5 text-xs text-zinc-300">
            <span className="truncate">
              Respondendo a <span className="font-semibold text-white">{replyTo.authorNickname}</span>
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              className="cursor-pointer rounded px-1 text-zinc-400 hover:text-white"
              title="Cancelar resposta (Esc)"
            >
              ✕
            </button>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-zinc-700/80 p-2">
            {uploads.map((upload) => (
              <div
                key={upload.localId}
                className={`relative w-36 rounded-lg border bg-[#2b2d31] p-2 text-[11px] ${
                  upload.error ? 'border-red-500/50' : 'border-zinc-700'
                }`}
              >
                <div className="truncate font-medium text-zinc-200">{upload.file.name}</div>
                <div className="text-zinc-500">{formatBytes(upload.file.size)}</div>
                {upload.error ? (
                  <div className="mt-1 text-red-300">{upload.error}</div>
                ) : (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-700">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round(upload.progress * 100)}%` }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    upload.cancel();
                    setUploads((list) => list.filter((u) => u.localId !== upload.localId));
                  }}
                  className="absolute top-1 right-1 cursor-pointer rounded px-1 text-zinc-400 hover:text-white"
                  title="Remover"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2">
          <button
            type="button"
            title="Anexar arquivo"
            onClick={() => fileInputRef.current?.click()}
            className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-600/60 text-lg leading-none text-zinc-200 hover:bg-zinc-500"
          >
            +
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={(e) => detectMention(draft, e.currentTarget.selectionStart)}
            rows={Math.min(8, Math.max(1, draft.split('\n').length))}
            placeholder={`Conversar em #${channel.name}`}
            className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-white placeholder-zinc-500 outline-none"
          />
          <div className="flex shrink-0 items-center gap-2 pb-1">
            {trimmedLength > LIMITS.messageMax - 200 && (
              <span
                className={`text-[11px] tabular-nums ${
                  trimmedLength > LIMITS.messageMax ? 'font-semibold text-red-400' : 'text-zinc-500'
                }`}
              >
                {trimmedLength}/{LIMITS.messageMax}
              </span>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || uploading || (trimmedLength === 0 && readyAttachments.length === 0)}
              className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? 'Enviando arquivo...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

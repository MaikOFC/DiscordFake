import { useState, type ReactNode } from 'react';
import { openExternal } from './desktop';

/**
 * Formatação simples de mensagens: **negrito**, *itálico*, ~~riscado~~, `código`,
 * blocos ```código```, ||spoiler||, links e @menções.
 *
 * Tudo vira elemento React (nunca HTML cru), então uma mensagem não consegue
 * injetar script ou tags na tela.
 */

export interface MentionInfo {
  displayName: string;
  isMe: boolean;
}

export interface MarkdownContext {
  resolveMention: (username: string) => MentionInfo | null;
}

type InlineType = 'code' | 'url' | 'mention' | 'bold' | 'strike' | 'spoiler' | 'italic';

const INLINE_PATTERNS: Array<{ type: InlineType; regex: RegExp }> = [
  { type: 'code', regex: /`([^`\n]+)`/ },
  { type: 'url', regex: /https?:\/\/[^\s<>"'`]+/ },
  { type: 'mention', regex: /(^|[^\w@])@([a-zA-Z0-9_.]{3,20})/ },
  { type: 'bold', regex: /\*\*([^*]+?)\*\*/ },
  { type: 'strike', regex: /~~([^~]+?)~~/ },
  { type: 'spoiler', regex: /\|\|([^|]+?)\|\|/ },
  { type: 'italic', regex: /\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/ },
];

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setRevealed(true);
      }}
      title={revealed ? undefined : 'Clique para mostrar o spoiler'}
      className={`rounded px-0.5 transition ${
        revealed ? 'bg-zinc-700/60' : 'cursor-pointer bg-zinc-600 text-transparent select-none'
      }`}
    >
      {children}
    </span>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href);
      }}
      className="break-all text-sky-400 hover:underline"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

function renderInline(text: string, ctx: MarkdownContext, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;

  while (rest.length > 0) {
    let best: { type: InlineType; match: RegExpExecArray } | null = null;
    for (const pattern of INLINE_PATTERNS) {
      const match = pattern.regex.exec(rest);
      if (match && (!best || match.index < best.match.index)) {
        best = { type: pattern.type, match };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }

    const { type, match } = best;
    let start = match.index;
    let full = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (type === 'mention') {
      // O primeiro grupo é o caractere antes do @ (espaço ou início).
      const prefix = match[1] ?? '';
      start += prefix.length;
      full = full.slice(prefix.length);
    }
    if (start > 0) nodes.push(rest.slice(0, start));

    switch (type) {
      case 'code':
        nodes.push(
          <code
            key={key}
            className="rounded bg-[#1e1f22] px-1 py-0.5 font-mono text-[0.85em] text-zinc-200"
          >
            {match[1]}
          </code>,
        );
        break;
      case 'url': {
        const url = full.replace(/[.,;:!?)\]]+$/, '');
        nodes.push(
          <ExternalLink key={key} href={url}>
            {url}
          </ExternalLink>,
        );
        full = url;
        break;
      }
      case 'mention': {
        const username = match[2] ?? '';
        const info = ctx.resolveMention(username);
        nodes.push(
          info ? (
            <span
              key={key}
              className={`rounded px-1 font-medium ${
                info.isMe ? 'bg-amber-500/25 text-amber-200' : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              @{info.displayName}
            </span>
          ) : (
            `@${username}`
          ),
        );
        break;
      }
      case 'bold':
        nodes.push(
          <strong key={key} className="font-semibold text-white">
            {renderInline(match[1] ?? '', ctx, key)}
          </strong>,
        );
        break;
      case 'strike':
        nodes.push(<s key={key}>{renderInline(match[1] ?? '', ctx, key)}</s>);
        break;
      case 'spoiler':
        nodes.push(<Spoiler key={key}>{renderInline(match[1] ?? '', ctx, key)}</Spoiler>);
        break;
      case 'italic':
        nodes.push(<em key={key}>{renderInline(match[1] ?? match[2] ?? '', ctx, key)}</em>);
        break;
    }

    rest = rest.slice(start + full.length);
  }
  return nodes;
}

export function renderMarkdown(content: string, ctx: MarkdownContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  const blockRegex = /```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g;
  let lastIndex = 0;
  let blockIndex = 0;

  for (const match of content.matchAll(blockRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(...renderInline(content.slice(lastIndex, start), ctx, `t${blockIndex}`));
    }
    nodes.push(
      <pre
        key={`b${blockIndex}`}
        className="my-1 max-h-80 overflow-auto rounded-md border border-zinc-700/70 bg-[#1e1f22] p-2 font-mono text-xs text-zinc-200"
      >
        <code>{(match[1] ?? '').replace(/\n$/, '')}</code>
      </pre>,
    );
    blockIndex++;
    lastIndex = start + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(...renderInline(content.slice(lastIndex), ctx, `t${blockIndex}`));
  }
  return nodes;
}

/** URLs de vídeo do YouTube viram miniatura clicável. */
export function youtubeId(url: string): string | null {
  const match =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(
      url,
    );
  return match?.[1] ?? null;
}

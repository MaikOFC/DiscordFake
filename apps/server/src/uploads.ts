import { createReadStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MessageAttachment } from '@nexusvoice/shared';
import { db, uploadsDir } from './db.js';

interface DetectedType {
  mime: string;
  ext: string;
  /** Se o navegador pode exibir direto (imagem, vídeo, áudio). O resto vira download. */
  inline: boolean;
  isImage: boolean;
}

const STORED_NAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

/**
 * Descobre o tipo do arquivo pelos primeiros bytes, sem confiar no nome nem no
 * tipo que o navegador mandou. Assim ninguém disfarça um HTML de imagem.
 */
export function detectFileType(buf: Buffer, originalName: string): DetectedType {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png', inline: true, isImage: true };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg', inline: true, isImage: true };
  }
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif', inline: true, isImage: true };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp', inline: true, isImage: true };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE') {
    return { mime: 'audio/wav', ext: 'wav', inline: true, isImage: false };
  }
  if (ascii(buf, 4, 8) === 'ftyp') {
    return { mime: 'video/mp4', ext: 'mp4', inline: true, isImage: false };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mime: 'video/webm', ext: 'webm', inline: true, isImage: false };
  }
  if (ascii(buf, 0, 4) === 'OggS') {
    return { mime: 'audio/ogg', ext: 'ogg', inline: true, isImage: false };
  }
  if (ascii(buf, 0, 3) === 'ID3' || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3])) {
    return { mime: 'audio/mpeg', ext: 'mp3', inline: true, isImage: false };
  }

  // Qualquer outro arquivo é aceito como download (nunca exibido direto no app).
  // Fica sempre como .bin no disco: um HTML chamado "foto.png" não ganha extensão de
  // imagem. O nome original continua no banco e volta no download.
  return { mime: 'application/octet-stream', ext: 'bin', inline: false, isImage: false };
}

/** Limpa o nome original para exibir e para o cabeçalho de download. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim();
  return (base || 'arquivo').slice(0, 120);
}

export async function storeFile(buf: Buffer, ext: string): Promise<string> {
  const storedName = `${randomUUID()}.${ext}`;
  await writeFile(join(uploadsDir, storedName), buf);
  return storedName;
}

export async function deleteStoredFile(storedName: string | null | undefined): Promise<void> {
  if (!storedName || !STORED_NAME_PATTERN.test(storedName)) return;
  try {
    await unlink(join(uploadsDir, storedName));
  } catch {
    // O arquivo já não existe: nada a fazer.
  }
}

interface AttachmentRow {
  id: string;
  uploader_id: string;
  message_id: string | null;
  stored_name: string;
  file_name: string;
  mime_type: string;
  size: number;
}

export function toAttachment(row: AttachmentRow): MessageAttachment {
  return {
    id: row.id,
    url: `/uploads/${row.stored_name}`,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
  };
}

export async function createPendingAttachment(
  uploaderId: string,
  buf: Buffer,
  originalName: string,
): Promise<MessageAttachment> {
  const type = detectFileType(buf, originalName);
  const storedName = await storeFile(buf, type.ext);
  const row: AttachmentRow = {
    id: randomUUID(),
    uploader_id: uploaderId,
    message_id: null,
    stored_name: storedName,
    file_name: sanitizeFileName(originalName),
    mime_type: type.mime,
    size: buf.length,
  };
  db.prepare(
    `INSERT INTO attachments (id, uploader_id, message_id, stored_name, file_name, mime_type, size, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.uploader_id,
    row.stored_name,
    row.file_name,
    row.mime_type,
    row.size,
    new Date().toISOString(),
  );
  return toAttachment(row);
}

export function getAttachmentsForMessages(
  messageIds: string[],
): Map<string, MessageAttachment[]> {
  const result = new Map<string, MessageAttachment[]>();
  if (messageIds.length === 0) return result;
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...messageIds) as AttachmentRow[];
  for (const row of rows) {
    const list = result.get(row.message_id!) ?? [];
    list.push(toAttachment(row));
    result.set(row.message_id!, list);
  }
  return result;
}

/** Liga anexos enviados antes à mensagem. Só aceita anexos da própria pessoa e ainda soltos. */
export function claimAttachments(
  uploaderId: string,
  attachmentIds: string[],
  messageId: string,
): number {
  const stmt = db.prepare(
    `UPDATE attachments SET message_id = ?
     WHERE id = ? AND uploader_id = ? AND message_id IS NULL`,
  );
  let claimed = 0;
  for (const id of attachmentIds) {
    claimed += stmt.run(messageId, id, uploaderId).changes;
  }
  return claimed;
}

export function countClaimableAttachments(uploaderId: string, attachmentIds: string[]): number {
  if (attachmentIds.length === 0) return 0;
  const placeholders = attachmentIds.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM attachments
       WHERE uploader_id = ? AND message_id IS NULL AND id IN (${placeholders})`,
    )
    .get(uploaderId, ...attachmentIds) as { total: number };
  return row.total;
}

/** Nomes dos arquivos ligados a mensagens que vão ser apagadas (para limpar o disco depois). */
export function collectAttachmentFiles(
  where: 'message' | 'channel' | 'server',
  id: string,
): string[] {
  const column =
    where === 'message' ? 'm.id' : where === 'channel' ? 'm.channel_id' : 'm.server_id';
  const rows = db
    .prepare(
      `SELECT a.stored_name FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE ${column} = ?`,
    )
    .all(id) as Array<{ stored_name: string }>;
  return rows.map((r) => r.stored_name);
}

/** Apaga anexos enviados mas nunca usados numa mensagem (a pessoa desistiu de mandar). */
export async function cleanupOrphanAttachments(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare('SELECT id, stored_name FROM attachments WHERE message_id IS NULL AND created_at < ?')
    .all(cutoff) as Array<{ id: string; stored_name: string }>;
  for (const row of rows) {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
    await deleteStoredFile(row.stored_name);
  }
}

const INLINE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Rota GET /uploads/:name com suporte a Range (necessário para avançar vídeos). */
export async function serveUpload(
  request: FastifyRequest<{ Params: { name: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { name } = request.params;
  if (!STORED_NAME_PATTERN.test(name)) {
    await reply.code(404).send({ ok: false, error: 'Arquivo não encontrado.' });
    return;
  }

  const filePath = join(uploadsDir, name);
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    await reply.code(404).send({ ok: false, error: 'Arquivo não encontrado.' });
    return;
  }

  const ext = name.slice(name.lastIndexOf('.') + 1);
  const inlineMime = INLINE_MIME_BY_EXT[ext];
  const record = db
    .prepare('SELECT file_name FROM attachments WHERE stored_name = ?')
    .get(name) as { file_name: string } | undefined;
  const downloadName = encodeURIComponent(record?.file_name ?? name);

  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
  );
  reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
  reply.header(
    'Content-Disposition',
    `${inlineMime ? 'inline' : 'attachment'}; filename*=UTF-8''${downloadName}`,
  );
  reply.type(inlineMime ?? 'application/octet-stream');

  const range = request.headers.range;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : size - Number(match[2]);
    let end = match[1] && match[2] ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      reply.header('Content-Range', `bytes */${size}`);
      await reply.code(416).send();
      return;
    }
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
    reply.header('Content-Length', end - start + 1);
    await reply.send(createReadStream(filePath, { start, end }));
    return;
  }

  reply.header('Content-Length', size);
  await reply.send(createReadStream(filePath));
}

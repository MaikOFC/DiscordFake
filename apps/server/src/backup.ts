import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { backupsDir, db } from './db.js';

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_BACKUP_DELAY_MS = 60 * 1000;
const KEEP_BACKUPS = 10;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Faz uma cópia do banco com o servidor rodando (o SQLite garante uma cópia consistente). */
export async function runBackup(): Promise<string> {
  await mkdir(backupsDir, { recursive: true });
  const file = join(backupsDir, `nexusvoice-${timestamp()}.db`);
  await db.backup(file);

  const existing = (await readdir(backupsDir))
    .filter((name) => /^nexusvoice-.*\.db$/.test(name))
    .sort();
  const extra = existing.slice(0, Math.max(0, existing.length - KEEP_BACKUPS));
  for (const name of extra) {
    await unlink(join(backupsDir, name)).catch(() => undefined);
  }
  return file;
}

export function startBackupSchedule(log: (msg: string, error?: unknown) => void): void {
  const run = (): void => {
    runBackup()
      .then((file) => log(`Backup do banco salvo em ${file}`))
      .catch((error: unknown) => log('Falha ao fazer backup do banco', error));
  };
  setTimeout(run, FIRST_BACKUP_DELAY_MS).unref();
  setInterval(run, BACKUP_INTERVAL_MS).unref();
}

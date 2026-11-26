import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const defaultDbPath = resolve(
  import.meta.dirname,
  '../data/nexusvoice.db',
);
const dbPath = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : defaultDbPath;

/** Pasta onde ficam os arquivos enviados (avatares, banners e anexos do chat). */
export const uploadsDir = process.env.UPLOADS_DIR
  ? resolve(process.env.UPLOADS_DIR)
  : resolve(dirname(dbPath), 'uploads');

/** Pasta das cópias de segurança automáticas do banco. */
export const backupsDir = resolve(dirname(dbPath), 'backups');

// Garante que a pasta do arquivo SQLite exista antes de abrir o banco.
mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(uploadsDir, { recursive: true });

export const db = new Database(dbPath);

// WAL melhora a concorrência de leitura/escrita; foreign_keys ativa CASCADE ao apagar servidor/canal.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_file TEXT,
    banner_file TEXT,
    bio TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Guardamos só o hash do token de sessão: quem copiar o banco não consegue entrar como ninguém.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_channels_server_pos
    ON channels(server_id, position, created_at);

  CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages(channel_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions(user_id);

  CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON attachments(message_id);
`);

/** Adiciona uma coluna só se ela ainda não existir (bancos criados antes desta versão). */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('messages', 'reply_to_id', 'TEXT');
addColumnIfMissing('messages', 'edited_at', 'TEXT');
addColumnIfMissing('messages', 'mentions', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('messages', 'link_previews', "TEXT NOT NULL DEFAULT '[]'");

export { dbPath };

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

// Garante que a pasta do arquivo SQLite exista antes de abrir o banco.
mkdirSync(dirname(dbPath), { recursive: true });

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

  CREATE INDEX IF NOT EXISTS idx_channels_server_pos
    ON channels(server_id, position, created_at);

  CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages(channel_id, created_at);
`);

export { dbPath };

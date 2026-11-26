import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { LIMITS, type ActionResult, type AuthResult, type PublicUser } from '@nexusvoice/shared';
import { db } from './db.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Parâmetros do scrypt: custo suficiente para atrasar ataques de força bruta sem travar o servidor.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Sessões sem uso por mais tempo que isso deixam de valer. */
const SESSION_IDLE_DAYS = 60;

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_file: string | null;
  banner_file: string | null;
  bio: string;
  created_at: string;
}

export function mediaUrl(storedName: string | null): string | null {
  return storedName ? `/uploads/${storedName}` : null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: mediaUrl(row.avatar_file),
    bannerUrl: mediaUrl(row.banner_file),
    bio: row.bio,
  };
}

export function getUserRow(userId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | UserRow
    | undefined;
}

export function getPublicUser(userId: string): PublicUser | null {
  const row = getUserRow(userId);
  return row ? toPublicUser(row) : null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), userId, now, now);
  return token;
}

function validateUsername(raw: unknown): string | ActionResult<never> {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Informe um nome de usuário.' };
  }
  const username = raw.trim();
  if (username.length < LIMITS.usernameMin || username.length > LIMITS.usernameMax) {
    return {
      ok: false,
      error: `O nome de usuário deve ter entre ${LIMITS.usernameMin} e ${LIMITS.usernameMax} caracteres.`,
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: 'Use só letras sem acento, números, ponto e sublinhado no nome de usuário.',
    };
  }
  return username;
}

function validatePassword(raw: unknown): string | ActionResult<never> {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Informe uma senha.' };
  }
  if (raw.length < LIMITS.passwordMin || raw.length > LIMITS.passwordMax) {
    return {
      ok: false,
      error: `A senha deve ter entre ${LIMITS.passwordMin} e ${LIMITS.passwordMax} caracteres.`,
    };
  }
  return raw;
}

export function validateDisplayName(raw: unknown): string | ActionResult<never> {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Informe um nome de exibição.' };
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < LIMITS.displayNameMin || name.length > LIMITS.displayNameMax) {
    return {
      ok: false,
      error: `O nome de exibição deve ter entre ${LIMITS.displayNameMin} e ${LIMITS.displayNameMax} caracteres.`,
    };
  }
  return name;
}

export async function registerUser(body: unknown): Promise<ActionResult<AuthResult>> {
  const input = (body ?? {}) as Record<string, unknown>;
  const username = validateUsername(input.username);
  if (typeof username !== 'string') return username;
  const password = validatePassword(input.password);
  if (typeof password !== 'string') return password;
  const displayName = validateDisplayName(input.displayName ?? username);
  if (typeof displayName !== 'string') return displayName;

  const taken = db
    .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (taken) {
    return { ok: false, error: 'Esse nome de usuário já está em uso.' };
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, bio, created_at)
       VALUES (?, ?, ?, ?, '', ?)`,
    ).run(id, username, displayName, passwordHash, now);
  } catch {
    // Duas contas iguais criadas ao mesmo tempo: o UNIQUE do banco barra a segunda.
    return { ok: false, error: 'Esse nome de usuário já está em uso.' };
  }

  const user = getPublicUser(id);
  if (!user) {
    return { ok: false, error: 'Erro ao criar a conta.' };
  }
  return { ok: true, data: { token: createSession(id), user } };
}

export async function loginUser(body: unknown): Promise<ActionResult<AuthResult>> {
  const input = (body ?? {}) as Record<string, unknown>;
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const genericError = 'Usuário ou senha incorretos.';

  if (!username || !password || password.length > LIMITS.passwordMax) {
    return { ok: false, error: genericError };
  }

  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return { ok: false, error: genericError };
  }

  return { ok: true, data: { token: createSession(row.id), user: toPublicUser(row) } };
}

export async function changePassword(
  userId: string,
  body: unknown,
): Promise<ActionResult> {
  const input = (body ?? {}) as Record<string, unknown>;
  const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
  const next = validatePassword(input.newPassword);
  if (typeof next !== 'string') return next;

  const row = getUserRow(userId);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return { ok: false, error: 'A senha atual está incorreta.' };
  }

  const hash = await hashPassword(next);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  return { ok: true };
}

/** Confere o token e devolve o ID da conta. Também renova a data de último uso. */
export function getUserIdByToken(token: string): string | null {
  if (!token || token.length > 200) {
    return null;
  }
  const tokenHash = hashToken(token);
  const row = db
    .prepare('SELECT user_id, last_used_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; last_used_at: string } | undefined;

  if (!row) {
    return null;
  }

  const lastUsed = new Date(row.last_used_at).getTime();
  const maxIdleMs = SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000;
  if (Number.isNaN(lastUsed) || Date.now() - lastUsed > maxIdleMs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  // Atualiza no máximo uma vez por hora para não escrever no banco a cada requisição.
  if (Date.now() - lastUsed > 60 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      tokenHash,
    );
  }
  return row.user_id;
}

export function revokeToken(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Lê o token do cabeçalho "Authorization: Bearer ...". */
export function readBearerToken(header: string | undefined): string {
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}

/** Limite simples de tentativas de login por IP, para dificultar adivinhar senhas. */
const loginAttemptsByIp = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export function allowLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const recent = (loginAttemptsByIp.get(ip) ?? []).filter(
    (ts) => now - ts < LOGIN_WINDOW_MS,
  );
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttemptsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  loginAttemptsByIp.set(ip, recent);
  return true;
}

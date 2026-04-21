import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import type { DailySnapshotInput, DailySnapshotRow } from './dailySnapshotTypes.js'
import type { DouyinBindingRow, UserRow } from './types.js'

let db: Database.Database | null = null

export function initSqliteStore(): void {
  const rawPath = process.env.DATABASE_PATH?.trim() || 'data/matrix.db'
  const dbPath = resolve(process.cwd(), rawPath)
  mkdirSync(dirname(dbPath), { recursive: true })
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS douyin_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      nickname TEXT,
      douyin_id TEXT,
      avatar_url TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_douyin_bindings_user ON douyin_bindings(user_id);

    CREATE TABLE IF NOT EXISTS douyin_daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      likes INTEGER,
      mutual INTEGER,
      following INTEGER,
      followers INTEGER,
      parsed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, session_id, snapshot_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_snap_user_session ON douyin_daily_snapshots(user_id, session_id);
  `)
  db = instance
}

function getDb(): Database.Database {
  if (!db) throw new Error('SQLite not initialized')
  return db
}

export function sqliteGetUserByUsername(username: string): UserRow | undefined {
  return getDb()
    .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?')
    .get(username) as UserRow | undefined
}

export function sqliteGetUserById(id: number): { id: number; username: string; role: string } | undefined {
  return getDb()
    .prepare('SELECT id, username, role FROM users WHERE id = ?')
    .get(id) as { id: number; username: string; role: string } | undefined
}

export function sqliteCreateUser(username: string, passwordPlain: string, role: 'user' | 'admin'): number {
  const hash = bcrypt.hashSync(passwordPlain, 10)
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, Date.now())
  return Number(info.lastInsertRowid)
}

export function sqliteListDouyinBindingsForUser(userId: number): DouyinBindingRow[] {
  return getDb()
    .prepare(
      'SELECT session_id, nickname, douyin_id, avatar_url, updated_at FROM douyin_bindings WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .all(userId) as DouyinBindingRow[]
}

export function sqliteGetDouyinBindingBySession(sessionId: string):
  | { user_id: number; session_id: string }
  | undefined {
  return getDb()
    .prepare('SELECT user_id, session_id FROM douyin_bindings WHERE session_id = ?')
    .get(sessionId) as { user_id: number; session_id: string } | undefined
}

export function sqliteUpsertDouyinBinding(
  userId: number,
  sessionId: string,
  fields: { nickname?: string; douyinId?: string; avatarUrl?: string },
): void {
  const now = Date.now()
  const nickname = fields.nickname ?? null
  const douyinId = fields.douyinId ?? null
  const avatarUrl = fields.avatarUrl ?? null
  getDb()
    .prepare(
      `INSERT INTO douyin_bindings (user_id, session_id, nickname, douyin_id, avatar_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         user_id = excluded.user_id,
         nickname = excluded.nickname,
         douyin_id = excluded.douyin_id,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`,
    )
    .run(userId, sessionId, nickname, douyinId, avatarUrl, now)
}

export function sqliteDeleteDouyinBinding(userId: number, sessionId: string): number {
  const r = getDb()
    .prepare('DELETE FROM douyin_bindings WHERE user_id = ? AND session_id = ?')
    .run(userId, sessionId)
  return r.changes
}

export function sqliteCountUsers(): number {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  return Number(r.c)
}

export function sqliteCountDouyinBindings(): number {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM douyin_bindings').get() as { c: number }
  return Number(r.c)
}

export function sqliteListAllDouyinBindings(): { user_id: number; session_id: string }[] {
  return getDb()
    .prepare('SELECT user_id, session_id FROM douyin_bindings')
    .all() as { user_id: number; session_id: string }[]
}

export function sqliteUpsertDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
  data: DailySnapshotInput,
): void {
  const now = Date.now()
  const parsed = data.parsed ? 1 : 0
  getDb()
    .prepare(
      `INSERT INTO douyin_daily_snapshots (user_id, session_id, snapshot_date, likes, mutual, following, followers, parsed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, session_id, snapshot_date) DO UPDATE SET
         likes = excluded.likes,
         mutual = excluded.mutual,
         following = excluded.following,
         followers = excluded.followers,
         parsed = excluded.parsed,
         created_at = excluded.created_at`,
    )
    .run(
      userId,
      sessionId,
      snapshotDate,
      data.likes,
      data.mutual,
      data.following,
      data.followers,
      parsed,
      now,
    )
}

export function sqliteListDailySnapshotDates(userId: number, sessionId: string): string[] {
  const rows = getDb()
    .prepare(
      'SELECT snapshot_date FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? ORDER BY snapshot_date DESC',
    )
    .all(userId, sessionId) as { snapshot_date: string }[]
  return rows.map((r) => String(r.snapshot_date).slice(0, 10))
}

export function sqliteGetDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
): DailySnapshotRow | undefined {
  const r = getDb()
    .prepare(
      'SELECT snapshot_date, likes, mutual, following, followers, parsed FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? AND snapshot_date = ?',
    )
    .get(userId, sessionId, snapshotDate) as
    | {
        snapshot_date: string
        likes: number | null
        mutual: number | null
        following: number | null
        followers: number | null
        parsed: number
      }
    | undefined
  if (!r) return undefined
  return {
    snapshot_date: String(r.snapshot_date),
    likes: r.likes == null ? null : Number(r.likes),
    mutual: r.mutual == null ? null : Number(r.mutual),
    following: r.following == null ? null : Number(r.following),
    followers: r.followers == null ? null : Number(r.followers),
    parsed: Boolean(r.parsed),
  }
}

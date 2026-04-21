import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { DailySnapshotInput, DailySnapshotRow } from './dailySnapshotTypes.js'
import type { DouyinBindingRow, UserRow } from './types.js'

let pool: Pool | null = null

function requirePool(): Pool {
  if (!pool) throw new Error('MySQL pool not initialized')
  return pool
}

function assertSafeMysqlIdentifier(name: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`DB_NAME 仅允许字母、数字、下划线，当前: ${name}`)
  }
}

/** 确保库存在后再建业务连接池（本地 MySQL 无需手建库） */
export async function initMysqlStore(): Promise<void> {
  const host = process.env.DB_HOST?.trim() || '127.0.0.1'
  const port = Number(process.env.DB_PORT?.trim() || '3306')
  const user = process.env.DB_USER?.trim() || 'root'
  const password = process.env.DB_PASSWORD ?? ''
  const database = process.env.DB_NAME?.trim() || 'matrix_data'
  assertSafeMysqlIdentifier(database)

  const poolSizeRaw = process.env.DB_POOL_SIZE?.trim()
  const charset = process.env.DB_CHARSET?.trim() || 'utf8mb4'

  const bootstrap = mysql.createPool({
    host,
    port,
    user,
    password,
    waitForConnections: true,
    connectionLimit: 2,
  })
  const b = await bootstrap.getConnection()
  try {
    await b.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    b.release()
    await bootstrap.end()
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: poolSizeRaw ? Math.max(1, Number(poolSizeRaw)) : 10,
    charset,
  })

  const conn = await pool.getConnection()
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'user',
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS douyin_bindings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        session_id VARCHAR(128) NOT NULL UNIQUE,
        nickname VARCHAR(255) NULL,
        douyin_id VARCHAR(255) NULL,
        avatar_url TEXT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_douyin_bindings_user (user_id),
        CONSTRAINT fk_douyin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS douyin_daily_snapshots (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        session_id VARCHAR(128) NOT NULL,
        snapshot_date DATE NOT NULL,
        likes INT NULL,
        mutual INT NULL,
        following INT NULL,
        followers INT NULL,
        parsed TINYINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uq_daily_snapshot (user_id, session_id, snapshot_date),
        CONSTRAINT fk_daily_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_daily_snap_user_session (user_id, session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
  } finally {
    conn.release()
  }
}

export async function mysqlGetUserByUsername(username: string): Promise<UserRow | undefined> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE username = ? LIMIT 1',
    [username],
  )
  const r = rows[0]
  if (!r) return undefined
  return {
    id: Number(r.id),
    username: String(r.username),
    password_hash: String(r.password_hash),
    role: String(r.role),
    created_at: Number(r.created_at),
  }
}

export async function mysqlGetUserById(id: number): Promise<{ id: number; username: string; role: string } | undefined> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT id, username, role FROM users WHERE id = ? LIMIT 1',
    [id],
  )
  const r = rows[0]
  if (!r) return undefined
  return { id: Number(r.id), username: String(r.username), role: String(r.role) }
}

export async function mysqlCreateUser(
  username: string,
  passwordPlain: string,
  role: 'user' | 'admin',
): Promise<number> {
  const p = requirePool()
  const hash = bcrypt.hashSync(passwordPlain, 10)
  const [result] = await p.query<ResultSetHeader>(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
    [username, hash, role, Date.now()],
  )
  return Number(result.insertId)
}

export async function mysqlListDouyinBindingsForUser(userId: number): Promise<DouyinBindingRow[]> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT session_id, nickname, douyin_id, avatar_url, updated_at FROM douyin_bindings WHERE user_id = ? ORDER BY updated_at DESC',
    [userId],
  )
  return rows.map((r) => ({
    session_id: String(r.session_id),
    nickname: r.nickname != null ? String(r.nickname) : null,
    douyin_id: r.douyin_id != null ? String(r.douyin_id) : null,
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
    updated_at: Number(r.updated_at),
  }))
}

export async function mysqlGetDouyinBindingBySession(
  sessionId: string,
): Promise<{ user_id: number; session_id: string } | undefined> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT user_id, session_id FROM douyin_bindings WHERE session_id = ? LIMIT 1',
    [sessionId],
  )
  const r = rows[0]
  if (!r) return undefined
  return { user_id: Number(r.user_id), session_id: String(r.session_id) }
}

export async function mysqlUpsertDouyinBinding(
  userId: number,
  sessionId: string,
  fields: { nickname?: string; douyinId?: string; avatarUrl?: string },
): Promise<void> {
  const p = requirePool()
  const now = Date.now()
  const nickname = fields.nickname ?? null
  const douyinId = fields.douyinId ?? null
  const avatarUrl = fields.avatarUrl ?? null
  await p.query(
    `INSERT INTO douyin_bindings (user_id, session_id, nickname, douyin_id, avatar_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       nickname = VALUES(nickname),
       douyin_id = VALUES(douyin_id),
       avatar_url = VALUES(avatar_url),
       updated_at = VALUES(updated_at)`,
    [userId, sessionId, nickname, douyinId, avatarUrl, now],
  )
}

export async function mysqlDeleteDouyinBinding(userId: number, sessionId: string): Promise<number> {
  const p = requirePool()
  const [result] = await p.query<ResultSetHeader>(
    'DELETE FROM douyin_bindings WHERE user_id = ? AND session_id = ?',
    [userId, sessionId],
  )
  return result.affectedRows
}

export async function mysqlCountUsers(): Promise<number> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM users')
  return Number((rows[0] as { c: number } | undefined)?.c ?? 0)
}

export async function mysqlCountDouyinBindings(): Promise<number> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM douyin_bindings')
  return Number((rows[0] as { c: number } | undefined)?.c ?? 0)
}

export async function mysqlListAllDouyinBindings(): Promise<{ user_id: number; session_id: string }[]> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>('SELECT user_id, session_id FROM douyin_bindings')
  return rows.map((r) => ({ user_id: Number(r.user_id), session_id: String(r.session_id) }))
}

export async function mysqlUpsertDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
  data: DailySnapshotInput,
): Promise<void> {
  const p = requirePool()
  const now = Date.now()
  const parsed = data.parsed ? 1 : 0
  await p.query(
    `INSERT INTO douyin_daily_snapshots (user_id, session_id, snapshot_date, likes, mutual, following, followers, parsed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       likes = VALUES(likes),
       mutual = VALUES(mutual),
       following = VALUES(following),
       followers = VALUES(followers),
       parsed = VALUES(parsed),
       created_at = VALUES(created_at)`,
    [userId, sessionId, snapshotDate, data.likes, data.mutual, data.following, data.followers, parsed, now],
  )
}

export async function mysqlListDailySnapshotDates(
  userId: number,
  sessionId: string,
): Promise<string[]> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT snapshot_date FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? ORDER BY snapshot_date DESC',
    [userId, sessionId],
  )
  return rows.map((r) => {
    const sd = r.snapshot_date
    return sd instanceof Date ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10)
  })
}

export async function mysqlGetDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
): Promise<DailySnapshotRow | undefined> {
  const p = requirePool()
  const [rows] = await p.query<RowDataPacket[]>(
    'SELECT snapshot_date, likes, mutual, following, followers, parsed FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? AND snapshot_date = ? LIMIT 1',
    [userId, sessionId, snapshotDate],
  )
  const r = rows[0]
  if (!r) return undefined
  const sd = r.snapshot_date
  const dateStr =
    sd instanceof Date ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10)
  return {
    snapshot_date: dateStr,
    likes: r.likes == null ? null : Number(r.likes),
    mutual: r.mutual == null ? null : Number(r.mutual),
    following: r.following == null ? null : Number(r.following),
    followers: r.followers == null ? null : Number(r.followers),
    parsed: Boolean(r.parsed),
  }
}

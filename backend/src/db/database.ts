import bcrypt from 'bcryptjs'
import {
  initMysqlStore,
  mysqlCountDouyinBindings,
  mysqlCountUsers,
  mysqlCreateUser,
  mysqlDeleteDouyinBinding,
  mysqlGetDailySnapshot,
  mysqlListDailySnapshotDates,
  mysqlGetDouyinBindingBySession,
  mysqlGetUserById,
  mysqlGetUserByUsername,
  mysqlListAllDouyinBindings,
  mysqlListDouyinBindingsForUser,
  mysqlUpsertDailySnapshot,
  mysqlUpsertDouyinBinding,
} from './mysqlStore.js'
import {
  initSqliteStore,
  sqliteCountDouyinBindings,
  sqliteCountUsers,
  sqliteCreateUser,
  sqliteDeleteDouyinBinding,
  sqliteGetDailySnapshot,
  sqliteListDailySnapshotDates,
  sqliteGetDouyinBindingBySession,
  sqliteGetUserById,
  sqliteGetUserByUsername,
  sqliteListAllDouyinBindings,
  sqliteListDouyinBindingsForUser,
  sqliteUpsertDailySnapshot,
  sqliteUpsertDouyinBinding,
} from './sqliteStore.js'
import type { DailySnapshotInput, DailySnapshotRow } from './dailySnapshotTypes.js'
import type { DouyinBindingRow, UserRow } from './types.js'

export type { DailySnapshotInput, DailySnapshotRow } from './dailySnapshotTypes.js'
export type { DouyinBindingRow, UserRow } from './types.js'

let dbMode: 'sqlite' | 'mysql' = 'sqlite'

export async function initDatabase(): Promise<void> {
  const t = (process.env.DB_TYPE || 'sqlite').trim().toLowerCase()
  if (t === 'mysql') {
    await initMysqlStore()
    dbMode = 'mysql'
    const host = process.env.DB_HOST || '127.0.0.1'
    const port = process.env.DB_PORT || '3306'
    console.log(`[db] MySQL ${host}:${port} / ${process.env.DB_NAME || 'matrix_data'}`)
  } else {
    initSqliteStore()
    dbMode = 'sqlite'
    console.log('[db] SQLite', process.env.DATABASE_PATH?.trim() || 'data/matrix.db')
  }
}

export async function getUserByUsername(username: string): Promise<UserRow | undefined> {
  if (dbMode === 'mysql') return mysqlGetUserByUsername(username)
  return sqliteGetUserByUsername(username)
}

export async function getUserById(id: number): Promise<{ id: number; username: string; role: string } | undefined> {
  if (dbMode === 'mysql') return mysqlGetUserById(id)
  return sqliteGetUserById(id)
}

export async function createUser(username: string, passwordPlain: string, role: 'user' | 'admin'): Promise<number> {
  if (dbMode === 'mysql') return mysqlCreateUser(username, passwordPlain, role)
  return sqliteCreateUser(username, passwordPlain, role)
}

export function verifyPassword(row: UserRow, passwordPlain: string): boolean {
  return bcrypt.compareSync(passwordPlain, row.password_hash)
}

export async function seedAdminUser(): Promise<void> {
  const u = process.env.ADMIN_USERNAME?.trim()
  const p = process.env.ADMIN_PASSWORD?.trim()
  if (!u || !p) {
    console.warn('[auth] ADMIN_USERNAME / ADMIN_PASSWORD 未配置，跳过管理员种子账号')
    return
  }
  const existing = await getUserByUsername(u)
  if (existing) return
  await createUser(u, p, 'admin')
  console.log('[auth] 已创建管理员账号:', u)
}

export async function listDouyinBindingsForUser(userId: number): Promise<DouyinBindingRow[]> {
  if (dbMode === 'mysql') return mysqlListDouyinBindingsForUser(userId)
  return sqliteListDouyinBindingsForUser(userId)
}

export async function getDouyinBindingBySession(
  sessionId: string,
): Promise<{ user_id: number; session_id: string } | undefined> {
  if (dbMode === 'mysql') return mysqlGetDouyinBindingBySession(sessionId)
  return sqliteGetDouyinBindingBySession(sessionId)
}

export async function upsertDouyinBinding(
  userId: number,
  sessionId: string,
  fields: { nickname?: string; douyinId?: string; avatarUrl?: string },
): Promise<void> {
  if (dbMode === 'mysql') return mysqlUpsertDouyinBinding(userId, sessionId, fields)
  sqliteUpsertDouyinBinding(userId, sessionId, fields)
}

export async function deleteDouyinBinding(userId: number, sessionId: string): Promise<number> {
  if (dbMode === 'mysql') return mysqlDeleteDouyinBinding(userId, sessionId)
  return sqliteDeleteDouyinBinding(userId, sessionId)
}

export async function countUsers(): Promise<number> {
  if (dbMode === 'mysql') return mysqlCountUsers()
  return sqliteCountUsers()
}

export async function countDouyinBindings(): Promise<number> {
  if (dbMode === 'mysql') return mysqlCountDouyinBindings()
  return sqliteCountDouyinBindings()
}

export async function listAllDouyinBindings(): Promise<{ user_id: number; session_id: string }[]> {
  if (dbMode === 'mysql') return mysqlListAllDouyinBindings()
  return sqliteListAllDouyinBindings()
}

export async function upsertDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
  data: DailySnapshotInput,
): Promise<void> {
  if (dbMode === 'mysql') return mysqlUpsertDailySnapshot(userId, sessionId, snapshotDate, data)
  sqliteUpsertDailySnapshot(userId, sessionId, snapshotDate, data)
}

export async function getDailySnapshot(
  userId: number,
  sessionId: string,
  snapshotDate: string,
): Promise<DailySnapshotRow | undefined> {
  if (dbMode === 'mysql') return mysqlGetDailySnapshot(userId, sessionId, snapshotDate)
  return sqliteGetDailySnapshot(userId, sessionId, snapshotDate)
}

export async function listDailySnapshotDates(userId: number, sessionId: string): Promise<string[]> {
  if (dbMode === 'mysql') return mysqlListDailySnapshotDates(userId, sessionId)
  return sqliteListDailySnapshotDates(userId, sessionId)
}

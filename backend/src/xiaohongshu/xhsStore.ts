/**
 * 小红书会话：内存 + data/xiaohongshu-sessions.json 持久化（参考抖音与 clawra-xiaohongshu storage/cookies 思路）
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Cookie } from 'playwright'
import type { DiskSessionRow } from '../douyin/playwrightSessionDisk.js'

/** 复用磁盘文件结构；user 字段存 XhsUserInfo 兼容 JSON */
export type XhsUserInfo = {
  nickname?: string
  avatarUrl?: string
  /** 小红书号展示 */
  redId?: string
  userId?: string
  tokenPreview?: string
}

export type XhsSession = {
  id: string
  phase: 'logged_in'
  hint: string
  user?: XhsUserInfo
  cookieCount?: number
  createdAt: number
}

const store = new Map<string, XhsSession>()
const cookieVault = new Map<string, Cookie[]>()
/** 用户已删除的 sessionId：防止扫码任务晚到仍写回会话 */
const removedSessionIds = new Set<string>()

const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000
const MIN_TTL_MS = 60_000
const MAX_TTL_MS = 3650 * 24 * 60 * 60 * 1000

function getTtlMs(): number {
  const raw = process.env.XHS_SESSION_TTL_MS ?? process.env.DOUYIN_PLAYWRIGHT_SESSION_TTL_MS
  if (!raw?.trim()) return DEFAULT_TTL_MS
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n)) return DEFAULT_TTL_MS
  return Math.min(Math.max(n, MIN_TTL_MS), MAX_TTL_MS)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushDisk()
  }, 2000)
}

async function flushDisk(): Promise<void> {
  const ttl = getTtlMs()
  const now = Date.now()
  const rows: DiskSessionRow[] = []
  for (const [id, s] of store) {
    if (now - s.createdAt > ttl) continue
    const cookies = cookieVault.get(id)
    if (!cookies?.length) continue
    rows.push({
      id,
      createdAt: s.createdAt,
      user: s.user,
      cookies,
    })
  }
  try {
    await writeDiskSessionsToXhs(rows)
  } catch (e) {
    console.error('[xhs] persist failed', e)
  }
}

const XHS_FILE = path.join(process.cwd(), 'data', 'xiaohongshu-sessions.json')

type XhsDiskFile = { version: 1; sessions: DiskSessionRow[] }

async function writeDiskSessionsToXhs(rows: DiskSessionRow[]): Promise<void> {
  await mkdir(path.dirname(XHS_FILE), { recursive: true })
  const payload: XhsDiskFile = { version: 1, sessions: rows }
  await writeFile(XHS_FILE, JSON.stringify(payload), 'utf8')
}

async function readDiskSessionsXhs(): Promise<DiskSessionRow[]> {
  try {
    const buf = await readFile(XHS_FILE, 'utf8')
    const parsed = JSON.parse(buf) as XhsDiskFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) return []
    return parsed.sessions.filter(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        typeof r.createdAt === 'number' &&
        Array.isArray(r.cookies) &&
        r.cookies.length > 0,
    )
  } catch {
    return []
  }
}

function touchTtl(id: string) {
  const s = store.get(id)
  if (s) {
    s.createdAt = Date.now()
    store.set(id, s)
    schedulePersist()
  }
}

function prune() {
  const now = Date.now()
  const ttl = getTtlMs()
  let removed = false
  for (const [id, s] of store) {
    if (now - s.createdAt > ttl) {
      store.delete(id)
      cookieVault.delete(id)
      removed = true
    }
  }
  if (removed) schedulePersist()
}

export async function initXhsSessionsFromDisk(): Promise<void> {
  const rows = await readDiskSessionsXhs()
  const ttl = getTtlMs()
  const now = Date.now()
  let n = 0
  for (const row of rows) {
    if (now - row.createdAt > ttl) continue
    store.set(row.id, {
      id: row.id,
      phase: 'logged_in',
      hint: '已从本地恢复（小红书 Cookie）',
      createdAt: row.createdAt,
      user: row.user as XhsUserInfo | undefined,
      cookieCount: row.cookies.length,
    })
    cookieVault.set(row.id, row.cookies)
    n++
  }
  if (n > 0) console.log(`[xhs] restored ${n} session(s) from disk`)
}

export function getXhsSession(id: string): XhsSession | undefined {
  prune()
  const s = store.get(id)
  if (s) touchTtl(id)
  return s
}

export function getXhsCookieVault(id: string): Cookie[] | undefined {
  prune()
  const c = cookieVault.get(id)
  if (c?.length) touchTtl(id)
  return c
}

export function putXhsLoggedInSession(id: string, cookies: Cookie[], user?: XhsUserInfo): void {
  if (removedSessionIds.has(id)) {
    removedSessionIds.delete(id)
    return
  }
  store.set(id, {
    id,
    phase: 'logged_in',
    hint: 'Cookie 已绑定',
    createdAt: Date.now(),
    user,
    cookieCount: cookies.length,
  })
  cookieVault.set(id, cookies)
  schedulePersist()
}

export function createXhsSessionId(): string {
  return randomUUID()
}

/** 删除已持久化的小红书会话并写入磁盘；后续同名 id 的迟到写入会被忽略 */
export function deletePersistedXhsSession(id: string): boolean {
  removedSessionIds.add(id)
  const hadStore = store.delete(id)
  const hadVault = cookieVault.delete(id)
  schedulePersist()
  return hadStore || hadVault
}

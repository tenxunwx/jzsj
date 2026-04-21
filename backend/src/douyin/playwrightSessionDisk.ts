/**
 * 将已登录 Playwright 会话落盘，服务重启后恢复（与内存 TTL 配合）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Cookie } from 'playwright'

/** 与 PlaywrightUserInfo 字段对齐，避免循环依赖 */
export type DiskSessionUser = {
  nickname?: string
  avatarUrl?: string
  douyinId?: string
  tokenPreview?: string
  tokenFullLine?: string
}

export type DiskSessionRow = {
  id: string
  createdAt: number
  user?: DiskSessionUser
  cookies: Cookie[]
}

type DiskFile = {
  version: 1
  sessions: DiskSessionRow[]
}

const DATA_DIR = path.join(process.cwd(), 'data')
const SESSION_FILE = path.join(DATA_DIR, 'douyin-playwright-sessions.json')

export async function readDiskSessions(): Promise<DiskSessionRow[]> {
  try {
    const buf = await readFile(SESSION_FILE, 'utf8')
    const parsed = JSON.parse(buf) as DiskFile
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

export async function writeDiskSessions(rows: DiskSessionRow[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const payload: DiskFile = { version: 1, sessions: rows }
  await writeFile(SESSION_FILE, JSON.stringify(payload), 'utf8')
}

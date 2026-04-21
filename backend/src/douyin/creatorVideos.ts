import type { Cookie } from 'playwright'
import { getPlaywrightCookieVault } from './playwrightLogin.js'

export type CreatorVideoItem = {
  id: string
  title: string
  coverUrl: string | null
  source: string
  createTime: number | null
  diggCount: number | null
  commentCount: number | null
  shareCount: number | null
  playCount: number | null
}

function buildCookieHeader(cookies: Cookie[], requestHost: string): string {
  const host = requestHost.toLowerCase()
  return cookies
    .filter((c) => {
      const raw = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
      const d = raw.toLowerCase()
      if (host === d) return true
      if (host.endsWith('.' + d)) return true
      return false
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

async function tryFetchJsonFrom(
  cookies: Cookie[],
  origin: string,
  path: string,
  referer?: string,
): Promise<unknown | null> {
  const base = origin.replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const host = new URL(url).hostname
  const cookie = buildCookieHeader(cookies, host)
  if (!cookie) return null
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        Referer: referer ?? `${base}/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

async function tryFetchCreatorJson(cookies: Cookie[], path: string): Promise<unknown | null> {
  return tryFetchJsonFrom(cookies, 'https://creator.douyin.com', path, 'https://creator.douyin.com/')
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return parseInt(v, 10)
  return null
}

function pickCoverUrl(o: Record<string, unknown>): string | null {
  const direct = [o.cover_url, o.coverUrl, o.thumbnail_url, o.poster_url]
  for (const v of direct) if (typeof v === 'string' && v.trim()) return v
  const nested = o.cover as Record<string, unknown> | undefined
  const list = nested?.url_list
  if (Array.isArray(list)) {
    for (const x of list) if (typeof x === 'string' && x.trim()) return x
  }
  return null
}

function normalizeVideo(o: Record<string, unknown>, source: string): CreatorVideoItem | null {
  const idRaw = o.aweme_id ?? o.awemeId ?? o.item_id ?? o.itemId ?? o.video_id ?? o.videoId ?? o.id
  const id = typeof idRaw === 'string' ? idRaw : typeof idRaw === 'number' ? String(idRaw) : ''
  if (!id) return null
  const titleRaw = o.desc ?? o.title ?? o.caption ?? o.name
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : '(无标题)'
  const stat = (o.statistics as Record<string, unknown> | undefined) ?? {}
  return {
    id,
    title,
    coverUrl: pickCoverUrl(o),
    source,
    createTime: parseNum(o.create_time ?? o.createTime ?? o.publish_time ?? o.publishTime),
    diggCount: parseNum(stat.digg_count ?? stat.diggCount ?? o.digg_count),
    commentCount: parseNum(stat.comment_count ?? stat.commentCount ?? o.comment_count),
    shareCount: parseNum(stat.share_count ?? stat.shareCount ?? o.share_count),
    playCount: parseNum(stat.play_count ?? stat.playCount ?? stat.play_cnt ?? o.play_count),
  }
}

function extractListFromJson(json: unknown, source: string): CreatorVideoItem[] {
  if (!json || typeof json !== 'object') return []
  const root = json as Record<string, unknown>
  const candidates = [
    root.aweme_list,
    root.awemeList,
    (root.data as Record<string, unknown> | undefined)?.aweme_list,
    (root.data as Record<string, unknown> | undefined)?.list,
    root.list,
    root.items,
  ]
  for (const c of candidates) {
    if (!Array.isArray(c)) continue
    const out: CreatorVideoItem[] = []
    for (const row of c) {
      if (!row || typeof row !== 'object') continue
      const v = normalizeVideo(row as Record<string, unknown>, source)
      if (v) out.push(v)
    }
    if (out.length > 0) return out
  }
  return []
}

function extractListsRecursively(node: unknown, source: string, depth = 0): CreatorVideoItem[] {
  if (depth > 10 || node === null || node === undefined) return []
  if (Array.isArray(node)) {
    const out: CreatorVideoItem[] = []
    for (const x of node) {
      if (!x || typeof x !== 'object') continue
      const v = normalizeVideo(x as Record<string, unknown>, source)
      if (v) out.push(v)
    }
    return out
  }
  if (typeof node !== 'object') return []
  const obj = node as Record<string, unknown>
  const keys = Object.keys(obj)
  for (const k of keys) {
    const v = obj[k]
    if (!Array.isArray(v)) continue
    if (!/aweme|item|video|post|works|content|list/i.test(k)) continue
    const got = extractListsRecursively(v, source, depth + 1)
    if (got.length > 0) return got
  }
  for (const v of Object.values(obj)) {
    if (!v || typeof v !== 'object') continue
    const got = extractListsRecursively(v, source, depth + 1)
    if (got.length > 0) return got
  }
  return []
}

function mergeUniqueVideos(target: CreatorVideoItem[], source: CreatorVideoItem[]): CreatorVideoItem[] {
  const seen = new Set(target.map((x) => x.id))
  for (const row of source) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    target.push(row)
  }
  return target
}

function extractSecUserId(json: unknown, depth = 0): string | null {
  if (depth > 16 || json === null || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const candidate = o.sec_user_id ?? o.secUserId ?? o.sec_uid ?? o.secUid
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  for (const v of Object.values(o)) {
    if (!v || typeof v !== 'object') continue
    const got = extractSecUserId(v, depth + 1)
    if (got) return got
  }
  return null
}

async function tryResolveSecUserId(cookies: Cookie[]): Promise<string | null> {
  const infoPaths = [
    '/web/api/media/user/info/',
    '/aweme/v1/creator/user/info/',
    '/passport/account/info/v2/',
  ]
  for (const p of infoPaths) {
    const json = await tryFetchCreatorJson(cookies, p)
    if (!json) continue
    const sid = extractSecUserId(json)
    if (sid) return sid
  }
  return null
}

export async function listCreatorVideos(sessionId: string): Promise<CreatorVideoItem[] | null> {
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return null

  // 方法 1：创作者常见接口（不同账号命中的 path 差异较大）
  const creatorPaths = [
    '/web/api/media/aweme/list/?count=30&cursor=0',
    '/web/api/media/aweme/list/?count=30&max_cursor=0',
    '/aweme/v1/creator/aweme/list/?count=30&cursor=0',
    '/web/api/creator/aweme/list/?count=30&cursor=0',
    '/web/api/media/content/list/?count=30&cursor=0',
    '/web/api/media/content/list/?count=30&page=1',
    '/web/api/media/video/list/?count=30&cursor=0',
    '/web/api/media/item/list/?count=30&cursor=0',
  ]
  const merged: CreatorVideoItem[] = []
  for (const p of creatorPaths) {
    const json = await tryFetchCreatorJson(cookies, p)
    if (!json) continue
    const source = `creator:${p}`
    const direct = extractListFromJson(json, source)
    const fallback = direct.length > 0 ? direct : extractListsRecursively(json, source)
    mergeUniqueVideos(merged, fallback)
    if (merged.length >= 12) return merged.slice(0, 60)
  }

  // 方法 2：通过 sec_user_id 调主站作品接口（部分会话只能命中这里）
  const secUserId = await tryResolveSecUserId(cookies)
  if (secUserId) {
    const webPaths = [
      `/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=30`,
      `/aweme/v1/web/aweme/post/?sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=20`,
    ]
    for (const p of webPaths) {
      const json = await tryFetchJsonFrom(cookies, 'https://www.douyin.com', p, 'https://www.douyin.com/')
      if (!json) continue
      const source = `web:${p}`
      const direct = extractListFromJson(json, source)
      const fallback = direct.length > 0 ? direct : extractListsRecursively(json, source)
      mergeUniqueVideos(merged, fallback)
      if (merged.length >= 1) break
    }
  }

  return merged.slice(0, 60)
}


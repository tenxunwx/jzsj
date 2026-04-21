/**
 * 使用 Cookie 尝试拉取小红书账号信息（接口常需签名；失败时仍保留 Cookie 供后续 Playwright 使用）
 */
import type { Cookie } from 'playwright'
import type { XhsUserInfo } from './xhsStore.js'

function buildCookieHeader(cookies: Cookie[], host: string): string {
  const hostLower = host.toLowerCase()
  const parts: string[] = []
  for (const c of cookies) {
    const raw = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
    const d = raw.toLowerCase()
    if (hostLower === d || hostLower.endsWith(`.${d}`)) parts.push(`${c.name}=${c.value}`)
  }
  return parts.join('; ')
}

function maskTokenPreview(cookies: Cookie[]): string | undefined {
  const c = cookies.find((x) => /web_session|a1/i.test(x.name))
  if (!c?.value || c.value.length < 4) return undefined
  const v = c.value
  const masked = v.length <= 12 ? `${v.slice(0, 2)}…` : `${v.slice(0, 4)}…${v.slice(-3)}`
  return `${c.name}=${masked}`
}

function readUserShape(obj: Record<string, unknown>): XhsUserInfo | null {
  const nickname =
    typeof obj.nickname === 'string'
      ? obj.nickname
      : typeof obj.nick_name === 'string'
        ? obj.nick_name
        : typeof obj.nickName === 'string'
          ? obj.nickName
          : undefined
  let userId: string | undefined
  if (typeof obj.user_id === 'string') userId = obj.user_id
  else if (typeof obj.userId === 'string') userId = obj.userId
  else if (typeof obj.userid === 'string') userId = obj.userid
  else if (typeof obj.userId === 'number' && Number.isFinite(obj.userId)) userId = String(obj.userId)
  const redId =
    typeof obj.red_id === 'string' ? obj.red_id : typeof obj.redId === 'string' ? obj.redId : undefined
  let avatarUrl: string | undefined
  const img = obj.imageb || obj.images || obj.avatar
  if (typeof img === 'string' && img.startsWith('http')) avatarUrl = img
  if (nickname || userId || redId) {
    return { nickname, userId, redId, avatarUrl }
  }
  return null
}

/**
 * 仅从常见接口结构解析用户，避免深度遍历误把 trace / 推荐里的 user_id 当成当前登录用户。
 */
function extractUserFromXhsJson(o: unknown, depth = 0): XhsUserInfo | null {
  if (depth > 6 || o === null || typeof o !== 'object') return null
  const obj = o as Record<string, unknown>

  const direct = readUserShape(obj)
  if (direct) return direct

  const data = obj.data
  if (data && typeof data === 'object') {
    const fromData = readUserShape(data as Record<string, unknown>)
    if (fromData) return fromData
    const d = data as Record<string, unknown>
    for (const k of ['user', 'userInfo', 'account', 'user_info']) {
      const v = d[k]
      if (v && typeof v === 'object') {
        const inner = readUserShape(v as Record<string, unknown>)
        if (inner) return inner
      }
    }
  }

  for (const k of ['user', 'userInfo', 'account']) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      const inner = readUserShape(v as Record<string, unknown>)
      if (inner) return inner
    }
  }

  return null
}

function isNoiseNickname(s: string): boolean {
  const t = s.trim()
  if (t.length < 2) return true
  return /^(游客|未登录|默认用户|小红书用户|用户\d*|Guest|test)$/i.test(t)
}

function isPlausibleUserId(s: string): boolean {
  const t = s.trim()
  if (t.length < 6) return false
  if (/^0+$/.test(t)) return false
  return true
}

function isPlausibleRedId(s: string): boolean {
  const t = s.trim()
  return t.length >= 4 && /^[a-zA-Z0-9_]+$/.test(t)
}

/**
 * 是否已从接口解析出可信的「当前账号」信息（用于扫码完成判定；避免短 id / 占位昵称误判）
 */
export function hasConfirmedXhsProfile(u: XhsUserInfo | null | undefined): boolean {
  if (!u) return false
  const nick = u.nickname?.trim()
  if (nick && !isNoiseNickname(nick)) return true
  if (u.redId?.trim() && isPlausibleRedId(u.redId.trim())) return true
  if (u.userId != null && isPlausibleUserId(String(u.userId))) return true
  return false
}

export async function tryFetchXhsUserInfo(cookies: Cookie[]): Promise<XhsUserInfo | null> {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  const endpoints = [
    'https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo',
    'https://edith.xiaohongshu.com/api/sns/web/v2/user/me',
  ]
  for (const url of endpoints) {
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      continue
    }
    const ch = buildCookieHeader(cookies, host)
    if (!ch) continue
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: ch,
          'User-Agent': ua,
          Referer: 'https://www.xiaohongshu.com/',
          Origin: 'https://www.xiaohongshu.com',
          Accept: 'application/json, text/plain, */*',
        },
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) continue
      const json = (await res.json()) as unknown
      const u = extractUserFromXhsJson(json)
      if (u) {
        u.tokenPreview = maskTokenPreview(cookies) ?? u.tokenPreview
        return u
      }
    } catch {
      /* */
    }
  }
  const fallback: XhsUserInfo = {}
  const tp = maskTokenPreview(cookies)
  if (tp) fallback.tokenPreview = tp
  return tp ? fallback : null
}

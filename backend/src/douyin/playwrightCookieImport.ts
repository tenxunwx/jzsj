/**
 * 将浏览器复制的 Cookie / Token 文本解析为 Playwright 可用的 Cookie 列表。
 * 支持：document.cookie 风格、多行 name=value、JSON 数组（含 domain/path）。
 */
import type { Cookie } from 'playwright'

const DEFAULT_DOMAIN = '.douyin.com'
const DEFAULT_PATH = '/'

function normalizeImportedCookie(partial: Record<string, unknown>): Cookie | null {
  const name = typeof partial.name === 'string' ? partial.name.trim() : ''
  const value = typeof partial.value === 'string' ? partial.value : String(partial.value ?? '')
  if (!name) return null
  const domain =
    typeof partial.domain === 'string' && partial.domain.trim().length > 0
      ? partial.domain.trim()
      : DEFAULT_DOMAIN
  const path =
    typeof partial.path === 'string' && partial.path.trim().length > 0 ? partial.path.trim() : DEFAULT_PATH
  let expires = -1
  if (typeof partial.expires === 'number' && Number.isFinite(partial.expires)) expires = partial.expires
  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly: partial.httpOnly === true,
    secure: partial.secure !== false,
    sameSite: (partial.sameSite as Cookie['sameSite']) ?? 'Lax',
  }
}

/** 从粘贴文本解析 Cookie；失败时返回空数组（由调用方提示） */
export function parseDouyinCookiePaste(raw: string): Cookie[] {
  const text = raw.trim()
  if (!text) return []

  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text) as unknown[]
      if (!Array.isArray(arr)) return []
      const out: Cookie[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const c = normalizeImportedCookie(item as Record<string, unknown>)
        if (c) out.push(c)
      }
      return dedupeCookies(out)
    } catch {
      return []
    }
  }

  let lineSource = text
  const m = /(?:^|\n)\s*Cookie:\s*(.+)/i.exec(text)
  if (m?.[1]) lineSource = m[1].trim()

  const segments = lineSource.split(/[\n\r]+|;/g).map((s) => s.trim()).filter(Boolean)
  const out: Cookie[] = []
  for (const seg of segments) {
    if (seg.startsWith('#')) continue
    const eq = seg.indexOf('=')
    if (eq <= 0) continue
    const name = seg.slice(0, eq).trim()
    let value = seg.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!name || name.toLowerCase() === 'path' || name.toLowerCase() === 'domain') continue
    out.push({
      name,
      value,
      domain: DEFAULT_DOMAIN,
      path: DEFAULT_PATH,
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    })
  }
  return dedupeCookies(out)
}

function dedupeCookies(cookies: Cookie[]): Cookie[] {
  const map = new Map<string, Cookie>()
  for (const c of cookies) {
    const key = `${c.domain}|${c.path}|${c.name}`
    map.set(key, c)
  }
  return [...map.values()]
}

/** 是否像抖音登录态（宽松，避免误拒合法导入） */
export function looksLikeDouyinAuthCookies(cookies: Cookie[]): boolean {
  if (cookies.length < 2) return false
  const names = cookies.map((c) => c.name.toLowerCase())
  return names.some(
    (n) =>
      n.includes('sessionid') ||
      n.includes('session_ssid') ||
      n.includes('sid_tt') ||
      n.includes('odin') ||
      n.includes('passport') ||
      n.includes('ttwid') ||
      n.includes('ms_token'),
  )
}

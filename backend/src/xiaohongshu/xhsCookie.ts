/**
 * 小红书 Cookie 粘贴解析（域名 .xiaohongshu.com / www.xiaohongshu.com）
 */
import type { Cookie } from 'playwright'

const DEFAULT_DOMAIN = '.xiaohongshu.com'
const DEFAULT_PATH = '/'

export function parseXhsCookiePaste(raw: string): Cookie[] {
  const text = raw.trim()
  if (!text) return []

  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text) as unknown[]
      if (!Array.isArray(arr)) return []
      const out: Cookie[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const name = typeof o.name === 'string' ? o.name : ''
        const value = typeof o.value === 'string' ? o.value : String(o.value ?? '')
        if (!name) continue
        out.push({
          name,
          value,
          domain: typeof o.domain === 'string' && o.domain.trim() ? o.domain.trim() : DEFAULT_DOMAIN,
          path: typeof o.path === 'string' && o.path.trim() ? o.path.trim() : DEFAULT_PATH,
          expires: typeof o.expires === 'number' ? o.expires : -1,
          httpOnly: o.httpOnly === true,
          secure: o.secure !== false,
          sameSite: (o.sameSite as Cookie['sameSite']) ?? 'Lax',
        })
      }
      return dedupe(out)
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
    if (!name) continue
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
  return dedupe(out)
}

function dedupe(cookies: Cookie[]): Cookie[] {
  const map = new Map<string, Cookie>()
  for (const c of cookies) {
    map.set(`${c.domain}|${c.path}|${c.name}`, c)
  }
  return [...map.values()]
}

export function looksLikeXhsAuthCookies(cookies: Cookie[]): boolean {
  if (cookies.length < 2) return false
  const names = cookies.map((c) => c.name.toLowerCase())
  return names.some(
    (n) =>
      n.includes('web_session') ||
      n.includes('a1') ||
      n.includes('websectiga') ||
      n.includes('acw_tc') ||
      n.includes('customer-sso-sid'),
  )
}

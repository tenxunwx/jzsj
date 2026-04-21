/**
 * 参考 AI-Scarlett/douyin-poster 的 Playwright 登录思路：
 * https://github.com/AI-Scarlett/douyin-poster
 * 打开 creator.douyin.com → 点击登录 → 提取二维码 → 轮询登录态 → 保存 Cookie（仅存服务端）
 */
import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Cookie, Page, Response } from 'playwright'
import { looksLikeDouyinAuthCookies, parseDouyinCookiePaste } from './playwrightCookieImport.js'
import { readDiskSessions, writeDiskSessions, type DiskSessionRow } from './playwrightSessionDisk.js'

const CREATOR_URL = 'https://creator.douyin.com/'

export type PlaywrightPhase = 'preparing' | 'awaiting_scan' | 'logged_in' | 'expired' | 'error'

/** 登录成功后从创作者后台页面临时读取（页面改版时需调整选择器） */
export type PlaywrightUserInfo = {
  nickname?: string
  avatarUrl?: string
  douyinId?: string
  /** 基于 Cookie 的脱敏会话标识（非完整 token，仅便于核对是否已建立会话） */
  tokenPreview?: string
  /** 与 tokenPreview 同一条 Cookie 的完整 name=value，便于本系统内复制核对 */
  tokenFullLine?: string
}

export type PlaywrightSession = {
  id: string
  phase: PlaywrightPhase
  hint: string
  qrcodeUrl?: string
  /** 无法解析图片 URL 时的整页/区域截图 */
  qrcodeDataUrl?: string
  cookieCount?: number
  user?: PlaywrightUserInfo
  error?: string
  createdAt: number
}

const store = new Map<string, PlaywrightSession>()
/** 登录成功后的 Cookie，仅服务端使用，勿下发前端 */
const cookieVault = new Map<string, Cookie[]>()

/** 默认 365 天；可用 DOUYIN_PLAYWRIGHT_SESSION_TTL_MS 覆盖（毫秒），范围 1 分钟～约 10 年 */
const DEFAULT_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000
const MIN_SESSION_TTL_MS = 60 * 1000
const MAX_SESSION_TTL_MS = 3650 * 24 * 60 * 60 * 1000

function getSessionTtlMs(): number {
  const raw = process.env.DOUYIN_PLAYWRIGHT_SESSION_TTL_MS
  if (!raw?.trim()) return DEFAULT_SESSION_TTL_MS
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n)) return DEFAULT_SESSION_TTL_MS
  return Math.min(Math.max(n, MIN_SESSION_TTL_MS), MAX_SESSION_TTL_MS)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersistSessions(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushSessionsToDisk()
  }, 2000)
}

async function flushSessionsToDisk(): Promise<void> {
  const rows: DiskSessionRow[] = []
  for (const [id, s] of store) {
    if (s.phase !== 'logged_in') continue
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
    await writeDiskSessions(rows)
  } catch (e) {
    console.error('[douyin] persist sessions failed', e)
  }
}

/** 服务启动时从 data/douyin-playwright-sessions.json 恢复已登录会话 */
export async function initPlaywrightSessionsFromDisk(): Promise<void> {
  const rows = await readDiskSessions()
  const ttl = getSessionTtlMs()
  const now = Date.now()
  let n = 0
  for (const row of rows) {
    if (now - row.createdAt > ttl) continue
    store.set(row.id, {
      id: row.id,
      phase: 'logged_in',
      hint: '已从服务端本地恢复（扫码或 Cookie 导入）',
      createdAt: row.createdAt,
      user: row.user as PlaywrightUserInfo | undefined,
      cookieCount: row.cookies.length,
    })
    cookieVault.set(row.id, row.cookies)
    n++
  }
  if (n > 0) console.log(`[douyin] restored ${n} session(s) from disk`)
}

function prune() {
  const now = Date.now()
  const ttl = getSessionTtlMs()
  let removed = false
  for (const [id, s] of store) {
    if (now - s.createdAt > ttl) {
      store.delete(id)
      cookieVault.delete(id)
      removed = true
    }
  }
  if (removed) schedulePersistSessions()
}

/** 已登录会话在每次读取 Cookie / 会话状态时顺延过期时间（滑动窗口） */
function touchLoggedInSessionTtl(id: string) {
  const cur = store.get(id)
  if (cur?.phase === 'logged_in') {
    cur.createdAt = Date.now()
    store.set(id, cur)
    schedulePersistSessions()
  }
}

export function getPlaywrightCookieVault(sessionId: string): Cookie[] | undefined {
  prune()
  const cookies = cookieVault.get(sessionId)
  if (cookies?.length) touchLoggedInSessionTtl(sessionId)
  return cookies
}

export function createPlaywrightSessionRecord(): PlaywrightSession {
  prune()
  const id = randomUUID()
  const s: PlaywrightSession = {
    id,
    phase: 'preparing',
    hint: '正在启动浏览器并打开抖音创作者中心…',
    createdAt: Date.now(),
  }
  store.set(id, s)
  return s
}

export function getPlaywrightSession(id: string): PlaywrightSession | undefined {
  prune()
  const s = store.get(id)
  if (s?.phase === 'logged_in') touchLoggedInSessionTtl(id)
  return s
}

/** 删除服务端会话与 Cookie 缓存并更新落盘文件 */
export function deletePlaywrightSession(id: string): boolean {
  const had = store.has(id) || cookieVault.has(id)
  store.delete(id)
  cookieVault.delete(id)
  schedulePersistSessions()
  return had
}

function patch(id: string, partial: Partial<PlaywrightSession>) {
  const cur = store.get(id)
  if (!cur) return
  Object.assign(cur, partial)
  store.set(id, cur)
  if (cur.phase === 'logged_in') schedulePersistSessions()
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 是否仍处于「扫码 / 登录」弹层（未扫码或未确认前应为 true）。
 * 旧逻辑用「URL 不含 login」或「任意 douyin.com Cookie 数量」会误判为已登录。
 */
async function isQrOrLoginModalOpen(page: Page): Promise<boolean> {
  const scanTitle = await page.getByText(/扫码登录/).first().isVisible().catch(() => false)
  if (scanTitle) return true
  const openDouyin = await page.getByText(/打开抖音/).first().isVisible().catch(() => false)
  if (openDouyin) return true
  /** 仅可见的二维码图才算「仍在登录层」，避免 DOM 里残留隐藏节点导致一直判为未关 */
  const qrImg = await page
    .locator('img[src*="qrcode" i]')
    .first()
    .isVisible()
    .catch(() => false)
  if (qrImg) return true
  const loginDialog = await page
    .locator('[role="dialog"]')
    .filter({ hasText: /登录|扫码/ })
    .first()
    .isVisible()
    .catch(() => false)
  return loginDialog
}

/** 进入创作者后台后的典型界面（扫码完成并确认后才会出现） */
async function isCreatorBackendVisible(page: Page): Promise<boolean> {
  const keywords =
    /数据概览|内容管理|作品管理|发布作品|创作服务平台|创作首页|数据中心|互动管理|直播管理|上传视频|发布视频|抖音号|粉丝数|累计粉丝/
  const tab = await page
    .getByText(keywords)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false)
  if (tab) return true
  try {
    const { pathname } = new URL(page.url())
    if (/^\/(creator-micro\/)?(home|data|content|publish|upload)/i.test(pathname)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 兜底：登录弹层已关，但文案改版导致 isCreatorBackendVisible 为 false 时，
 * 用创作者域 Cookie 中的强登录字段判断（避免误判：须先 !isQrOrLoginModalOpen）
 */
async function hasStrongCreatorSession(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies()
  for (const c of cookies) {
    if (!/douyin\.com|bytedance\.com/i.test(c.domain)) continue
    if (/sessionid|session_ssid|passport_auth|passport_csrf|sid_guard|sso/i.test(c.name)) {
      return true
    }
  }
  return false
}

function isLikelyUserAvatarSrc(src: string): boolean {
  const lower = src.toLowerCase()
  if (lower.includes('qrcode') || lower.includes('qr_code') || lower.includes('login')) return false
  if (lower.includes('logo') && !lower.includes('avatar')) return false
  return (
    lower.includes('douyinpic.com') ||
    lower.includes('byteimg.com') ||
    lower.includes('p3-sign') ||
    lower.includes('p26-sign') ||
    /\/aweme\/avatar\//i.test(lower)
  )
}

/**
 * 从创作者接口 / 页面内嵌 JSON 递归提取用户字段（适配 status_code + data 包裹）
 */
function extractUserFromApiJson(o: unknown, depth = 0): Partial<PlaywrightUserInfo> {
  if (depth > 28 || o === null || o === undefined) return {}
  if (Array.isArray(o)) {
    const m: Partial<PlaywrightUserInfo> = {}
    for (const item of o) {
      Object.assign(m, extractUserFromApiJson(item, depth + 1))
    }
    return m
  }
  if (typeof o !== 'object') return {}

  const out: Partial<PlaywrightUserInfo> = {}
  const obj = o as Record<string, unknown>

  if (typeof obj.nickname === 'string' && obj.nickname.length >= 1 && obj.nickname.length < 80) {
    if (!/^\d{8,}$/.test(obj.nickname)) out.nickname = obj.nickname
  }
  if (typeof obj.screen_name === 'string' && obj.screen_name.length >= 1 && obj.screen_name.length < 80) {
    out.nickname = out.nickname ?? obj.screen_name
  }
  if (typeof obj.display_name === 'string' && obj.display_name.length >= 1 && obj.display_name.length < 80) {
    out.nickname = out.nickname ?? obj.display_name
  }

  const pickAvatarUrl = (x: unknown): string | undefined => {
    if (typeof x === 'string' && x.startsWith('http') && isLikelyUserAvatarSrc(x)) return x
    if (x && typeof x === 'object') {
      const u = x as { url_list?: string[]; uri?: string }
      const first = u.url_list?.[0]
      if (typeof first === 'string' && isLikelyUserAvatarSrc(first)) return first
    }
    return undefined
  }

  for (const key of ['avatar_300x300', 'avatar_thumb', 'avatar_medium', 'avatar_larger', 'user_avatar', 'avatar']) {
    const a = obj[key]
    const url = pickAvatarUrl(a)
    if (url) {
      out.avatarUrl = url
      break
    }
  }
  if (typeof obj.avatar_url === 'string' && isLikelyUserAvatarSrc(obj.avatar_url)) {
    out.avatarUrl = out.avatarUrl ?? obj.avatar_url
  }

  for (const uk of ['unique_id', 'short_id', 'user_id', 'uid', 'douyin_id']) {
    const v = obj[uk]
    if (v === null || v === undefined) continue
    const s = String(v).replace(/\D/g, '')
    if (s.length >= 5 && s.length <= 20) {
      out.douyinId = s
      break
    }
  }

  const nestedKeys = ['user', 'user_info', 'userInfo', 'profile', 'data', 'owner', 'author']
  for (const nk of nestedKeys) {
    const v = obj[nk]
    if (v !== null && typeof v === 'object') {
      Object.assign(out, extractUserFromApiJson(v, depth + 1))
    }
  }

  return out
}

async function collectNetworkUserHintsDuring(
  page: Page,
  action: () => Promise<void>,
): Promise<Partial<PlaywrightUserInfo>> {
  const merged: Partial<PlaywrightUserInfo> = {}
  const onResponse = async (response: Response) => {
    try {
      const url = response.url()
      if (!/douyin\.com|snssdk\.com|bytedance\.com|amemv\.com/i.test(url)) return
      const ct = response.headers()['content-type'] ?? ''
      if (!ct.includes('json')) return
      if (response.status() !== 200) return
      const json = (await response.json()) as unknown
      const part = extractUserFromApiJson(json)
      if (part.nickname) merged.nickname = part.nickname
      if (part.avatarUrl) merged.avatarUrl = part.avatarUrl
      if (part.douyinId) merged.douyinId = part.douyinId
    } catch {
      /* 非 JSON */
    }
  }
  page.on('response', onResponse)
  try {
    await action()
    await delay(1400)
  } finally {
    page.off('response', onResponse)
  }
  return merged
}

async function tryFetchUserApis(page: Page): Promise<Partial<PlaywrightUserInfo>> {
  const urls = [
    'https://creator.douyin.com/web/api/media/user/info/',
    'https://creator.douyin.com/aweme/v1/creator/user/info/',
    'https://creator.douyin.com/passport/account/info/v2/',
  ]
  const merged: Partial<PlaywrightUserInfo> = {}
  for (const url of urls) {
    try {
      const res = await page.request.get(url, { timeout: 15000 })
      if (!res.ok()) continue
      const ct = res.headers()['content-type'] ?? ''
      if (!ct.includes('json')) continue
      const json = (await res.json()) as unknown
      Object.assign(merged, extractUserFromApiJson(json))
      if (merged.nickname && merged.avatarUrl) break
    } catch {
      /* */
    }
  }
  return merged
}

/** 从 Cookie 生成脱敏展示串（不把完整密钥下发给前端） */
function buildTokenPreviewFromCookies(cookies: Cookie[]): string | undefined {
  const prefer = [/sessionid/i, /session_ssid/i, /sid_tt/i, /msToken/i, /passport_csrf_token/i]
  for (const re of prefer) {
    const c = cookies.find((x) => re.test(x.name) && /douyin|bytedance|\.com/i.test(x.domain))
    if (!c?.value || c.value.length < 4) continue
    const v = c.value
    const masked = v.length <= 16 ? `${v.slice(0, 3)}…` : `${v.slice(0, 4)}…${v.slice(-4)}`
    return `${c.name}=${masked}`
  }
  return undefined
}

/** 同一生成规则下的完整 Cookie 行，供前端完整展示与复制 */
function buildTokenFullLineFromCookies(cookies: Cookie[]): string | undefined {
  const prefer = [/sessionid/i, /session_ssid/i, /sid_tt/i, /msToken/i, /passport_csrf_token/i]
  for (const re of prefer) {
    const c = cookies.find((x) => re.test(x.name) && /douyin|bytedance|\.com/i.test(x.domain))
    if (!c?.value) continue
    return `${c.name}=${c.value}`
  }
  return undefined
}

function buildCookieHeaderForHost(cookies: Cookie[], host: string): string {
  const hostLower = host.toLowerCase()
  const parts: string[] = []
  for (const c of cookies) {
    const raw = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
    const d = raw.toLowerCase()
    if (hostLower === d || hostLower.endsWith(`.${d}`)) parts.push(`${c.name}=${c.value}`)
  }
  return parts.join('; ')
}

/** 无浏览器时用 fetch 拉创作者接口，拼头像昵称等（与扫码成功路径一致） */
async function fetchUserHintsWithCookieArray(cookies: Cookie[]): Promise<PlaywrightUserInfo> {
  const merged: PlaywrightUserInfo = {}
  const urls = [
    'https://creator.douyin.com/web/api/media/user/info/',
    'https://creator.douyin.com/aweme/v1/creator/user/info/',
    'https://creator.douyin.com/passport/account/info/v2/',
  ]
  for (const url of urls) {
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      continue
    }
    const ch = buildCookieHeaderForHost(cookies, host)
    if (!ch) continue
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: ch,
          Referer: 'https://creator.douyin.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) continue
      const json = (await res.json()) as unknown
      const part = extractUserFromApiJson(json)
      if (part.nickname) merged.nickname = part.nickname
      if (part.avatarUrl) merged.avatarUrl = part.avatarUrl
      if (part.douyinId) merged.douyinId = part.douyinId
      if (merged.nickname && merged.avatarUrl) break
    } catch {
      /* */
    }
  }
  merged.tokenPreview = buildTokenPreviewFromCookies(cookies)
  merged.tokenFullLine = buildTokenFullLineFromCookies(cookies)
  return merged
}

/**
 * 从浏览器复制的 Cookie / Token 文本创建已登录会话（落盘，重启不丢）。
 * 建议在创作者中心域名下导出 Cookie，需含 sessionid 等登录字段。
 */
export async function importPlaywrightSessionFromTokens(
  raw: string,
): Promise<{ ok: true; sessionId: string; user: PlaywrightUserInfo | null } | { ok: false; error: string }> {
  prune()
  const cookies = parseDouyinCookiePaste(raw)
  if (cookies.length < 1) {
    return {
      ok: false,
      error: '未能解析出 Cookie。支持：多行 name=value、分号分隔、或 JSON 数组 [{name,value,domain?}]',
    }
  }
  if (!looksLikeDouyinAuthCookies(cookies)) {
    return {
      ok: false,
      error:
        '未识别到常见抖音登录 Cookie（如 sessionid、sid_tt、passport 等）。请在 Chrome 开发者工具 → Application → Cookies 下对 creator.douyin.com / .douyin.com 复制。',
    }
  }
  const id = randomUUID()
  const user = await fetchUserHintsWithCookieArray(cookies)
  cookieVault.set(id, cookies)
  store.set(id, {
    id,
    phase: 'logged_in',
    hint: '已通过 Cookie / Token 导入（已写入服务端本地，重启后自动恢复）',
    createdAt: Date.now(),
    user,
    cookieCount: cookies.length,
  })
  schedulePersistSessions()
  const hasProfile = Boolean(user.nickname?.trim() || user.douyinId?.trim() || user.avatarUrl?.trim())
  if (hasProfile) return { ok: true, sessionId: id, user }
  if (user.tokenPreview || user.tokenFullLine) return { ok: true, sessionId: id, user: { tokenPreview: user.tokenPreview, tokenFullLine: user.tokenFullLine } }
  return { ok: true, sessionId: id, user: null }
}

/** 解析 __NEXT_DATA__ / 内嵌 JSON 中的用户信息（抖音创作者多为 Next.js） */
async function scrapeFromEmbeddedJson(page: Page): Promise<Partial<PlaywrightUserInfo>> {
  return page.evaluate(() => {
    function dig(obj: unknown, depth: number): { n?: string; a?: string; u?: string } {
      if (depth > 18 || obj === null || typeof obj !== 'object') return {}
      const acc: { n?: string; a?: string; u?: string } = {}
      const o = obj as Record<string, unknown>
      for (const k of Object.keys(o)) {
        const v = o[k]
        const kl = k.toLowerCase()
        if (typeof v === 'string') {
          if (
            (kl.includes('nickname') || kl === 'nick_name' || kl === 'screen_name' || kl === 'user_name') &&
            v.length > 0 &&
            v.length < 80 &&
            !/^[\d\s]+$/.test(v)
          ) {
            if (!v.includes('登录') && !v.includes('扫码')) acc.n = v
          }
          if (
            /^https?:\/\//.test(v) &&
            (kl.includes('avatar') || kl.includes('avatarurl') || (kl.includes('url') && kl.includes('user'))) &&
            !/qr|login|logo|qrcode/i.test(v)
          ) {
            acc.a = v
          }
        }
        if (
          (kl === 'uid' || kl === 'user_id' || kl === 'user_unique_id' || kl === 'short_id') &&
          v !== null &&
          v !== undefined
        ) {
          const s = String(v).replace(/\D/g, '')
          if (s.length >= 5) acc.u = s
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            const sub = dig(item, depth + 1)
            if (!acc.n && sub.n) acc.n = sub.n
            if (!acc.a && sub.a) acc.a = sub.a
            if (!acc.u && sub.u) acc.u = sub.u
          }
        } else if (typeof v === 'object' && v !== null) {
          const sub = dig(v, depth + 1)
          if (!acc.n && sub.n) acc.n = sub.n
          if (!acc.a && sub.a) acc.a = sub.a
          if (!acc.u && sub.u) acc.u = sub.u
        }
      }
      return acc
    }

    const out: Partial<PlaywrightUserInfo> = {}
    const next = (globalThis as unknown as { document: { getElementById(id: string): { textContent: string | null } | null } }).document.getElementById(
      '__NEXT_DATA__',
    )
    if (next?.textContent) {
      try {
        const data = JSON.parse(next.textContent) as unknown
        const r = dig(data, 0)
        if (r.n) out.nickname = r.n
        if (r.a) out.avatarUrl = r.a
        if (r.u) out.douyinId = r.u
      } catch {
        /* ignore */
      }
    }
    return out
  })
}

/** 登录后进后台，抓取侧栏/顶栏与内嵌数据；失败不影响登录成功状态 */
async function scrapeCreatorUserProfile(
  page: Page,
  cookies: Cookie[],
  preMerged?: Partial<PlaywrightUserInfo>,
): Promise<PlaywrightUserInfo> {
  try {
    await delay(600)
    const out: PlaywrightUserInfo = { ...preMerged }

    const embedded = await scrapeFromEmbeddedJson(page)
    if (!out.nickname && embedded.nickname) out.nickname = embedded.nickname
    if (!out.avatarUrl && embedded.avatarUrl) out.avatarUrl = embedded.avatarUrl
    if (!out.douyinId && embedded.douyinId) out.douyinId = embedded.douyinId

    try {
      const headerUser = page.locator('header').locator('[class*="avatar" i], [class*="user" i]').first()
      if (await headerUser.isVisible({ timeout: 2000 }).catch(() => false)) {
        await headerUser.click({ timeout: 2000 }).catch(() => {})
        await delay(500)
        const pop = page.locator('[class*="popover" i], [class*="dropdown" i], [role="menu"]').first()
        const nickInMenu = await pop.locator('span, div').filter({ hasNotText: /设置|退出|管理/ }).first().textContent({ timeout: 1500 }).catch(() => null)
        const s = nickInMenu?.trim()
        if (s && s.length >= 2 && s.length < 50 && !out.nickname) out.nickname = s
      }
    } catch {
      /* ignore */
    }

    if (!out.nickname) {
      const nickLocators = [
        page.locator('[class*="nickname" i]').first(),
        page.locator('[class*="userName" i]').first(),
        page.locator('[class*="user-name" i]').first(),
        page.locator('aside').locator('[class*="name" i]').first(),
        page.getByRole('navigation').locator('span').first(),
      ]
      for (const loc of nickLocators) {
        const t = await loc.textContent({ timeout: 1000 }).catch(() => null)
        const s = t?.trim()
        if (s && s.length >= 2 && s.length <= 80 && !/数据概览|内容管理/.test(s)) {
          out.nickname = s
          break
        }
      }
    }

    if (!out.avatarUrl) {
      const imgs = page.locator('img[src*="http"]')
      const n = await imgs.count()
      for (let i = 0; i < Math.min(n, 40); i++) {
        const src = await imgs.nth(i).getAttribute('src').catch(() => null)
        if (!src || src.startsWith('data:')) continue
        if (!isLikelyUserAvatarSrc(src)) continue
        try {
          out.avatarUrl = src.startsWith('http') ? src : new URL(src, page.url()).href
          break
        } catch {
          out.avatarUrl = src
          break
        }
      }
    }

    try {
      const { pathname } = new URL(page.url())
      const m = pathname.match(/\/(?:user\/)?(\d{5,})/)
      if (m && !out.douyinId) out.douyinId = m[1]
    } catch {
      /* ignore */
    }

    out.tokenPreview = buildTokenPreviewFromCookies(cookies)
    out.tokenFullLine = buildTokenFullLineFromCookies(cookies)

    return out
  } catch {
    return {
      ...preMerged,
      tokenPreview: buildTokenPreviewFromCookies(cookies),
      tokenFullLine: buildTokenFullLineFromCookies(cookies),
    }
  }
}

async function tryExtractQrUrl(page: Page): Promise<string | undefined> {
  const imgs = page.locator('img')
  const n = await imgs.count()
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i)
    const src = await img.getAttribute('src').catch(() => null)
    if (!src) continue
    const lower = src.toLowerCase()
    if (lower.includes('qrcode') || lower.includes('qr') || lower.includes('login')) {
      try {
        return src.startsWith('http') ? src : new URL(src, page.url()).href
      } catch {
        return src
      }
    }
  }
  const html = await page.content().catch(() => '')
  const m = html.match(/https?:\/\/[^\s"'<>]+(?:qrcode|qr)[^\s"'<>]*/i)
  return m?.[0]
}

/**
 * 在登录弹层内截取二维码图片。前端不能直接用 img[src] 外链（防盗链/Cookie），必须用 data URL。
 */
async function captureQrForDisplay(page: Page): Promise<string | undefined> {
  const shells = [
    page.locator('[role="dialog"]').first(),
    page.locator('.semi-modal').first(),
    page.locator('[class*="modal" i]').filter({ hasText: /扫码|登录|抖音/ }).first(),
  ]
  for (const shell of shells) {
    if (!(await shell.isVisible().catch(() => false))) continue
    const imgs = shell.locator('img')
    const count = await imgs.count()
    for (let i = 0; i < count; i++) {
      const img = imgs.nth(i)
      if (!(await img.isVisible().catch(() => false))) continue
      try {
        const buf = await img.screenshot({ type: 'png' })
        return `data:image/png;base64,${buf.toString('base64')}`
      } catch {
        /* 下一张 */
      }
    }
    const canvas = shell.locator('canvas').first()
    if (await canvas.isVisible().catch(() => false)) {
      try {
        const buf = await canvas.screenshot({ type: 'png' })
        return `data:image/png;base64,${buf.toString('base64')}`
      } catch {
        /* */
      }
    }
    try {
      const buf = await shell.screenshot({ type: 'png' })
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      /* */
    }
  }
  return undefined
}

/** 使用与页面相同的 Cookie 拉取图片，转为 data URL（供前端 img 使用） */
async function fetchImageUrlAsDataUrl(page: Page, href: string): Promise<string | undefined> {
  if (!href || href.startsWith('blob:') || href.startsWith('data:')) {
    return undefined
  }
  try {
    const abs = href.startsWith('http') ? href : new URL(href, page.url()).href
    const res = await page.request.get(abs)
    if (!res.ok()) return undefined
    const buf = await res.body()
    if (buf.length === 0) return undefined
    const rawCt = res.headers()['content-type']
    const ct =
      typeof rawCt === 'string'
        ? rawCt.split(';')[0]?.trim() ?? 'image/png'
        : 'image/png'
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) {
      return undefined
    }
    const mime = ct.includes('octet-stream') ? 'image/png' : ct
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

async function tryScreenshotQr(page: Page): Promise<string | undefined> {
  const candidates = [
    page.locator('[class*="qrcode" i], [class*="qr-code" i]').first(),
    page.locator('img[src*="qr" i], img[src*="login" i]').first(),
    page.locator('canvas').first(),
  ]
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        const buf = await loc.screenshot({ type: 'png' })
        return `data:image/png;base64,${buf.toString('base64')}`
      }
    } catch {
      /* next */
    }
  }
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: true })
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

async function cleanup(browser: Browser | undefined) {
  try {
    await browser?.close()
  } catch {
    /* ignore */
  }
}

/**
 * 后台执行：与 douyin-poster 中 login_headless / gen_qr_login 流程一致。
 */
export function runPlaywrightLoginJob(sessionId: string): void {
  void (async () => {
    let browser: Browser | undefined
    try {
      const { chromium } = await import('playwright')
      const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== 'false'

      browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      })

      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
      })
      const page = await context.newPage()

      await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await delay(5000)

      try {
        const loginBtn = page.locator('button:has-text("登录"), a:has-text("登录")').first()
        await loginBtn.click({ timeout: 8000 })
      } catch {
        try {
          await page.locator('[class*="login" i]').first().click({ timeout: 3000 })
        } catch {
          /* 可能已弹出登录层 */
        }
      }
      await delay(3000)

      const qrcodeUrl = await tryExtractQrUrl(page)
      /** 外链在浏览器里常因防盗链失败，必须用截图或带 Cookie 拉取 */
      let qrcodeDataUrl =
        (await captureQrForDisplay(page)) ??
        (qrcodeUrl ? await fetchImageUrlAsDataUrl(page, qrcodeUrl) : undefined) ??
        (await tryScreenshotQr(page))

      if (!qrcodeUrl && !qrcodeDataUrl) {
        patch(sessionId, {
          phase: 'error',
          hint: '',
          error: '未找到二维码（页面结构可能已变更）。可尝试设置 DOUYIN_PLAYWRIGHT_HEADLESS=false 使用有头模式。',
        })
        await cleanup(browser)
        return
      }

      patch(sessionId, {
        phase: 'awaiting_scan',
        hint: '请使用抖音 App 扫码登录创作者平台',
        qrcodeUrl,
        qrcodeDataUrl,
      })

      /** 扫码后轮询：先检测再间隔，避免每轮开头固定多等 2s；总等待约 90s */
      const loginPollMs = 850
      const maxTicks = 106
      for (let i = 0; i < maxTicks; i++) {
        await page.waitForLoadState('domcontentloaded').catch(() => {})

        const loginUiOpen = await isQrOrLoginModalOpen(page)
        if (loginUiOpen) {
          await delay(loginPollMs)
          continue
        }

        const onCreator = page.url().includes('creator.douyin.com')
        const backendVisible = onCreator && (await isCreatorBackendVisible(page))
        const cookieOk = onCreator && (await hasStrongCreatorSession(context))
        if (!backendVisible && !cookieOk) {
          await delay(loginPollMs)
          continue
        }

        let cookies = await context.cookies()
        if (!store.get(sessionId)) {
          await context.close().catch(() => {})
          await cleanup(browser)
          return
        }
        const netHints = await collectNetworkUserHintsDuring(page, async () => {
          try {
            await page.goto('https://creator.douyin.com/creator-micro/home', {
              waitUntil: 'domcontentloaded',
              timeout: 25000,
            })
            await delay(320)
          } catch {
            /* 路径因账号而异，留在当前页继续抓取 */
          }
        })
        cookies = await context.cookies()
        const apiHints = await tryFetchUserApis(page)
        const user = await scrapeCreatorUserProfile(page, cookies, { ...netHints, ...apiHints })
        if (!store.get(sessionId)) {
          await context.close().catch(() => {})
          await cleanup(browser)
          return
        }
        cookieVault.set(sessionId, cookies)
        patch(sessionId, {
          phase: 'logged_in',
          hint: '登录成功（会话已保存在服务端，可用于后续矩阵接口）',
          cookieCount: cookies.length,
          user,
          qrcodeUrl: undefined,
          qrcodeDataUrl: undefined,
        })
        await context.close().catch(() => {})
        await cleanup(browser)
        return
      }

      patch(sessionId, {
        phase: 'expired',
        hint: '等待扫码超时，请重试',
      })
      await context.close().catch(() => {})
      await cleanup(browser)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const hint =
        msg.includes('Executable doesn') || msg.includes('browserType.launch')
          ? '未检测到 Chromium，请在 backend 目录执行：npx playwright install chromium'
          : msg
      patch(sessionId, {
        phase: 'error',
        hint: '',
        error: hint,
      })
      await cleanup(browser)
    }
  })()
}

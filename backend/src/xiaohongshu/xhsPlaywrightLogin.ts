/**
 * 小红书网页扫码登录（Playwright），思路对齐 clawra-xiaohongshu / npm run login。
 * 页面改版时需调整选择器；可设 XHS_PLAYWRIGHT_HEADLESS=false 调试。
 */
import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Cookie, Locator, Page } from 'playwright'
import { hasConfirmedXhsProfile, tryFetchXhsUserInfo } from './xhsFetch.js'
import {
  deletePersistedXhsSession,
  getXhsSession,
  putXhsLoggedInSession,
  type XhsUserInfo,
} from './xhsStore.js'

const XHS_EXPLORE = 'https://www.xiaohongshu.com/explore'

export type XhsPwPhase = 'preparing' | 'awaiting_scan' | 'logged_in' | 'expired' | 'error'

export type XhsPlaywrightSession = {
  id: string
  phase: XhsPwPhase
  hint: string
  qrcodeUrl?: string
  qrcodeDataUrl?: string
  error?: string
  createdAt: number
}

const pwStore = new Map<string, XhsPlaywrightSession>()

const PW_TTL_MS = 15 * 60 * 1000

function prunePw() {
  const now = Date.now()
  for (const [id, s] of pwStore) {
    if (now - s.createdAt > PW_TTL_MS && s.phase !== 'logged_in') {
      pwStore.delete(id)
    }
  }
}

function patch(id: string, partial: Partial<XhsPlaywrightSession>) {
  const cur = pwStore.get(id)
  if (!cur) return
  Object.assign(cur, partial)
  pwStore.set(id, cur)
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function cleanup(browser: Browser | undefined) {
  try {
    await browser?.close()
  } catch {
    /* */
  }
}

function hasWebSession(cookies: Cookie[]): boolean {
  return cookies.some((c) => c.name === 'web_session' && (c.value?.length ?? 0) > 8)
}

/**
 * 登录弹层仍在且呈现扫码相关 UI 时，不应判定为扫码完成（避免仅有游客 web_session + 接口噪声即落库）
 */
async function isLikelyAwaitingQrScan(page: Page): Promise<boolean> {
  const dialog = page.locator('[role="dialog"]').first()
  const visible = await dialog.isVisible().catch(() => false)
  if (!visible) return false
  const scanCopy = await dialog.getByText(/扫码|二维码|请使用小红书/).first().isVisible().catch(() => false)
  const canvas = await dialog.locator('canvas').first().isVisible().catch(() => false)
  return scanCopy || canvas
}

function toDataUrlPng(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`
}

/**
 * 只截二维码区域，避免整页/整弹窗图里码太小无法扫。
 * 顺序：同域 data: src → 元素截图 → 视口内裁剪最大二维码图 → 最后才截较小弹窗子区域。
 */
async function captureQrForDisplay(page: Page): Promise<string | undefined> {
  try {
    await page.getByText(/扫码登录/).first().click({ timeout: 6000 }).catch(() => {})
    await delay(1200)

    const dialog = page.locator('[role="dialog"]').first()

    const tryImgSrcFromPage = async (): Promise<string | undefined> => {
      const src = await page
        .evaluate(() => {
          const root =
            document.querySelector('[role="dialog"]') ??
            document.querySelector('[class*="login" i]') ??
            document.body
          const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[]
          for (const img of imgs) {
            const s = img.getAttribute('src') ?? ''
            if (s.startsWith('data:image') && s.length > 200) return s
          }
          return ''
        })
        .catch(() => '')
      return src || undefined
    }

    const tryScreenshotLocator = async (loc: Locator): Promise<Buffer | undefined> => {
      if (!(await loc.isVisible({ timeout: 2500 }).catch(() => false))) return undefined
      await loc.scrollIntoViewIfNeeded().catch(() => {})
      await delay(150)
      const buf = await loc.screenshot({ type: 'png' }).catch(() => undefined)
      if (buf && buf.length > 400) return buf
      return undefined
    }

    // 1) 常见二维码节点（canvas / 明确含 qr 的 img；不要用 src*="code" 会误匹配大量 CDN 链接）
    const qrCandidates = [
      dialog.locator('canvas').first(),
      page.locator('[role="dialog"] canvas').first(),
      dialog.locator('img[src*="qrcode" i], img[src*="qr/"], img[src*="/qr"]').first(),
      page.locator('img[alt*="二维码" i], img[alt*="扫码" i]').first(),
      page.locator('[class*="qrcode" i], [class*="qr-code" i], [class*="QRCode" i]').first(),
    ]
    for (const loc of qrCandidates) {
      const buf = await tryScreenshotLocator(loc)
      if (buf) return toDataUrlPng(buf)
    }

    // 2) data: 内联图（放在 canvas 之后，避免误把装饰图当码）
    const inline = await tryImgSrcFromPage()
    if (inline?.startsWith('data:image')) return inline

    // 3) 在弹窗内找二维码：排除品牌 Logo（大图、URL 含 logo 且无 qr 线索）
    const clip = await page
      .evaluate(() => {
        const d = document.querySelector('[role="dialog"]')
        if (!d) return null
        const nodes: Element[] = [
          ...Array.from(d.querySelectorAll('img')),
          ...Array.from(d.querySelectorAll('canvas')),
        ]
        let best: { x: number; y: number; width: number; height: number } | null = null
        let bestScore = 0
        for (const el of nodes) {
          const r = el.getBoundingClientRect()
          if (r.width < 72 || r.height < 72) continue
          if (r.bottom < 0 || r.top > window.innerHeight) continue
          const isCanvas = el instanceof HTMLCanvasElement
          const src = el instanceof HTMLImageElement ? el.src : ''
          const alt = el.getAttribute('alt') || ''
          const cls =
            el instanceof HTMLElement && typeof el.className === 'string' ? el.className : ''
          const qrHint = /qr|qrcode|二维码|扫码|barcode/i.test(`${src}${cls}${alt}`)
          const logoGuess =
            /logo|brand|favicon|watermark|\/icon|头像|小红书logo/i.test(`${src}${alt}${cls}`) &&
            !/qr|qrcode/i.test(`${src}${cls}`)
          if (!isCanvas && logoGuess) continue
          if (!isCanvas && !qrHint) {
            const maxSide = Math.max(r.width, r.height)
            if (maxSide > 420) continue
          }
          const a = r.width * r.height
          const ar = r.width / Math.max(r.height, 1)
          const squareish = ar > 0.75 && ar < 1.35
          if (!isCanvas && !qrHint && !squareish) continue
          let score = squareish ? a * 1.15 : a * 0.85
          if (qrHint) score *= 2.2
          if (isCanvas) score *= 1.35
          if (score > bestScore) {
            bestScore = score
            best = { x: r.x, y: r.y, width: r.width, height: r.height }
          }
        }
        if (!best) return null
        const pad = 12
        const x = Math.max(0, Math.floor(best.x - pad))
        const y = Math.max(0, Math.floor(best.y - pad))
        const w = Math.min(Math.ceil(best.width + pad * 2), window.innerWidth - x)
        const h = Math.min(Math.ceil(best.height + pad * 2), window.innerHeight - y)
        if (w < 80 || h < 80) return null
        return { x, y, width: w, height: h }
      })
      .catch(() => null)

    if (clip) {
      const buf = await page.screenshot({ type: 'png', clip })
      if (buf.length > 800) return toDataUrlPng(buf)
    }

    // 4) 最后兜底：整弹窗（码可能仍偏小，优先依赖上方裁剪）
    const modal = page
      .locator('[role="dialog"], [class*="login" i], [class*="Login" i], [class*="modal" i]')
      .first()
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const buf = await modal.screenshot({ type: 'png' })
      if (buf.length > 500) return toDataUrlPng(buf)
    }

    return undefined
  } catch {
    return undefined
  }
}

/**
 * 合并：已落库的小红书会话优先；否则返回扫码中的临时会话。
 */
export function getXhsPlaywrightSessionForApi(id: string):
  | {
      phase: XhsPwPhase
      loggedIn: boolean
      hint: string
      qrcodeUrl?: string
      qrcodeDataUrl?: string
      user?: XhsUserInfo | null
      cookieCount?: number
      error?: string
    }
  | undefined {
  prunePw()
  const persisted = getXhsSession(id)
  if (persisted) {
    return {
      phase: 'logged_in',
      loggedIn: true,
      hint: persisted.hint,
      user: persisted.user ?? null,
      cookieCount: persisted.cookieCount,
    }
  }
  const p = pwStore.get(id)
  if (!p) return undefined
  return {
    phase: p.phase,
    loggedIn: p.phase === 'logged_in',
    hint: p.hint,
    qrcodeUrl: p.qrcodeUrl,
    qrcodeDataUrl: p.qrcodeDataUrl,
    error: p.error,
  }
}

/** 结束扫码中的临时状态并删除已落库会话（供 DELETE API） */
export function removeXhsSessionEverywhere(id: string): boolean {
  prunePw()
  const hadPw = pwStore.has(id)
  pwStore.delete(id)
  return deletePersistedXhsSession(id) || hadPw
}

export function createXhsPlaywrightSessionRecord(): XhsPlaywrightSession {
  prunePw()
  const id = randomUUID()
  const s: XhsPlaywrightSession = {
    id,
    phase: 'preparing',
    hint: '正在启动浏览器并打开小红书…',
    createdAt: Date.now(),
  }
  pwStore.set(id, s)
  return s
}

export function runXhsPlaywrightLoginJob(sessionId: string): void {
  void (async () => {
    let browser: Browser | undefined
    try {
      const { chromium } = await import('playwright')
      const headless = process.env.XHS_PLAYWRIGHT_HEADLESS !== 'false'

      browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      })

      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        locale: 'zh-CN',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })
      const page = await context.newPage()

      await page.goto(XHS_EXPLORE, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await delay(3500)

      const loginEntry = page
        .getByRole('button', { name: /登录/ })
        .or(page.locator('a:has-text("登录")'))
        .first()
      await loginEntry.click({ timeout: 12_000 }).catch(() => {})

      await delay(2500)

      const qrcodeDataUrl = await captureQrForDisplay(page)
      if (!qrcodeDataUrl) {
        patch(sessionId, {
          phase: 'error',
          hint: '',
          error: '未找到登录二维码。可尝试设置环境变量 XHS_PLAYWRIGHT_HEADLESS=false 使用有头模式。',
        })
        await context.close().catch(() => {})
        await cleanup(browser)
        return
      }

      patch(sessionId, {
        phase: 'awaiting_scan',
        hint: '请使用小红书 App 扫码登录',
        qrcodeDataUrl,
      })

      const loginPollMs = 1000
      const maxTicks = 120
      for (let i = 0; i < maxTicks; i++) {
        await delay(loginPollMs)
        await page.waitForLoadState('domcontentloaded').catch(() => {})
        const cookies = await context.cookies()
        if (hasWebSession(cookies)) {
          const awaitingQr = await isLikelyAwaitingQrScan(page)
          const user = await tryFetchXhsUserInfo(cookies)
          /** 弹层仍显示扫码时绝不落库；资料须通过严格校验，避免误解析 JSON 中的无关 user_id */
          if (!awaitingQr && hasConfirmedXhsProfile(user)) {
            putXhsLoggedInSession(sessionId, cookies, user ?? undefined)
            pwStore.delete(sessionId)
            await context.close().catch(() => {})
            await cleanup(browser)
            return
          }
        }
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
        msg.includes('Executable') || msg.includes('browserType.launch')
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

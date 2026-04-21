/**
 * 抖音网页端好友 / 私信：依赖 Playwright + 已保存 Cookie，页面改版时需调整选择器。
 * 好友列表：DOM 链接 + __NEXT_DATA__ + 网络 JSON（关系/im 等接口）多路合并。
 */
import type { Browser, Frame, Locator, Page, Response } from 'playwright'
import { getPlaywrightCookieVault } from './playwrightLogin.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type ChatPeer = {
  /** 用于发消息的标识，一般为 sec_user_id 或 user 路径段 */
  id: string
  label: string
}

/** 同一用户保留权重最高的来源（DOM / 社交接口 / 泛 aweme） */
type PeerEntry = { peer: ChatPeer; weight: number }

function recordPeer(map: Map<string, PeerEntry>, id: string, label: string, weight: number) {
  const trimmed = label.replace(/\s+/g, ' ').trim().slice(0, 64)
  if (!trimmed || id.length < 4) return
  const prev = map.get(id)
  if (!prev || weight > prev.weight) map.set(id, { peer: { id, label: trimmed }, weight })
}

/** 根据请求 URL 给「从 JSON 里扫到的用户」一个权重，优先采用明显社交类接口 */
function networkWeightForUrl(url: string): number {
  if (/\/friend|m_friend|mutual|relation|follow_list|following|follower|\/im\/|message|conversation|stranger|contact|social|chat_list|cfriend/i.test(url))
    return 22
  if (/\/user\/(profile|detail)|passport|\/aweme\/v1\/web\/user\//i.test(url)) return 14
  if (/\/aweme\/v1\/web\//i.test(url)) return 5
  return 2
}

/** 递归扫描接口 JSON，提取 sec_user_id + 昵称（抖音字段名多变） */
function extractPeersFromApiJson(
  o: unknown,
  acc: Map<string, PeerEntry>,
  weight: number,
  depth = 0,
): void {
  if (depth > 26 || o === null || o === undefined) return
  if (Array.isArray(o)) {
    for (const item of o) extractPeersFromApiJson(item, acc, weight, depth + 1)
    return
  }
  if (typeof o !== 'object') return
  const obj = o as Record<string, unknown>

  const secRaw = obj.sec_user_id ?? obj.sec_uid ?? obj.secUid
  const sec = typeof secRaw === 'string' && secRaw.length >= 8 ? secRaw : undefined
  const nickRaw =
    obj.nickname ?? obj.nick_name ?? obj.nickName ?? obj.display_name ?? obj.displayName ?? obj.name
  const nick = typeof nickRaw === 'string' ? nickRaw : undefined

  if (sec && nick && nick.length >= 1 && nick.length < 80) {
    /** 弱社交信号：减少把首页随机作者当成「好友」 */
    const rel =
      obj.follow_status ??
      obj.followStatus ??
      obj.follow_relation ??
      obj.relation_type ??
      obj.is_friend ??
      obj.isFriend ??
      obj.muf_relation ??
      obj.card_type
    const strongRel = rel !== null && rel !== undefined && String(rel).length > 0
    const w = strongRel ? weight + 6 : weight
    recordPeer(acc, sec, nick, w)
  }

  const uniq = obj.unique_id ?? obj.uniqueId
  if (typeof uniq === 'string' && /^[\w.]+$/.test(uniq) && uniq.length >= 2 && nick) {
    recordPeer(acc, uniq, nick, Math.max(1, weight - 4))
  }

  for (const k of Object.keys(obj)) {
    if (k === 'log_pb' || k === 'logPassback') continue
    extractPeersFromApiJson(obj[k], acc, weight, depth + 1)
  }
}

function attachPeerNetworkCollector(page: Page, acc: Map<string, PeerEntry>): () => void {
  const onResponse = async (response: Response) => {
    try {
      const url = response.url()
      if (!/(douyin\.com|snssdk\.com|bytedance\.com|amemv\.com|ixigua\.com)/i.test(url)) return
      const ct = response.headers()['content-type'] ?? ''
      if (!ct.includes('json') || response.status() !== 200) return
      const w = networkWeightForUrl(url)
      if (w <= 2) return
      const json = (await response.json()) as unknown
      extractPeersFromApiJson(json, acc, w, 0)
    } catch {
      /* 非 JSON 或解析失败 */
    }
  }
  page.on('response', onResponse)
  return () => page.off('response', onResponse)
}

async function scrollPageGradually(page: Page, rounds: number) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 900).catch(() => {})
    await delay(650)
  }
}

async function cleanup(browser: Browser | undefined) {
  try {
    await browser?.close()
  } catch {
    /* */
  }
}

function extractPeersFromPage(page: Page): Promise<ChatPeer[]> {
  /** 在浏览器上下文执行，避免 Node 侧引入 DOM lib */
  return page.evaluate(`(() => {
    const out = []
    const seen = new Set()
    const anchors = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="sec_user"]'))
    for (const a of anchors) {
      try {
        const u = new URL(a.href, window.location.origin)
        let id = null
        const pm = u.pathname.match(new RegExp('/user/([^/?#]+)'))
        if (pm && pm[1]) id = decodeURIComponent(pm[1])
        if (!id) {
          const sm = u.searchParams.get('sec_user_id') || u.searchParams.get('sec_uid')
          if (sm) id = decodeURIComponent(sm)
        }
        if (!id || seen.has(id) || id === 'self') continue
        const label = (a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || id)
          .replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 64)
        if (!label) continue
        seen.add(id)
        out.push({ id, label })
      } catch {
        /* */
      }
    }
    return out.slice(0, 120)
  })()`) as Promise<ChatPeer[]>
}

function extractPeersFromNextData(page: Page): Promise<ChatPeer[]> {
  return page.evaluate(`(() => {
    const out = []
    const seen = new Set()
    const el = document.getElementById('__NEXT_DATA__')
    if (!el || !el.textContent) return out
    try {
      const d = JSON.parse(el.textContent)
      const walk = (x) => {
        if (!x || typeof x !== 'object') return
        const sec = x.sec_user_id
        const nick = x.nickname || x.nick_name || x.display_name
        if (typeof sec === 'string' && typeof nick === 'string' && sec.length >= 8 && !seen.has(sec)) {
          seen.add(sec)
          out.push({ id: sec, label: nick.replace(/\\s+/g, ' ').trim().slice(0, 64) })
        }
        for (const k of Object.keys(x)) walk(x[k])
      }
      walk(d)
    } catch {
      /* */
    }
    return out.slice(0, 120)
  })()`) as Promise<ChatPeer[]>
}

function peersFromMergedMap(merged: Map<string, PeerEntry>): { peers: ChatPeer[]; maxWeight: number } {
  const arr = Array.from(merged.values()).sort((a, b) => b.weight - a.weight)
  const peers = arr.slice(0, 80).map((x) => x.peer)
  const maxWeight = arr[0]?.weight ?? 0
  return { peers, maxWeight }
}

async function collectPeersOnPage(page: Page, merged: Map<string, PeerEntry>, domWeight: number, nextWeight: number) {
  for (const p of await extractPeersFromPage(page)) recordPeer(merged, p.id, p.label, domWeight)
  for (const p of await extractPeersFromNextData(page)) recordPeer(merged, p.id, p.label, nextWeight)
}

/** 从好友页 / 首页等抓取用户：DOM + __NEXT_DATA__ + 网络 JSON（关系类接口优先） */
export async function listChatPeers(sessionId: string): Promise<{ peers: ChatPeer[]; hint?: string }> {
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return { peers: [], hint: '无登录 Cookie' }

  const { chromium } = await import('playwright')
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== 'false'
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'zh-CN',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    await context.addCookies(cookies)
    const page = await context.newPage()

    const merged = new Map<string, PeerEntry>()
    const detachNet = attachPeerNetworkCollector(page, merged)

    try {
      await page.goto('https://www.douyin.com/friend', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await delay(4000)
      await scrollPageGradually(page, 7)
      await delay(2200)
      await collectPeersOnPage(page, merged, 30, 26)

      if (merged.size === 0) {
        await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
        await delay(3500)
        await scrollPageGradually(page, 5)
        await delay(2000)
        await collectPeersOnPage(page, merged, 20, 18)
      }

      /** 部分账号「自己」页会带关注/粉丝入口，再试一条路由 */
      if (merged.size === 0) {
        await page
          .goto('https://www.douyin.com/user/self', { waitUntil: 'domcontentloaded', timeout: 35_000 })
          .catch(() => {})
        await delay(3500)
        await scrollPageGradually(page, 4)
        await collectPeersOnPage(page, merged, 22, 19)
      }
    } finally {
      detachNet()
    }

    const { peers, maxWeight } = peersFromMergedMap(merged)

    await context.close().catch(() => {})
    await cleanup(browser)

    if (peers.length === 0) {
      return {
        peers: [],
        hint:
          '仍未解析到用户（常见原因：网页风控验证、需有头模式 DOUYIN_PLAYWRIGHT_HEADLESS=false、或接口已改版）。可改用抖音 App；也可在「基础信息」核对 Cookie 是否仍有效。',
      }
    }

    let hint: string | undefined
    if (maxWeight < 20) {
      hint =
        '下列用户部分可能来自首页推荐或接口泛数据，未必是互关好友；发私信前请在抖音 App 内确认对方身份。'
    }
    return { peers, hint }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cleanup(browser)
    return { peers: [], hint: msg }
  }
}

/** 在单页或 iframe 内查找私信输入区（抖音 DOM 常变，多策略兜底） */
async function tryLocateMessageComposer(ctx: Page | Frame): Promise<Locator | null> {
  const candidates: Locator[] = [
    ctx.getByPlaceholder(/消息|私信|输入|内容|打个招呼|说点什么|和对方|聊聊|发私信|聊天|想说|回复/i),
    ctx.locator('[role="dialog"] textarea'),
    ctx.locator('[role="dialog"] [contenteditable="true"]'),
    ctx.locator('[class*="modal" i] textarea'),
    ctx.locator('[class*="modal" i] [contenteditable="true"]'),
    ctx.locator('textarea:not([readonly]):visible'),
    ctx.locator('div[contenteditable="true"]:visible'),
    ctx.getByRole('textbox'),
  ]
  for (const loc of candidates) {
    const first = loc.first()
    if (await first.isVisible({ timeout: 1000 }).catch(() => false)) return first
  }
  return null
}

async function findMessageComposerWithRetry(page: Page): Promise<Locator | null> {
  const deadline = Date.now() + 24_000
  while (Date.now() < deadline) {
    const onMain = await tryLocateMessageComposer(page)
    if (onMain) return onMain
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      try {
        const hit = await tryLocateMessageComposer(frame)
        if (hit) return hit
      } catch {
        /* 子 frame 可能已卸载 */
      }
    }
    await delay(500)
  }
  return null
}

/** 打开用户页并尝试点击「私信」后输入内容发送（尽力而为） */
export async function sendChatMessage(
  sessionId: string,
  params: { userId: string; text: string },
): Promise<{ ok: boolean; message: string }> {
  const text = params.text.trim()
  if (!text) return { ok: false, message: '消息内容不能为空' }
  const uid = params.userId.trim()
  if (!uid) return { ok: false, message: '缺少好友标识' }

  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return { ok: false, message: '无登录 Cookie' }

  const { chromium } = await import('playwright')
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== 'false'
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'zh-CN',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    await context.addCookies(cookies)
    const page = await context.newPage()

    const userUrl = `https://www.douyin.com/user/${encodeURIComponent(uid)}`
    await page.goto(userUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await delay(3200)

    const dmBtn = page
      .getByRole('button', { name: /私信|发消息|聊天/ })
      .or(page.locator('div[role="button"]:has-text("私信"), div[role="button"]:has-text("发消息")'))
      .or(page.locator('button:has-text("私信"), a:has-text("私信"), span:has-text("私信")'))
      .or(page.locator('[class*="message" i], [class*="Message" i]').filter({ hasText: /私信|发消息/ }))
      .first()
    const visible = await dmBtn.isVisible({ timeout: 12_000 }).catch(() => false)
    if (!visible) {
      await context.close().catch(() => {})
      await cleanup(browser)
      return { ok: false, message: '未找到「私信」入口，可能该用户不允许私信或页面已改版' }
    }
    await dmBtn.click({ timeout: 5000 }).catch(() => {})
    await delay(4500)

    let box = await findMessageComposerWithRetry(page)
    if (!box) {
      await dmBtn.click({ timeout: 4000 }).catch(() => {})
      await delay(4000)
      box = await findMessageComposerWithRetry(page)
    }
    if (!box) {
      await context.close().catch(() => {})
      await cleanup(browser)
      return {
        ok: false,
        message:
          '未找到消息输入框（私信层可能未完全打开、在 iframe 内或需网页验证）。可设置 DOUYIN_PLAYWRIGHT_HEADLESS=false 后重试，或使用抖音 App 发私信。',
      }
    }
    await box.click({ timeout: 4000 }).catch(() => {})
    await box.fill(text).catch(async () => {
      await page.keyboard.press('Control+A').catch(() => {})
      await page.keyboard.type(text, { delay: 15 }).catch(() => {})
    })
    await delay(400)

    const sendBtn = page.getByRole('button', { name: /发送|发 送/ }).or(page.locator('button:has-text("发送")')).first()
    if (await sendBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await sendBtn.click({ timeout: 5000 }).catch(() => {})
    } else {
      await page.keyboard.press('Enter').catch(() => {})
    }
    await delay(2000)

    await context.close().catch(() => {})
    await cleanup(browser)
    return { ok: true, message: '已尝试发送（请在抖音网页或 App 确认是否送达）' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cleanup(browser)
    return { ok: false, message: msg }
  }
}

/**
 * 参考 AI-Scarlett/douyin-poster：使用已保存的 Cookie 在创作者中心完成图文 / 视频发布。
 * https://github.com/AI-Scarlett/douyin-poster （scripts/douyin_post_optimized.py、douyin_video_post.py）
 */
import type { Browser, Page } from 'playwright'
import { getPlaywrightCookieVault } from './playwrightLogin.js'

const PUBLISH_URL = 'https://creator.douyin.com/publish'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function cleanup(browser: Browser | undefined) {
  try {
    await browser?.close()
  } catch {
    /* */
  }
}

async function fillTitle(page: Page, title: string) {
  const locators = [
    page.locator('textarea[placeholder*="标题"]').first(),
    page.locator('input[placeholder*="标题"]').first(),
    page.locator('[contenteditable="true"]').first(),
  ]
  for (const el of locators) {
    const ok = await el.isVisible({ timeout: 2500 }).catch(() => false)
    if (!ok) continue
    await el.click({ timeout: 3000 }).catch(() => {})
    await el.fill('').catch(() => {})
    await el.fill(title).catch(() => {})
    return
  }
}

async function addTopics(page: Page, topics: string[]) {
  for (const topic of topics) {
    const t = topic.replace(/^#/, '').trim()
    if (!t) continue
    const topicInput = page.locator('input[placeholder*="话题"], input[placeholder*="#"]').first()
    const vis = await topicInput.isVisible({ timeout: 2000 }).catch(() => false)
    if (!vis) continue
    await topicInput.click().catch(() => {})
    await topicInput.fill(`#${t}`).catch(() => {})
    await delay(300)
    await page.keyboard.press('Enter').catch(() => {})
    await delay(400)
  }
}

async function clickPublish(page: Page) {
  const candidates = [
    page.getByRole('button', { name: /发布/ }).first(),
    page.locator('button:has-text("发布")').first(),
  ]
  for (const btn of candidates) {
    const ok = await btn.isVisible({ timeout: 4000 }).catch(() => false)
    if (!ok) continue
    const en = await btn.isEnabled().catch(() => false)
    if (en) {
      await btn.click({ timeout: 10000 }).catch(() => {})
      return true
    }
  }
  return false
}

export type PublishResult = { ok: boolean; message: string }

/** 图集 / 图文：至少 1 张图（单图图集） */
export async function runCarouselPublish(
  sessionId: string,
  params: { title: string; topics: string[]; imagePaths: string[] },
): Promise<PublishResult> {
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return { ok: false, message: '无登录 Cookie，请重新扫码登录' }
  if (params.imagePaths.length < 1) return { ok: false, message: '请至少选择 1 张图片' }

  const { chromium } = await import('playwright')
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== 'false'
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'zh-CN',
    })
    await context.addCookies(cookies)
    const page = await context.newPage()
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await delay(2500)

    if (/login/i.test(page.url())) {
      await cleanup(browser)
      return { ok: false, message: '发布页判定为未登录，请重新扫码' }
    }

    const storyTab = page.getByRole('tab', { name: /图文|图片/ }).first()
    if (await storyTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await storyTab.click().catch(() => {})
      await delay(900)
    }

    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(params.imagePaths, { timeout: 60_000 })
    await delay(4000)

    await fillTitle(page, params.title)
    await delay(600)
    if (params.topics.length) await addTopics(page, params.topics)
    await delay(800)

    const clicked = await clickPublish(page)
    await delay(5000)

    await context.close().catch(() => {})
    await cleanup(browser)
    return {
      ok: clicked,
      message: clicked
        ? '已提交发布（抖音侧可能审核中，请在创作者中心确认）'
        : '未找到可用「发布」按钮，页面结构可能已变更',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cleanup(browser)
    return { ok: false, message: msg }
  }
}

/** 视频发布：先切到「视频」再上传 */
export async function runVideoPublish(
  sessionId: string,
  params: { title: string; topics: string[]; videoPath: string; coverPath?: string },
): Promise<PublishResult> {
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return { ok: false, message: '无登录 Cookie，请重新扫码登录' }

  const { chromium } = await import('playwright')
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== 'false'
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'zh-CN',
    })
    await context.addCookies(cookies)
    const page = await context.newPage()
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await delay(2500)

    if (/login/i.test(page.url())) {
      await cleanup(browser)
      return { ok: false, message: '发布页判定为未登录，请重新扫码' }
    }

    const videoTab = page.getByRole('tab', { name: /视频/ }).first()
    if (await videoTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await videoTab.click().catch(() => {})
      await delay(1200)
    }

    const videoInput = page.locator('input[type="file"]').first()
    await videoInput.setInputFiles(params.videoPath, { timeout: 120_000 })
    await delay(8000)

    if (params.coverPath) {
      const coverBtn = page.locator('button:has-text("封面")').first()
      if (await coverBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await coverBtn.click().catch(() => {})
        await delay(600)
        const coverInput = page.locator('input[type="file"]').first()
        if (await coverInput.isVisible({ timeout: 4000 }).catch(() => false)) {
          await coverInput.setInputFiles(params.coverPath).catch(() => {})
          await delay(1500)
          const confirm = page.locator('button:has-text("确定"), button:has-text("确认")').first()
          if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirm.click().catch(() => {})
          }
        }
      }
    }

    await fillTitle(page, params.title)
    await delay(600)
    if (params.topics.length) await addTopics(page, params.topics)
    await delay(800)

    const clicked = await clickPublish(page)
    await delay(6000)

    await context.close().catch(() => {})
    await cleanup(browser)
    return {
      ok: clicked,
      message: clicked
        ? '已提交视频发布（请在创作者中心确认进度）'
        : '未找到可用「发布」按钮，页面结构可能已变更',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await cleanup(browser)
    return { ok: false, message: msg }
  }
}

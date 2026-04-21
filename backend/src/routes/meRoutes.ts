import { Router } from 'express'
import {
  deleteDouyinBinding,
  getDailySnapshot,
  getDouyinBindingBySession,
  getUserById,
  listDailySnapshotDates,
  listDouyinBindingsForUser,
  upsertDailySnapshot,
  upsertDouyinBinding,
} from '../db/database.js'
import { fetchCreatorAccountStats } from '../douyin/creatorAccountStats.js'
import { listCreatorVideos } from '../douyin/creatorVideos.js'
import { deletePlaywrightSession, getPlaywrightCookieVault, getPlaywrightSession } from '../douyin/playwrightLogin.js'
import {
  isSnapshotDebugEnabled,
  mergeDebugIntoBaseline,
  mergeDebugIntoSnapshotView,
  resolveBaselineYmd,
} from '../lib/snapshotDebug.js'
import { snapshotTimezone, ymdInTz } from '../lib/snapshotCalendar.js'

const router = Router()

router.get('/douyin-accounts', async (req, res) => {
  const userId = req.userId!
  const rows = await listDouyinBindingsForUser(userId)
  res.json({
    list: rows.map((r) => ({
      sessionId: r.session_id,
      user:
        r.nickname || r.douyin_id || r.avatar_url
          ? {
              nickname: r.nickname ?? undefined,
              douyinId: r.douyin_id ?? undefined,
              avatarUrl: r.avatar_url ?? undefined,
            }
          : null,
    })),
  })
})

router.post('/douyin/bind', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  const s = getPlaywrightSession(sessionId)
  if (!s || s.phase !== 'logged_in') {
    res.status(400).json({ error: '会话不存在或未登录' })
    return
  }
  const existing = await getDouyinBindingBySession(sessionId)
  if (existing && existing.user_id !== userId) {
    res.status(403).json({ error: '该抖音会话已绑定到其他用户' })
    return
  }
  const u = s.user
  await upsertDouyinBinding(userId, sessionId, {
    nickname: u?.nickname,
    douyinId: u?.douyinId,
    avatarUrl: u?.avatarUrl,
  })
  res.json({ ok: true })
})

function statDelta(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null
  return cur - prev
}

function parseOptNonNegInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n =
    typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : parseInt(String(v).trim(), 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** 当前接口数据 vs 昨日 23:59 归档（用于抽屉「较昨日」） */
router.get('/douyin/daily-compare', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权查看该会话' })
    return
  }
  const tz = snapshotTimezone()
  const todayYmd = ymdInTz(new Date(), tz)
  const baselineYmd = resolveBaselineYmd(todayYmd)
  const baselineRaw = await getDailySnapshot(userId, sessionId, baselineYmd)
  const baseline = mergeDebugIntoBaseline(baselineRaw, baselineYmd)
  const current = await fetchCreatorAccountStats(sessionId)
  if (!current) {
    res.status(400).json({ error: '无法拉取当前账号数据（会话可能已失效）' })
    return
  }
  res.json({
    timezone: tz,
    todayYmd,
    baselineYmd,
    baseline: baseline
      ? {
          likes: baseline.likes,
          mutual: baseline.mutual,
          following: baseline.following,
          followers: baseline.followers,
          parsed: baseline.parsed,
        }
      : null,
    current: {
      likes: current.likes,
      mutual: current.mutual,
      following: current.following,
      followers: current.followers,
      parsed: current.parsed,
    },
    delta: {
      likes: statDelta(current.likes, baseline?.likes ?? null),
      mutual: statDelta(current.mutual, baseline?.mutual ?? null),
      following: statDelta(current.following, baseline?.following ?? null),
      followers: statDelta(current.followers, baseline?.followers ?? null),
    },
    snapshotDebug: isSnapshotDebugEnabled(),
  })
})

/** 某会话已有归档日期列表（降序） */
router.get('/douyin/snapshot-dates', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权查看该会话' })
    return
  }
  const dates = await listDailySnapshotDates(userId, sessionId)
  const u = await getUserById(userId)
  res.json({
    dates,
    timezone: snapshotTimezone(),
    snapshotDebug: isSnapshotDebugEnabled(),
    snapshotAdmin: u?.role === 'admin',
  })
})

/** 单日归档明细（库数据；调试模式下可合并 SNAPSHOT_DEBUG_VIEW_OVERRIDES） */
router.get('/douyin/snapshot', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
  const date = typeof req.query.date === 'string' ? req.query.date.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date 须为 YYYY-MM-DD' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权查看该会话' })
    return
  }
  const raw = await getDailySnapshot(userId, sessionId, date)
  const merged = isSnapshotDebugEnabled() ? mergeDebugIntoSnapshotView(raw, date) : raw ?? null
  res.json({
    timezone: snapshotTimezone(),
    snapshot: merged
      ? {
          snapshotDate: merged.snapshot_date,
          likes: merged.likes,
          mutual: merged.mutual,
          following: merged.following,
          followers: merged.followers,
          parsed: merged.parsed,
        }
      : null,
    snapshotDebug: isSnapshotDebugEnabled(),
  })
})

/** 某会话的视频列表（用于账号视频标签） */
router.get('/douyin/videos', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权查看该会话' })
    return
  }
  const s = getPlaywrightSession(sessionId)
  if (!s || s.phase !== 'logged_in') {
    res.status(400).json({ error: '会话未登录或已失效' })
    return
  }
  const items = await listCreatorVideos(sessionId)
  if (items === null) {
    res.status(400).json({ error: '无法读取登录 Cookie，请重新登录' })
    return
  }
  const sources = Array.from(new Set(items.map((x) => x.source))).sort()
  res.json({ items, sources })
})

router.get('/douyin/video-cover', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : ''
  if (!sessionId || !url) {
    res.status(400).json({ error: '缺少 sessionId 或 url' })
    return
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    res.status(400).json({ error: 'url 无效' })
    return
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    res.status(400).json({ error: '仅支持 http/https' })
    return
  }
  const h = parsed.hostname.toLowerCase()
  if (
    !(
      h.includes('douyinpic.com') ||
      h.includes('byteimg.com') ||
      h.includes('ibytedtos.com') ||
      h.includes('douyin.com')
    )
  ) {
    res.status(400).json({ error: '不支持该封面域名' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权查看该会话' })
    return
  }
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) {
    res.status(400).json({ error: '会话 Cookie 不可用，请重新登录' })
    return
  }
  const host = parsed.hostname.toLowerCase()
  const cookieHeader = cookies
    .filter((c) => {
      const raw = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
      const d = raw.toLowerCase()
      return host === d || host.endsWith('.' + d)
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  try {
    const r = await fetch(parsed.toString(), {
      headers: {
        Cookie: cookieHeader,
        Referer: 'https://www.douyin.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!r.ok) {
      res.status(404).json({ error: '拉取封面失败' })
      return
    }
    const ct = r.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'private, max-age=120')
    res.end(buf)
  } catch {
    res.status(500).json({ error: '封面代理失败' })
  }
})

/** 管理员：手动写入或覆盖某日归档（用于调试 / 补数据） */
router.post('/douyin/snapshot', async (req, res) => {
  const userId = req.userId!
  const actor = await getUserById(userId)
  if (!actor || actor.role !== 'admin') {
    res.status(403).json({ error: '需要管理员账号才能写入归档' })
    return
  }
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : ''
  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date 须为 YYYY-MM-DD' })
    return
  }
  const binding = await getDouyinBindingBySession(sessionId)
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: '无权为该会话写入归档' })
    return
  }
  const likes = parseOptNonNegInt(req.body?.likes)
  const mutual = parseOptNonNegInt(req.body?.mutual)
  const following = parseOptNonNegInt(req.body?.following)
  const followers = parseOptNonNegInt(req.body?.followers)
  const parsed = req.body?.parsed === false ? false : true
  await upsertDailySnapshot(userId, sessionId, date, {
    likes,
    mutual,
    following,
    followers,
    parsed,
  })
  res.json({ ok: true })
})

/** 批量：卡片列表用（粉丝涨跌排序 + 定时刷新，减少请求次数） */
router.get('/douyin/cards-metrics', async (req, res) => {
  const userId = req.userId!
  const rows = await listDouyinBindingsForUser(userId)
  const tz = snapshotTimezone()
  const todayYmd = ymdInTz(new Date(), tz)
  const baselineYmd = resolveBaselineYmd(todayYmd)
  const items = await Promise.all(
    rows.map(async (r) => {
      const sessionId = r.session_id
      const s = getPlaywrightSession(sessionId)
      if (!s || s.phase !== 'logged_in') {
        return { sessionId, ok: false as const, error: '会话未登录或已失效' }
      }
      const current = await fetchCreatorAccountStats(sessionId)
      if (!current) {
        return { sessionId, ok: false as const, error: '无法拉取统计数据' }
      }
      const baselineRaw = await getDailySnapshot(userId, sessionId, baselineYmd)
      const baseline = mergeDebugIntoBaseline(baselineRaw, baselineYmd)
      return {
        sessionId,
        ok: true as const,
        parsed: current.parsed,
        likes: current.likes,
        mutual: current.mutual,
        following: current.following,
        followers: current.followers,
        baselineAvailable: Boolean(baseline?.parsed),
        delta: {
          likes: statDelta(current.likes, baseline?.likes ?? null),
          mutual: statDelta(current.mutual, baseline?.mutual ?? null),
          following: statDelta(current.following, baseline?.following ?? null),
          followers: statDelta(current.followers, baseline?.followers ?? null),
        },
      }
    }),
  )
  res.json({
    items,
    serverTimeYmd: todayYmd,
    baselineYmd,
    timezone: tz,
    snapshotDebug: isSnapshotDebugEnabled(),
  })
})

router.delete('/douyin-accounts/:sessionId', async (req, res) => {
  const userId = req.userId!
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
  if (!sessionId) {
    res.status(400).json({ error: '缺少 sessionId' })
    return
  }
  const n = await deleteDouyinBinding(userId, sessionId)
  if (n < 1) {
    res.status(404).json({ error: '未找到绑定' })
    return
  }
  deletePlaywrightSession(sessionId)
  res.json({ ok: true })
})

export { router as meRouter }

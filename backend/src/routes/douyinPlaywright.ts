import { mkdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { fetchCreatorAccountStats } from '../douyin/creatorAccountStats.js'
import { importDouyinSessionWithLogs } from '../douyin/importDouyinSessionWithLogs.js'
import {
  createPlaywrightSessionRecord,
  deletePlaywrightSession,
  getPlaywrightSession,
  importPlaywrightSessionFromTokens,
  runPlaywrightLoginJob,
} from '../douyin/playwrightLogin.js'
import { listChatPeers, sendChatMessage } from '../douyin/playwrightChat.js'
import { runCarouselPublish, runVideoPublish } from '../douyin/playwrightPublish.js'

const router = Router()

const uploadDir = path.join(os.tmpdir(), 'matrix-douyin-upload')
mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`)
  },
})

const uploadCarousel = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 9 },
})

const uploadVideo = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 2 },
})

async function unlinkPaths(paths: string[]) {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})))
}

function sessionParamId(req: { params: Record<string, string | string[]> }): string {
  const v = req.params.id
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

/** 创作者中心 + Playwright（参考 douyin-poster） */
router.post('/playwright/sessions', (_req, res) => {
  try {
    const session = createPlaywrightSessionRecord()
    runPlaywrightLoginJob(session.id)
    res.json({ sessionId: session.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

/** 粘贴浏览器 Cookie / Token 创建长期会话（写入服务端 data 目录，重启可恢复） */
router.post('/playwright/sessions/import', async (req, res) => {
  const tokens = typeof req.body?.tokens === 'string' ? req.body.tokens : ''
  if (!tokens.trim()) {
    res.status(400).json({ error: '请在 JSON 体中提供 tokens 字段（Cookie 原始文本）' })
    return
  }
  try {
    const result = await importPlaywrightSessionFromTokens(tokens)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    res.json({ sessionId: result.sessionId, user: result.user })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

/** Cookie 导入并分步拉取基础信息 + 账号数据（返回 logs 供前端进度弹窗） */
router.post('/playwright/sessions/import-with-logs', async (req, res) => {
  const tokens = typeof req.body?.tokens === 'string' ? req.body.tokens : ''
  if (!tokens.trim()) {
    res.status(400).json({ error: '请在 JSON 体中提供 tokens 字段', logs: [] })
    return
  }
  try {
    const result = await importDouyinSessionWithLogs(tokens)
    if (!result.ok) {
      res.status(400).json({ error: result.error, logs: result.logs })
      return
    }
    res.json({
      sessionId: result.sessionId,
      user: result.user,
      stats: result.stats,
      logs: result.logs,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg, logs: [] })
  }
})

router.get('/playwright/sessions/:id', (req, res) => {
  const s = getPlaywrightSession(req.params.id)
  if (!s) {
    res.status(404).json({ error: '会话不存在或已过期' })
    return
  }
  res.json({
    phase: s.phase,
    hint: s.error ?? s.hint,
    qrcodeUrl: s.qrcodeUrl,
    qrcodeDataUrl: s.qrcodeDataUrl,
    loggedIn: s.phase === 'logged_in',
    cookieCount: s.cookieCount,
    user: s.user ?? null,
  })
})

router.delete('/playwright/sessions/:id', (req, res) => {
  const id = sessionParamId(req)
  if (!id.trim()) {
    res.status(400).json({ error: '缺少会话 id' })
    return
  }
  const removed = deletePlaywrightSession(id)
  if (!removed) {
    res.status(404).json({ error: '会话不存在或已删除' })
    return
  }
  res.status(204).end()
})

/** 使用服务端保存的 Cookie 请求创作者接口，解析获赞 / 互关 / 关注 / 粉丝 */
router.get('/playwright/sessions/:id/account-stats', async (req, res) => {
  const s = getPlaywrightSession(req.params.id)
  if (!s || s.phase !== 'logged_in') {
    res.status(404).json({ error: '会话无效或未登录' })
    return
  }
  try {
    const stats = await fetchCreatorAccountStats(req.params.id)
    if (!stats) {
      res.status(404).json({ error: '无法读取登录 Cookie，请重新扫码登录' })
      return
    }
    res.json(stats)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

/** 图集 / 图文发布（参考 douyin-poster，支持单张或多张） */
router.post(
  '/playwright/sessions/:id/publish/carousel',
  uploadCarousel.array('images', 9),
  async (req, res) => {
    const sid = sessionParamId(req)
    const s = getPlaywrightSession(sid)
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    const paths = files.map((f) => f.path)
    if (!s || s.phase !== 'logged_in') {
      await unlinkPaths(paths)
      res.status(404).json({ error: '会话无效或未登录' })
      return
    }
    const title = String(req.body?.title ?? '').trim()
    const topicsRaw = String(req.body?.topics ?? '')
    const topics = topicsRaw
      .split(/[,，\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (!title) {
      await unlinkPaths(paths)
      res.status(400).json({ error: '请填写标题' })
      return
    }
    if (paths.length < 1) {
      await unlinkPaths(paths)
      res.status(400).json({ error: '请至少上传 1 张图片' })
      return
    }
    try {
      const result = await runCarouselPublish(sid, { title, topics, imagePaths: paths })
      await unlinkPaths(paths)
      res.json(result)
    } catch (e) {
      await unlinkPaths(paths)
      const msg = e instanceof Error ? e.message : String(e)
      res.status(500).json({ error: msg })
    }
  },
)

/** 视频发布（参考 douyin-poster douyin_video_post.py） */
router.post(
  '/playwright/sessions/:id/publish/video',
  uploadVideo.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req, res) => {
    const sid = sessionParamId(req)
    const s = getPlaywrightSession(sid)
    const map = req.files as { video?: Express.Multer.File[]; cover?: Express.Multer.File[] } | undefined
    const videoFile = map?.video?.[0]
    const coverFile = map?.cover?.[0]
    const paths = [videoFile?.path, coverFile?.path].filter(Boolean) as string[]
    if (!s || s.phase !== 'logged_in') {
      await unlinkPaths(paths)
      res.status(404).json({ error: '会话无效或未登录' })
      return
    }
    if (!videoFile?.path) {
      await unlinkPaths(paths)
      res.status(400).json({ error: '请上传视频文件' })
      return
    }
    const title = String(req.body?.title ?? '').trim()
    const topicsRaw = String(req.body?.topics ?? '')
    const topics = topicsRaw
      .split(/[,，\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (!title) {
      await unlinkPaths(paths)
      res.status(400).json({ error: '请填写标题' })
      return
    }
    try {
      const result = await runVideoPublish(sid, {
        title,
        topics,
        videoPath: videoFile.path,
        coverPath: coverFile?.path,
      })
      await unlinkPaths(paths)
      res.json(result)
    } catch (e) {
      await unlinkPaths(paths)
      const msg = e instanceof Error ? e.message : String(e)
      res.status(500).json({ error: msg })
    }
  },
)

/** 好友列表（Playwright 打开抖音好友页尽力解析） */
router.get('/playwright/sessions/:id/chat/peers', async (req, res) => {
  const sid = sessionParamId(req)
  const s = getPlaywrightSession(sid)
  if (!s || s.phase !== 'logged_in') {
    res.status(404).json({ error: '会话无效或未登录' })
    return
  }
  try {
    const { peers, hint } = await listChatPeers(sid)
    res.json({ peers, hint })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

/** 尝试向指定用户发送私信（页面改版可能导致失败） */
router.post('/playwright/sessions/:id/chat/send', async (req, res) => {
  const sid = sessionParamId(req)
  const s = getPlaywrightSession(sid)
  if (!s || s.phase !== 'logged_in') {
    res.status(404).json({ error: '会话无效或未登录' })
    return
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!userId || !text) {
    res.status(400).json({ error: '请提供 userId 与 text' })
    return
  }
  try {
    const result = await sendChatMessage(sid, { userId, text })
    res.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

export { router as douyinPlaywrightRouter }

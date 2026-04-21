import { Router } from 'express'
import { importXhsSessionWithLogs } from '../xiaohongshu/xhsImportWithLogs.js'
import {
  createXhsPlaywrightSessionRecord,
  getXhsPlaywrightSessionForApi,
  removeXhsSessionEverywhere,
  runXhsPlaywrightLoginJob,
} from '../xiaohongshu/xhsPlaywrightLogin.js'
import { getXhsSession } from '../xiaohongshu/xhsStore.js'

const router = Router()

/** Playwright 打开小红书网页并展示扫码（与 clawra-xiaohongshu 扫码登录同类流程） */
router.post('/playwright/sessions', (_req, res) => {
  try {
    const session = createXhsPlaywrightSessionRecord()
    runXhsPlaywrightLoginJob(session.id)
    res.json({ sessionId: session.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg })
  }
})

router.get('/playwright/sessions/:id', (req, res) => {
  const data = getXhsPlaywrightSessionForApi(req.params.id)
  if (!data) {
    res.status(404).json({ error: '会话不存在或已过期' })
    return
  }
  res.json({
    phase: data.phase,
    hint: data.hint,
    qrcodeUrl: data.qrcodeUrl,
    qrcodeDataUrl: data.qrcodeDataUrl,
    loggedIn: data.loggedIn,
    user: data.user ?? null,
    cookieCount: data.cookieCount,
    error: data.error,
  })
})

/** 能力与外部参考（阿里云百炼、QQ 通知等为可选环境变量，完整自动化可参考该仓库） */
router.get('/capabilities', (_req, res) => {
  res.json({
    reference: 'https://github.com/AI-Scarlett/clawra-xiaohongshu',
    features: [
      { id: 'qr_login', name: '网页扫码登录（Playwright）', ready: true },
      { id: 'cookie_persist', name: 'Cookie 持久化', ready: true },
      { id: 'ai_image', name: '阿里云百炼生成图片', ready: Boolean(process.env.DASHSCOPE_API_KEY?.trim()) },
      { id: 'ai_caption', name: '智能文案', ready: Boolean(process.env.DASHSCOPE_API_KEY?.trim()) },
      { id: 'playwright_publish', name: '无头浏览器发布', ready: false, note: '可对接 clawra 脚本或后续接入' },
      { id: 'cron', name: '定时发布', ready: false, note: '建议用系统计划任务调用 npm 脚本' },
      {
        id: 'qq_notify',
        name: '失败 QQ 通知',
        ready: Boolean(process.env.QQ_NOTIFY_WEBHOOK_URL?.trim() || process.env.QQBOT_USER_ID?.trim()),
      },
    ],
    envHints: {
      DASHSCOPE_API_KEY: '阿里云百炼（图/文）',
      QQ_NOTIFY_WEBHOOK_URL: '可选：失败通知 Webhook',
    },
  })
})

router.post('/sessions/import-with-logs', async (req, res) => {
  const tokens = typeof req.body?.tokens === 'string' ? req.body.tokens : ''
  if (!tokens.trim()) {
    res.status(400).json({ error: '请提供 tokens', logs: [] })
    return
  }
  try {
    const result = await importXhsSessionWithLogs(tokens)
    if (!result.ok) {
      res.status(400).json({ error: result.error, logs: result.logs })
      return
    }
    res.json({ sessionId: result.sessionId, user: result.user, logs: result.logs })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: msg, logs: [] })
  }
})

router.get('/sessions/:id', (req, res) => {
  const s = getXhsSession(req.params.id)
  if (!s) {
    res.status(404).json({ error: '会话不存在或已过期' })
    return
  }
  res.json({
    loggedIn: true,
    hint: s.hint,
    user: s.user ?? null,
    cookieCount: s.cookieCount,
  })
})

router.delete('/sessions/:id', (req, res) => {
  const id = typeof req.params.id === 'string' ? req.params.id : ''
  if (!id.trim()) {
    res.status(400).json({ error: '缺少会话 id' })
    return
  }
  const removed = removeXhsSessionEverywhere(id)
  if (!removed) {
    res.status(404).json({ error: '会话不存在或已删除' })
    return
  }
  res.status(204).end()
})

export { router as xhsRouter }

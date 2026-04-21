import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import { countDouyinBindings, countUsers, initDatabase, seedAdminUser } from './db/database.js'
import { startDailyDouyinSnapshotScheduler } from './jobs/dailyDouyinSnapshot.js'
import { initPlaywrightSessionsFromDisk } from './douyin/playwrightLogin.js'
import { initXhsSessionsFromDisk } from './xiaohongshu/xhsStore.js'
import { requireAuth } from './middleware/requireAuth.js'
import { authRouter } from './routes/authRoutes.js'
import { douyinPlaywrightRouter } from './routes/douyinPlaywright.js'
import { meRouter } from './routes/meRoutes.js'
import { xhsRouter } from './routes/xhsRoutes.js'

async function main() {
  await initDatabase()
  await seedAdminUser()
  {
    const nu = await countUsers()
    const nd = await countDouyinBindings()
    console.log(`[db] 数据快照：users=${nu} 行，douyin_bindings=${nd} 行`)
    if ((process.env.DB_TYPE || 'sqlite').trim().toLowerCase() === 'mysql') {
      const name = process.env.DB_NAME?.trim() || 'matrix_data'
      console.log(`[db] 请在数据库客户端选中库「${name}」，再打开表 users（登录账号）与 douyin_bindings（抖音授权后才有）`)
    } else {
      console.log(`[db] SQLite 文件：${process.env.DATABASE_PATH?.trim() || 'data/matrix.db'}`)
    }
  }

  const app = express()
  const port = Number(process.env.PORT) || 3000

  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '4mb' }))

  app.use('/api/auth', authRouter)
  app.use('/api/me', requireAuth, meRouter)
  app.use('/api/douyin', requireAuth, douyinPlaywrightRouter)
  app.use('/api/xhs', requireAuth, xhsRouter)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'matrix-data-api' })
  })

  app.get('/api/platforms', (_req, res) => {
    res.json({
      platforms: [
        { id: 'douyin', name: '抖音' },
        { id: 'xiaohongshu', name: '小红书' },
        { id: 'channels', name: '视频号' },
      ],
    })
  })

  const staticDir = process.env.FRONTEND_DIST_DIR?.trim()
    ? path.resolve(process.env.FRONTEND_DIST_DIR.trim())
    : path.resolve(process.cwd(), 'public')
  const indexHtmlPath = path.join(staticDir, 'index.html')
  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(indexHtmlPath)
    })
    console.log(`[web] 静态站点目录：${staticDir}`)
  } else {
    console.log(`[web] 未找到前端静态目录：${staticDir}（仅提供 API）`)
  }

  await initPlaywrightSessionsFromDisk()
  await initXhsSessionsFromDisk()

  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`)
    startDailyDouyinSnapshotScheduler()
  })
}

void main().catch((e) => {
  console.error('[boot] 启动失败', e)
  process.exit(1)
})

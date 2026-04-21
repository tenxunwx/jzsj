/**
 * 手动执行一次每日归档（需已配置 .env 且本机有抖音会话数据）
 * 用法：在 backend 目录执行 npm run snapshot:once
 */
import 'dotenv/config'
import { initDatabase } from '../db/database.js'
import { initPlaywrightSessionsFromDisk } from '../douyin/playwrightLogin.js'
import { runDailyDouyinSnapshotJob } from '../jobs/dailyDouyinSnapshot.js'
import { initXhsSessionsFromDisk } from '../xiaohongshu/xhsStore.js'

await initDatabase()
await initPlaywrightSessionsFromDisk()
await initXhsSessionsFromDisk()
await runDailyDouyinSnapshotJob()
process.exit(0)

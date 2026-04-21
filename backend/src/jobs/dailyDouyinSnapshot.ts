import cron from 'node-cron'
import { listAllDouyinBindings, upsertDailySnapshot } from '../db/database.js'
import { fetchCreatorAccountStats } from '../douyin/creatorAccountStats.js'
import { getPlaywrightSession } from '../douyin/playwrightLogin.js'
import { snapshotTimezone, ymdInTz } from '../lib/snapshotCalendar.js'

let jobRunning = false

/** 拉取所有已绑定且仍登录的抖音会话，写入当日日历归档（供次日对比） */
export async function runDailyDouyinSnapshotJob(): Promise<void> {
  if (jobRunning) {
    console.warn('[snapshot] 上一次归档尚未结束，跳过')
    return
  }
  jobRunning = true
  const tz = snapshotTimezone()
  const dateStr = ymdInTz(new Date(), tz)
  try {
    console.log(`[snapshot] 开始归档 ${dateStr}（${tz}）`)
    const bindings = await listAllDouyinBindings()
    let ok = 0
    let skip = 0
    let bad = 0
    for (const { user_id, session_id } of bindings) {
      const s = getPlaywrightSession(session_id)
      if (!s || s.phase !== 'logged_in') {
        skip++
        continue
      }
      try {
        const stats = await fetchCreatorAccountStats(session_id)
        if (!stats || !stats.parsed) {
          bad++
          continue
        }
        await upsertDailySnapshot(user_id, session_id, dateStr, {
          likes: stats.likes,
          mutual: stats.mutual,
          following: stats.following,
          followers: stats.followers,
          parsed: stats.parsed,
        })
        ok++
      } catch (e) {
        console.warn('[snapshot] 会话归档失败', session_id, e)
        bad++
      }
    }
    console.log(`[snapshot] 完成 ${dateStr}：写入=${ok} 跳过=${skip} 未解析/失败=${bad}`)
  } finally {
    jobRunning = false
  }
}

export function startDailyDouyinSnapshotScheduler(): void {
  const tz = snapshotTimezone()
  cron.schedule(
    '59 23 * * *',
    () => {
      void runDailyDouyinSnapshotJob().catch((e) => console.error('[snapshot]', e))
    },
    { timezone: tz },
  )
  console.log(`[snapshot] 已定时：每日 23:59（${tz}）自动归档抖音数据；对比接口见 GET /api/me/douyin/daily-compare`)
}

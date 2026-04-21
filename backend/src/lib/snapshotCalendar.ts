/** 每日归档使用的日历日与时区（与 node-cron 的 timezone 一致） */
export function snapshotTimezone(): string {
  return process.env.SNAPSHOT_TZ?.trim() || 'Asia/Shanghai'
}

/** 某时刻在指定时区下的公历 YYYY-MM-DD */
export function ymdInTz(date: Date, tz: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: tz })
}

/** 公历 YYYY-MM-DD 加减天数（按 UTC 日历分量计算，避免 DST 干扰） */
export function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + deltaDays)
  const y2 = t.getUTCFullYear()
  const m2 = String(t.getUTCMonth() + 1).padStart(2, '0')
  const d2 = String(t.getUTCDate()).padStart(2, '0')
  return `${y2}-${m2}-${d2}`
}

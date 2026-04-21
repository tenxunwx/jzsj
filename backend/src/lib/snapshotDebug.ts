import type { DailySnapshotRow } from '../db/dailySnapshotTypes.js'
import { addCalendarDaysYmd } from './snapshotCalendar.js'

export function isSnapshotDebugEnabled(): boolean {
  const v = process.env.SNAPSHOT_DEBUG?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 与卡片 / 较昨日对比使用的归档日：调试可指定，否则为日历上的「昨天」 */
export function resolveBaselineYmd(todayYmd: string): string {
  const o = process.env.SNAPSHOT_DEBUG_BASELINE_YMD?.trim()
  if (isSnapshotDebugEnabled() && o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o
  return addCalendarDaysYmd(todayYmd, -1)
}

function numOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return parseInt(v, 10)
  return undefined
}

function parseBaselineJsonOverride(): Partial<
  Pick<DailySnapshotRow, 'likes' | 'mutual' | 'following' | 'followers' | 'parsed'>
> | null {
  if (!isSnapshotDebugEnabled()) return null
  const raw = process.env.SNAPSHOT_DEBUG_BASELINE_JSON?.trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const patch: Partial<Pick<DailySnapshotRow, 'likes' | 'mutual' | 'following' | 'followers' | 'parsed'>> = {}
    const lk = numOrNull(o.likes)
    if (lk !== undefined) patch.likes = lk
    const m = numOrNull(o.mutual)
    if (m !== undefined) patch.mutual = m
    const f = numOrNull(o.following)
    if (f !== undefined) patch.following = f
    const fo = numOrNull(o.followers)
    if (fo !== undefined) patch.followers = fo
    if (typeof o.parsed === 'boolean') patch.parsed = o.parsed
    return Object.keys(patch).length > 0 ? patch : null
  } catch {
    return null
  }
}

/** 用于「当前 vs 归档」：库里的基准行 + 调试 JSON 覆盖（可无库行则合成一行） */
export function mergeDebugIntoBaseline(
  dbRow: DailySnapshotRow | undefined,
  baselineYmd: string,
): DailySnapshotRow | undefined {
  const patch = parseBaselineJsonOverride()
  if (!dbRow && !patch) return undefined
  const base: DailySnapshotRow = dbRow ?? {
    snapshot_date: baselineYmd,
    likes: null,
    mutual: null,
    following: null,
    followers: null,
    parsed: false,
  }
  if (!patch) return base
  return {
    snapshot_date: base.snapshot_date,
    likes: patch.likes !== undefined ? patch.likes : base.likes,
    mutual: patch.mutual !== undefined ? patch.mutual : base.mutual,
    following: patch.following !== undefined ? patch.following : base.following,
    followers: patch.followers !== undefined ? patch.followers : base.followers,
    parsed: patch.parsed !== undefined ? patch.parsed : base.parsed,
  }
}

type ViewPatch = Partial<
  Pick<DailySnapshotRow, 'likes' | 'mutual' | 'following' | 'followers' | 'parsed'>
>

function parseViewOverridesMap(): Record<string, ViewPatch> | null {
  if (!isSnapshotDebugEnabled()) return null
  const raw = process.env.SNAPSHOT_DEBUG_VIEW_OVERRIDES?.trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const out: Record<string, ViewPatch> = {}
    for (const [ymd, val] of Object.entries(o)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !val || typeof val !== 'object' || Array.isArray(val)) continue
      const rec = val as Record<string, unknown>
      const patch: ViewPatch = {}
      const lk = numOrNull(rec.likes)
      if (lk !== undefined) patch.likes = lk
      const m = numOrNull(rec.mutual)
      if (m !== undefined) patch.mutual = m
      const f = numOrNull(rec.following)
      if (f !== undefined) patch.following = f
      const fo = numOrNull(rec.followers)
      if (fo !== undefined) patch.followers = fo
      if (typeof rec.parsed === 'boolean') patch.parsed = rec.parsed
      if (Object.keys(patch).length > 0) out[ymd] = patch
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

/** 账号数据里「点某一天」：库数据 + 调试按日覆盖（用于本地无库时看合成数据） */
export function mergeDebugIntoSnapshotView(
  dbRow: DailySnapshotRow | undefined,
  ymd: string,
): DailySnapshotRow | null {
  const map = parseViewOverridesMap()
  const patch = map?.[ymd]
  if (!dbRow && !patch) return null
  const base: DailySnapshotRow = dbRow ?? {
    snapshot_date: ymd,
    likes: null,
    mutual: null,
    following: null,
    followers: null,
    parsed: false,
  }
  if (!patch) return base
  return {
    snapshot_date: base.snapshot_date,
    likes: patch.likes !== undefined ? patch.likes : base.likes,
    mutual: patch.mutual !== undefined ? patch.mutual : base.mutual,
    following: patch.following !== undefined ? patch.following : base.following,
    followers: patch.followers !== undefined ? patch.followers : base.followers,
    parsed: patch.parsed !== undefined ? patch.parsed : base.parsed,
  }
}

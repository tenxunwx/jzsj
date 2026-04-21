/**
 * 使用登录后保存的 Cookie 请求创作者域接口，解析获赞 / 关注 / 粉丝 / 互关等数据。
 * 抖音接口字段可能随版本变化，解析采用宽松递归 + 常见键名。
 */
import type { Cookie } from 'playwright'
import { getPlaywrightCookieVault } from './playwrightLogin.js'

export type CreatorAccountStats = {
  /** 获赞 */
  likes: number | null
  /** 互关 */
  mutual: number | null
  /** 关注 */
  following: number | null
  /** 粉丝 */
  followers: number | null
  /** 是否来自接口解析（false 表示未能解析到有效数字） */
  parsed: boolean
}

const CREATOR_ORIGIN = 'https://creator.douyin.com'

function buildCookieHeader(cookies: Cookie[], requestHost: string): string {
  const host = requestHost.toLowerCase()
  return cookies
    .filter((c) => {
      const raw = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain
      const d = raw.toLowerCase()
      if (host === d) return true
      if (host.endsWith('.' + d)) return true
      return false
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isInteger(n)
}

function parseNonNegNumber(v: unknown): number | undefined {
  if (isNonNegInt(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const x = parseInt(v, 10)
    if (x >= 0) return x
  }
  return undefined
}

/** 互关在不同接口里命名差异大（snake / camel / mplatform 前缀等），用键名辅助识别 */
function keyLooksLikeMutualFollowCount(key: string): boolean {
  const k = key.toLowerCase()
  if (k.includes('互关') || k.includes('互粉')) return true
  if (k.includes('mutually')) return false
  if (/mutual[_\s]?follow|mutualfollow|mutual_cnt|mutual_count/i.test(k)) {
    if (/following|follower|fans/i.test(k) && !/mutual/i.test(k)) return false
    return true
  }
  if (/friend[_\s]?follow|friendfollow|follow[_\s]?friend/i.test(k)) return true
  if (/bilateral|each[_\s]?other|双向关注/i.test(k)) return true
  if (/mplatform.*mutual|^m_friend|^mfriend/i.test(k)) return true
  if (/double_follow|双向好友|互相关注/i.test(k)) return true
  if (/bi[_\s-]?follow|bifollow|two[_\s-]?way|双向互关|互关好友|互关数/i.test(k)) return true
  return false
}

type StatKey = 'likes' | 'mutual' | 'following' | 'followers'

function extractStatsFromJson(o: unknown, depth = 0): Partial<Record<StatKey, number>> {
  if (depth > 32 || o === null || typeof o !== 'object') return {}
  const acc: Partial<Record<StatKey, number>> = {}

  if (!Array.isArray(o)) {
    const r = o as Record<string, unknown>
    const trySet = (key: StatKey, ...names: string[]) => {
      if (acc[key] !== undefined) return
      for (const n of names) {
        const v = r[n]
        const parsed = parseNonNegNumber(v)
        if (parsed !== undefined) {
          acc[key] = parsed
          return
        }
      }
    }

    trySet(
      'likes',
      'total_favorited',
      'total_favorited_count',
      'totalFavorited',
      'favorited_count',
      'digg_count',
      'like_count',
    )
    trySet('following', 'following_count', 'following_cnt', 'follow_count', 'followingCount', 'mplatform_following_count')
    trySet(
      'followers',
      'follower_count',
      'followers_count',
      'mplatform_followers_count',
      'fans_count',
      'follower_cnt',
      'followerCount',
    )
    trySet(
      'mutual',
      'mutual_follow_count',
      'mutual_follow_cnt',
      'mutual_follow_num',
      'mutualFollowCount',
      'mutualFollowCnt',
      'friend_follow_count',
      'friendFollowCount',
      'friend_follow_cnt',
      'bilateral_follow_count',
      'bilateralFollowCount',
      'both_follow_count',
      'bothFollowCount',
      'each_follow_count',
      'mplatform_mutual_follow_count',
      'mplatform_friend_follow_count',
      'interaction_mutual_follow_count',
      'mutual_count',
      'mutual_friend_count',
      'mutualFriendCount',
      /** 抖音主站/部分接口用「双向关注」表示互关 */
      'bi_follow_count',
      'bi_follow_cnt',
      'biFollowCount',
      'bifollow_count',
      'two_way_follow_count',
      'twoWayFollowCount',
      'mate_follow_count',
      'friend_relation_count',
      'social_friend_count',
    )

    if (acc.mutual === undefined) {
      for (const key of Object.keys(r)) {
        if (!keyLooksLikeMutualFollowCount(key)) continue
        const parsed = parseNonNegNumber(r[key])
        if (parsed !== undefined) {
          acc.mutual = parsed
          break
        }
      }
    }
  }

  const nested: unknown[] = Array.isArray(o) ? o : Object.values(o as Record<string, unknown>)
  for (const v of nested) {
    if (v !== null && typeof v === 'object') {
      Object.assign(acc, extractStatsFromJson(v, depth + 1))
    }
  }
  return acc
}

async function tryFetchJsonFrom(
  cookies: Cookie[],
  origin: string,
  path: string,
  referer?: string,
): Promise<{ json: unknown; ok: boolean }> {
  const base = origin.replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return { json: null, ok: false }
  }
  const cookie = buildCookieHeader(cookies, host)
  if (!cookie) return { json: null, ok: false }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        Referer: referer ?? `${base}/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    })
    if (!res.ok) return { json: null, ok: false }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return { json: null, ok: false }
    const json = (await res.json()) as unknown
    return { json, ok: true }
  } catch {
    return { json: null, ok: false }
  }
}

function tryFetchJson(
  cookies: Cookie[],
  path: string,
): Promise<{ json: unknown; ok: boolean }> {
  return tryFetchJsonFrom(cookies, CREATOR_ORIGIN, path, `${CREATOR_ORIGIN}/`)
}

/** 部分字段只在 JSON 字符串里以固定键出现，递归对象易漏；用正则兜底互关 */
function extractMutualByRegexFromJsonBodies(bodies: unknown[]): number | null {
  const patterns = [
    /"friend_follow_count"\s*:\s*(\d+)/,
    /"friendFollowCount"\s*:\s*(\d+)/,
    /"mutual_follow_count"\s*:\s*(\d+)/,
    /"mutualFollowCount"\s*:\s*(\d+)/,
    /"bi_follow_count"\s*:\s*(\d+)/,
    /"biFollowCount"\s*:\s*(\d+)/,
    /"interaction_friend_follow_count"\s*:\s*(\d+)/,
    /"mplatform_friend_follow_count"\s*:\s*(\d+)/,
    /"mate_follow_count"\s*:\s*(\d+)/,
    /"two_way_follow_count"\s*:\s*(\d+)/,
  ]
  for (const body of bodies) {
    try {
      const s = JSON.stringify(body)
      for (const re of patterns) {
        const m = s.match(re)
        if (m) {
          const n = parseInt(m[1], 10)
          if (Number.isFinite(n) && n >= 0) return n
        }
      }
    } catch {
      /* */
    }
  }
  return null
}

export async function fetchCreatorAccountStats(sessionId: string): Promise<CreatorAccountStats | null> {
  const cookies = getPlaywrightCookieVault(sessionId)
  if (!cookies?.length) return null

  const paths = [
    '/web/api/media/user/info/',
    '/aweme/v1/creator/user/info/',
    '/passport/account/info/v2/',
    /** 部分账号互关仅出现在创作者聚合接口 */
    '/web/api/creator/user/info/',
    '/web/api/creator/user/detail/',
  ]

  const merged: Partial<Record<StatKey, number>> = {}
  const rawBodies: unknown[] = []
  for (const path of paths) {
    const { json, ok } = await tryFetchJson(cookies, path)
    if (!ok || json === null) continue
    rawBodies.push(json)
    Object.assign(merged, extractStatsFromJson(json))
  }

  /** 主站用户资料里常有「互关」等社交计数；仅补缺，避免覆盖创作者接口已解析的其它指标 */
  const wwwPaths = [
    '/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2&source=channel_pc_web&pc_client_type=1&version_code=170400&cookie_enabled=true&platform=PC&downlink=10',
    '/aweme/v1/web/user/profile/self/',
  ]
  for (const path of wwwPaths) {
    const { json, ok } = await tryFetchJsonFrom(
      cookies,
      'https://www.douyin.com',
      path,
      'https://www.douyin.com/',
    )
    if (!ok || json === null) continue
    rawBodies.push(json)
    const part = extractStatsFromJson(json)
    const keys: StatKey[] = ['likes', 'mutual', 'following', 'followers']
    for (const k of keys) {
      if (merged[k] == null && part[k] != null) merged[k] = part[k]
    }
  }

  if (merged.mutual == null) {
    const fromRe = extractMutualByRegexFromJsonBodies(rawBodies)
    if (fromRe != null) merged.mutual = fromRe
  }

  const likes = merged.likes ?? null
  const mutual = merged.mutual ?? null
  const following = merged.following ?? null
  const followers = merged.followers ?? null
  const parsed = [likes, mutual, following, followers].some((x) => x !== null)

  return {
    likes,
    mutual,
    following,
    followers,
    parsed,
  }
}

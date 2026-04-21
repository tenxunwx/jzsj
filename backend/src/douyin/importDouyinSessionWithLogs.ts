/**
 * Cookie 导入时按步骤记录日志，并拉取账号统计（供前端进度弹窗展示）。
 */
import type { CreatorAccountStats } from './creatorAccountStats.js'
import { fetchCreatorAccountStats } from './creatorAccountStats.js'
import { looksLikeDouyinAuthCookies, parseDouyinCookiePaste } from './playwrightCookieImport.js'
import { importPlaywrightSessionFromTokens, type PlaywrightUserInfo } from './playwrightLogin.js'

function ts(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

export type ImportDouyinWithLogsResult =
  | {
      ok: true
      sessionId: string
      user: PlaywrightUserInfo | null
      stats: CreatorAccountStats | null
      logs: string[]
    }
  | { ok: false; error: string; logs: string[] }

export async function importDouyinSessionWithLogs(raw: string): Promise<ImportDouyinWithLogsResult> {
  const logs: string[] = []
  const log = (msg: string) => logs.push(`[${ts()}] ${msg}`)

  log('① 解析 Cookie 文本…')
  const pre = parseDouyinCookiePaste(raw)
  if (pre.length < 1) {
    log('解析失败：未识别到任何 name=value')
    return { ok: false, error: '未能解析出 Cookie', logs }
  }
  log(`已解析 ${pre.length} 条 Cookie`)

  log('② 校验抖音登录特征（sessionid / sid_tt 等）…')
  if (!looksLikeDouyinAuthCookies(pre)) {
    log('校验未通过')
    return {
      ok: false,
      error:
        '未识别到常见抖音登录 Cookie。请在浏览器开发者工具中从 creator.douyin.com 或 .douyin.com 复制完整 Cookie。',
      logs,
    }
  }
  log('校验通过')

  log('③ 创建服务端会话并拉取账号基础信息（昵称/头像等）…')
  const created = await importPlaywrightSessionFromTokens(raw)
  if (!created.ok) {
    log(`失败：${created.error}`)
    return { ok: false, error: created.error, logs }
  }
  log('基础信息已写入会话')

  log('④ 请求创作者数据中心（获赞、粉丝、关注、互关等）…')
  let stats: CreatorAccountStats | null = null
  try {
    stats = await fetchCreatorAccountStats(created.sessionId)
    if (stats?.parsed) log('账号数据统计拉取成功')
    else log('部分指标未能解析（接口字段可能变更），会话仍可用于矩阵能力')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`数据统计请求异常：${msg}（会话已保存，可稍后重试）`)
  }

  log('⑤ 全部完成')
  return {
    ok: true,
    sessionId: created.sessionId,
    user: created.user,
    stats,
    logs,
  }
}

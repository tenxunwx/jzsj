import { looksLikeXhsAuthCookies, parseXhsCookiePaste } from './xhsCookie.js'
import { tryFetchXhsUserInfo } from './xhsFetch.js'
import { createXhsSessionId, putXhsLoggedInSession, type XhsUserInfo } from './xhsStore.js'

function ts(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

export type ImportXhsWithLogsResult =
  | { ok: true; sessionId: string; user: XhsUserInfo | null; logs: string[] }
  | { ok: false; error: string; logs: string[] }

export async function importXhsSessionWithLogs(raw: string): Promise<ImportXhsWithLogsResult> {
  const logs: string[] = []
  const log = (msg: string) => logs.push(`[${ts()}] ${msg}`)

  log('① 解析小红书 Cookie…')
  const cookies = parseXhsCookiePaste(raw)
  if (cookies.length < 1) {
    log('解析失败')
    return { ok: false, error: '未能解析出 Cookie', logs }
  }
  log(`已解析 ${cookies.length} 条`)

  log('② 校验登录特征（web_session / a1 等）…')
  if (!looksLikeXhsAuthCookies(cookies)) {
    log('校验未通过')
    return {
      ok: false,
      error: '未识别到常见小红书登录 Cookie，请从 www.xiaohongshu.com 域名下复制',
      logs,
    }
  }
  log('校验通过')

  log('③ 尝试拉取账号基础信息（接口可能需额外签名，失败仍会保存 Cookie）…')
  let user: XhsUserInfo | null = await tryFetchXhsUserInfo(cookies)
  if (user?.nickname || user?.userId) log('已获取到账号资料')
  else log('接口未返回完整资料（可继续使用无头发布脚本或参考 clawra-xiaohongshu）')

  const id = createXhsSessionId()
  putXhsLoggedInSession(id, cookies, user ?? undefined)

  log('④ 会话已写入服务端 data/xiaohongshu-sessions.json')
  log('⑤ 完成')
  return { ok: true, sessionId: id, user, logs }
}

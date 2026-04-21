import type { RequestHandler } from 'express'
import { verifyAuthToken } from '../auth/jwt.js'

export const requireAuth: RequestHandler = (req, res, next) => {
  const raw = req.headers.authorization
  const m = typeof raw === 'string' ? raw.match(/^Bearer\s+(.+)$/i) : null
  const token = m?.[1]?.trim()
  if (!token) {
    res.status(401).json({ error: '未登录或缺少令牌' })
    return
  }
  try {
    const { userId, username } = verifyAuthToken(token)
    req.userId = userId
    req.authUsername = username
    next()
  } catch {
    res.status(401).json({ error: '令牌无效或已过期' })
  }
}

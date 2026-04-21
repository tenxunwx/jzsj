import { Router } from 'express'
import { signAuthToken } from '../auth/jwt.js'
import { createUser, getUserById, getUserByUsername, verifyPassword } from '../db/database.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.get('/capabilities', (_req, res) => {
  res.json({ registerEnabled: process.env.REGISTER_ENABLED === 'true' })
})

router.post('/login', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (username.length < 1 || password.length < 1) {
    res.status(400).json({ error: '请填写账号和密码' })
    return
  }
  const row = await getUserByUsername(username)
  if (!row || !verifyPassword(row, password)) {
    res.status(401).json({ error: '账号或密码错误' })
    return
  }
  const token = signAuthToken(row.id, row.username)
  res.json({ token, user: { id: row.id, username: row.username, role: row.role } })
})

function validUsername(u: string): boolean {
  return /^[a-zA-Z0-9_\u4e00-\u9fff]{2,32}$/.test(u)
}

router.post('/register', async (req, res) => {
  if (process.env.REGISTER_ENABLED !== 'true') {
    res.status(403).json({ error: '当前未开放注册' })
    return
  }
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!validUsername(username)) {
    res.status(400).json({ error: '用户名需为 2～32 位字母数字、下划线或中文' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' })
    return
  }
  if (await getUserByUsername(username)) {
    res.status(409).json({ error: '用户名已存在' })
    return
  }
  const id = await createUser(username, password, 'user')
  const token = signAuthToken(id, username)
  res.json({ token, user: { id, username, role: 'user' } })
})

router.get('/me', requireAuth, async (req, res) => {
  const row = await getUserById(req.userId!)
  if (!row) {
    res.status(401).json({ error: '用户不存在' })
    return
  }
  res.json(row)
})

export { router as authRouter }

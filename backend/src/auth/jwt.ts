import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'

function jwtSecret(): Secret {
  const s = process.env.JWT_SECRET?.trim()
  if (s) return s
  console.warn('[auth] JWT_SECRET 未设置，使用不安全的开发默认值')
  return 'dev-insecure-jwt-secret'
}

export function signAuthToken(userId: number, username: string): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN?.trim() || '7d') as NonNullable<SignOptions['expiresIn']>
  const opts: SignOptions = { expiresIn }
  return jwt.sign({ sub: String(userId), username }, jwtSecret(), opts)
}

export function verifyAuthToken(token: string): { userId: number; username: string } {
  const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload
  const sub = payload.sub
  const userId = typeof sub === 'string' ? Number(sub) : Number(sub)
  if (!Number.isFinite(userId)) throw new Error('invalid token')
  const username = typeof payload.username === 'string' ? payload.username : ''
  return { userId, username }
}

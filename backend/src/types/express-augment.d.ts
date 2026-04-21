declare global {
  namespace Express {
    interface Request {
      userId?: number
      authUsername?: string
    }
  }
}

export {}

const WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
const MAX_ATTEMPTS = Number(process.env.AUTH_RATE_LIMIT_MAX || 20)

const buckets = new Map()

function authRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown"
  const key = `${req.path}:${ip}`
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  if (bucket.count > MAX_ATTEMPTS) {
    return res.status(429).json({
      error: "RATE_LIMITED",
      message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    })
  }
  return next()
}

module.exports = { authRateLimit }

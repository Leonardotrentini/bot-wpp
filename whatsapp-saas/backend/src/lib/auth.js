const jwt = require("jsonwebtoken")
const { loadAuthContext, resolveDataScope } = require("./orgScope")

async function signToken(user) {
  const orgCtx = await loadAuthContext(user.id)
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: orgCtx.orgId,
      orgRole: orgCtx.orgRole,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  )
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: "UNAUTHORIZED", message: "Token ausente." })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = payload
    req.dataScope = await resolveDataScope(payload.sub)
    return next()
  } catch (err) {
    if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "INVALID_TOKEN", message: "Token inválido ou expirado." })
    }
    console.error("[auth] scope:", err)
    return res.status(500).json({ error: "SCOPE_FAILED", message: "Falha ao resolver escopo da empresa." })
  }
}

module.exports = { signToken, authMiddleware }

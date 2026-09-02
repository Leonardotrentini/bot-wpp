const jwt = require("jsonwebtoken")
const { prisma } = require("./prisma")

/** Depois do authMiddleware: confirma na BD que o utilizador é ADMIN */
async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, role: true },
    })
    if (!user || user.role !== "ADMIN") {
      return res.status(403).json({ error: "FORBIDDEN", message: "Acesso restrito a administradores." })
    }
    req.adminUser = user
    return next()
  } catch (e) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao validar permissões." })
  }
}

/**
 * Admin direto OU admin visualizando outra conta (impersonação).
 * Bearer = conta visualizada; header X-Vesto-Admin-Token = JWT do admin real.
 */
async function requireAdminOrImpersonation(req, res, next) {
  try {
    const direct = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, role: true },
    })
    if (direct?.role === "ADMIN") {
      req.adminUser = direct
      return next()
    }

    const adminHeader = req.headers["x-vesto-admin-token"]
    if (adminHeader && typeof adminHeader === "string") {
      try {
        const payload = jwt.verify(adminHeader, process.env.JWT_SECRET)
        const admin = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, role: true },
        })
        if (admin?.role === "ADMIN") {
          req.adminUser = admin
          req.adminImpersonation = true
          return next()
        }
      } catch {
        /* token inválido */
      }
    }

    return res.status(403).json({ error: "FORBIDDEN", message: "Acesso restrito a administradores." })
  } catch (e) {
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao validar permissões." })
  }
}

module.exports = { requireAdmin, requireAdminOrImpersonation }

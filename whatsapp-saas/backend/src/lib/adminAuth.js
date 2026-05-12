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

module.exports = { requireAdmin }

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const { requireAdmin } = require("../lib/adminAuth")

const router = express.Router()

router.get("/users", authMiddleware, requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || "20", 10) || 20))
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""

  const where = q
    ? {
        OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }],
      }
    : {}

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { startedAt: "desc" },
          select: {
            plan: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    }),
  ])

  const users = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    plan: u.subscriptions[0]?.plan ?? null,
  }))

  res.json({ users, total, page, pageSize })
})

router.patch("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    role: z.enum(["USER", "ADMIN"]).optional(),
    name: z.string().min(2).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const id = req.params.id
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Utilizador não encontrado." })

  const data = {}
  if (parsed.data.role !== undefined) data.role = parsed.data.role
  if (parsed.data.name !== undefined) data.name = parsed.data.name

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "EMPTY_UPDATE", message: "Nada para atualizar." })
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  res.json({ user: { ...user, createdAt: user.createdAt.toISOString() } })
})

router.get("/plans", authMiddleware, requireAdmin, async (_req, res) => {
  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      priceMonthly: true,
      maxGroups: true,
      active: true,
      sortOrder: true,
      createdAt: true,
    },
  })
  res.json({
    plans: plans.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  })
})

module.exports = router

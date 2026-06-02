const express = require("express")
const { z } = require("zod")
const bcrypt = require("bcryptjs")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const { requireAdmin } = require("../lib/adminAuth")
const { ensureDefaultPlans } = require("../lib/ensureBillingDefaults")

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

router.post("/users", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: z.string().min(6),
    role: z.enum(["USER", "ADMIN"]).optional().default("USER"),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues?.[0]?.message || "Dados inválidos.",
    })
  }

  const { name, email, password, role } = parsed.data
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) {
    return res.status(409).json({ error: "EMAIL_IN_USE", message: "E-mail já cadastrado." })
  }

  await ensureDefaultPlans()
  const freePlan = await prisma.plan.findUnique({ where: { slug: "free" } })
  if (!freePlan) {
    return res.status(503).json({
      error: "NO_DEFAULT_PLAN",
      message: "Não foi possível criar o plano padrão. Verifique a base de dados.",
    })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })
    await tx.subscription.create({
      data: { userId: user.id, planId: freePlan.id, status: "ACTIVE" },
    })
    return user
  })

  res.status(201).json({
    user: { ...created, createdAt: created.createdAt.toISOString(), plan: { id: freePlan.id, name: freePlan.name, slug: freePlan.slug } },
  })
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

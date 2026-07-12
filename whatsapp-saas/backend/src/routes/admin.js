const express = require("express")
const { z } = require("zod")
const bcrypt = require("bcryptjs")
const { prisma } = require("../lib/prisma")
const { authMiddleware, signToken } = require("../lib/auth")
const { requireAdmin } = require("../lib/adminAuth")
const { ensureDefaultPlans } = require("../lib/ensureBillingDefaults")

const router = express.Router()

function mapAdminUserRow(u) {
  const plan = u.subscriptions[0]?.plan ?? null
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    plan: plan ? { id: plan.id, name: plan.name, slug: plan.slug, maxGroups: plan.maxGroups } : null,
  }
}

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
        phone: true,
        role: true,
        createdAt: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { startedAt: "desc" },
          select: {
            plan: { select: { id: true, name: true, slug: true, maxGroups: true } },
          },
        },
      },
    }),
  ])

  res.json({ users: rows.map(mapAdminUserRow), total, page, pageSize })
})

router.post("/users/:id/impersonate", authMiddleware, requireAdmin, async (req, res) => {
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      avatarUrl: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { startedAt: "desc" },
        include: { plan: { select: { id: true, name: true, slug: true, maxGroups: true } } },
      },
    },
  })
  if (!target) return res.status(404).json({ error: "NOT_FOUND", message: "Utilizador não encontrado." })
  if (target.role === "ADMIN") {
    return res.status(403).json({ error: "FORBIDDEN", message: "Não é possível acessar a conta de outro administrador." })
  }

  const sub = target.subscriptions[0]
  const token = await signToken(target)
  const orgMember = await prisma.organizationMember.findUnique({
    where: { userId: target.id },
    include: { organization: { select: { id: true, name: true } } },
  })
  return res.json({
    token,
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      phone: target.phone || "",
      avatar: target.avatarUrl || null,
      role: target.role,
      orgId: orgMember?.organizationId || null,
      orgRole: orgMember?.role || null,
      orgName: orgMember?.organization?.name || null,
      plan: sub?.plan
        ? { id: sub.plan.id, name: sub.plan.name, slug: sub.plan.slug, maxGroups: sub.plan.maxGroups }
        : null,
    },
  })
})

router.patch("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    role: z.enum(["USER", "ADMIN"]).optional(),
    name: z.string().min(2).optional(),
    email: z.string().trim().email().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const id = req.params.id
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Utilizador não encontrado." })

  if (parsed.data.email) {
    const emailInUse = await prisma.user.findFirst({
      where: { email: parsed.data.email, id: { not: id } },
      select: { id: true },
    })
    if (emailInUse) {
      return res.status(409).json({ error: "EMAIL_IN_USE", message: "Este e-mail já está em uso." })
    }
  }

  const data = {}
  if (parsed.data.role !== undefined) data.role = parsed.data.role
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.email !== undefined) data.email = parsed.data.email

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "EMPTY_UPDATE", message: "Nada para atualizar." })
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { plan: { select: { id: true, name: true, slug: true, maxGroups: true } } },
      },
    },
  })

  res.json({ user: mapAdminUserRow(user) })
})

router.patch("/users/:id/subscription", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({ planId: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Plano inválido." })

  const id = req.params.id
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Utilizador não encontrado." })

  const plan = await prisma.plan.findUnique({ where: { id: parsed.data.planId } })
  if (!plan || !plan.active) {
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." })
  }

  const active = await prisma.subscription.findFirst({
    where: { userId: id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  })

  if (active) {
    await prisma.subscription.update({ where: { id: active.id }, data: { planId: plan.id } })
  } else {
    await prisma.subscription.create({ data: { userId: id, planId: plan.id, status: "ACTIVE" } })
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { plan: { select: { id: true, name: true, slug: true, maxGroups: true } } },
      },
    },
  })

  res.json({ user: mapAdminUserRow(user) })
})

router.delete("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const id = req.params.id
  if (id === req.adminUser.id) {
    return res.status(403).json({ error: "FORBIDDEN", message: "Você não pode excluir a própria conta." })
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Utilizador não encontrado." })

  await prisma.user.delete({ where: { id } })
  res.json({ ok: true })
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
    user: {
      ...created,
      createdAt: created.createdAt.toISOString(),
      plan: { id: freePlan.id, name: freePlan.name, slug: freePlan.slug, maxGroups: freePlan.maxGroups },
    },
  })
})

router.get("/plans", authMiddleware, requireAdmin, async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { active: true },
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

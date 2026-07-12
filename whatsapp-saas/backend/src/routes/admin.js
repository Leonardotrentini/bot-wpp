const express = require("express")
const { z } = require("zod")
const bcrypt = require("bcryptjs")
const { prisma } = require("../lib/prisma")
const { authMiddleware, signToken } = require("../lib/auth")
const { requireAdmin } = require("../lib/adminAuth")
const { ensureDefaultPlans } = require("../lib/ensureBillingDefaults")
const { ensureUserOrganization, backfillAllUserOrganizations } = require("../lib/orgScope")

const router = express.Router()

function mapAdminUserRow(u) {
  const plan = u.subscriptions[0]?.plan ?? null
  const member = u.organizationMember
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    plan: plan ? { id: plan.id, name: plan.name, slug: plan.slug, maxGroups: plan.maxGroups } : null,
    organization: member
      ? {
          id: member.organizationId,
          name: member.organization?.name || "",
          role: member.role,
        }
      : null,
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
        organizationMember: {
          include: { organization: { select: { id: true, name: true } } },
        },
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
      organizationMember: {
        include: { organization: { select: { id: true, name: true } } },
      },
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

router.get("/organizations", authMiddleware, requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || "20", 10) || 20))
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""

  const where = q ? { name: { contains: q, mode: "insensitive" } } : {}

  const [total, rows] = await prisma.$transaction([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                whatsappConnection: { select: { connected: true, phone: true } },
              },
            },
          },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        },
      },
    }),
  ])

  res.json({
    organizations: rows.map((org) => ({
      id: org.id,
      name: org.name,
      createdAt: org.createdAt.toISOString(),
      members: org.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        whatsappConnected: Boolean(m.user.whatsappConnection?.connected),
        whatsappPhone: m.user.whatsappConnection?.phone || null,
      })),
      memberCount: org.members.length,
      owner: org.members.find((m) => m.role === "OWNER")?.user || null,
    })),
    total,
    page,
    pageSize,
  })
})

router.post("/organizations/backfill", authMiddleware, requireAdmin, async (_req, res) => {
  const result = await backfillAllUserOrganizations()
  res.json(result)
})

router.patch("/organizations/:id", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({ name: z.string().trim().min(2).max(120) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nome inválido." })

  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: { name: parsed.data.name },
  })
  res.json({ organization: { id: org.id, name: org.name, createdAt: org.createdAt.toISOString() } })
})

router.post("/organizations/:id/members", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    userId: z.string().min(1),
    role: z.enum(["OWNER", "SELLER"]).default("SELLER"),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const orgId = req.params.id
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } })
  if (!user) return res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." })

  const existing = await prisma.organizationMember.findUnique({ where: { userId: parsed.data.userId } })
  if (existing) {
    return res.status(409).json({ error: "ALREADY_MEMBER", message: "Usuário já pertence a uma empresa." })
  }

  if (parsed.data.role === "OWNER") {
    const hasOwner = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, role: "OWNER" },
    })
    if (hasOwner) {
      return res.status(409).json({ error: "OWNER_EXISTS", message: "Esta empresa já tem um dono." })
    }
  }

  const member = await prisma.organizationMember.create({
    data: {
      organizationId: orgId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      joinedAt: new Date(),
    },
  })

  res.status(201).json({
    member: {
      userId: member.userId,
      role: member.role,
      organizationId: member.organizationId,
    },
  })
})

router.post("/organizations/:id/members/create", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: z.string().min(6),
    role: z.enum(["OWNER", "SELLER"]).default("SELLER"),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
  }

  const orgId = req.params.id
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })

  const email = parsed.data.email.toLowerCase()
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return res.status(409).json({ error: "EMAIL_IN_USE", message: "E-mail já cadastrado." })

  if (parsed.data.role === "OWNER") {
    const hasOwner = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, role: "OWNER" },
    })
    if (hasOwner) {
      return res.status(409).json({ error: "OWNER_EXISTS", message: "Esta empresa já tem um dono." })
    }
  }

  await ensureDefaultPlans()
  const freePlan = await prisma.plan.findUnique({ where: { slug: "free" } })
  if (!freePlan) {
    return res.status(503).json({ error: "NO_DEFAULT_PLAN", message: "Plano padrão indisponível." })
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10)
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { name: parsed.data.name, email, passwordHash, role: "USER" },
    })
    await tx.subscription.create({
      data: { userId: u.id, planId: freePlan.id, status: "ACTIVE" },
    })
    await tx.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: u.id,
        role: parsed.data.role,
        joinedAt: new Date(),
      },
    })
    return u
  })

  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: { id: orgId, name: org.name, role: parsed.data.role },
    },
  })
})

router.patch("/organizations/:orgId/members/:userId", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({ role: z.enum(["OWNER", "SELLER"]) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Papel inválido." })

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: req.params.orgId, userId: req.params.userId },
  })
  if (!member) return res.status(404).json({ error: "NOT_FOUND", message: "Membro não encontrado." })

  if (parsed.data.role === "OWNER" && member.role !== "OWNER") {
    const hasOwner = await prisma.organizationMember.findFirst({
      where: { organizationId: req.params.orgId, role: "OWNER" },
    })
    if (hasOwner) {
      return res.status(409).json({ error: "OWNER_EXISTS", message: "Esta empresa já tem um dono." })
    }
  }

  const updated = await prisma.organizationMember.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
  })

  res.json({ member: { userId: updated.userId, role: updated.role, organizationId: updated.organizationId } })
})

router.delete("/organizations/:orgId/members/:userId", authMiddleware, requireAdmin, async (req, res) => {
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: req.params.orgId, userId: req.params.userId },
  })
  if (!member) return res.status(404).json({ error: "NOT_FOUND", message: "Membro não encontrado." })
  if (member.role === "OWNER") {
    return res.status(400).json({ error: "CANNOT_REMOVE_OWNER", message: "Não é possível remover o dono da empresa." })
  }

  await prisma.organizationMember.delete({ where: { id: member.id } })
  res.json({ ok: true })
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
      organizationMember: {
        include: { organization: { select: { id: true, name: true } } },
      },
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

router.post("/organizations", authMiddleware, requireAdmin, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(120),
    ownerUserId: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nome inválido." })

  if (parsed.data.ownerUserId) {
    const ownerUser = await prisma.user.findUnique({ where: { id: parsed.data.ownerUserId } })
    if (!ownerUser) return res.status(404).json({ error: "NOT_FOUND", message: "Usuário dono não encontrado." })
    const existingMember = await prisma.organizationMember.findUnique({ where: { userId: parsed.data.ownerUserId } })
    if (existingMember) {
      return res.status(409).json({ error: "ALREADY_MEMBER", message: "Usuário já pertence a uma empresa." })
    }
  }

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name: parsed.data.name } })
    if (parsed.data.ownerUserId) {
      await tx.organizationMember.create({
        data: {
          organizationId: created.id,
          userId: parsed.data.ownerUserId,
          role: "OWNER",
          joinedAt: new Date(),
        },
      })
    }
    return created
  })

  res.status(201).json({
    organization: { id: org.id, name: org.name, createdAt: org.createdAt.toISOString() },
  })
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

  if (role === "USER") {
    await ensureUserOrganization(created.id)
  }

  const full = await prisma.user.findUnique({
    where: { id: created.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      organizationMember: {
        include: { organization: { select: { id: true, name: true } } },
      },
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { plan: { select: { id: true, name: true, slug: true, maxGroups: true } } },
      },
    },
  })

  res.status(201).json({ user: mapAdminUserRow(full) })
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

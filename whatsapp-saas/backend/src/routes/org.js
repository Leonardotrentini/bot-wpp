const express = require("express")
const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware, signToken } = require("../lib/auth")
const { requireOrgOwner, readUserFilter, assertUserInScope } = require("../lib/orgScope")

function createOrgRouter() {
  const router = express.Router()
  router.use(authMiddleware)

  router.get("/", async (req, res) => {
    const scope = req.dataScope
    const org = await prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: { id: true, name: true, createdAt: true },
    })
    if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })

    return res.json({
      organization: {
        ...org,
        createdAt: org.createdAt.toISOString(),
      },
      role: scope.orgRole,
      isOwner: scope.isOwner,
    })
  })

  router.get("/members", requireOrgOwner, async (req, res) => {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: req.dataScope.orgId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
            whatsappConnection: {
              select: { status: true, phone: true, qrCode: true, updatedAt: true },
            },
          },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    })

    const sellers = members
      .filter((m) => m.role === "SELLER" || m.role === "OWNER")
      .map((m) => {
        const conn = m.user.whatsappConnection
        return {
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl || null,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
          invitedAt: m.invitedAt?.toISOString() || null,
          whatsapp: {
            connected: Boolean(conn?.connected),
            status: conn?.connected ? "connected" : "disconnected",
            phone: conn?.phone || null,
            updatedAt: conn?.updatedAt?.toISOString() || null,
          },
        }
      })

    const pendingInvites = await prisma.orgInvite.findMany({
      where: {
        organizationId: req.dataScope.orgId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    })

    return res.json({
      members: sellers,
      pendingInvites: pendingInvites.map((i) => ({
        id: i.id,
        email: i.email,
        name: i.name,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
    })
  })

  router.post("/members/invite", requireOrgOwner, async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nome e e-mail válidos são obrigatórios." })
    }

    const { name, email } = parsed.data
    const normalizedEmail = email.toLowerCase()

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      const existingMember = await prisma.organizationMember.findUnique({ where: { userId: existingUser.id } })
      if (existingMember) {
        return res.status(409).json({
          error: "ALREADY_MEMBER",
          message: "Este e-mail já pertence a uma empresa.",
        })
      }
    }

    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const invite = await prisma.orgInvite.create({
      data: {
        organizationId: req.dataScope.orgId,
        email: normalizedEmail,
        name,
        token,
        role: "SELLER",
        expiresAt,
      },
    })

    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:5173"
    const inviteUrl = `${baseUrl.replace(/\/$/, "")}/accept-invite?token=${token}`

    return res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        name: invite.name,
        expiresAt: invite.expiresAt.toISOString(),
        inviteUrl,
      },
    })
  })

  router.delete("/members/:userId", requireOrgOwner, async (req, res) => {
    const targetUserId = req.params.userId
    if (targetUserId === req.user.sub) {
      return res.status(400).json({ error: "CANNOT_REMOVE_SELF", message: "O dono não pode remover a si mesmo." })
    }

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: req.dataScope.orgId, userId: targetUserId },
    })
    if (!member) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Membro não encontrado nesta empresa." })
    }
    if (member.role === "OWNER") {
      const owners = await prisma.organizationMember.count({
        where: { organizationId: req.dataScope.orgId, role: "OWNER" },
      })
      if (owners <= 1) {
        return res.status(400).json({
          error: "LAST_OWNER",
          message: "Não é possível remover o único dono da empresa.",
        })
      }
    }

    await prisma.organizationMember.delete({ where: { id: member.id } })
    return res.json({ ok: true })
  })

  /** Dono define/remove foto de perfil de um membro (aparece na bolinha do Kanban). */
  router.patch("/members/:userId/avatar", requireOrgOwner, async (req, res) => {
    const targetUserId = req.params.userId
    const schema = z.object({
      avatar: z.string().max(1_000_000).nullable(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Envie avatar (data URL) ou null para remover.",
      })
    }

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: req.dataScope.orgId, userId: targetUserId },
      select: { id: true },
    })
    if (!member) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Membro não encontrado nesta empresa." })
    }

    const avatar = parsed.data.avatar
    if (avatar != null && avatar !== "" && !String(avatar).startsWith("data:image/")) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Avatar inválido. Use uma imagem (JPG/PNG).",
      })
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { avatarUrl: avatar || null },
      select: { id: true, name: true, email: true, avatarUrl: true },
    })

    return res.json({
      member: {
        userId: updated.id,
        name: updated.name,
        email: updated.email,
        avatarUrl: updated.avatarUrl || null,
      },
    })
  })

  router.get("/sellers", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono pode listar vendedores." })
    }

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: req.dataScope.orgId, role: "SELLER" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    })

    return res.json({
      sellers: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
    })
  })

  return router
}

async function handleAcceptInvite(req, res) {
  const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(6).max(128),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Token e senha válidos são obrigatórios." })
  }

  const { token, password } = parsed.data
  const invite = await prisma.orgInvite.findUnique({ where: { token } })
  if (!invite || invite.expiresAt < new Date()) {
    return res.status(400).json({ error: "INVALID_INVITE", message: "Convite inválido ou expirado." })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const normalizedEmail = invite.email.toLowerCase()

  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (user) {
    const existingMember = await prisma.organizationMember.findUnique({ where: { userId: user.id } })
    if (existingMember) {
      return res.status(409).json({ error: "ALREADY_MEMBER", message: "Este usuário já pertence a uma empresa." })
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, name: invite.name },
    })
  } else {
    const { ensureDefaultPlans } = require("../lib/ensureBillingDefaults")
    await ensureDefaultPlans()
    const freePlan = await prisma.plan.findUnique({ where: { slug: "free" } })

    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { name: invite.name, email: normalizedEmail, passwordHash },
      })
      if (freePlan) {
        await tx.subscription.create({
          data: { userId: u.id, planId: freePlan.id, status: "ACTIVE" },
        })
      }
      return u
    })
  }

  await prisma.$transaction([
    prisma.organizationMember.create({
      data: {
        organizationId: invite.organizationId,
        userId: user.id,
        role: invite.role,
        invitedAt: invite.createdAt,
        joinedAt: new Date(),
      },
    }),
    prisma.orgInvite.delete({ where: { id: invite.id } }),
  ])

  const jwtToken = await signToken(user)
  const orgCtx = await prisma.organizationMember.findUnique({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
  })

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      avatar: user.avatarUrl || null,
      role: user.role,
      orgId: orgCtx?.organizationId || null,
      orgRole: orgCtx?.role || null,
      orgName: orgCtx?.organization?.name || null,
    },
    token: jwtToken,
  })
}

module.exports = { createOrgRouter, handleAcceptInvite }

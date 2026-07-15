const express = require("express")
const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware, signToken } = require("../lib/auth")
const { requireOrgOwner } = require("../lib/orgScope")
const { validateMediaContentSize } = require("../lib/mediaLimits")

function formatMaterialRow(row) {
  const hasMedia = Boolean(row.mediaBase64)
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    body: row.body || "",
    url: row.url || null,
    shortcut: row.shortcut || null,
    sortOrder: row.sortOrder ?? 0,
    mediaType: hasMedia ? "document" : "none",
    mediaMime: row.mediaMime || null,
    mediaName: row.mediaName || null,
    hasMedia,
    createdByUserId: row.createdByUserId || null,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  }
}

function createOrgRouter() {
  const router = express.Router()
  router.use(authMiddleware)

  router.get("/", async (req, res) => {
    const scope = req.dataScope
    const org = await prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: { id: true, name: true, dailySalesGoal: true, createdAt: true },
    })
    if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })

    return res.json({
      organization: {
        ...org,
        dailySalesGoal: org.dailySalesGoal != null ? Number(org.dailySalesGoal) : null,
        createdAt: org.createdAt.toISOString(),
      },
      role: scope.orgRole,
      isOwner: scope.isOwner,
    })
  })

  router.patch("/", requireOrgOwner, async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(120).optional(),
      dailySalesGoal: z.union([z.number().nonnegative(), z.null()]).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    }
    const data = {}
    if (parsed.data.name != null) data.name = parsed.data.name
    if (parsed.data.dailySalesGoal !== undefined) data.dailySalesGoal = parsed.data.dailySalesGoal
    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nada para atualizar." })
    }
    const org = await prisma.organization.update({
      where: { id: req.dataScope.orgId },
      data,
      select: { id: true, name: true, dailySalesGoal: true, createdAt: true },
    })
    return res.json({
      organization: {
        ...org,
        dailySalesGoal: org.dailySalesGoal != null ? Number(org.dailySalesGoal) : null,
        createdAt: org.createdAt.toISOString(),
      },
    })
  })

  // ------------------------- Materiais da loja -------------------------

  router.get("/materials", async (req, res) => {
    if (!req.dataScope?.orgId) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })
    }
    const rows = await prisma.orgMaterial.findMany({
      where: { organizationId: req.dataScope.orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    return res.json({ materials: rows.map(formatMaterialRow) })
  })

  const materialSchema = z.object({
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["document", "link"]),
    body: z.string().max(4096).optional().default(""),
    url: z.string().url().max(2000).optional().nullable(),
    shortcut: z
      .string()
      .max(30)
      .regex(/^[a-z0-9_-]*$/i)
      .optional()
      .nullable(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    mediaBase64: z.string().optional().nullable(),
    mediaMime: z.string().max(120).optional().nullable(),
    mediaName: z.string().max(255).optional().nullable(),
  })

  router.post("/materials", requireOrgOwner, async (req, res) => {
    const parsed = materialSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Material inválido." })
    }
    const data = parsed.data
    if (data.kind === "link" && !data.url) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe o link do material." })
    }
    if (data.kind === "document") {
      if (!data.mediaBase64) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "Envie o PDF do material." })
      }
      const mediaError = validateMediaContentSize({
        body: data.body || "",
        mediaType: "document",
        mediaBase64: data.mediaBase64,
        mediaMime: data.mediaMime || "application/pdf",
        mediaName: data.mediaName || "catalogo.pdf",
      })
      if (mediaError) return res.status(400).json({ error: "VALIDATION_ERROR", message: mediaError })
    }

    const mediaB64 =
      data.kind === "document" && data.mediaBase64
        ? String(data.mediaBase64).replace(/^data:[^;]+;base64,/, "")
        : null

    const row = await prisma.orgMaterial.create({
      data: {
        organizationId: req.dataScope.orgId,
        title: data.title,
        kind: data.kind,
        body: data.body || "",
        url: data.kind === "link" ? data.url : null,
        shortcut: data.shortcut ? data.shortcut.toLowerCase() : null,
        sortOrder: data.sortOrder ?? 0,
        mediaBase64: mediaB64,
        mediaMime: data.kind === "document" ? data.mediaMime || "application/pdf" : null,
        mediaName: data.kind === "document" ? data.mediaName || "catalogo.pdf" : null,
        createdByUserId: req.user.sub,
      },
    })
    return res.status(201).json({ material: formatMaterialRow(row) })
  })

  router.put("/materials/:id", requireOrgOwner, async (req, res) => {
    const existing = await prisma.orgMaterial.findFirst({
      where: { id: req.params.id, organizationId: req.dataScope.orgId },
    })
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Material não encontrado." })

    const parsed = materialSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Material inválido." })
    }
    const data = parsed.data
    if (data.kind === "link" && !data.url) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe o link do material." })
    }

    let mediaB64 = existing.mediaBase64
    let mediaMime = existing.mediaMime
    let mediaName = existing.mediaName
    if (data.kind === "document") {
      if (data.mediaBase64) {
        const mediaError = validateMediaContentSize({
          body: data.body || "",
          mediaType: "document",
          mediaBase64: data.mediaBase64,
          mediaMime: data.mediaMime || "application/pdf",
          mediaName: data.mediaName || "catalogo.pdf",
        })
        if (mediaError) return res.status(400).json({ error: "VALIDATION_ERROR", message: mediaError })
        mediaB64 = String(data.mediaBase64).replace(/^data:[^;]+;base64,/, "")
        mediaMime = data.mediaMime || "application/pdf"
        mediaName = data.mediaName || "catalogo.pdf"
      } else if (!mediaB64) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "Envie o PDF do material." })
      }
    } else {
      mediaB64 = null
      mediaMime = null
      mediaName = null
    }

    const row = await prisma.orgMaterial.update({
      where: { id: existing.id },
      data: {
        title: data.title,
        kind: data.kind,
        body: data.body || "",
        url: data.kind === "link" ? data.url : null,
        shortcut: data.shortcut ? data.shortcut.toLowerCase() : null,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        mediaBase64: mediaB64,
        mediaMime,
        mediaName,
      },
    })
    return res.json({ material: formatMaterialRow(row) })
  })

  router.delete("/materials/:id", requireOrgOwner, async (req, res) => {
    const existing = await prisma.orgMaterial.findFirst({
      where: { id: req.params.id, organizationId: req.dataScope.orgId },
    })
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Material não encontrado." })
    await prisma.orgMaterial.delete({ where: { id: existing.id } })
    return res.json({ ok: true })
  })

  router.get("/materials/:id/content", async (req, res) => {
    if (!req.dataScope?.orgId) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Empresa não encontrada." })
    }
    const row = await prisma.orgMaterial.findFirst({
      where: { id: req.params.id, organizationId: req.dataScope.orgId },
    })
    if (!row) return res.status(404).json({ error: "NOT_FOUND", message: "Material não encontrado." })
    return res.json({
      material: {
        ...formatMaterialRow(row),
        mediaBase64: row.mediaBase64 || null,
      },
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
            createdAt: true,
            whatsappConnection: {
              select: { connected: true, status: true, phone: true, qrCode: true, updatedAt: true },
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
      select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true, token: true },
      orderBy: { createdAt: "desc" },
    })

    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:5173"
    const inviteBase = baseUrl.replace(/\/$/, "")

    return res.json({
      members: sellers,
      pendingInvites: pendingInvites.map((i) => ({
        id: i.id,
        email: i.email,
        name: i.name,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
        inviteUrl: `${inviteBase}/accept-invite?token=${i.token}`,
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
      return res.status(400).json({ error: "CANNOT_REMOVE_OWNER", message: "Não é possível remover o dono da empresa." })
    }

    await prisma.organizationMember.delete({ where: { id: member.id } })
    return res.json({ ok: true })
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

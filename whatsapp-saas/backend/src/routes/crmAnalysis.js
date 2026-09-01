/**
 * Rotas de análise de conversas por IA — perfis, runs e resultados.
 */

const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { readUserFilter, assertUserInScope } = require("../lib/orgScope")
const { CONVERSATION_INCLUDE } = require("../lib/crmCore")
const { DEFAULT_ANALYSIS_CRITERIA, DEFAULT_ANALYSIS_SYSTEM_PROMPT } = require("../lib/crmAnalysisDefaults")
const {
  aiConfigured,
  scheduleAnalysisRun,
  formatProfileRow,
  formatAnalysisRow,
  formatRunRow,
} = require("../lib/crmAnalysisAgent")

const criterionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  weight: z.number().min(0.1).max(5).optional(),
})

const profileSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  criteria: z.array(criterionSchema).min(1).max(20),
  systemPrompt: z.string().min(10).max(12000),
  model: z.string().max(64).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(200).max(4000).optional(),
  minMessages: z.number().int().min(1).max(50).optional(),
  maxMessages: z.number().int().min(10).max(200).optional(),
  locale: z.string().max(12).optional(),
})

function registerCrmAnalysisRoutes(router) {
  function resolveScopeUserIds(req, sellerUserIds) {
    const scope = req.dataScope
    const requested = Array.isArray(sellerUserIds) ? sellerUserIds.map(String).filter(Boolean) : []

    if (scope.isOwner) {
      if (!requested.length) return [...scope.userIds]
      for (const id of requested) {
        if (!assertUserInScope(scope, id)) {
          const err = new Error("Vendedor fora do escopo da organização.")
          err.code = "FORBIDDEN"
          throw err
        }
      }
      return requested
    }

    if (requested.length && (requested.length > 1 || requested[0] !== scope.actorId)) {
      const err = new Error("Somente o dono da empresa pode analisar outros vendedores.")
      err.code = "FORBIDDEN"
      throw err
    }
    return [scope.actorId]
  }

  router.get("/analysis/status", async (req, res) => {
    return res.json({ aiConfigured: aiConfigured() })
  })

  router.get("/analysis/profiles", async (req, res) => {
    const rows = await prisma.crmAnalysisProfile.findMany({
      where: { userId: req.user.sub },
      orderBy: { updatedAt: "desc" },
    })
    return res.json({ profiles: rows.map(formatProfileRow) })
  })

  router.post("/analysis/profiles", async (req, res) => {
    const parsed = profileSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados do perfil inválidos." })
    }
    const data = parsed.data
    const row = await prisma.crmAnalysisProfile.create({
      data: {
        userId: req.user.sub,
        name: data.name,
        enabled: data.enabled !== false,
        criteria: data.criteria,
        systemPrompt: data.systemPrompt,
        model: data.model || "gpt-4o-mini",
        temperature: data.temperature ?? 0.2,
        maxTokens: data.maxTokens ?? 1200,
        minMessages: data.minMessages ?? 2,
        maxMessages: data.maxMessages ?? 80,
        locale: data.locale || "pt-BR",
      },
    })
    return res.status(201).json({ profile: formatProfileRow(row) })
  })

  router.post("/analysis/profiles/default", async (req, res) => {
    const existing = await prisma.crmAnalysisProfile.findFirst({
      where: { userId: req.user.sub, name: "Análise de vendas" },
    })
    if (existing) return res.json({ profile: formatProfileRow(existing), created: false })

    const row = await prisma.crmAnalysisProfile.create({
      data: {
        userId: req.user.sub,
        name: "Análise de vendas",
        enabled: true,
        criteria: DEFAULT_ANALYSIS_CRITERIA,
        systemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT,
      },
    })
    return res.status(201).json({ profile: formatProfileRow(row), created: true })
  })

  router.put("/analysis/profiles/:id", async (req, res) => {
    const existing = await prisma.crmAnalysisProfile.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    })
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Perfil não encontrado." })

    const parsed = profileSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    }
    const row = await prisma.crmAnalysisProfile.update({
      where: { id: existing.id },
      data: parsed.data,
    })
    return res.json({ profile: formatProfileRow(row) })
  })

  router.delete("/analysis/profiles/:id", async (req, res) => {
    const existing = await prisma.crmAnalysisProfile.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    })
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Perfil não encontrado." })
    await prisma.crmAnalysisProfile.delete({ where: { id: existing.id } })
    return res.json({ ok: true })
  })

  router.post("/analysis/runs", async (req, res) => {
    if (!aiConfigured()) {
      return res.status(503).json({
        error: "AI_NOT_CONFIGURED",
        message: "Configure OPENAI_API_KEY no servidor para usar análise por IA.",
      })
    }

    const schema = z.object({
      profileId: z.string().min(1),
      sellerUserIds: z.array(z.string()).optional(),
      periodFrom: z.string().datetime().optional(),
      periodTo: z.string().datetime().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Parâmetros inválidos." })
    }

    const profile = await prisma.crmAnalysisProfile.findFirst({
      where: { id: parsed.data.profileId, userId: req.user.sub },
    })
    if (!profile) return res.status(404).json({ error: "NOT_FOUND", message: "Perfil não encontrado." })

    let scopeUserIds
    try {
      scopeUserIds = resolveScopeUserIds(req, parsed.data.sellerUserIds)
    } catch (err) {
      if (err.code === "FORBIDDEN") return res.status(403).json({ error: err.code, message: err.message })
      throw err
    }

    const run = await prisma.crmAnalysisRun.create({
      data: {
        userId: req.user.sub,
        profileId: profile.id,
        scopeUserIds,
        periodFrom: parsed.data.periodFrom ? new Date(parsed.data.periodFrom) : null,
        periodTo: parsed.data.periodTo ? new Date(parsed.data.periodTo) : null,
        status: "running",
      },
    })

    scheduleAnalysisRun(prisma, run.id)

    return res.status(202).json({ run: formatRunRow(run) })
  })

  router.get("/analysis/runs/:id", async (req, res) => {
    const run = await prisma.crmAnalysisRun.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    })
    if (!run) return res.status(404).json({ error: "NOT_FOUND", message: "Execução não encontrada." })
    return res.json({ run: formatRunRow(run) })
  })

  router.get("/analysis/runs/:id/results", async (req, res) => {
    const run = await prisma.crmAnalysisRun.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    })
    if (!run) return res.status(404).json({ error: "NOT_FOUND", message: "Execução não encontrada." })

    const sellerUserId = req.query.sellerUserId ? String(req.query.sellerUserId) : null
    const where = { runId: run.id }
    if (sellerUserId) where.userId = sellerUserId

    const rows = await prisma.crmConversationAnalysis.findMany({
      where,
      orderBy: { analyzedAt: "desc" },
      take: Math.min(200, Number(req.query.limit) || 100),
    })

    const convIds = [...new Set(rows.map((r) => r.conversationId))]
    const convos = await prisma.crmConversation.findMany({
      where: { id: { in: convIds } },
      include: CONVERSATION_INCLUDE,
    })
    const convMap = Object.fromEntries(convos.map((c) => [c.id, c]))

    return res.json({
      run: formatRunRow(run),
      results: rows.map((r) => formatAnalysisRow(r, convMap[r.conversationId])),
    })
  })

  router.get("/conversations/:id/analysis", async (req, res) => {
    const uf = readUserFilter(req.dataScope)
    const convo = await prisma.crmConversation.findFirst({
      where: { id: req.params.id, ...uf },
      include: CONVERSATION_INCLUDE,
    })
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const profileId = req.query.profileId ? String(req.query.profileId) : null
    const where = { conversationId: convo.id }
    if (profileId) where.profileId = profileId

    const rows = await prisma.crmConversationAnalysis.findMany({
      where,
      orderBy: { analyzedAt: "desc" },
      take: 5,
    })
    return res.json({ analyses: rows.map((r) => formatAnalysisRow(r, convo)) })
  })
}

module.exports = { registerCrmAnalysisRoutes }

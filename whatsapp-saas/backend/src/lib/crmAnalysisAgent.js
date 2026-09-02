/**
 * Motor de análise de conversas — uma análise IA por conversa com critérios customizados.
 */

const crypto = require("crypto")
const { callChatCompletion, aiConfigured } = require("./crmAiAgent")
const { CONVERSATION_INCLUDE } = require("./crmCore")
const { buildSellerSummaries, buildGeneralNarrative } = require("./crmAnalysisAggregate")

const ANALYSIS_DELAY_MS = Number(process.env.CRM_ANALYSIS_DELAY_MS || 800)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function formatTranscriptLine(msg) {
  const ts = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp)
  const when = Number.isNaN(ts.getTime()) ? "?" : ts.toISOString().slice(0, 16).replace("T", " ")
  const role = msg.fromMe ? "VENDEDOR" : "CLIENTE"
  const body = String(msg.body || `[${msg.type || "mídia"}]`).trim().slice(0, 2000)
  return `[${when}] ${role}: ${body}`
}

function isAnalyzableMessage(msg) {
  if (!msg) return false
  const src = String(msg.source || "")
  if (["flow", "ai"].includes(src)) return false
  return true
}

async function loadConversationTranscript(prisma, conversationId, { maxMessages = 80 } = {}) {
  const messages = await prisma.crmMessage.findMany({
    where: { conversationId },
    orderBy: { timestamp: "asc" },
    take: Math.min(200, Math.max(10, maxMessages * 2)),
    select: { id: true, fromMe: true, body: true, type: true, source: true, timestamp: true },
  })
  const filtered = messages.filter(isAnalyzableMessage).slice(-maxMessages)
  return filtered
}

function buildAggregateKey(conversation, messageCount, lastTs) {
  const raw = `${conversation.id}:${messageCount}:${lastTs?.toISOString?.() || ""}`
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)
}

function buildAnalysisPrompt(profile, transcript, contactName) {
  const criteria = Array.isArray(profile.criteria) ? profile.criteria : []
  const criteriaBlock = criteria
    .map(
      (c) =>
        `- id="${c.id}" label="${c.label}" (peso ${c.weight || 1}): ${c.description || c.label}. Nota 1-5.`,
    )
    .join("\n")

  return `${profile.systemPrompt || ""}

LOCALE: ${profile.locale || "pt-BR"}
CONTATO: ${contactName || "Lead"}

CRITÉRIOS (use exatamente estes nomes no campo "nome" de cada item em "criterios"):
${criteriaBlock}

TRANSCRITO DA CONVERSA:
${transcript}`
}

function resolveCriterionId(criteria, nome, index) {
  const list = Array.isArray(criteria) ? criteria : []
  const norm = String(nome || "")
    .trim()
    .toLowerCase()
  const byLabel = list.find((c) => String(c.label || "").trim().toLowerCase() === norm)
  if (byLabel?.id) return String(byLabel.id)
  if (list[index]?.id) return String(list[index].id)
  return `criterio_${index + 1}`
}

function parseNota(value) {
  if (value == null) return null
  const raw = String(value).trim().toUpperCase()
  if (raw === "N/A" || raw === "NA") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10))
}

function parseNewFormat(parsed, criteria) {
  const criterios = Array.isArray(parsed.criterios) ? parsed.criterios : []
  const resumo = parsed.resumo_geral && typeof parsed.resumo_geral === "object" ? parsed.resumo_geral : {}

  const scores = {}
  const failures = []

  criterios.forEach((c, index) => {
    const criterionId = resolveCriterionId(criteria, c.nome, index)
    const nota = parseNota(c.nota)
    if (nota != null) scores[criterionId] = nota

    failures.push({
      criterionId,
      criterionName: String(c.nome || "").slice(0, 120),
      nota,
      issue: String(c.analise || "").slice(0, 2000),
      quote: c.exemplo_negativo ? String(c.exemplo_negativo).slice(0, 300) : null,
      positiveQuote: c.exemplo_positivo ? String(c.exemplo_positivo).slice(0, 300) : null,
      suggestion: c.sugestao ? String(c.sugestao).slice(0, 500) : null,
    })
  })

  let overallScore = parseNota(resumo.nota_final)
  if (overallScore == null) {
    const vals = Object.values(scores).filter((n) => Number.isFinite(Number(n)))
    overallScore = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null
  }

  const strengths = Array.isArray(resumo.pontos_fortes)
    ? resumo.pontos_fortes.map(String).filter(Boolean).slice(0, 8)
    : []
  const weaknesses = Array.isArray(resumo.pontos_fracos)
    ? resumo.pontos_fracos.map(String).filter(Boolean).slice(0, 8)
    : []

  const summaryParts = []
  if (resumo.momento_critico) summaryParts.push(String(resumo.momento_critico).trim())
  if (resumo.acao_prioritaria) {
    summaryParts.push(`Ação prioritária: ${String(resumo.acao_prioritaria).trim()}`)
  }
  const summary = summaryParts.join("\n\n") || "Análise sem resumo."

  return {
    scores,
    overallScore,
    summary,
    strengths,
    weaknesses,
    failures,
    resumoGeral: {
      momentoCritico: resumo.momento_critico ? String(resumo.momento_critico) : null,
      acaoPrioritaria: resumo.acao_prioritaria ? String(resumo.acao_prioritaria) : null,
    },
  }
}

function parseLegacyFormat(parsed, criteria) {
  const scores = parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {}
  for (const c of criteria || []) {
    const id = String(c.id || "")
    if (scores[id] == null) continue
    scores[id] = Math.min(5, Math.max(1, Math.round(Number(scores[id]) * 10) / 10))
  }

  let overallScore = Number(parsed.overallScore)
  if (!Number.isFinite(overallScore)) {
    const vals = Object.values(scores).filter((n) => Number.isFinite(Number(n)))
    overallScore = vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : null
  }

  return {
    scores,
    overallScore: overallScore != null ? Math.round(overallScore * 100) / 100 : null,
    summary: String(parsed.summary || "").trim() || "Análise sem resumo.",
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).filter(Boolean).slice(0, 8) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String).filter(Boolean).slice(0, 8) : [],
    failures: Array.isArray(parsed.failures)
      ? parsed.failures.slice(0, 12).map((f) => ({
          criterionId: String(f.criterionId || f.criterion || ""),
          issue: String(f.issue || f.description || "").slice(0, 500),
          quote: f.quote ? String(f.quote).slice(0, 300) : null,
          suggestion: f.suggestion ? String(f.suggestion).slice(0, 500) : null,
        }))
      : [],
    resumoGeral: null,
  }
}

function parseAnalysisJson(content, criteria) {
  let parsed = {}
  try {
    const cleaned = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim()
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = { summary: String(content || "").slice(0, 4000), scores: {}, failures: [] }
  }

  if (Array.isArray(parsed.criterios) || parsed.resumo_geral) {
    return parseNewFormat(parsed, criteria)
  }
  return parseLegacyFormat(parsed, criteria)
}

async function analyzeOneConversation(prisma, profile, conversation) {
  const msgs = await loadConversationTranscript(prisma, conversation.id, {
    maxMessages: profile.maxMessages || 80,
  })
  if (msgs.length < (profile.minMessages || 2)) {
    return { skipped: true, reason: "min_messages", messageCount: msgs.length }
  }

  const transcript = msgs.map(formatTranscriptLine).join("\n")
  const contactName =
    conversation.contact?.savedName ||
    conversation.contact?.pushName ||
    conversation.contact?.phone ||
    conversation.remoteJid

  const userContent = buildAnalysisPrompt(profile, transcript, contactName)
  const completion = await callChatCompletion({
    model: "gpt-4o-mini",
    temperature: profile.temperature ?? 0.2,
    maxTokens: profile.maxTokens || 2500,
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: "Você retorna apenas JSON válido para análise de vendas." },
      { role: "user", content: userContent },
    ],
  })

  const criteria = Array.isArray(profile.criteria) ? profile.criteria : []
  const parsed = parseAnalysisJson(completion.content, criteria)
  const failuresToStore = [...parsed.failures]
  if (parsed.resumoGeral?.momentoCritico || parsed.resumoGeral?.acaoPrioritaria) {
    failuresToStore.push({
      criterionId: "_resumo",
      resumoGeral: parsed.resumoGeral,
    })
  }
  const lastTs = msgs[msgs.length - 1]?.timestamp
  const aggregateKey = buildAggregateKey(conversation, msgs.length, lastTs)

  const row = await prisma.crmConversationAnalysis.upsert({
    where: {
      profileId_conversationId_aggregateKey: {
        profileId: profile.id,
        conversationId: conversation.id,
        aggregateKey,
      },
    },
    create: {
      profileId: profile.id,
      userId: conversation.userId,
      conversationId: conversation.id,
      messageCount: msgs.length,
      scores: parsed.scores,
      failures: failuresToStore,
      summary: parsed.summary,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      overallScore: parsed.overallScore,
      aggregateKey,
    },
    update: {
      messageCount: msgs.length,
      scores: parsed.scores,
      failures: failuresToStore,
      summary: parsed.summary,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      overallScore: parsed.overallScore,
      analyzedAt: new Date(),
    },
  })

  return { skipped: false, analysis: row, messageCount: msgs.length }
}

async function listConversationsForRun(prisma, { scopeUserIds, periodFrom, periodTo, conversationIds, minMessages = 2 }) {
  const where = {
    userId: scopeUserIds.length === 1 ? scopeUserIds[0] : { in: scopeUserIds },
  }
  if (periodFrom || periodTo) {
    where.lastMessageAt = {}
    if (periodFrom) where.lastMessageAt.gte = periodFrom
    if (periodTo) where.lastMessageAt.lte = periodTo
  }
  if (Array.isArray(conversationIds) && conversationIds.length) {
    where.id = { in: conversationIds.map(String) }
  }

  const conversations = await prisma.crmConversation.findMany({
    where,
    include: CONVERSATION_INCLUDE,
    orderBy: { lastMessageAt: "desc" },
    take: 500,
  })

  const eligible = []
  for (const conv of conversations) {
    const count = await prisma.crmMessage.count({
      where: {
        conversationId: conv.id,
        source: { notIn: ["flow", "ai"] },
      },
    })
    if (count >= minMessages) eligible.push(conv)
  }
  return eligible
}

const activeRuns = new Set()

async function processAnalysisRun(prisma, runId) {
  if (activeRuns.has(runId)) return
  activeRuns.add(runId)

  try {
    const run = await prisma.crmAnalysisRun.findUnique({
      where: { id: runId },
      include: { profile: true },
    })
    if (!run || run.status !== "running") return

    const profile = run.profile
    if (!profile?.enabled) {
      await prisma.crmAnalysisRun.update({
        where: { id: runId },
        data: { status: "error", error: "Perfil de análise desativado.", finishedAt: new Date() },
      })
      return
    }

    const conversations = await listConversationsForRun(prisma, {
      scopeUserIds: run.scopeUserIds,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      minMessages: profile.minMessages || 2,
    })

    await prisma.crmAnalysisRun.update({
      where: { id: runId },
      data: { totalConversations: conversations.length, doneConversations: 0 },
    })

    let done = 0
    for (const conv of conversations) {
      const current = await prisma.crmAnalysisRun.findUnique({ where: { id: runId }, select: { status: true } })
      if (current?.status === "cancelled") break

      try {
        const result = await analyzeOneConversation(prisma, profile, conv)
        if (!result.skipped) {
          await prisma.crmConversationAnalysis.update({
            where: { id: result.analysis.id },
            data: { runId },
          })
        }
      } catch (err) {
        console.error(`[crm-analysis] conv ${conv.id}:`, err?.message || err)
      }

      done += 1
      await prisma.crmAnalysisRun.update({
        where: { id: runId },
        data: { doneConversations: done },
      })
      await wait(ANALYSIS_DELAY_MS)
    }

    const analyses = await prisma.crmConversationAnalysis.findMany({
      where: { runId },
    })

    const users = await prisma.user.findMany({
      where: { id: { in: run.scopeUserIds } },
      select: { id: true, name: true },
    })
    const sellerNames = Object.fromEntries(users.map((u) => [u.id, u.name]))

    const aggregate = buildSellerSummaries(analyses, profile.criteria, sellerNames)
    const narrative = buildGeneralNarrative(aggregate, profile.criteria)

    await prisma.crmAnalysisRun.update({
      where: { id: runId },
      data: {
        status: "done",
        finishedAt: new Date(),
        sellerSummaries: { ...aggregate, narrative },
      },
    })
  } catch (err) {
    console.error("[crm-analysis] run failed:", err?.message || err)
    await prisma.crmAnalysisRun
      .update({
        where: { id: runId },
        data: { status: "error", error: err?.message || String(err), finishedAt: new Date() },
      })
      .catch(() => {})
  } finally {
    activeRuns.delete(runId)
  }
}

function scheduleAnalysisRun(prisma, runId) {
  setImmediate(() => {
    processAnalysisRun(prisma, runId).catch((err) => console.error("[crm-analysis] background:", err?.message || err))
  })
}

function formatProfileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    criteria: row.criteria,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    minMessages: row.minMessages,
    maxMessages: row.maxMessages,
    locale: row.locale,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  }
}

function formatAnalysisRow(row, conversation) {
  const allFailures = Array.isArray(row.failures) ? row.failures : []
  const meta = allFailures.find((f) => f?.criterionId === "_resumo")
  const failures = allFailures.filter((f) => f?.criterionId !== "_resumo")
  return {
    id: row.id,
    runId: row.runId,
    profileId: row.profileId,
    userId: row.userId,
    conversationId: row.conversationId,
    messageCount: row.messageCount,
    scores: row.scores,
    failures,
    summary: row.summary,
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    overallScore: row.overallScore,
    resumoGeral: meta?.resumoGeral || null,
    analyzedAt: row.analyzedAt?.toISOString?.() || row.analyzedAt,
    contactName:
      conversation?.contact?.savedName ||
      conversation?.contact?.pushName ||
      conversation?.contact?.phone ||
      null,
    lastMessagePreview: conversation?.lastMessagePreview || null,
  }
}

function formatRunRow(row) {
  return {
    id: row.id,
    profileId: row.profileId,
    scopeUserIds: row.scopeUserIds,
    periodFrom: row.periodFrom?.toISOString?.() || null,
    periodTo: row.periodTo?.toISOString?.() || null,
    status: row.status,
    totalConversations: row.totalConversations,
    doneConversations: row.doneConversations,
    error: row.error,
    sellerSummaries: row.sellerSummaries,
    startedAt: row.startedAt?.toISOString?.() || row.startedAt,
    finishedAt: row.finishedAt?.toISOString?.() || null,
  }
}

module.exports = {
  aiConfigured,
  analyzeOneConversation,
  listConversationsForRun,
  scheduleAnalysisRun,
  formatProfileRow,
  formatAnalysisRow,
  formatRunRow,
  loadConversationTranscript,
}

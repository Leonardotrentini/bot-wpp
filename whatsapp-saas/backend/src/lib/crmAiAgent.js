/**
 * Agente de IA do CRM — responde conversas via API compatível com OpenAI.
 *
 * Config por env:
 * - OPENAI_API_KEY (obrigatório para ativar)
 * - AI_BASE_URL (opcional; default https://api.openai.com/v1 — aceita OpenRouter/Groq etc.)
 *
 * Guard-rails:
 * - Só responde se a conversa tem aiEnabled + agente habilitado.
 * - Nunca responde a fromMe nem a mensagens de fluxo/IA (anti-loop).
 * - Teto de respostas por conversa/24h; handoff por palavra-chave ou erro.
 * - Resposta entra na fila CrmDelivery com delay "humano" (min–max segundos).
 */

const { isWithinQuietHours } = require("./crmFlows")

const AI_CONTEXT_MESSAGES = Number(process.env.CRM_AI_CONTEXT_MESSAGES || 20)
const AI_TIMEOUT_MS = Number(process.env.CRM_AI_TIMEOUT_MS || 60000)

function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY)
}

function aiBaseUrl() {
  return String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
}

async function callChatCompletion({ model, temperature, maxTokens, messages }) {
  if (!aiConfigured()) {
    const err = new Error("Chave de IA não configurada (OPENAI_API_KEY).")
    err.code = "AI_NOT_CONFIGURED"
    throw err
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err = new Error(data?.error?.message || `IA HTTP ${res.status}`)
      err.code = "AI_HTTP_ERROR"
      err.status = res.status
      throw err
    }
    const text = data?.choices?.[0]?.message?.content
    return typeof text === "string" ? text.trim() : ""
  } finally {
    clearTimeout(timer)
  }
}

function containsHandoffKeyword(agent, body) {
  const text = String(body || "").toLowerCase()
  if (!text) return false
  return (agent.handoffKeywords || []).some((kw) => kw && text.includes(String(kw).toLowerCase()))
}

async function handoffToHuman(deps, conversation, reason) {
  const { prisma, io } = deps
  const updated = await prisma.crmConversation.update({
    where: { id: conversation.id },
    data: { aiEnabled: false, assignedTo: "human", status: "pending" },
  })
  if (io) {
    io.to(`user:${conversation.userId}`).emit("crm:handoff", {
      conversationId: conversation.id,
      reason,
    })
  }
  return updated
}

async function buildContextMessages(prisma, agent, conversation) {
  const history = await prisma.crmMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { timestamp: "desc" },
    take: AI_CONTEXT_MESSAGES,
  })
  history.reverse()

  const messages = [
    {
      role: "system",
      content:
        `${agent.systemPrompt}\n\n` +
        `Regras: você é um atendente via WhatsApp. Responda em português, de forma curta e natural. ` +
        `Não invente informações. Se não souber responder ou o cliente pedir um humano, responda apenas "TRANSFERIR_HUMANO".`,
    },
  ]
  for (const msg of history) {
    const body = String(msg.body || "").trim()
    if (!body) continue
    messages.push({ role: msg.fromMe ? "assistant" : "user", content: body.slice(0, 2000) })
  }
  return messages
}

/**
 * Avalia se deve responder à mensagem recebida e, se sim, enfileira a resposta.
 * Retorna { queued } | { handoff, reason } | { skipped, reason }.
 */
async function maybeReplyWithAi(deps, { conversation, message }) {
  const { prisma } = deps
  if (!conversation?.aiEnabled) return { skipped: true, reason: "ai_disabled" }
  if (message.fromMe || ["flow", "ai", "import"].includes(message.source)) {
    return { skipped: true, reason: "not_contact_message" }
  }

  const agent = conversation.aiAgentId
    ? await prisma.crmAiAgent.findFirst({ where: { id: conversation.aiAgentId, userId: conversation.userId } })
    : await prisma.crmAiAgent.findFirst({ where: { userId: conversation.userId, enabled: true }, orderBy: { createdAt: "asc" } })

  if (!agent || !agent.enabled) return { skipped: true, reason: "no_agent" }
  if (!aiConfigured()) return { skipped: true, reason: "ai_not_configured" }
  if (isWithinQuietHours(agent.quietHours)) return { skipped: true, reason: "quiet_hours" }

  if (containsHandoffKeyword(agent, message.body)) {
    await handoffToHuman(deps, conversation, "keyword")
    return { handoff: true, reason: "keyword" }
  }

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
  const repliesToday = await prisma.crmMessage.count({
    where: { conversationId: conversation.id, source: "ai", createdAt: { gte: dayAgo } },
  })
  if (repliesToday >= agent.maxRepliesPerConversation) {
    await handoffToHuman(deps, conversation, "limit_reached")
    return { handoff: true, reason: "limit_reached" }
  }

  let reply
  try {
    const context = await buildContextMessages(prisma, agent, conversation)
    reply = await callChatCompletion({
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      messages: context,
    })
  } catch (err) {
    console.error(`[crm-ai] agente ${agent.id}:`, err?.message || err)
    await handoffToHuman(deps, conversation, "ai_error")
    return { handoff: true, reason: "ai_error" }
  }

  if (!reply || reply.includes("TRANSFERIR_HUMANO")) {
    await handoffToHuman(deps, conversation, "agent_requested")
    return { handoff: true, reason: "agent_requested" }
  }

  const minMs = Math.max(1, agent.replyDelayMinSec) * 1000
  const maxMs = Math.max(agent.replyDelayMinSec, agent.replyDelayMaxSec) * 1000
  const delay = minMs + Math.floor(Math.random() * Math.max(0, maxMs - minMs))

  await prisma.crmDelivery.create({
    data: {
      userId: conversation.userId,
      conversationId: conversation.id,
      remoteJid: conversation.remoteJid,
      kind: "ai",
      sourceId: agent.id,
      body: reply.slice(0, 4000),
      scheduledAt: new Date(Date.now() + delay),
    },
  })
  return { queued: true }
}

/** Playground: gera uma resposta de teste sem tocar em conversas. */
async function testAgentReply(agent, userMessage) {
  const messages = [
    {
      role: "system",
      content:
        `${agent.systemPrompt}\n\nRegras: você é um atendente via WhatsApp. Responda em português, curto e natural.`,
    },
    { role: "user", content: String(userMessage || "").slice(0, 2000) },
  ]
  return callChatCompletion({
    model: agent.model,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    messages,
  })
}

module.exports = {
  aiConfigured,
  maybeReplyWithAi,
  testAgentReply,
  containsHandoffKeyword,
  handoffToHuman,
}

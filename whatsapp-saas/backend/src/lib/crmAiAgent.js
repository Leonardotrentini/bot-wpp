/**
 * Agente de IA do CRM — responde conversas via API compatível com OpenAI.
 */

const { isWithinQuietHours } = require("./crmFlows")
const { isFlowsStoppedForContact } = require("./crmFlowStop")
const { buildSystemPromptForAgent } = require("./crmAiPromptTemplates")
const { loadKnowledgeChunks } = require("./crmAiKnowledge")
const { shouldAgentRespond, maybeAutoEnableAi } = require("./crmAiScope")
const { buildOpenAiTools, executeTool } = require("./crmAiTools")

const AI_CONTEXT_MESSAGES = Number(process.env.CRM_AI_CONTEXT_MESSAGES || 20)
const AI_TIMEOUT_MS = Number(process.env.CRM_AI_TIMEOUT_MS || 60000)
const DEFAULT_MODEL = "gpt-4o-mini"

function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY)
}

function aiBaseUrl() {
  return String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
}

async function callChatCompletion({ model, temperature, maxTokens, messages, tools, responseFormat }) {
  if (!aiConfigured()) {
    const err = new Error("Chave de IA não configurada (OPENAI_API_KEY).")
    err.code = "AI_NOT_CONFIGURED"
    throw err
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }
    if (responseFormat) body.response_format = responseFormat
    if (tools?.length) {
      body.tools = tools
      body.tool_choice = "auto"
    }
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err = new Error(data?.error?.message || `IA HTTP ${res.status}`)
      err.code = "AI_HTTP_ERROR"
      err.status = res.status
      throw err
    }
    const choice = data?.choices?.[0]?.message
    return {
      content: typeof choice?.content === "string" ? choice.content.trim() : "",
      toolCalls: Array.isArray(choice?.tool_calls) ? choice.tool_calls : [],
    }
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

async function resolveAgentWithKnowledge(prisma, agent) {
  const chunks = await loadKnowledgeChunks(prisma, agent.id)
  const systemPrompt = buildSystemPromptForAgent(agent, chunks)
  return { ...agent, systemPromptResolved: systemPrompt, knowledgeChunks: chunks }
}

async function buildContextMessages(prisma, agent, conversation, { historyOverride } = {}) {
  const resolved = await resolveAgentWithKnowledge(prisma, agent)
  let history = historyOverride
  if (!history) {
    history = await prisma.crmMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { timestamp: "desc" },
      take: AI_CONTEXT_MESSAGES,
      select: { fromMe: true, body: true },
    })
    history.reverse()
  }

  const messages = [
    {
      role: "system",
      content:
        `${resolved.systemPromptResolved}\n\n` +
        `Regras: você é um atendente via WhatsApp. Responda em português, de forma curta e natural. ` +
        `Não invente informações. Se não souber responder ou o cliente pedir um humano, responda apenas "TRANSFERIR_HUMANO".`,
    },
  ]
  for (const msg of history) {
    const body = String(msg.body || "").trim()
    if (!body) continue
    messages.push({ role: msg.fromMe ? "assistant" : "user", content: body.slice(0, 2000) })
  }
  return { messages, resolved }
}

async function runToolCalls(deps, { agent, conversation, toolCalls }) {
  const results = []
  let handoff = false
  for (const call of toolCalls) {
    const name = call?.function?.name
    let args = {}
    try {
      args = JSON.parse(call?.function?.arguments || "{}")
    } catch {
      args = {}
    }
    const result = await executeTool(deps, { agent, conversation, toolName: name, args })
    results.push(result)
    if (result.handoff) handoff = true
  }
  return { results, handoff }
}

/**
 * Avalia se deve responder à mensagem recebida e, se sim, enfileira a resposta.
 */
async function maybeReplyWithAi(deps, { conversation, message }) {
  const { prisma } = deps

  if (message.fromMe || ["flow", "ai", "import"].includes(message.source)) {
    return { skipped: true, reason: "not_contact_message" }
  }

  if (await isFlowsStoppedForContact(prisma, conversation.contactId, conversation.contact)) {
    return { skipped: true, reason: "flows_stopped" }
  }

  let agent = conversation.aiAgentId
    ? await prisma.crmAiAgent.findFirst({ where: { id: conversation.aiAgentId, userId: conversation.userId } })
    : await prisma.crmAiAgent.findFirst({ where: { userId: conversation.userId, enabled: true }, orderBy: { createdAt: "asc" } })

  if (!agent || !agent.enabled) return { skipped: true, reason: "no_agent" }
  if (!aiConfigured()) return { skipped: true, reason: "ai_not_configured" }

  const convWithContact = conversation.contact
    ? conversation
    : await prisma.crmConversation.findUnique({
        where: { id: conversation.id },
        include: { contact: true },
      })

  const shouldRespond = await shouldAgentRespond(prisma, agent, convWithContact, message)
  if (!shouldRespond) return { skipped: true, reason: "scope" }

  conversation = await maybeAutoEnableAi(prisma, agent, convWithContact)

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
    const { messages, resolved } = await buildContextMessages(prisma, agent, conversation)
    const tools = buildOpenAiTools(resolved)
    const completion = await callChatCompletion({
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      messages,
      tools,
    })

    if (completion.toolCalls.length) {
      const { handoff: toolHandoff } = await runToolCalls(deps, {
        agent: resolved,
        conversation,
        toolCalls: completion.toolCalls,
      })
      if (toolHandoff) return { handoff: true, reason: "tool_handoff" }
    }

    reply = completion.content
    if (!reply && completion.toolCalls.length) {
      reply = "Entendido! Já atualizei aqui no sistema."
    }
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

/** Playground: gera resposta de teste (multi-turno opcional). */
async function testAgentReply(agent, userMessage, history = [], knowledgeChunks = []) {
  const systemPrompt = buildSystemPromptForAgent(agent, knowledgeChunks)

  const messages = [
    {
      role: "system",
      content:
        `${systemPrompt}\n\nRegras: você é um atendente via WhatsApp. Responda em português, curto e natural.`,
    },
  ]

  for (const turn of history) {
    const role = turn.role === "assistant" ? "assistant" : "user"
    const content = String(turn.content || "").trim()
    if (content) messages.push({ role, content: content.slice(0, 2000) })
  }

  messages.push({ role: "user", content: String(userMessage || "").slice(0, 2000) })

  const tools = buildOpenAiTools(agent)
  const completion = await callChatCompletion({
    model: agent.model,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    messages,
    tools,
  })

  if (completion.toolCalls.length && !completion.content) {
    const names = completion.toolCalls.map((c) => c?.function?.name).filter(Boolean)
    return `[Ação simulada: ${names.join(", ")}]`
  }

  return completion.content || "(sem resposta)"
}

module.exports = {
  aiConfigured,
  DEFAULT_MODEL,
  maybeReplyWithAi,
  testAgentReply,
  containsHandoffKeyword,
  handoffToHuman,
  resolveAgentWithKnowledge,
  buildContextMessages,
  callChatCompletion,
}

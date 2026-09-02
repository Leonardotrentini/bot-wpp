/**
 * Escopo de ativação/resposta do agente de IA.
 */

const { keywordMatches, normalizeKeywordText } = require("./crmFlows")
const { contactHasAnyTag } = require("./crmFlows")

function normalizeActivationConfig(raw) {
  if (!raw || typeof raw !== "object") return {}
  return {
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map((k) => normalizeKeywordText(k)).filter(Boolean)
      : [],
    matchMode: raw.matchMode === "exact" ? "exact" : "contains",
    tagIds: Array.isArray(raw.tagIds) ? raw.tagIds.map(String).filter(Boolean) : [],
    stageIds: Array.isArray(raw.stageIds) ? raw.stageIds.map(String).filter(Boolean) : [],
    autoEnableOnMatch: raw.autoEnableOnMatch !== false,
  }
}

/**
 * Deve tentar responder a esta mensagem? (conversa já com aiEnabled ou modo auto)
 */
async function shouldAgentRespond(prisma, agent, conversation, message) {
  const mode = String(agent.activationMode || "manual").trim()
  if (mode === "manual") {
    return Boolean(conversation.aiEnabled)
  }

  const cfg = normalizeActivationConfig(agent.activationConfig)

  if (mode === "auto_new" && conversation.contact) {
    const inboundCount = await prisma.crmMessage.count({
      where: {
        conversationId: conversation.id,
        fromMe: false,
        source: { notIn: ["flow", "ai"] },
      },
    })
    if (inboundCount <= 1) return true
  }

  if (mode === "auto_keyword" && cfg.keywords.length) {
    const trigger = { keywords: cfg.keywords, matchMode: cfg.matchMode }
    if (keywordMatches(trigger, message?.body)) return true
  }

  if (mode === "auto_tag" && cfg.tagIds.length) {
    const ok = await contactHasAnyTag(prisma, conversation.contactId, cfg.tagIds)
    if (ok) return true
  }

  if (mode === "auto_stage" && cfg.stageIds.length) {
    const stageId = conversation.kanbanStageId || "__none__"
    if (cfg.stageIds.includes(stageId) || cfg.stageIds.includes(String(stageId))) return true
    if (cfg.stageIds.includes("__none__") && !conversation.kanbanStageId) return true
  }

  return Boolean(conversation.aiEnabled)
}

/**
 * Se modo auto e match, liga aiEnabled na conversa (uma vez).
 */
async function maybeAutoEnableAi(prisma, agent, conversation) {
  const mode = String(agent.activationMode || "manual").trim()
  if (mode === "manual" || conversation.aiEnabled) return conversation

  const cfg = normalizeActivationConfig(agent.activationConfig)
  if (!cfg.autoEnableOnMatch) return conversation

  return prisma.crmConversation.update({
    where: { id: conversation.id },
    data: {
      aiEnabled: true,
      assignedTo: "ai",
      aiAgentId: agent.id,
    },
  })
}

module.exports = {
  normalizeActivationConfig,
  shouldAgentRespond,
  maybeAutoEnableAi,
}

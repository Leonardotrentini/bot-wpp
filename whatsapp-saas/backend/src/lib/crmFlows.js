/**
 * FlowEngine — automações de conversa do CRM.
 *
 * Gatilhos: new_conversation | keyword | no_reply | stage_change
 * Condições: has_tag | not_has_tag | stage_is | status_is
 * Ações: send_message | add_tag | move_stage | assign_ai | set_status
 *
 * Guard-rails anti-loop/anti-ban:
 * - Nunca reage a mensagens fromMe nem a mensagens geradas por fluxo/IA.
 * - Cooldown por contato (default 24h) via CrmFlowRun.
 * - Envios entram na fila CrmDelivery (processada com delay + jitter).
 * - Quiet hours opcionais por fluxo.
 */

const CRM_FLOW_MAX_RUNS_PER_DAY = Number(process.env.CRM_FLOW_MAX_RUNS_PER_DAY || 20)
const CRM_DELIVERY_MIN_DELAY_MS = Number(process.env.CRM_DELIVERY_MIN_DELAY_MS || 3000)
const CRM_DELIVERY_JITTER_MS = Number(process.env.CRM_DELIVERY_JITTER_MS || 5000)

function normalizeQuietHours(value) {
  if (!value || typeof value !== "object" || value.enabled !== true) return null
  const re = /^([01]?\d|2[0-3]):[0-5]\d$/
  const start = re.test(value.start) ? value.start : "22:00"
  const end = re.test(value.end) ? value.end : "08:00"
  return { enabled: true, start, end }
}

/** true se agora está dentro do intervalo de silêncio (America/Sao_Paulo). */
function isWithinQuietHours(quietHours, now = new Date()) {
  const qh = normalizeQuietHours(quietHours)
  if (!qh) return false
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  const minutes = sp.getHours() * 60 + sp.getMinutes()
  const [sh, sm] = qh.start.split(":").map(Number)
  const [eh, em] = qh.end.split(":").map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start <= end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end // atravessa a meia-noite
}

function normalizeTrigger(trigger) {
  if (!trigger || typeof trigger !== "object") return null
  const type = String(trigger.type || "")
  if (!["new_conversation", "keyword", "no_reply", "stage_change"].includes(type)) return null
  const out = { type }
  if (type === "keyword") {
    const keywords = Array.isArray(trigger.keywords)
      ? trigger.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      : []
    if (!keywords.length) return null
    out.keywords = keywords
    out.matchMode = trigger.matchMode === "exact" ? "exact" : "contains"
  }
  if (type === "no_reply") {
    out.hours = Math.min(720, Math.max(1, Number(trigger.hours) || 24))
  }
  if (type === "stage_change") {
    out.stageId = trigger.stageId ? String(trigger.stageId) : null
  }
  return out
}

function keywordMatches(trigger, body) {
  const text = String(body || "").trim().toLowerCase()
  if (!text) return false
  for (const kw of trigger.keywords) {
    if (trigger.matchMode === "exact" ? text === kw : text.includes(kw)) return true
  }
  return false
}

async function conditionsPass(prisma, flow, conversation) {
  const conditions = Array.isArray(flow.conditions) ? flow.conditions : []
  for (const cond of conditions) {
    const type = String(cond?.type || "")
    if (type === "stage_is") {
      if (conversation.kanbanStageId !== cond.value) return false
    } else if (type === "status_is") {
      if (conversation.status !== cond.value) return false
    } else if (type === "has_tag" || type === "not_has_tag") {
      const count = await prisma.crmContactTag.count({
        where: { contactId: conversation.contactId, tagId: String(cond.value || "") },
      })
      if (type === "has_tag" && count === 0) return false
      if (type === "not_has_tag" && count > 0) return false
    }
  }
  return true
}

async function isFlowOnCooldown(prisma, flow, conversationId) {
  const cooldownHours = Math.max(0, Number(flow.cooldownPerContactHours) || 0)
  if (cooldownHours > 0) {
    const since = new Date(Date.now() - cooldownHours * 3600 * 1000)
    const recent = await prisma.crmFlowRun.count({
      where: { flowId: flow.id, conversationId, status: "ok", createdAt: { gte: since } },
    })
    if (recent > 0) return true
  }
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
  const runsToday = await prisma.crmFlowRun.count({
    where: { flowId: flow.id, status: "ok", createdAt: { gte: dayAgo } },
  })
  return runsToday >= CRM_FLOW_MAX_RUNS_PER_DAY
}

function deliveryDelayMs() {
  return CRM_DELIVERY_MIN_DELAY_MS + Math.floor(Math.random() * CRM_DELIVERY_JITTER_MS)
}

async function executeActions(deps, flow, conversation) {
  const { prisma } = deps
  const actions = Array.isArray(flow.actions) ? flow.actions : []
  const detail = []

  for (const action of actions) {
    const type = String(action?.type || "")
    try {
      if (type === "send_message") {
        const body = String(action.body || "").trim()
        if (!body) continue
        await prisma.crmDelivery.create({
          data: {
            userId: conversation.userId,
            conversationId: conversation.id,
            remoteJid: conversation.remoteJid,
            kind: "flow",
            sourceId: flow.id,
            body,
            scheduledAt: new Date(Date.now() + deliveryDelayMs()),
          },
        })
        detail.push("send_message")
      } else if (type === "add_tag" && action.tagId) {
        await prisma.crmContactTag
          .upsert({
            where: { contactId_tagId: { contactId: conversation.contactId, tagId: String(action.tagId) } },
            create: { contactId: conversation.contactId, tagId: String(action.tagId) },
            update: {},
          })
          .catch(() => {})
        detail.push("add_tag")
      } else if (type === "move_stage" && action.stageId) {
        await prisma.crmConversation.update({
          where: { id: conversation.id },
          data: { kanbanStageId: String(action.stageId) },
        })
        detail.push("move_stage")
      } else if (type === "assign_ai") {
        await prisma.crmConversation.update({
          where: { id: conversation.id },
          data: { aiEnabled: true, assignedTo: "ai", aiAgentId: action.agentId ? String(action.agentId) : undefined },
        })
        detail.push("assign_ai")
      } else if (type === "set_status" && action.value) {
        await prisma.crmConversation.update({
          where: { id: conversation.id },
          data: { status: String(action.value) },
        })
        detail.push("set_status")
      }
    } catch (err) {
      console.error(`[crm-flow] ação ${type} falhou (flow ${flow.id}):`, err?.message || err)
    }
  }
  return detail
}

async function runFlow(deps, flow, conversation, reason) {
  const { prisma } = deps
  if (isWithinQuietHours(flow.quietHours)) return false
  if (await isFlowOnCooldown(prisma, flow, conversation.id)) return false
  if (!(await conditionsPass(prisma, flow, conversation))) return false

  const detail = await executeActions(deps, flow, conversation)
  await prisma.crmFlowRun.create({
    data: {
      userId: conversation.userId,
      flowId: flow.id,
      conversationId: conversation.id,
      status: "ok",
      detail: `${reason}: ${detail.join(", ") || "sem ações"}`,
    },
  })
  return true
}

async function loadEnabledFlows(prisma, userId, triggerType) {
  const flows = await prisma.crmFlow.findMany({ where: { userId, enabled: true } })
  return flows.filter((f) => normalizeTrigger(f.trigger)?.type === triggerType)
}

/** Chamado quando chega mensagem do contato (nunca fromMe/flow/ai). */
async function onCrmMessage(deps, { conversation, message, isNewConversation }) {
  if (!conversation || !message) return
  if (message.fromMe || ["flow", "ai", "import"].includes(message.source)) return
  const { prisma } = deps

  if (isNewConversation) {
    for (const flow of await loadEnabledFlows(prisma, conversation.userId, "new_conversation")) {
      await runFlow(deps, flow, conversation, "new_conversation").catch(() => {})
    }
  }

  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "keyword")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger && keywordMatches(trigger, message.body)) {
      await runFlow(deps, flow, conversation, `keyword`).catch(() => {})
    }
  }
}

/** Chamado quando um card muda de estágio no Kanban. */
async function onStageChange(deps, { conversation, stageId }) {
  const { prisma } = deps
  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "stage_change")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger && (!trigger.stageId || trigger.stageId === stageId)) {
      await runFlow(deps, flow, conversation, "stage_change").catch(() => {})
    }
  }
}

/** Tick do scheduler: fluxos "sem resposta há X horas". */
async function processNoReplyFlows(deps) {
  const { prisma } = deps
  const flows = await prisma.crmFlow.findMany({ where: { enabled: true } })
  for (const flow of flows) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger?.type !== "no_reply") continue
    const threshold = new Date(Date.now() - trigger.hours * 3600 * 1000)
    // conversas abertas onde a ÚLTIMA mensagem é do usuário (fromMe) e está sem resposta
    const candidates = await prisma.crmConversation.findMany({
      where: {
        userId: flow.userId,
        status: "open",
        lastMessageFromMe: true,
        lastMessageAt: { lt: threshold },
      },
      take: 20,
    })
    for (const conversation of candidates) {
      await runFlow(deps, flow, conversation, "no_reply").catch(() => {})
    }
  }
}

module.exports = {
  onCrmMessage,
  onStageChange,
  processNoReplyFlows,
  normalizeTrigger,
  keywordMatches,
  isWithinQuietHours,
  normalizeQuietHours,
  deliveryDelayMs,
}

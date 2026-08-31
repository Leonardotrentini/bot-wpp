/**
 * FlowEngine — automações de conversa do CRM.
 *
 * Gatilhos: new_conversation | keyword | no_reply | stage_change | tag_added | contact_reply
 * Gatilhos adicionais (AND): has_tag | not_has_tag via flow.conditions
 * Ações: send_message | add_tag | remove_tag | move_stage | assign_ai | set_status
 *
 * Guard-rails anti-loop/anti-ban:
 * - Nunca reage a mensagens fromMe nem a mensagens geradas por fluxo/IA.
 * - Cooldown por contato (default 24h) via CrmFlowRun.
 * - Envios entram na fila CrmDelivery (processada com delay + jitter).
 * - Quiet hours opcionais por fluxo.
 * - tag_added só dispara quando o vínculo tag↔contato é criado de fato (não no re-add).
 * - no_reply ancora em noReplySinceAt (envio humano); flow/IA não reiniciam o timer.
 * - contact_reply exige tagIds e só roda em conversa já existente (!isNewConversation).
 */

const CRM_FLOW_MAX_RUNS_PER_DAY = Number(process.env.CRM_FLOW_MAX_RUNS_PER_DAY || 20)
const { CONVERSATION_INCLUDE, emitCrmEvent, formatConversationRow } = require("./crmCore")
const { processPendingCrmDeliveries } = require("./crmDelivery")
const CRM_DELIVERY_MIN_DELAY_MS = Number(process.env.CRM_DELIVERY_MIN_DELAY_MS || 800)
const CRM_DELIVERY_JITTER_MS = Number(process.env.CRM_DELIVERY_JITTER_MS || 1200)
/** Pausa entre nota de voz e texto de continuação na mesma ação. */
const TEXT_AFTER_AUDIO_MS = Number(process.env.CRM_TEXT_AFTER_AUDIO_MS || 2000)
const { resolveActionDelayMs } = require("./flowActionDelay")
const { resolveRecordingDelayMs, MAX_RECORDING_DELAY_SECONDS } = require("./flowRecordingDelay")

function resolveNoReplyMinutes(trigger) {
  if (!trigger) return 24 * 60
  const rawMinutes = Number(trigger.minutes)
  if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
    return Math.min(720 * 60, Math.max(1, Math.round(rawMinutes)))
  }
  if (trigger.delayUnit === "minutes") {
    const v = Number(trigger.delayValue)
    if (Number.isFinite(v) && v > 0) return Math.min(720 * 60, Math.max(1, Math.round(v)))
  }
  if (trigger.delayUnit === "hours") {
    const v = Number(trigger.delayValue)
    if (Number.isFinite(v) && v > 0) return Math.min(720 * 60, Math.max(1, Math.round(v * 60)))
  }
  const h = Number(trigger.hours)
  if (Number.isFinite(h) && h > 0) {
    return Math.min(720 * 60, Math.max(1, Math.round(h * 60)))
  }
  return 24 * 60
}

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
  if (
    !["new_conversation", "keyword", "no_reply", "stage_change", "tag_added", "contact_reply"].includes(type)
  ) {
    return null
  }
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
    const minutes = resolveNoReplyMinutes(trigger)
    out.minutes = minutes
    out.hours = Math.ceil(minutes / 60)
    if (trigger.delayUnit === "hours" || trigger.delayUnit === "minutes") {
      out.delayUnit = trigger.delayUnit
      out.delayValue = Number(trigger.delayValue) || (trigger.delayUnit === "minutes" ? minutes : out.hours)
    }
  }
  if (type === "stage_change") {
    out.stageId = trigger.stageId ? String(trigger.stageId) : null
  }
  if (type === "tag_added") {
    const tagId = trigger.tagId ? String(trigger.tagId) : ""
    if (!tagId) return null
    out.tagId = tagId
  }
  if (type === "contact_reply") {
    const raw = Array.isArray(trigger.tagIds) ? trigger.tagIds : Array.isArray(trigger.conditionTags) ? trigger.conditionTags : []
    const tagIds = [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 20)
    if (!tagIds.length) return null
    out.tagIds = tagIds
  }
  return out
}

async function contactHasAnyTag(prisma, contactId, tagIds) {
  if (!contactId || !Array.isArray(tagIds) || !tagIds.length) return false
  const count = await prisma.crmContactTag.count({
    where: { contactId, tagId: { in: tagIds.map(String) } },
  })
  return count > 0
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
      const want = cond.value === "__none__" ? null : cond.value
      if ((conversation.kanbanStageId || null) !== want) return false
    } else if (type === "status_is") {
      if (conversation.status !== cond.value) return false
    } else if (type === "has_tag" || type === "not_has_tag") {
      const count = await prisma.crmContactTag.count({
        where: { contactId: conversation.contactId, tagId: String(cond.value || "") },
      })
      if (type === "has_tag" && count === 0) return false
      if (type === "not_has_tag" && count > 0) return false
    } else if (type === "has_any_tag") {
      let tagIds = []
      try {
        tagIds = JSON.parse(String(cond.value || "[]"))
      } catch {
        tagIds = []
      }
      if (!(await contactHasAnyTag(prisma, conversation.contactId, tagIds))) return false
    } else if (type === "keyword_in_last") {
      let parsed = { keywords: [], matchMode: "contains" }
      try {
        parsed = JSON.parse(String(cond.value || "{}"))
      } catch {
        parsed = { keywords: [], matchMode: "contains" }
      }
      const last = await prisma.crmMessage.findFirst({
        where: {
          conversationId: conversation.id,
          fromMe: false,
          source: { notIn: ["flow", "ai"] },
        },
        orderBy: { timestamp: "desc" },
        select: { body: true },
      })
      if (!keywordMatches(parsed, last?.body)) return false
    } else if (type === "no_reply_minutes") {
      const minutes = Math.max(1, Number(cond.value) || 1)
      const threshold = new Date(Date.now() - minutes * 60 * 1000)
      if (!conversation.lastMessageFromMe) return false
      const anchor = conversation.noReplySinceAt || conversation.lastMessageAt
      if (!anchor || new Date(anchor) >= threshold) return false
    }
  }
  return true
}

const CRM_FLOW_DEFAULT_COOLDOWN_HOURS = 24

async function isFlowOnCooldown(prisma, flow, conversationId) {
  const raw = Number(flow.cooldownPerContactHours ?? CRM_FLOW_DEFAULT_COOLDOWN_HOURS)
  const cooldownHours = Number.isFinite(raw) ? Math.min(720, Math.max(0, Math.round(raw))) : CRM_FLOW_DEFAULT_COOLDOWN_HOURS

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

function recordingDelayMsForAction(action) {
  const sec = Number(action.recordingDelayValue)
  if (Number.isFinite(sec) && sec > 0) {
    return Math.min(sec, MAX_RECORDING_DELAY_SECONDS) * 1000
  }
  return resolveRecordingDelayMs(action)
}

async function executeActions(deps, flow, conversation, options = {}) {
  const { prisma, io, sendText } = deps
  const immediate = options.immediate === true
  const actions = Array.isArray(flow.actions) ? flow.actions : []
  const detail = []
  let stageChangedTo = null
  const newlyAddedTagIds = []
  let tagsMutated = false
  let cumulativeDelayMs = 0
  let deliveryQueued = false

  async function queueMessageDelivery(
    { body, mediaType, mediaBase64, mediaMime, mediaName, presenceDelayMs },
    { delayAfterPreviousMs = 0, requiresPreviousSent = false } = {},
  ) {
    const mt = mediaType && mediaType !== "none" ? String(mediaType) : "none"
    const hasMedia = ["image", "video", "audio", "document"].includes(mt)
    const text = String(body || "").trim()
    if (!text && !hasMedia) return
    if (hasMedia && !String(mediaBase64 || "").trim()) {
      console.error(`[crm-flow] mídia ausente (${mt}) no fluxo ${flow.id || "?"} — ação ignorada`)
      return
    }

    const chainDelayMs = deliveryQueued ? Math.max(0, Number(delayAfterPreviousMs) || 0) : 0
    deliveryQueued = true
    const jitter = immediate ? 0 : deliveryDelayMs()
    await prisma.crmDelivery.create({
      data: {
        userId: conversation.userId,
        conversationId: conversation.id,
        remoteJid: conversation.remoteJid,
        kind: options.deliveryKind || "flow",
        sourceId: flow.id || null,
        body: text || null,
        mediaType: mt,
        mediaBase64: hasMedia ? String(mediaBase64 || "") : null,
        mediaMime: hasMedia ? mediaMime || null : null,
        mediaName: hasMedia ? mediaName || null : null,
        presenceDelayMs: mt === "audio" ? Number(presenceDelayMs) || 0 : 0,
        delayAfterPreviousMs: chainDelayMs,
        requiresPreviousSent: Boolean(requiresPreviousSent),
        scheduledAt: new Date(Date.now() + (chainDelayMs > 0 ? 86400000 : jitter)),
      },
    })
  }

  async function runOneAction(action, stepDelayMs) {
    const type = String(action?.type || "")
    try {
      if (type === "send_message") {
        const body = String(action.body || "").trim()
        const mediaType = action.mediaType && action.mediaType !== "none" ? String(action.mediaType) : "none"
        const hasMedia = ["image", "video", "audio", "document"].includes(mediaType)
        if (!body && !hasMedia) return

        const presenceDelayMs = recordingDelayMsForAction(action)

        // Nota de voz: áudio primeiro, texto depois (WhatsApp não aceita legenda em PTT).
        if (hasMedia && mediaType === "audio" && body) {
          await queueMessageDelivery(
            {
              body: null,
              mediaType,
              mediaBase64: action.mediaBase64,
              mediaMime: action.mediaMime,
              mediaName: action.mediaName,
              presenceDelayMs,
            },
            { delayAfterPreviousMs: stepDelayMs },
          )
          await queueMessageDelivery({ body, mediaType: "none" }, { delayAfterPreviousMs: TEXT_AFTER_AUDIO_MS, requiresPreviousSent: true })
          detail.push("send_message:audio+text")
          return
        }

        await queueMessageDelivery(
          {
            body,
            mediaType,
            mediaBase64: action.mediaBase64,
            mediaMime: action.mediaMime,
            mediaName: action.mediaName,
            presenceDelayMs,
          },
          { delayAfterPreviousMs: stepDelayMs },
        )
        detail.push(hasMedia ? `send_message:${mediaType}` : "send_message")
      } else if (type === "add_tag" && action.tagId) {
        const tagId = String(action.tagId)
        const existing = await prisma.crmContactTag.findUnique({
          where: { contactId_tagId: { contactId: conversation.contactId, tagId } },
        })
        if (!existing) {
          try {
            await prisma.crmContactTag.create({
              data: { contactId: conversation.contactId, tagId },
            })
            newlyAddedTagIds.push(tagId)
          } catch (err) {
            if (err?.code !== "P2002") throw err
          }
        }
        detail.push("add_tag")
      } else if (type === "remove_tag" && action.tagId) {
        const tagId = String(action.tagId)
        const deleted = await prisma.crmContactTag.deleteMany({
          where: { contactId: conversation.contactId, tagId },
        })
        if (deleted.count > 0) tagsMutated = true
        detail.push("remove_tag")
      } else if (type === "move_stage" && action.stageId) {
        const stageId = String(action.stageId)
        await prisma.crmConversation.update({
          where: { id: conversation.id },
          data: { kanbanStageId: stageId },
        })
        stageChangedTo = stageId
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

  for (const action of actions) {
    const stepDelayMs = immediate ? 0 : resolveActionDelayMs(action)
    cumulativeDelayMs += stepDelayMs
    const type = String(action?.type || "")

    if (!immediate && cumulativeDelayMs > 0 && type !== "send_message") {
      const offset = cumulativeDelayMs
      setTimeout(() => {
        runOneAction(action, 0).then(async () => {
          if ((stageChangedTo || newlyAddedTagIds.length || tagsMutated) && io) {
            const updated = await prisma.crmConversation.findUnique({
              where: { id: conversation.id },
              include: CONVERSATION_INCLUDE,
            })
            if (updated) {
              emitCrmEvent(io, conversation.userId, "crm:conversation", {
                conversation: formatConversationRow(updated),
              })
            }
          }
        }).catch((err) => console.error("[crm-flow] ação atrasada:", err?.message || err))
      }, offset).unref?.()
      continue
    }

    await runOneAction(action, stepDelayMs)
  }

  if ((stageChangedTo || newlyAddedTagIds.length || tagsMutated) && io) {
    const updated = await prisma.crmConversation.findUnique({
      where: { id: conversation.id },
      include: CONVERSATION_INCLUDE,
    })
    if (updated) {
      emitCrmEvent(io, conversation.userId, "crm:conversation", {
        conversation: formatConversationRow(updated),
      })
      if (stageChangedTo) {
        onStageChange({ prisma, io, sendText }, { conversation: updated, stageId: stageChangedTo }).catch((err) =>
          console.error("[crm-flow] stage_change:", err?.message || err),
        )
      }
      for (const tagId of newlyAddedTagIds) {
        onTagAdded({ prisma, io, sendText }, { conversation: updated, tagId }).catch((err) =>
          console.error("[crm-flow] tag_added:", err?.message || err),
        )
      }
    }
  }

  return detail
}

/** Executa um fluxo manualmente em uma conversa (teste) — ignora cooldown e quiet hours. */
async function testFlowOnConversation(deps, { flow, conversationId, userId }) {
  const { prisma } = deps
  const conversation = await prisma.crmConversation.findFirst({
    where: { id: String(conversationId), userId },
    include: CONVERSATION_INCLUDE,
  })
  if (!conversation) {
    const err = new Error("Conversa não encontrada.")
    err.code = "NOT_FOUND"
    throw err
  }

  const conn = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!conn?.connected) {
    const err = new Error("WhatsApp desconectado. Conecte antes de testar.")
    err.code = "WHATSAPP_NOT_CONNECTED"
    throw err
  }

  const detail = await executeActions(deps, flow, conversation, { immediate: true, deliveryKind: "flow" })

  if (flow.id) {
    await prisma.crmFlowRun.create({
      data: {
        userId,
        flowId: flow.id,
        conversationId: conversation.id,
        status: "ok",
        detail: `test: ${detail.join(", ") || "sem ações"}`,
      },
    })
  }

  return {
    detail,
    conversationId: conversation.id,
    contactName: conversation.contact?.savedName || conversation.contact?.pushName || conversation.contact?.phone || "",
  }
}

async function runFlow(deps, flow, conversation, reason) {
  const { prisma } = deps
  if (isWithinQuietHours(flow.quietHours)) return false
  if (await isFlowOnCooldown(prisma, flow, conversation.id)) return false
  if (!(await conditionsPass(prisma, flow, conversation))) return false

  const detail = await executeActions(deps, flow, conversation)
  await processPendingCrmDeliveries(deps).catch((err) =>
    console.error("[crm-flow] processPendingCrmDeliveries:", err?.message || err),
  )

  const hasSend = detail.some((d) => String(d).startsWith("send_message"))
  let runStatus = "ok"
  if (hasSend && flow.id) {
    const deliveries = await prisma.crmDelivery.findMany({
      where: {
        conversationId: conversation.id,
        sourceId: flow.id,
        kind: "flow",
        createdAt: { gte: new Date(Date.now() - 120000) },
      },
      select: { status: true },
    })
    const sent = deliveries.some((d) => d.status === "sent")
    const pending = deliveries.some((d) => ["pending", "sending"].includes(d.status))
    const allFailed = deliveries.length > 0 && deliveries.every((d) => d.status === "failed")
    if (allFailed && !sent && !pending) runStatus = "failed"
  }

  await prisma.crmFlowRun.create({
    data: {
      userId: conversation.userId,
      flowId: flow.id,
      conversationId: conversation.id,
      status: runStatus,
      detail: `${reason}: ${detail.join(", ") || "sem ações"}${runStatus === "failed" ? " (envio falhou)" : ""}`,
    },
  })
  return runStatus === "ok"
}

async function loadEnabledFlows(prisma, userId, triggerType) {
  const flows = await prisma.crmFlow.findMany({ where: { userId, enabled: true } })
  return flows.filter((f) => normalizeTrigger(f.trigger)?.type === triggerType)
}

/** Chamado quando chega mensagem do contato (nunca fromMe/flow/ai). */
async function onCrmMessage(deps, { conversation, message, isNewConversation, dispatchNewConversation }) {
  if (!conversation || !message) return
  if (message.fromMe || ["flow", "ai"].includes(message.source)) return
  const { prisma } = deps

  if (isNewConversation || dispatchNewConversation) {
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

  // Resposta do lead em conversa existente + filtro por tag (obrigatório).
  if (!isNewConversation) {
    for (const flow of await loadEnabledFlows(prisma, conversation.userId, "contact_reply")) {
      const trigger = normalizeTrigger(flow.trigger)
      if (!trigger?.tagIds?.length) continue
      const ok = await contactHasAnyTag(prisma, conversation.contactId, trigger.tagIds)
      if (ok) {
        await runFlow(deps, flow, conversation, "contact_reply").catch(() => {})
      }
    }
  }
}

/** Chamado quando um card muda de estágio no Kanban. */
async function onStageChange(deps, { conversation, stageId }) {
  const { prisma } = deps
  // Coluna virtual "Sem estágio" no board = kanbanStageId null → chave __none__ no trigger.
  const targetKey = stageId == null || stageId === "" ? "__none__" : String(stageId)
  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "stage_change")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (!trigger) continue
    if (!trigger.stageId || trigger.stageId === targetKey) {
      await runFlow(deps, flow, conversation, "stage_change").catch(() => {})
    }
  }
}

/** Chamado quando uma tag é vinculada de fato ao contato (não no re-add). */
async function onTagAdded(deps, { conversation, tagId }) {
  if (!conversation || !tagId) return
  const { prisma } = deps
  const wanted = String(tagId)
  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "tag_added")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger && trigger.tagId === wanted) {
      await runFlow(deps, flow, conversation, "tag_added").catch(() => {})
    }
  }
}

/**
 * Dispara fluxos tag_added a partir de contactId (rotas/CRM commerce).
 * No-op se não houver conversa ou se tagId estiver vazio.
 */
async function notifyTagAddedForContact(deps, { userId, contactId, tagId }) {
  if (!deps?.prisma || !userId || !contactId || !tagId) return
  const conversation = await deps.prisma.crmConversation.findFirst({
    where: { contactId, userId },
    include: CONVERSATION_INCLUDE,
  })
  if (!conversation) return
  await onTagAdded(deps, { conversation, tagId: String(tagId) })
}

/** Where do scheduler no_reply — âncora humana com fallback legado. */
function noReplyCandidateWhere(userId, threshold) {
  return {
    userId,
    status: "open",
    lastMessageFromMe: true,
    OR: [
      { noReplySinceAt: { lt: threshold } },
      { noReplySinceAt: null, lastMessageAt: { lt: threshold } },
    ],
  }
}

/**
 * Tick do scheduler: fluxos "sem resposta há X tempo".
 * Usa `noReplySinceAt` (último outbound humano). Envios de flow/IA atualizam
 * lastMessageAt mas NÃO reiniciam este timer — só resposta do lead zera a âncora.
 */
async function processNoReplyFlows(deps) {
  const { prisma } = deps
  const flows = await prisma.crmFlow.findMany({ where: { enabled: true } })
  for (const flow of flows) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger?.type !== "no_reply") continue
    const threshold = new Date(Date.now() - trigger.minutes * 60 * 1000)
    const candidates = await prisma.crmConversation.findMany({
      where: noReplyCandidateWhere(flow.userId, threshold),
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
  onTagAdded,
  notifyTagAddedForContact,
  processNoReplyFlows,
  noReplyCandidateWhere,
  contactHasAnyTag,
  testFlowOnConversation,
  normalizeTrigger,
  keywordMatches,
  conditionsPass,
  isWithinQuietHours,
  normalizeQuietHours,
  deliveryDelayMs,
}

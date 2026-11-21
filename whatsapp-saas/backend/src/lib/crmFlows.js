/**
 * FlowEngine — automações de conversa do CRM.
 *
 * Gatilhos: new_conversation | keyword | no_reply | stage_change | tag_added | contact_reply
 * Gatilhos adicionais (AND): has_tag | not_has_tag via flow.conditions
 * Ações: send_message | add_tag | remove_tag | move_stage | assign_ai | set_status | stop_flows
 *
 * Guard-rails anti-loop/anti-ban:
 * - Nunca reage a mensagens fromMe nem a mensagens geradas por fluxo/IA.
 * - Cooldown por contato (default 24h) via CrmFlowRun.
 * - Envios entram na fila CrmDelivery (processada com delay + jitter).
 * - Quiet hours: adia só mensagens (não bloqueia o fluxo).
 * - tag_added só dispara quando o vínculo tag↔contato é criado de fato (não no re-add).
 * - no_reply ancora em noReplySinceAt (envio humano); flow/IA não reiniciam o timer.
 * - contact_reply: tags opcionais; só roda em conversa já existente (!isNewConversation).
 * - cancelIfHumanReplies (default true): cancela fila pendente se humano falar.
 * - Regra de ativação: fluxos só reagem a eventos DEPOIS de enabledAt (última vez que ficou ativo).
 *   stage_change NÃO varre quem já está no estágio — só dispara na entrada após ativar.
 */

const { CONVERSATION_INCLUDE, emitCrmEvent, formatConversationRow } = require("./crmCore")
const { processPendingCrmDeliveries, flushCrmDeliveries } = require("./crmDelivery")
const { isFlowsStopped, isFlowsStoppedForContact, stopFlowsForContact } = require("./crmFlowStop")
const { resolveSendMessageBody } = require("./flowMessageText")
const {
  normalizeQuietHours,
  isWithinQuietHours,
  bumpScheduledAtPastQuietHours,
} = require("./flowQuietHours")
const CRM_DELIVERY_MIN_DELAY_MS = Number(process.env.CRM_DELIVERY_MIN_DELAY_MS || 800)
const CRM_DELIVERY_JITTER_MS = Number(process.env.CRM_DELIVERY_JITTER_MS || 1200)
/** Pausa entre nota de voz e texto de continuação na mesma ação. */
const TEXT_AFTER_AUDIO_MS = Number(process.env.CRM_TEXT_AFTER_AUDIO_MS || 2000)
const { resolveActionDelayMs } = require("./flowActionDelay")
const { resolveRecordingDelayMs, MAX_RECORDING_DELAY_SECONDS } = require("./flowRecordingDelay")

/** Cancelamento in-memory de ações atrasadas via setTimeout (conversationId:flowId). */
const cancelledDelayedActions = new Set()

function delayedActionKey(conversationId, flowId) {
  return `${conversationId || ""}:${flowId || ""}`
}

function markDelayedActionsCancelled(conversationId, flowId = null) {
  if (!conversationId) return
  if (flowId) {
    cancelledDelayedActions.add(delayedActionKey(conversationId, flowId))
    return
  }
  cancelledDelayedActions.add(delayedActionKey(conversationId, "*"))
}

function isDelayedActionCancelled(conversationId, flowId) {
  if (!conversationId) return false
  if (cancelledDelayedActions.has(delayedActionKey(conversationId, "*"))) return true
  if (flowId && cancelledDelayedActions.has(delayedActionKey(conversationId, flowId))) return true
  return false
}

function clearDelayedActionCancel(conversationId, flowId) {
  if (!conversationId) return
  // Novo run do fluxo: limpa cancelamento prévio desta conversa (inclui wildcard de humano).
  cancelledDelayedActions.delete(delayedActionKey(conversationId, "*"))
  if (flowId) cancelledDelayedActions.delete(delayedActionKey(conversationId, flowId))
}

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

/**
 * Âncora temporal da ativação do fluxo.
 * Preferência: enabledAt (última vez que ligou) → createdAt (legado / já ativo sem stamp).
 * Eventos e varreduras (no_reply) só consideram o que veio depois disso.
 */
function resolveFlowActiveSince(flow) {
  if (!flow) return null
  const raw = flow.enabledAt || flow.createdAt
  if (!raw) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** true se o evento (ex.: agora, createdAt da conversa) é estritamente após a ativação. */
function isEventAfterFlowActivation(flow, eventAt = new Date()) {
  const since = resolveFlowActiveSince(flow)
  if (!since) return true
  const at = eventAt instanceof Date ? eventAt : new Date(eventAt)
  if (Number.isNaN(at.getTime())) return false
  return at.getTime() >= since.getTime()
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
      ? trigger.keywords.map((k) => normalizeKeywordText(k)).filter(Boolean)
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
    // Default ON: não varre histórico antigo — só conversas criadas após a ativação do fluxo.
    out.onlyAfterFlowCreated = trigger.onlyAfterFlowCreated !== false
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
    out.tagIds = tagIds
    out.firstReplyOnly = trigger.firstReplyOnly === true
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

function normalizeKeywordText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function keywordMatches(trigger, body) {
  const text = normalizeKeywordText(body)
  if (!text) return false
  for (const kw of trigger.keywords) {
    const normalizedKw = normalizeKeywordText(kw)
    if (!normalizedKw) continue
    if (trigger.matchMode === "exact" ? text === normalizedKw : text.includes(normalizedKw)) return true
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
/** 0 = sem teto global (recomendado). Defina CRM_FLOW_MAX_RUNS_PER_DAY só como proteção anti-abuso. */
const CRM_FLOW_MAX_RUNS_PER_DAY = Number(process.env.CRM_FLOW_MAX_RUNS_PER_DAY ?? 0)

const PROD_RUN_WHERE = {
  status: "ok",
  NOT: { detail: { startsWith: "test:" } },
}

/** Por que runFlow não executou — null = pode rodar. */
async function getFlowBlockReason(prisma, flow, conversation) {
  if (isFlowsStopped(conversation?.contact)) return "flows_stopped"
  if (await isFlowsStoppedForContact(prisma, conversation?.contactId, conversation?.contact)) {
    return "flows_stopped"
  }
  // Quiet hours não bloqueiam o fluxo — só adiam mensagens na fila (CrmDelivery).
  if (!(await conditionsPass(prisma, flow, conversation))) return "conditions"

  const raw = Number(flow.cooldownPerContactHours ?? CRM_FLOW_DEFAULT_COOLDOWN_HOURS)
  const cooldownHours = Number.isFinite(raw) ? Math.min(720, Math.max(0, Math.round(raw))) : CRM_FLOW_DEFAULT_COOLDOWN_HOURS

  if (cooldownHours > 0) {
    const since = new Date(Date.now() - cooldownHours * 3600 * 1000)
    const recent = await prisma.crmFlowRun.count({
      where: {
        flowId: flow.id,
        conversationId: conversation.id,
        createdAt: { gte: since },
        ...PROD_RUN_WHERE,
      },
    })
    if (recent > 0) return "cooldown_contact"
  }

  if (CRM_FLOW_MAX_RUNS_PER_DAY > 0) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
    const runsToday = await prisma.crmFlowRun.count({
      where: {
        flowId: flow.id,
        createdAt: { gte: dayAgo },
        ...PROD_RUN_WHERE,
      },
    })
    if (runsToday >= CRM_FLOW_MAX_RUNS_PER_DAY) return "daily_cap"
  }

  return null
}

async function recordSkippedFlowRun(prisma, flow, conversation, reason, blockReason) {
  if (!flow?.id) return

  // Skips rotineiros (cooldown/conditions) não gravam no DB — inundavam disco e I/O.
  const noisy = new Set(["cooldown_contact", "conditions", "daily_cap", "flows_stopped", "disabled"])
  if (noisy.has(String(blockReason || ""))) return

  await prisma.crmFlowRun
    .create({
      data: {
        userId: conversation.userId,
        flowId: flow.id,
        conversationId: conversation.id,
        status: "skipped",
        detail: `${reason}: skipped (${blockReason})`,
      },
    })
    .catch((err) => console.warn("[crm-flow] skipped run log:", err?.message || err))
}

const skipWarnThrottle = new Map()
function warnSkippedFlow(flow, conversation, reason, blockReason) {
  const key = `${flow?.id || "?"}:${blockReason}`
  const now = Date.now()
  const last = skipWarnThrottle.get(key) || 0
  if (now - last < 60_000) return
  skipWarnThrottle.set(key, now)
  if (skipWarnThrottle.size > 2000) {
    for (const [k, t] of skipWarnThrottle) {
      if (now - t > 300_000) skipWarnThrottle.delete(k)
    }
  }
  console.warn(
    `[crm-flow] skipped flow=${flow?.id || flow?.name || "?"} conv=${conversation?.id} reason=${blockReason} trigger=${reason}`,
  )
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
  let flowsStopped = false

  if (flow?.id && conversation?.id) {
    clearDelayedActionCancel(conversation.id, flow.id)
  }

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
    let scheduledAt = new Date(Date.now() + (chainDelayMs > 0 ? 86400000 : jitter))
    if (!immediate) {
      scheduledAt = bumpScheduledAtPastQuietHours(flow.quietHours, scheduledAt)
    }
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
        scheduledAt,
      },
    })
  }

  async function runOneAction(action, stepDelayMs) {
    if (flowsStopped) return true
    if (isDelayedActionCancelled(conversation.id, flow.id)) {
      flowsStopped = true
      return true
    }
    if (await isFlowsStoppedForContact(prisma, conversation.contactId, conversation.contact)) {
      flowsStopped = true
      return true
    }

    const type = String(action?.type || "")
    try {
      if (type === "send_message") {
        const body = resolveSendMessageBody(action, conversation.contact)
        const mediaType = action.mediaType && action.mediaType !== "none" ? String(action.mediaType) : "none"
        const hasMedia = ["image", "video", "audio", "document"].includes(mediaType)
        if (!body && !hasMedia) return false

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
        if ((conversation.kanbanStageId || null) === stageId) {
          detail.push("move_stage:already")
        } else {
          await prisma.crmConversation.update({
            where: { id: conversation.id },
            data: { kanbanStageId: stageId },
          })
          conversation.kanbanStageId = stageId
          stageChangedTo = stageId
          detail.push("move_stage")
        }
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
      } else if (type === "stop_flows") {
        await stopFlowsForContact(prisma, {
          contactId: conversation.contactId,
          conversationId: conversation.id,
          userId: conversation.userId,
          reason: `flow:${flow.id || "test"}`,
        })
        flowsStopped = true
        if (conversation.contact) conversation.contact.flowsStoppedAt = new Date()
        detail.push("stop_flows")
        return true
      }
    } catch (err) {
      console.error(`[crm-flow] ação ${type} falhou (flow ${flow.id}):`, err?.message || err)
    }
    return false
  }

  for (const action of actions) {
    if (flowsStopped) break
    const stepDelayMs = immediate ? 0 : resolveActionDelayMs(action)
    cumulativeDelayMs += stepDelayMs
    const type = String(action?.type || "")

    if (!immediate && cumulativeDelayMs > 0 && type !== "send_message") {
      const offset = cumulativeDelayMs
      const flowId = flow.id || null
      const conversationId = conversation.id
      setTimeout(() => {
        if (isDelayedActionCancelled(conversationId, flowId)) return
        runOneAction(action, 0).then(async (stopped) => {
          if (stopped) flowsStopped = true
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

    const stopped = await runOneAction(action, stepDelayMs)
    if (stopped) break
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
  const blockReason = await getFlowBlockReason(prisma, flow, conversation)
  if (blockReason) {
    await recordSkippedFlowRun(prisma, flow, conversation, reason, blockReason)
    warnSkippedFlow(flow, conversation, reason, blockReason)
    return false
  }

  const detail = await executeActions(deps, flow, conversation)
  // Só no-op (ex.: já estava no estágio) → não grava run "ok" (senão queima cooldown e trava o lote).
  const meaningful = detail.filter((d) => {
    const s = String(d || "")
    return s && !s.endsWith(":already")
  })
  if (!meaningful.length) return false

  await processPendingCrmDeliveries(deps).catch((err) =>
    console.error("[crm-flow] processPendingCrmDeliveries:", err?.message || err),
  )
  // Flush curto: o scheduler (30s) entrega o restante — evita segurar event loop 90s por fluxo.
  flushCrmDeliveries(deps, { conversationId: conversation.id, maxMs: 8000 }).catch((err) =>
    console.error("[crm-flow] flushCrmDeliveries:", err?.message || err),
  )

  const hasSend = meaningful.some((d) => String(d).startsWith("send_message"))
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
      detail: `${reason}: ${meaningful.join(", ") || "sem ações"}${runStatus === "failed" ? " (envio falhou)" : ""}`,
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
  if (isFlowsStopped(conversation.contact)) return
  if (await isFlowsStoppedForContact(deps.prisma, conversation.contactId, conversation.contact)) return
  const { prisma } = deps

  const eventAt = message.timestamp || message.createdAt || new Date()

  if (isNewConversation || dispatchNewConversation) {
    for (const flow of await loadEnabledFlows(prisma, conversation.userId, "new_conversation")) {
      if (!isEventAfterFlowActivation(flow, eventAt)) continue
      await runFlow(deps, flow, conversation, "new_conversation").catch((err) =>
        console.error("[crm-flow] new_conversation:", err?.message || err),
      )
    }
  }

  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "keyword")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger && keywordMatches(trigger, message.body)) {
      if (!isEventAfterFlowActivation(flow, eventAt)) continue
      await runFlow(deps, flow, conversation, "keyword").catch((err) =>
        console.error("[crm-flow] keyword:", err?.message || err),
      )
    }
  }

  // Resposta do lead em conversa existente; tags opcionais; firstReplyOnly opcional.
  if (!isNewConversation) {
    for (const flow of await loadEnabledFlows(prisma, conversation.userId, "contact_reply")) {
      const trigger = normalizeTrigger(flow.trigger)
      if (!trigger) continue
      if (!isEventAfterFlowActivation(flow, eventAt)) continue
      if (trigger.tagIds?.length) {
        const ok = await contactHasAnyTag(prisma, conversation.contactId, trigger.tagIds)
        if (!ok) continue
      }
      if (trigger.firstReplyOnly) {
        const inboundCount = await prisma.crmMessage.count({
          where: {
            conversationId: conversation.id,
            fromMe: false,
            source: { notIn: ["flow", "ai"] },
          },
        })
        // Conta inclui a mensagem atual já persistida → só a 1ª inbound.
        if (inboundCount > 1) continue
      }
      await runFlow(deps, flow, conversation, "contact_reply").catch((err) =>
        console.error("[crm-flow] contact_reply:", err?.message || err),
      )
    }
  }
}

/**
 * Cancela CrmDelivery pendentes de fluxos (e ações setTimeout) para uma conversa.
 * @param {{ flowIds?: string[]|null, reason?: string }} opts
 *   flowIds null/undefined = todos os kind=flow da conversa com cancelIfHumanReplies
 *   (quando reason é human). Para condition-broken, passa flowIds explícitos.
 */
async function cancelPendingFlowDeliveries(prisma, conversationId, opts = {}) {
  if (!prisma || !conversationId) return { cancelled: 0 }
  const reason = String(opts.reason || "cancelled")
  const flowIds = Array.isArray(opts.flowIds) ? opts.flowIds.filter(Boolean) : null

  const where = {
    conversationId,
    kind: "flow",
    status: "pending",
  }
  if (flowIds?.length) {
    where.sourceId = { in: flowIds }
  } else if (opts.onlyCancelIfHumanReplies) {
    const flows = await prisma.crmFlow.findMany({
      where: { cancelIfHumanReplies: true },
      select: { id: true },
    })
    const ids = flows.map((f) => f.id)
    if (!ids.length) return { cancelled: 0 }
    where.sourceId = { in: ids }
  }

  const result = await prisma.crmDelivery.updateMany({
    where,
    data: { status: "cancelled", error: reason },
  })

  if (flowIds?.length) {
    for (const id of flowIds) markDelayedActionsCancelled(conversationId, id)
  } else {
    markDelayedActionsCancelled(conversationId, null)
  }

  return { cancelled: result.count || 0 }
}

/** Humano enviou mensagem na conversa (CRM manual ou WhatsApp fromMe não-flow/ai). */
async function onHumanOutboundMessage(deps, { conversationId, userId = null }) {
  const { prisma } = deps
  if (!conversationId) return { cancelled: 0 }
  return cancelPendingFlowDeliveries(prisma, conversationId, {
    onlyCancelIfHumanReplies: true,
    reason: "Humano respondeu antes do envio automático.",
  })
}

/** Extrai stageId / tagIds que o fluxo exige como condição de disparo. */
function flowRequiredStageAndTags(flow) {
  const stages = new Set()
  const tags = new Set()
  const trigger = normalizeTrigger(flow?.trigger)
  if (trigger?.type === "stage_change" && trigger.stageId) stages.add(String(trigger.stageId))
  if (trigger?.type === "contact_reply" && Array.isArray(trigger.tagIds)) {
    for (const id of trigger.tagIds) tags.add(String(id))
  }
  if (trigger?.type === "tag_added" && trigger.tagId) tags.add(String(trigger.tagId))

  const conditions = Array.isArray(flow?.conditions) ? flow.conditions : []
  for (const cond of conditions) {
    const type = String(cond?.type || "")
    if (type === "stage_is") {
      stages.add(cond.value === "__none__" || cond.value == null ? "__none__" : String(cond.value))
    } else if (type === "has_tag") {
      if (cond.value) tags.add(String(cond.value))
    } else if (type === "has_any_tag") {
      try {
        const ids = JSON.parse(String(cond.value || "[]"))
        if (Array.isArray(ids)) for (const id of ids) tags.add(String(id))
      } catch {
        /* ignore */
      }
    }
  }
  return { stages, tags }
}

/**
 * Quando o card sai do estágio ou perde tag que era condição do fluxo,
 * cancela deliveries pendentes daquele fluxo nesta conversa.
 */
async function cancelFlowsBrokenByStageOrTag(deps, { conversation, previousStageId = undefined, removedTagId = null }) {
  const { prisma } = deps
  if (!conversation?.id || !conversation?.userId) return { cancelled: 0 }

  const flows = await prisma.crmFlow.findMany({
    where: { userId: conversation.userId, enabled: true },
  })
  const brokenIds = []
  const currentStageKey =
    conversation.kanbanStageId == null || conversation.kanbanStageId === ""
      ? "__none__"
      : String(conversation.kanbanStageId)

  for (const flow of flows) {
    const { stages, tags } = flowRequiredStageAndTags(flow)
    let broken = false
    if (previousStageId !== undefined && stages.size && !stages.has(currentStageKey)) {
      broken = true
    }
    if (removedTagId && tags.has(String(removedTagId))) {
      // Para has_any_tag / contact_reply com várias tags: só quebra se NÃO restar nenhuma.
      if (tags.size <= 1) {
        broken = true
      } else {
        const stillHas = await contactHasAnyTag(prisma, conversation.contactId, [...tags])
        if (!stillHas) broken = true
      }
    }
    if (broken) brokenIds.push(flow.id)
  }

  if (!brokenIds.length) return { cancelled: 0 }
  return cancelPendingFlowDeliveries(prisma, conversation.id, {
    flowIds: brokenIds,
    reason: "Condição do fluxo deixou de ser verdadeira (estágio/tag).",
  })
}

/**
 * Chamado quando um card muda de estágio no Kanban (só na transição — não varre quem já está).
 * `cancelBrokenConditions` + `previousStageId`: use em mudanças externas (UI/WA),
 * NÃO ao mover estágio de dentro do próprio fluxo (senão cancela a fila do run atual).
 */
async function onStageChange(deps, { conversation, stageId, eventAt = null, previousStageId = undefined, cancelBrokenConditions = false }) {
  const { prisma } = deps
  if (cancelBrokenConditions) {
    await cancelFlowsBrokenByStageOrTag(deps, {
      conversation: { ...conversation, kanbanStageId: stageId },
      previousStageId: previousStageId !== undefined ? previousStageId : conversation?.kanbanStageId,
    }).catch((err) => console.warn("[crm-flow] cancel on stage leave:", err?.message || err))
  }
  if (isFlowsStopped(conversation?.contact)) return
  if (await isFlowsStoppedForContact(prisma, conversation?.contactId, conversation?.contact)) return
  // Coluna virtual "Sem estágio" no board = kanbanStageId null → chave __none__ no trigger.
  const targetKey = stageId == null || stageId === "" ? "__none__" : String(stageId)
  const happenedAt = eventAt ? new Date(eventAt) : new Date()
  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "stage_change")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (!trigger) continue
    // Só dispara se a entrada no estágio for depois da ativação do fluxo.
    if (!isEventAfterFlowActivation(flow, happenedAt)) continue
    if (!trigger.stageId || trigger.stageId === targetKey) {
      await runFlow(deps, flow, conversation, "stage_change").catch((err) =>
        console.error("[crm-flow] stage_change:", err?.message || err),
      )
    }
  }
}

/** Tag removida do contato — cancela filas cujas condições dependiam dela. */
async function onTagRemoved(deps, { conversation, tagId }) {
  if (!conversation || !tagId) return
  await cancelFlowsBrokenByStageOrTag(deps, {
    conversation,
    removedTagId: String(tagId),
  }).catch((err) => console.warn("[crm-flow] cancel on tag remove:", err?.message || err))
}

/** Chamado quando uma tag é vinculada de fato ao contato (não no re-add). */
async function onTagAdded(deps, { conversation, tagId }) {
  if (!conversation || !tagId) return
  const { prisma } = deps
  if (isFlowsStopped(conversation.contact)) return
  if (await isFlowsStoppedForContact(prisma, conversation.contactId, conversation.contact)) return
  const wanted = String(tagId)
  const eventAt = new Date()
  for (const flow of await loadEnabledFlows(prisma, conversation.userId, "tag_added")) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger && trigger.tagId === wanted) {
      if (!isEventAfterFlowActivation(flow, eventAt)) continue
      await runFlow(deps, flow, conversation, "tag_added").catch((err) =>
        console.error("[crm-flow] tag_added:", err?.message || err),
      )
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

/** Lote por tick/fluxo — backlog grande (ex. Bina) não pode ficar preso em 20 cards. */
const NO_REPLY_BATCH = Math.max(20, Math.min(200, Number(process.env.CRM_NO_REPLY_BATCH || 80)))

/**
 * Tick do scheduler: fluxos "sem resposta há X tempo".
 * Usa `noReplySinceAt` (último outbound humano). Envios de flow/IA atualizam
 * lastMessageAt mas NÃO reiniciam este timer — só resposta do lead zera a âncora.
 *
 * Importante: exclui quem já está no estágio destino (move_stage-only) e quem
 * está em cooldown — senão o mesmo take:N engasga o lote e o resto nunca move.
 */
async function processNoReplyFlows(deps) {
  const { prisma } = deps
  const flows = await prisma.crmFlow.findMany({ where: { enabled: true } })
  for (const flow of flows) {
    const trigger = normalizeTrigger(flow.trigger)
    if (trigger?.type !== "no_reply") continue
    const threshold = new Date(Date.now() - trigger.minutes * 60 * 1000)
    const where = { ...noReplyCandidateWhere(flow.userId, threshold) }
    const andFilters = []

    // Default: só conversas criadas depois que o fluxo ficou ativo (não backfill).
    if (trigger.onlyAfterFlowCreated !== false) {
      const since = resolveFlowActiveSince(flow)
      if (since) andFilters.push({ createdAt: { gte: since } })
    }

    const actions = Array.isArray(flow.actions) ? flow.actions : []
    const moveOnly =
      actions.length > 0 && actions.every((a) => a?.type === "move_stage" && a.stageId)
    if (moveOnly) {
      const stageIds = [...new Set(actions.map((a) => String(a.stageId)))]
      // Prisma `{ not: id }` NÃO inclui null — precisa OR explícito.
      andFilters.push({
        OR: [{ kanbanStageId: null }, { kanbanStageId: { notIn: stageIds } }],
      })
    }
    if (andFilters.length) where.AND = andFilters

    const rawCd = Number(flow.cooldownPerContactHours ?? CRM_FLOW_DEFAULT_COOLDOWN_HOURS)
    const cooldownHours = Number.isFinite(rawCd)
      ? Math.min(720, Math.max(0, Math.round(rawCd)))
      : CRM_FLOW_DEFAULT_COOLDOWN_HOURS
    if (cooldownHours > 0) {
      const since = new Date(Date.now() - cooldownHours * 3600 * 1000)
      const recent = await prisma.crmFlowRun.findMany({
        where: {
          flowId: flow.id,
          createdAt: { gte: since },
          ...PROD_RUN_WHERE,
        },
        select: { conversationId: true },
        distinct: ["conversationId"],
        take: 8000,
      })
      const excludeIds = [...new Set(recent.map((r) => r.conversationId).filter(Boolean))]
      if (excludeIds.length) where.id = { notIn: excludeIds }
    }

    const candidates = await prisma.crmConversation.findMany({
      where,
      take: NO_REPLY_BATCH,
      orderBy: [{ noReplySinceAt: "asc" }, { lastMessageAt: "asc" }],
      include: CONVERSATION_INCLUDE,
    })
    let moved = 0
    for (const conversation of candidates) {
      const ok = await runFlow(deps, flow, conversation, "no_reply").catch((err) => {
        console.error("[crm-flow] no_reply:", err?.message || err)
        return false
      })
      if (ok) moved += 1
    }
    if (candidates.length || moved) {
      console.log(
        `[crm-flow] no_reply flow=${flow.id.slice(0, 8)}… user=${flow.userId.slice(0, 8)}… candidates=${candidates.length} ranOk=${moved}`,
      )
    }
  }
}

/** Dispara fluxos (e opcionalmente IA) após ingestCrmMessage quando shouldDispatchFlows. */
async function dispatchCrmMessageFlows(deps, result, { includeAi = false } = {}) {
  if (!result?.shouldDispatchFlows || !result.message || result.message.fromMe) return
  const { conversation, message, isNewConversation, dispatchNewConversation } = result
  await onCrmMessage(deps, {
    conversation,
    message,
    isNewConversation,
    dispatchNewConversation,
  }).catch((err) => console.error("[crm-flow] dispatch:", err?.message || err))

  if (includeAi) {
    const { maybeReplyWithAi } = require("./crmAiAgent")
    await maybeReplyWithAi(deps, { conversation, message }).catch((err) =>
      console.error("[crm-ai] dispatch:", err?.message || err),
    )
  }
}

module.exports = {
  onCrmMessage,
  dispatchCrmMessageFlows,
  onStageChange,
  onTagAdded,
  onTagRemoved,
  notifyTagAddedForContact,
  onHumanOutboundMessage,
  cancelPendingFlowDeliveries,
  cancelFlowsBrokenByStageOrTag,
  processNoReplyFlows,
  noReplyCandidateWhere,
  contactHasAnyTag,
  testFlowOnConversation,
  normalizeTrigger,
  keywordMatches,
  normalizeKeywordText,
  conditionsPass,
  isWithinQuietHours,
  normalizeQuietHours,
  bumpScheduledAtPastQuietHours,
  deliveryDelayMs,
  getFlowBlockReason,
  resolveFlowActiveSince,
  isEventAfterFlowActivation,
}

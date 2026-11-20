/**
 * Rotas do módulo CRM (conversas 1:1, kanban, tags, atalhos, fluxos, agentes IA, sync).
 * Fábrica: recebe `io` para eventos em tempo real.
 */

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const { readUserFilter, assertUserInScope } = require("../lib/orgScope")
const {
  sendText,
  sendMedia,
  sendWhatsAppAudio,
  sendPresence,
  findChats,
  findChatsPaginated,
  findContacts,
  fetchChatMessages,
  findMessageById,
  fetchProfile,
  fetchProfilePictureUrl,
  numberExistsOnWhatsapp,
  bindInstanceHost,
  saveContact,
  getBase64FromMediaMessage,
  extractMediaBase64Payload,
  restartInstance,
  reassertInstanceWebhook,
  getConnectionStateForProbe,
  pickConnected,
  pickStatus,
  deleteMessageForEveryone,
  updateMessageText,
  markMessagesAsRead,
} = require("../lib/evolution")
const {
  buildEvolutionQuotedPayload,
  mergeVestoRaw,
} = require("../lib/crmMessageActions")
const { enqueueUserSend } = require("../lib/sendQueue")
const { validateMediaContentSize } = require("../lib/mediaLimits")
const { createSemaphore } = require("../lib/semaphore")
const mediaDownloadSemaphore = createSemaphore(Number(process.env.MEDIA_DOWNLOAD_CONCURRENCY || 2))
const {
  formatContactRow,
  formatConversationRow,
  formatMessageRow,
  previewFromBody,
  emitCrmEvent,
  CONVERSATION_INCLUDE,
  normalizeMessageMediaKind,
  resolveEvolutionRecipient,
  propagateSavedNameToPhoneSiblings,
  ensureContactAndConversation,
} = require("../lib/crmCore")
const { startCrmSync, cancelCrmSync, getCrmSyncStatus } = require("../lib/crmSync")
const { syncContactProfiles, enqueueAvatarFetches } = require("../lib/crmProfile")
const { ensureMessageRaw, readStoredMessageMedia, buildOutboundMessageRaw, stripMediaBase64 } = require("../lib/crmMedia")
const { onStageChange, notifyTagAddedForContact, testFlowOnConversation, dispatchCrmMessageFlows } = require("../lib/crmFlows")
const { importCrmPack } = require("../lib/crmPackImport")
const { processPendingCrmDeliveries, flushCrmDeliveries } = require("../lib/crmDelivery")
const { ensureWhatsAppConnected } = require("../lib/whatsappConnection")
const { pickAvatarFromPicturePayload, pickProfileFields } = require("../lib/crmProfile")
const { testAgentReply, generateSystemPrompt } = require("../lib/crmAiAgent")
const { parseKnowledgeUpload, loadKnowledgeChunks } = require("../lib/crmAiKnowledge")
const { encryptApiKey, last4, publicAiStatus, resolveOrgAiClient } = require("../lib/crmAiCredentials")
const { normalizeAudience, audienceError, agentCoversMember, agentInOrganization } = require("../lib/crmAiAudience")
const { registerCrmAnalysisRoutes } = require("./crmAnalysis")
const {
  logContactActivity,
  getContactActivityTimeline,
  deleteContactActivity,
  updateContactActivity,
  saveContactQuote,
  confirmContactPurchase,
} = require("../lib/crmContactActivity")
const {
  listContactReminders,
  createContactReminder,
  cancelContactReminder,
  listReminderAlerts,
  dismissReminderAlert,
  processDueContactReminders,
} = require("../lib/crmContactReminders")
const { listCrmSales } = require("../lib/crmSales")
const { ensureDefaultTags, isQualifiedTagName, resolveTagForContactUser, tagNameKey } = require("../lib/crmDefaults")
const { trackMetaForContactTag } = require("../lib/metaConversions")
const { reassignContactToSeller } = require("../lib/crmReassign")
const {
  unifyLidPhoneDuplicates,
  emitUnificationEvents,
  findContactByPhone,
} = require("../lib/crmContactMerge")
const { buildConversationSearchClauses, phoneDigitsFromValue } = require("../lib/participantIdentity")
const { deleteScopedContact, deleteScopedContacts, emitContactDeleted } = require("../lib/crmContactDelete")
const {
  confirmEvolutionDelivery,
  assertOutboundRecipient,
  extractProviderMessageId,
} = require("../lib/crmOutboundSend")
const {
  syncWhatsappLabelsForUser,
  getWhatsappLabelsStatus,
  mirrorStageChangeToWhatsapp,
  mirrorQualifiedTagToWhatsapp,
} = require("../lib/crmWhatsappLabels")
const {
  resolveStageForConversationUser,
  buildViewerStageRemap,
  applyViewerStageRemap,
} = require("../lib/crmKanbanStages")

function isQuoteTagName(name) {
  const n = String(name || "").trim()
  return n === "Orçamento" || n.startsWith("Orçamento ")
}

/** Normaliza telefone digitado no CRM (BR): 10/11 dígitos → prefixa 55. */
function normalizeManualCrmPhone(input) {
  let digits = String(input || "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (!digits.startsWith("55")) return null
  if (digits.length < 12 || digits.length > 13) return null
  return digits
}

const DEFAULT_STAGES = [
  { name: "Novo", color: "#38bdf8", isDefault: true },
  { name: "Em atendimento", color: "#fbbf24" },
  { name: "Negociando", color: "#a78bfa" },
  { name: "Fechado", color: "#34d399" },
]

async function ensureDefaultStages(userId) {
  const count = await prisma.crmKanbanStage.count({ where: { userId } })
  if (count === 0) {
    await prisma.crmKanbanStage.createMany({
      data: DEFAULT_STAGES.map((s, i) => ({ userId, sortOrder: i, ...s })),
    })
  }
  await ensureDefaultTags(userId)
}

function formatStageRow(stage) {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    sortOrder: stage.sortOrder,
    isDefault: stage.isDefault,
  }
}

function formatTagRow(tag) {
  return { id: tag.id, name: tag.name, color: tag.color }
}

function formatQuickReplyRow(qr) {
  return {
    id: qr.id,
    shortcut: qr.shortcut,
    title: qr.title || "",
    body: qr.body,
    mediaType: qr.mediaType,
    mediaMime: qr.mediaMime || null,
    mediaName: qr.mediaName || null,
    hasMedia: qr.mediaType !== "none",
  }
}

function formatFlowRow(flow) {
  return {
    id: flow.id,
    name: flow.name,
    enabled: flow.enabled,
    enabledAt: flow.enabledAt?.toISOString?.() || flow.enabledAt || null,
    trigger: flow.trigger,
    conditions: flow.conditions || [],
    actions: flow.actions,
    cooldownPerContactHours: flow.cooldownPerContactHours,
    quietHours: flow.quietHours || null,
    createdAt: flow.createdAt.toISOString(),
  }
}

/** Stamp de ativação: só dispara/varre eventos a partir deste instante. */
function flowEnabledAtData(nextEnabled, previousEnabled) {
  if (nextEnabled === true && !previousEnabled) return { enabledAt: new Date() }
  if (nextEnabled === false) return { enabledAt: null }
  return {}
}

function validateFlowActions(actions) {
  for (const action of actions) {
    if (action.type !== "send_message") continue
    const err = validateMediaContentSize({
      body: action.body || "",
      mediaType: action.mediaType || "none",
      mediaBase64: action.mediaBase64,
      mediaMime: action.mediaMime,
      mediaName: action.mediaName,
    })
    if (err) return err
  }
  return null
}

function formatAgentRow(agent) {
  return {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    maxRepliesPerConversation: agent.maxRepliesPerConversation,
    handoffKeywords: agent.handoffKeywords || [],
    quietHours: agent.quietHours || null,
    replyDelayMinSec: agent.replyDelayMinSec,
    replyDelayMaxSec: agent.replyDelayMaxSec,
    activationMode: agent.activationMode || "manual",
    activationConfig: agent.activationConfig || null,
    allowedTools: agent.allowedTools || [],
    allowedTagIds: agent.allowedTagIds || [],
    knowledgeText: agent.knowledgeText || "",
    promptTemplateId: agent.promptTemplateId || null,
    locale: agent.locale || "pt-BR",
    numberScope: agent.numberScope || "all",
    numberUserId: agent.numberUserId || null,
    boardScope: agent.boardScope || "all",
    boardUserId: agent.boardUserId || null,
    organizationId: agent.organizationId || null,
    createdAt: agent.createdAt.toISOString(),
  }
}

const quietHoursSchema = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  })
  .nullable()
  .optional()

function createCrmRouter({ io }) {
  const router = express.Router()
  router.use(authMiddleware)

  function scopeWhere(req, extra = {}) {
    return { ...readUserFilter(req.dataScope), ...extra }
  }

  async function findScopedConversation(req, conversationId) {
    return prisma.crmConversation.findFirst({
      where: { id: conversationId, ...readUserFilter(req.dataScope) },
      include: CONVERSATION_INCLUDE,
    })
  }

  async function findScopedContact(req, contactId) {
    return prisma.crmContact.findFirst({
      where: { id: contactId, ...readUserFilter(req.dataScope) },
    })
  }

  function canMutateAsActor(req, resourceUserId) {
    if (resourceUserId === req.user.sub) return true
    // Dono da empresa pode corrigir vendas/histórico da equipe no escopo.
    if (req.dataScope?.isOwner && assertUserInScope(req.dataScope, resourceUserId)) return true
    return false
  }

  async function resolveActorProfile(req) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true },
    })
    return { actorUserId: req.user.sub, actorName: user?.name || null }
  }

  const syncDeps = {
    prisma,
    io,
    findChats,
    findChatsPaginated,
    findContacts,
    fetchChatMessages,
    fetchProfile,
    fetchProfilePictureUrl,
    restartInstance,
    reassertInstanceWebhook,
    bindInstanceHost,
    getConnectionStateForProbe,
    pickConnected,
    pickStatus,
  }

  // ------------------------- Conversas -------------------------

  router.get("/conversations", async (req, res) => {
    const userId = req.user.sub
    await ensureDefaultStages(userId)

    const { status, stageId, tagId, q, sellerUserId } = req.query

    const where = scopeWhere(req)
    // Arquivada some da inbox por padrão; para revê-las é preciso pedir status=archived.
    if (status && ["open", "pending", "resolved", "archived"].includes(status)) where.status = status
    else where.status = { not: "archived" }
    // Grupos (@g.us) têm inbox própria — não misturar com conversas 1:1.
    where.NOT = { ...(where.NOT || {}), remoteJid: { endsWith: "@g.us" } }
    if (stageId === "none") where.kanbanStageId = null
    else if (stageId) where.kanbanStageId = String(stageId)
    if (tagId) where.contact = { tags: { some: { tagId: String(tagId) } } }
    // Dono/admin: filtrar inbox por membro da empresa (vendedor ou dono).
    if (sellerUserId && String(sellerUserId).trim()) {
      const sid = String(sellerUserId).trim()
      if (!req.dataScope?.isOwner) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Apenas o dono da empresa pode filtrar por membro.",
        })
      }
      if (!assertUserInScope(req.dataScope, sid)) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Membro fora do escopo da empresa.",
        })
      }
      where.userId = sid
    }

    const unifyIds = typeof where.userId === "string"
      ? [where.userId]
      : Array.isArray(where.userId?.in)
        ? where.userId.in
        : [userId]
    const lidCleanup = await unifyLidPhoneDuplicates(prisma, { userIds: unifyIds, limit: 80 }).catch(() => ({ results: [] }))
    for (const row of lidCleanup.results || []) {
      emitUnificationEvents(emitCrmEvent, io, row.contact?.userId || userId, row)
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "100", 10) || 100))
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0)
    if (q && String(q).trim()) {
      const term = String(q).trim()
      const clauses = buildConversationSearchClauses(term)
      if (clauses.length) where.OR = clauses
    }

    const [total, rows] =
      req.query.includeTotal === "0"
        ? [null, await prisma.crmConversation.findMany({
            where,
            include: CONVERSATION_INCLUDE,
            orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
            skip: offset,
            take: limit,
          })]
        : await prisma.$transaction([
            prisma.crmConversation.count({ where }),
            prisma.crmConversation.findMany({
              where,
              include: CONVERSATION_INCLUDE,
              orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
              skip: offset,
              take: limit,
            }),
          ])

    // Dono vê estágios do próprio board: remapeia ids da equipe pelo nome da coluna.
    const stageRemap =
      req.dataScope?.isOwner && (req.dataScope.userIds?.length || 0) > 1
        ? await buildViewerStageRemap(prisma, {
            viewerUserId: userId,
            stageIds: rows.map((r) => r.kanbanStageId),
          })
        : new Map()

    return res.json({
      conversations: rows.map((r) => applyViewerStageRemap(formatConversationRow(r), stageRemap)),
      total: total ?? rows.length,
      limit,
      offset,
    })
  })

  router.get("/conversations/:id", async (req, res) => {
    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    let row = formatConversationRow(convo)
    if (req.dataScope?.isOwner && convo.userId !== req.user.sub && convo.kanbanStageId) {
      const remap = await buildViewerStageRemap(prisma, {
        viewerUserId: req.user.sub,
        stageIds: [convo.kanbanStageId],
      })
      row = applyViewerStageRemap(row, remap)
    }
    return res.json({ conversation: row })
  })

  router.get("/conversations/:id/messages", async (req, res) => {
    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10) || 50))
    const before = req.query.before ? new Date(String(req.query.before)) : null

    const phoneDigits = String(convo.contact?.phone || "").replace(/\D/g, "")
    let conversationIds = [convo.id]
    if (phoneDigits.length >= 8) {
      const siblings = await prisma.crmContact.findMany({
        where: {
          userId: convo.userId,
          phone: phoneDigits,
          id: { not: convo.contactId },
        },
        select: { id: true },
      })
      if (siblings.length) {
        const extraConvos = await prisma.crmConversation.findMany({
          where: { contactId: { in: siblings.map((s) => s.id) } },
          select: { id: true },
        })
        conversationIds = [...new Set([convo.id, ...extraConvos.map((c) => c.id)])]
      }
    }

    const where = { conversationId: { in: conversationIds } }
    if (before && !Number.isNaN(before.getTime())) where.timestamp = { lt: before }

    const rows = await prisma.crmMessage.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
      omit: { raw: true },
    })
    rows.reverse()

    return res.json({
      messages: rows.map(formatMessageRow),
      hasMore: rows.length === limit,
    })
  })

  router.get("/messages/:messageId/media", async (req, res) => {
    const msg = await prisma.crmMessage.findFirst({
      where: { id: req.params.messageId, ...readUserFilter(req.dataScope) },
    })
    if (!msg) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })

    const mediaKind = normalizeMessageMediaKind(msg.type)
    if (!mediaKind) {
      return res.status(400).json({ error: "NOT_MEDIA", message: "Esta mensagem não contém mídia." })
    }

    const stored = readStoredMessageMedia(msg)
    if (stored?.base64) {
      return res.json({
        kind: mediaKind,
        mimetype: stored.mimetype || msg.mediaMime || null,
        base64: stored.base64,
      })
    }

    const conn = await ensureWhatsAppConnected(prisma, msg.userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    const rawRecord = await ensureMessageRaw({ prisma, fetchChatMessages }, msg)
    if (!rawRecord || typeof rawRecord !== "object") {
      return res.status(409).json({ error: "MEDIA_UNAVAILABLE", message: "Mídia indisponível para esta mensagem." })
    }

    try {
      const resp = await mediaDownloadSemaphore.run(() =>
        getBase64FromMediaMessage(conn.instanceName, rawRecord, {
          convertToMp4: mediaKind === "video",
        }),
      )
      const media = extractMediaBase64Payload(resp)
      if (!media) {
        return res.status(502).json({ error: "MEDIA_FETCH_FAILED", message: "Não foi possível baixar a mídia." })
      }
      return res.json({
        kind: mediaKind,
        mimetype: media.mimetype || msg.mediaMime || null,
        base64: media.base64,
      })
    } catch (err) {
      console.error("[crm] media download failed:", err?.message || err)
      return res.status(502).json({
        error: "MEDIA_FETCH_FAILED",
        message: err?.message || "Falha ao baixar mídia do WhatsApp.",
      })
    }
  })

  router.post("/conversations/:id/send", async (req, res) => {
    const schema = z.object({
      body: z.string().max(4096).optional().default(""),
      mediaType: z.enum(["none", "image", "video", "audio", "document"]).optional().default("none"),
      mediaBase64: z.string().optional().nullable(),
      mediaMime: z.string().max(120).optional().nullable(),
      mediaName: z.string().max(255).optional().nullable(),
      quotedMessageId: z.string().max(120).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const content = parsed.data

    const mediaError = validateMediaContentSize(content)
    if (mediaError) return res.status(400).json({ error: "MEDIA_INVALID", message: mediaError })

    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    if (!canMutateAsActor(req, convo.userId)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente o vendedor responsável pode responder nesta conversa.",
      })
    }

    const userId = convo.userId
    const conn = await ensureWhatsAppConnected(prisma, userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    let quotedRow = null
    if (content.quotedMessageId) {
      quotedRow = await prisma.crmMessage.findFirst({
        where: {
          conversationId: convo.id,
          OR: [{ id: content.quotedMessageId }, { messageId: content.quotedMessageId }],
        },
      })
    }

    try {
      const resp = await enqueueUserSend(userId, async () => {
        const to = assertOutboundRecipient(convo)
        const quoted = quotedRow
          ? buildEvolutionQuotedPayload(
              {
                messageId: quotedRow.messageId,
                fromMe: quotedRow.fromMe,
                body: quotedRow.body || "",
                raw: quotedRow.raw,
              },
              convo.remoteJid,
            )
          : null
        let sendResp
        if (content.mediaType === "audio") {
          const media = stripMediaBase64(content.mediaBase64)
          const mimetype = content.mediaMime || "audio/ogg; codecs=opus"
          sendResp = await sendWhatsAppAudio(conn.instanceName, to, {
            audio: media,
            mimetype,
            encoding: true,
          })
        } else if (content.mediaType !== "none") {
          const media = stripMediaBase64(content.mediaBase64)
          sendResp = await sendMedia(conn.instanceName, to, {
            mediatype: content.mediaType,
            media,
            mimetype: content.mediaMime || undefined,
            caption: content.body || undefined,
            fileName: content.mediaName || undefined,
            ...(quoted ? { quoted } : {}),
          })
        } else {
          sendResp = await sendText(conn.instanceName, to, content.body, quoted ? { quoted } : {})
        }
        const { messageId, crmStatus, ackOk, detail } = await confirmEvolutionDelivery(
          { fetchChatMessages, findMessageById },
          {
            instanceName: conn.instanceName,
            conversation: convo,
            to,
            resp: sendResp,
            context: content.mediaType !== "none" ? `mídia (${content.mediaType})` : "texto",
            mediaType: content.mediaType,
          },
        )
        return {
          ...sendResp,
          key: { ...(sendResp?.key || {}), id: messageId },
          _crmStatus: crmStatus,
          _ackOk: ackOk,
          _ackDetail: detail,
        }
      })

      const providerMessageId = resp?.key?.id || extractProviderMessageId(resp)
      const now = new Date()
      const hasMedia = content.mediaType !== "none"
      const mediaB64 = hasMedia ? stripMediaBase64(content.mediaBase64) : null
      const storedMime =
        content.mediaType === "audio"
          ? resp?._vestoAudio?.mimetype || content.mediaMime || "audio/ogg; codecs=opus"
          : content.mediaMime || null
      let messageRaw = hasMedia
        ? buildOutboundMessageRaw({
            providerMessageId,
            remoteJid: convo.remoteJid,
            evolutionResp: resp,
            mediaBase64: mediaB64,
            mediaMime: storedMime,
            mediaName: content.mediaName,
          })
        : null
      if (quotedRow) {
        messageRaw = mergeVestoRaw(messageRaw, {
          quotedMessageId: quotedRow.messageId,
          quotedFromMe: Boolean(quotedRow.fromMe),
          quotedPreview: String(quotedRow.body || "").slice(0, 200) || previewFromBody(quotedRow.body, quotedRow.type),
        })
      }

      const message = await prisma.crmMessage.upsert({
        where: {
          conversationId_messageId: { conversationId: convo.id, messageId: providerMessageId },
        },
        create: {
          userId,
          conversationId: convo.id,
          messageId: providerMessageId,
          fromMe: true,
          type: content.mediaType === "none" ? "text" : content.mediaType,
          body: content.body || "",
          mediaMime: storedMime,
          status: resp?._crmStatus || "sent",
          source: "manual",
          timestamp: now,
          raw: messageRaw,
        },
        update: {
          body: content.body || "",
          type: content.mediaType === "none" ? "text" : content.mediaType,
          mediaMime: storedMime,
          status: resp?._crmStatus || "sent",
          source: "manual",
          raw: messageRaw ?? undefined,
        },
      })

      const updated = await prisma.crmConversation.update({
        where: { id: convo.id },
        data: {
          lastMessageAt: now,
          lastMessagePreview: previewFromBody(content.body, content.mediaType === "none" ? "text" : content.mediaType),
          lastMessageFromMe: true,
          noReplySinceAt: now,
          status: convo.status === "resolved" ? "open" : convo.status,
        },
        include: CONVERSATION_INCLUDE,
      })

      emitCrmEvent(io, userId, "crm:message", {
        conversationId: convo.id,
        message: formatMessageRow(message),
        conversation: formatConversationRow(updated),
      })

      emitCrmEvent(io, userId, "crm:message_status", {
        conversationId: convo.id,
        messageId: providerMessageId,
        status: message.status,
        message: formatMessageRow(message),
      })

      if (resp?._ackOk === false) {
        return res.status(502).json({
          error: "DELIVERY_NOT_CONFIRMED",
          message: resp?._ackDetail || "WhatsApp não confirmou a entrega.",
          crmMessage: formatMessageRow(message),
          conversation: formatConversationRow(updated),
        })
      }

      return res.json({ message: formatMessageRow(message), conversation: formatConversationRow(updated) })
    } catch (err) {
      console.error("[crm] envio manual falhou:", err?.message || err)
      return res.status(502).json({ error: "SEND_FAILED", message: "Falha ao enviar. Tente novamente." })
    }
  })

  router.post("/conversations/:id/read", async (req, res) => {
    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    const updated = await prisma.crmConversation.update({
      where: { id: convo.id },
      data: { unreadCount: 0 },
      include: CONVERSATION_INCLUDE,
    })
    emitCrmEvent(io, convo.userId, "crm:conversation", { conversation: formatConversationRow(updated) })

    // Marca no WhatsApp as inbound recentes como lidas (ticks azuis para o contato)
    try {
      const conn = await ensureWhatsAppConnected(prisma, convo.userId)
      if (conn) {
        const recentInbound = await prisma.crmMessage.findMany({
          where: { conversationId: convo.id, fromMe: false },
          orderBy: { timestamp: "desc" },
          take: 20,
          select: { messageId: true },
        })
        if (recentInbound.length) {
          await markMessagesAsRead(
            conn.instanceName,
            recentInbound.map((m) => ({
              remoteJid: convo.remoteJid,
              id: m.messageId,
              fromMe: false,
            })),
          ).catch(() => {})
        }
      }
    } catch {
      /* best-effort */
    }

    return res.json({ conversation: formatConversationRow(updated) })
  })

  /** Editar mensagem própria (texto). */
  router.patch("/conversations/:id/messages/:messageId", async (req, res) => {
    const schema = z.object({ body: z.string().min(1).max(4096) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Texto inválido." })

    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    if (!canMutateAsActor(req, convo.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão nesta conversa." })
    }

    const msg = await prisma.crmMessage.findFirst({
      where: {
        conversationId: convo.id,
        OR: [{ id: req.params.messageId }, { messageId: req.params.messageId }],
      },
    })
    if (!msg) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })
    if (!msg.fromMe) {
      return res.status(400).json({ error: "NOT_OWN", message: "Só é possível editar suas mensagens." })
    }
    if (String(msg.type || "").toLowerCase() !== "text") {
      return res.status(400).json({ error: "NOT_TEXT", message: "Só é possível editar mensagens de texto." })
    }
    if (msg.raw?._vesto?.deleted) {
      return res.status(400).json({ error: "DELETED", message: "Mensagem já foi apagada." })
    }

    const conn = await ensureWhatsAppConnected(prisma, convo.userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    try {
      const to = assertOutboundRecipient(convo)
      await updateMessageText(conn.instanceName, {
        number: to,
        text: parsed.data.body,
        key: {
          remoteJid: convo.remoteJid,
          fromMe: true,
          id: msg.messageId,
        },
      })
      const updated = await prisma.crmMessage.update({
        where: { id: msg.id },
        data: {
          body: parsed.data.body,
          raw: mergeVestoRaw(msg.raw, { editedAt: new Date().toISOString() }),
        },
      })
      const formatted = formatMessageRow(updated)
      emitCrmEvent(io, convo.userId, "crm:message", {
        conversationId: convo.id,
        message: formatted,
      })
      return res.json({ message: formatted })
    } catch (err) {
      console.error("[crm] edit message:", err?.message || err)
      return res.status(502).json({ error: "EDIT_FAILED", message: "Não foi possível editar a mensagem." })
    }
  })

  /** Apagar mensagem para todos. */
  router.delete("/conversations/:id/messages/:messageId", async (req, res) => {
    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    if (!canMutateAsActor(req, convo.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão nesta conversa." })
    }

    const msg = await prisma.crmMessage.findFirst({
      where: {
        conversationId: convo.id,
        OR: [{ id: req.params.messageId }, { messageId: req.params.messageId }],
      },
    })
    if (!msg) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })
    if (!msg.fromMe) {
      return res.status(400).json({ error: "NOT_OWN", message: "Só é possível apagar suas mensagens." })
    }

    const conn = await ensureWhatsAppConnected(prisma, convo.userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    try {
      await deleteMessageForEveryone(conn.instanceName, {
        id: msg.messageId,
        remoteJid: convo.remoteJid,
        fromMe: true,
      })
      const updated = await prisma.crmMessage.update({
        where: { id: msg.id },
        data: {
          body: "",
          type: "deleted",
          mediaMime: null,
          raw: mergeVestoRaw(msg.raw, { deleted: true, deletedAt: new Date().toISOString() }),
        },
      })
      const formatted = formatMessageRow(updated)
      emitCrmEvent(io, convo.userId, "crm:message", {
        conversationId: convo.id,
        message: formatted,
      })
      return res.json({ message: formatted })
    } catch (err) {
      console.error("[crm] delete message:", err?.message || err)
      return res.status(502).json({ error: "DELETE_FAILED", message: "Não foi possível apagar a mensagem." })
    }
  })

  /** Encaminhar mensagem para outras conversas (reenvia conteúdo). */
  router.post("/conversations/:id/messages/:messageId/forward", async (req, res) => {
    const schema = z.object({
      targetConversationIds: z.array(z.string().min(1)).min(1).max(10),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Selecione ao menos um destino." })
    }

    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    if (!canMutateAsActor(req, convo.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão nesta conversa." })
    }

    const msg = await prisma.crmMessage.findFirst({
      where: {
        conversationId: convo.id,
        OR: [{ id: req.params.messageId }, { messageId: req.params.messageId }],
      },
    })
    if (!msg) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })
    if (msg.raw?._vesto?.deleted || msg.type === "deleted") {
      return res.status(400).json({ error: "DELETED", message: "Não é possível encaminhar mensagem apagada." })
    }

    const conn = await ensureWhatsAppConnected(prisma, convo.userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    const mediaKind = normalizeMessageMediaKind(msg.type)
    let mediaBase64 = null
    let mediaMime = msg.mediaMime || null
    if (mediaKind) {
      try {
        const stored = readStoredMessageMedia(msg)
        if (stored?.base64) {
          mediaBase64 = stored.base64
          mediaMime = stored.mimetype || mediaMime
        } else {
          const rawRecord = await ensureMessageRaw({ prisma, fetchChatMessages }, msg)
          if (rawRecord) {
            const resp = await getBase64FromMediaMessage(conn.instanceName, rawRecord, {
              convertToMp4: mediaKind === "video",
            })
            const media = extractMediaBase64Payload(resp)
            mediaBase64 = media?.base64 || null
            mediaMime = media?.mimetype || mediaMime
          }
        }
      } catch {
        mediaBase64 = null
      }
      if (!mediaBase64) {
        return res.status(400).json({
          error: "MEDIA_UNAVAILABLE",
          message: "Não foi possível carregar a mídia para encaminhar.",
        })
      }
    }

    const results = []
    for (const targetId of parsed.data.targetConversationIds) {
      const target = await findScopedConversation(req, targetId)
      if (!target) {
        results.push({ conversationId: targetId, ok: false, error: "NOT_FOUND" })
        continue
      }
      if (!canMutateAsActor(req, target.userId)) {
        results.push({ conversationId: targetId, ok: false, error: "FORBIDDEN" })
        continue
      }
      try {
        const to = assertOutboundRecipient(target)
        let sendResp
        if (mediaKind === "audio") {
          sendResp = await sendWhatsAppAudio(conn.instanceName, to, {
            audio: mediaBase64,
            mimetype: mediaMime || "audio/ogg; codecs=opus",
            encoding: true,
          })
        } else if (mediaKind) {
          sendResp = await sendMedia(conn.instanceName, to, {
            mediatype: mediaKind,
            media: mediaBase64,
            mimetype: mediaMime || undefined,
            caption: msg.body || undefined,
          })
        } else {
          sendResp = await sendText(conn.instanceName, to, msg.body || "")
        }
        const providerMessageId = sendResp?.key?.id || extractProviderMessageId(sendResp) || `fwd-${Date.now()}`
        const now = new Date()
        const created = await prisma.crmMessage.create({
          data: {
            userId: target.userId,
            conversationId: target.id,
            messageId: providerMessageId,
            fromMe: true,
            type: mediaKind || "text",
            body: msg.body || "",
            mediaMime: mediaMime,
            status: "sent",
            source: "manual",
            timestamp: now,
            raw: mergeVestoRaw(null, { forwardedFrom: msg.messageId }),
          },
        })
        await prisma.crmConversation.update({
          where: { id: target.id },
          data: {
            lastMessageAt: now,
            lastMessagePreview: previewFromBody(msg.body, mediaKind || "text"),
            lastMessageFromMe: true,
            noReplySinceAt: now,
          },
        })
        emitCrmEvent(io, target.userId, "crm:message", {
          conversationId: target.id,
          message: formatMessageRow(created),
        })
        results.push({ conversationId: targetId, ok: true, messageId: created.id })
      } catch (err) {
        console.error("[crm] forward:", err?.message || err)
        results.push({ conversationId: targetId, ok: false, error: "SEND_FAILED" })
      }
    }

    const okCount = results.filter((r) => r.ok).length
    return res.json({ forwarded: okCount, results })
  })

  /** Re-dispara fluxos automáticos (mesmo caminho do webhook) — não consome teto global. */
  router.post("/conversations/:id/redispatch-flows", async (req, res) => {
    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const lastInbound = await prisma.crmMessage.findFirst({
      where: {
        conversationId: convo.id,
        fromMe: false,
        source: { notIn: ["flow", "ai"] },
      },
      orderBy: { timestamp: "desc" },
    })
    if (!lastInbound) {
      return res.status(400).json({ error: "NO_INBOUND", message: "Conversa sem mensagem inbound do contato." })
    }

    const priorInbound = await prisma.crmMessage.count({
      where: {
        conversationId: convo.id,
        fromMe: false,
        id: { not: lastInbound.id },
        source: { notIn: ["flow", "ai"] },
        timestamp: { lt: lastInbound.timestamp },
      },
    })

    const flowDeps = { prisma, io, sendText, sendMedia, sendWhatsAppAudio, sendPresence, fetchChatMessages, findMessageById }
    try {
      await dispatchCrmMessageFlows(
        flowDeps,
        {
          message: lastInbound,
          conversation: convo,
          isNewConversation: priorInbound === 0,
          dispatchNewConversation: priorInbound === 0,
          shouldDispatchFlows: true,
        },
        { includeAi: false },
      )
      const flush = await flushCrmDeliveries(flowDeps, { conversationId: convo.id, maxMs: 90000 })
      const runs = await prisma.crmFlowRun.findMany({
        where: { conversationId: convo.id, createdAt: { gte: new Date(Date.now() - 120000) } },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
      return res.json({
        ok: true,
        flushed: flush.flushed,
        runs: runs.map((r) => ({ status: r.status, detail: r.detail, createdAt: r.createdAt.toISOString() })),
      })
    } catch (err) {
      console.error("[crm] redispatch-flows:", err?.message || err)
      return res.status(500).json({ error: "REDISPATCH_FAILED", message: "Falha ao re-disparar fluxos." })
    }
  })

  router.patch("/conversations/:id", async (req, res) => {
    const schema = z.object({
      status: z.enum(["open", "pending", "resolved", "archived"]).optional(),
      kanbanStageId: z.string().nullable().optional(),
      kanbanOrder: z.number().int().min(0).optional(),
      aiEnabled: z.boolean().optional(),
      aiAgentId: z.string().nullable().optional(),
      assignedTo: z.enum(["human", "ai"]).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

    const convo = await findScopedConversation(req, req.params.id)
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    if (!canMutateAsActor(req, convo.userId)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente o vendedor responsável pode alterar esta conversa.",
      })
    }

    const userId = convo.userId
    const data = { ...parsed.data }
    if (Object.prototype.hasOwnProperty.call(parsed.data, "kanbanStageId")) {
      const resolved = await resolveStageForConversationUser(prisma, {
        stageId: parsed.data.kanbanStageId,
        targetUserId: userId,
        dataScope: req.dataScope,
      })
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error, message: resolved.message })
      }
      data.kanbanStageId = resolved.stageId
    }
    if (data.aiAgentId) {
      const agent = await prisma.crmAiAgent.findFirst({ where: { id: data.aiAgentId } })
      const visible =
        agent &&
        agentInOrganization(agent, req.dataScope) &&
        agentCoversMember(agent, userId)
      if (!visible) return res.status(400).json({ error: "AGENT_NOT_FOUND", message: "Agente inválido para este número." })
    }
    if (data.aiEnabled === true) data.assignedTo = "ai"
    if (data.aiEnabled === false && !data.assignedTo) data.assignedTo = "human"

    const updated = await prisma.crmConversation.update({
      where: { id: convo.id },
      data,
      include: CONVERSATION_INCLUDE,
    })

    // Emite com estágio remapeado para o board do ator (dono) quando o lead é da equipe.
    let emitted = formatConversationRow(updated)
    if (req.dataScope?.isOwner && updated.userId !== req.user.sub && updated.kanbanStageId) {
      const remap = await buildViewerStageRemap(prisma, {
        viewerUserId: req.user.sub,
        stageIds: [updated.kanbanStageId],
      })
      emitted = applyViewerStageRemap(emitted, remap)
    }
    emitCrmEvent(io, userId, "crm:conversation", { conversation: emitted })
    if (req.user.sub !== userId) {
      emitCrmEvent(io, req.user.sub, "crm:conversation", { conversation: emitted })
    }

    const stagePatched = Object.prototype.hasOwnProperty.call(parsed.data, "kanbanStageId")
    const nextStageId = stagePatched ? data.kanbanStageId || null : undefined
    const stageChanged =
      stagePatched && (nextStageId || null) !== (convo.kanbanStageId || null)
    if (stageChanged) {
      const stage = nextStageId
        ? await prisma.crmKanbanStage.findUnique({ where: { id: nextStageId } })
        : null
      logContactActivity(prisma, {
        userId,
        contactId: convo.contactId,
        type: "stage_changed",
        payload: {
          stageId: nextStageId,
          stageName: stage?.name || (nextStageId ? null : "Sem estágio"),
          source: "crm_ui",
        },
      }).catch((err) => console.error("[crm-activity] stage_changed:", err?.message || err))

      onStageChange({ prisma, io, sendText }, { conversation: updated, stageId: nextStageId }).catch((err) =>
        console.error("[crm-flow] stage_change:", err?.message || err),
      )

      mirrorStageChangeToWhatsapp(prisma, {
        userId,
        conversation: updated,
        previousStageId: convo.kanbanStageId || null,
        nextStageId: nextStageId || null,
      }).catch((err) => console.warn("[wa-labels] mirror:", err?.message || err))
    }

    return res.json({ conversation: emitted })
  })

  // ------------------------- Contatos -------------------------

  router.post("/contacts/bulk-delete", async (req, res) => {
    const schema = z.object({
      contactIds: z.array(z.string().min(1)).min(1).max(500),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe entre 1 e 500 leads por requisição." })
    }

    const scoped = []
    const forbidden = []
    const notFound = []

    for (const contactId of parsed.data.contactIds) {
      const contact = await findScopedContact(req, contactId)
      if (!contact) {
        notFound.push(contactId)
        continue
      }
      if (!canMutateAsActor(req, contact.userId)) {
        forbidden.push(contactId)
        continue
      }
      scoped.push(contactId)
    }

    if (!scoped.length) {
      const status = forbidden.length ? 403 : 404
      return res.status(status).json({
        error: forbidden.length ? "FORBIDDEN" : "NOT_FOUND",
        message: forbidden.length
          ? "Sem permissão para excluir um ou mais leads selecionados."
          : "Nenhum lead encontrado para excluir.",
        notFound,
        forbidden,
      })
    }

    const result = await deleteScopedContacts(prisma, scoped)
    for (const row of result.deleted) {
      emitContactDeleted(io, emitCrmEvent, row)
    }

    return res.json({
      ok: true,
      deleted: result.deleted.length,
      deletedIds: result.deleted.map((r) => r.contactId),
      notFound: [...notFound, ...result.notFound],
      forbidden,
    })
  })

  router.delete("/contacts/:id", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para excluir este lead." })
    }

    const result = await deleteScopedContact(prisma, contact.id)
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }

    emitContactDeleted(io, emitCrmEvent, result)
    return res.json({ ok: true, contactId: result.contactId, conversationId: result.conversationId })
  })

  /** Cria contato/conversa manualmente (ou reabre se o telefone já existir). */
  router.post("/contacts", async (req, res) => {
    const schema = z.object({
      phone: z.string().min(8).max(32),
      name: z.string().max(120).optional().nullable(),
      notes: z.string().max(4000).optional().nullable(),
      sellerUserId: z.string().min(1).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um telefone válido." })
    }

    const phone = normalizeManualCrmPhone(parsed.data.phone) || phoneDigitsFromValue(parsed.data.phone)
    if (!phone) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Telefone inválido. Use DDD + número (ex.: 11987654321).",
      })
    }

    let targetUserId = req.user.sub
    const sellerUserId = parsed.data.sellerUserId ? String(parsed.data.sellerUserId).trim() : ""
    if (sellerUserId) {
      if (!req.dataScope?.isOwner) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Apenas o dono da empresa pode atribuir o contato a um vendedor.",
        })
      }
      if (!assertUserInScope(req.dataScope, sellerUserId)) {
        return res.status(403).json({ error: "FORBIDDEN", message: "Vendedor fora da empresa." })
      }
      targetUserId = sellerUserId
    }

    const remoteJid = `${phone}@s.whatsapp.net`
    const existing = await findContactByPhone(prisma, { userId: targetUserId, phone })
    const created = !existing

    const name = parsed.data.name != null ? String(parsed.data.name).trim() || null : null
    const notes = parsed.data.notes != null ? String(parsed.data.notes).trim() : null

    // Valida se o número existe no WhatsApp antes de criar (contato novo).
    // Contato já existente: só reabre o chat, sem bloquear.
    if (created) {
      const conn = await ensureWhatsAppConnected(prisma, targetUserId)
      if (!conn?.connected || !conn.instanceName) {
        return res.status(400).json({
          error: "WHATSAPP_DISCONNECTED",
          message: "Conecte o WhatsApp para verificar se o número está correto.",
        })
      }
      bindInstanceHost(conn.instanceName, conn.evolutionHost || "primary")
      const check = await numberExistsOnWhatsapp(conn.instanceName, phone)
      if (!check.ok) {
        return res.status(502).json({
          error: "WHATSAPP_CHECK_FAILED",
          message: "Não foi possível verificar o número no WhatsApp. Tente de novo em instantes.",
        })
      }
      if (!check.exists) {
        return res.status(400).json({
          error: "INVALID_WHATSAPP_NUMBER",
          message: "Contato errado: este número não tem WhatsApp (ou está incorreto).",
        })
      }
    }

    try {
      let { contact, conversation } = await ensureContactAndConversation(prisma, targetUserId, remoteJid, {
        phone,
        pushName: created && name ? name : undefined,
      })

      if (created && (name || notes != null)) {
        contact = await prisma.crmContact.update({
          where: { id: contact.id },
          data: {
            ...(name ? { name } : {}),
            ...(notes != null ? { notes } : {}),
          },
          include: {
            tags: { include: { tag: true } },
            reminders: { where: { status: "pending" }, orderBy: { scheduledAt: "asc" } },
          },
        })
        conversation = await prisma.crmConversation.findFirst({
          where: { contactId: contact.id, userId: targetUserId },
          include: CONVERSATION_INCLUDE,
        })
      } else if (conversation?.contact) {
        contact = conversation.contact
      } else {
        contact = await prisma.crmContact.findUnique({
          where: { id: contact.id },
          include: {
            tags: { include: { tag: true } },
            reminders: { where: { status: "pending" }, orderBy: { scheduledAt: "asc" } },
          },
        })
        conversation = await prisma.crmConversation.findFirst({
          where: { contactId: contact.id, userId: targetUserId },
          include: CONVERSATION_INCLUDE,
        })
      }

      if (conversation) {
        emitCrmEvent(io, targetUserId, "crm:conversation", {
          conversation: formatConversationRow(conversation),
        })
      }

      return res.status(created ? 201 : 200).json({
        created,
        message: created
          ? "Contato criado. Você já pode enviar mensagem."
          : "Este contato já existe no CRM.",
        contact: formatContactRow(contact),
        conversation: conversation ? formatConversationRow(conversation) : null,
      })
    } catch (err) {
      console.error("[crm] create contact:", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao criar contato.",
      })
    }
  })

  router.patch("/contacts/:id", async (req, res) => {
    const schema = z.object({
      name: z.string().max(120).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Somente o vendedor responsável pode editar este contato." })
    }

    const userId = contact.userId

    const data = { ...parsed.data }
    if (data.name !== undefined) data.name = data.name ? String(data.name).trim() : null

    const nameChanged = data.name !== undefined && data.name !== contact.name
    const notesChanged = data.notes !== undefined && data.notes !== (contact.notes || "")

    const updated = await prisma.crmContact.update({
      where: { id: contact.id },
      data,
      include: { tags: { include: { tag: true } } },
    })

    if (nameChanged) {
      logContactActivity(prisma, {
        userId,
        contactId: contact.id,
        type: "contact_named",
        payload: { name: updated.name },
      }).catch((err) => console.error("[crm-activity] contact_named:", err?.message || err))
      const phone = updated.phone || contact.phone
      if (updated.name) {
        propagateSavedNameToPhoneSiblings(prisma, {
          userId,
          contactId: contact.id,
          phone,
          savedName: updated.name,
        }).catch((err) => console.error("[crm] propagateSavedName:", err?.message || err))
      }
    }
    if (notesChanged) {
      logContactActivity(prisma, {
        userId,
        contactId: contact.id,
        type: "notes_updated",
        payload: {},
      }).catch((err) => console.error("[crm-activity] notes_updated:", err?.message || err))
    }

    const conversation = await prisma.crmConversation.findFirst({
      where: { contactId: contact.id, userId },
      include: CONVERSATION_INCLUDE,
    })
    if (conversation) {
      emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
    }

    return res.json({ contact: formatContactRow(updated) })
  })

  router.post("/contacts/:id/refresh-avatar", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Somente o vendedor responsável pode atualizar este contato." })
    }

    const userId = contact.userId

    const conn = await ensureWhatsAppConnected(prisma, userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    let avatarUrl = null
    let pushName = null
    let phone = null

    try {
      avatarUrl = pickAvatarFromPicturePayload(await fetchProfilePictureUrl(conn.instanceName, contact.remoteJid))
    } catch {
      /* tenta fetchProfile */
    }

    if (!avatarUrl || !pushName) {
      try {
        const target = String(contact.remoteJid).includes("@") ? contact.remoteJid : contact.remoteJid.split("@")[0]
        const fields = pickProfileFields(await fetchProfile(conn.instanceName, target))
        avatarUrl = avatarUrl || fields.avatarUrl
        pushName = fields.pushName
        phone = fields.phone
      } catch {
        /* ignore */
      }
    }

    if (contact.phone && !avatarUrl) {
      try {
        avatarUrl = pickAvatarFromPicturePayload(await fetchProfilePictureUrl(conn.instanceName, contact.phone))
      } catch {
        /* ignore */
      }
    }

    const data = {}
    if (avatarUrl && avatarUrl !== contact.avatarUrl) data.avatarUrl = avatarUrl
    if (pushName && pushName !== contact.pushName) data.pushName = pushName
    if (phone && !contact.phone) data.phone = phone

    let updated = contact
    if (Object.keys(data).length) {
      updated = await prisma.crmContact.update({
        where: { id: contact.id },
        data,
        include: { tags: { include: { tag: true } } },
      })
    }

    const conversation = await prisma.crmConversation.findFirst({
      where: { contactId: contact.id, userId },
      include: CONVERSATION_INCLUDE,
    })
    if (conversation && Object.keys(data).length) {
      emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
    }

    return res.json({
      avatarUrl: updated.avatarUrl || null,
      contact: formatContactRow(updated),
    })
  })

  router.post("/contacts/:id/save", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(120),
      saveOnWhatsapp: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um nome válido." })

    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Somente o vendedor responsável pode salvar este contato." })
    }

    const userId = contact.userId

    const savedName = parsed.data.name.trim()
    const lidJid = /@lid$/i.test(contact.remoteJid || "")
    const phone = contact.phone || (!lidJid ? contact.remoteJid.split("@")[0].replace(/\D/g, "") : "")
    const hasPhone = Boolean(phone && phone.length >= 8)

    let whatsappSaved = false
    let whatsappWarning = null
    if (parsed.data.saveOnWhatsapp) {
      if (!hasPhone) {
        return res.status(400).json({
          error: "NO_PHONE",
          message: "Este contato não tem número de telefone — não é possível salvar na agenda do WhatsApp.",
        })
      }
      const conn = await prisma.whatsAppConnection.findUnique({ where: { userId } })
      if (!conn || !conn.connected) {
        whatsappWarning = "WhatsApp desconectado — nome salvo apenas no Vesto."
      } else {
        try {
          await saveContact(conn.instanceName, { number: phone, name: savedName, saveOnDevice: true })
          whatsappSaved = true
        } catch (err) {
          console.warn("[crm] saveContact WhatsApp:", err?.message || err)
          whatsappWarning = "Não foi possível salvar na agenda do WhatsApp — nome salvo apenas no Vesto."
        }
      }
    }

    const updated = await prisma.crmContact.update({
      where: { id: contact.id },
      data: { name: savedName },
      include: { tags: { include: { tag: true } } },
    })

    logContactActivity(prisma, {
      userId,
      contactId: contact.id,
      type: "contact_named",
      payload: { name: savedName },
    }).catch((err) => console.error("[crm-activity] contact_named:", err?.message || err))

    propagateSavedNameToPhoneSiblings(prisma, {
      userId,
      contactId: contact.id,
      phone: contact.phone || (hasPhone ? phone : null),
      savedName,
    }).catch((err) => console.error("[crm] propagateSavedName:", err?.message || err))

    const conversation = await prisma.crmConversation.findFirst({
      where: { contactId: contact.id, userId },
      include: CONVERSATION_INCLUDE,
    })
    if (conversation) {
      emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
    }

    let message = whatsappSaved
      ? "Contato salvo no Vesto e na agenda do WhatsApp."
      : "Contato salvo no Vesto."
    if (whatsappWarning) message = whatsappWarning

    return res.json({
      contact: formatContactRow(updated),
      whatsappSaved,
      message,
    })
  })

  /** Dono atribui o lead a outro vendedor da empresa (corrige inbox errada). */
  router.post("/contacts/:id/reassign", async (req, res) => {
    if (!req.dataScope?.isOwner) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Apenas o dono da empresa pode atribuir leads a vendedores.",
      })
    }

    const schema = z.object({
      sellerUserId: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe o vendedor." })
    }

    const toUserId = String(parsed.data.sellerUserId).trim()
    if (!assertUserInScope(req.dataScope, toUserId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Vendedor fora da empresa." })
    }

    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })

    const previousConversation = await prisma.crmConversation.findFirst({
      where: { contactId: contact.id },
      select: { id: true },
    })

    try {
      const result = await reassignContactToSeller(prisma, {
        contactId: contact.id,
        toUserId,
      })
      if (result.error === "NOT_FOUND") {
        return res.status(404).json({ error: result.error, message: result.message })
      }
      if (result.error === "SAME_SELLER") {
        return res.status(400).json({ error: result.error, message: result.message })
      }

      const [fromUser, toUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: result.fromUserId }, select: { id: true, name: true } }),
        prisma.user.findUnique({ where: { id: result.toUserId }, select: { id: true, name: true } }),
      ])

      const finalContactId = result.contactId
      await logContactActivity(prisma, {
        userId: result.toUserId,
        contactId: finalContactId,
        type: "lead_reassigned",
        payload: {
          fromUserId: result.fromUserId,
          toUserId: result.toUserId,
          fromName: fromUser?.name || null,
          toName: toUser?.name || null,
          merged: Boolean(result.merged),
          actorUserId: req.user.sub,
        },
      }).catch((err) => console.error("[crm-activity] lead_reassigned:", err?.message || err))

      const conversation = result.conversationId
        ? await prisma.crmConversation.findUnique({
            where: { id: result.conversationId },
            include: CONVERSATION_INCLUDE,
          })
        : await prisma.crmConversation.findFirst({
            where: { contactId: finalContactId, userId: result.toUserId },
            include: CONVERSATION_INCLUDE,
          })

      if (conversation) {
        emitCrmEvent(io, result.toUserId, "crm:conversation", {
          conversation: formatConversationRow(conversation),
        })
      }
      // Só na inbox do vendedor de origem (não na sala org — o dono precisa manter o card).
      if (io) {
        io.to(`user:${result.fromUserId}`).emit("crm:conversation_removed", {
          conversationId: previousConversation?.id || null,
          contactId: contact.id,
          reason: "reassigned",
          toUserId: result.toUserId,
        })
      }

      return res.json({
        ok: true,
        merged: Boolean(result.merged),
        message: result.merged
          ? `Lead mesclado na inbox de ${toUser?.name || "vendedor"}.`
          : `Lead atribuído a ${toUser?.name || "vendedor"}.`,
        conversation: conversation ? formatConversationRow(conversation) : null,
        contact: conversation?.contact
          ? formatContactRow(conversation.contact)
          : formatContactRow(
              await prisma.crmContact.findUnique({
                where: { id: finalContactId },
                include: { tags: { include: { tag: true } }, reminders: true },
              }),
            ),
      })
    } catch (err) {
      console.error("[crm] reassign:", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao atribuir o lead.",
      })
    }
  })

  router.post("/contacts/:id/tags", async (req, res) => {
    const tagId = String(req.body?.tagId || "")
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Somente o vendedor responsável pode alterar tags deste contato." })
    }
    const userId = contact.userId
    const tag = await resolveTagForContactUser(prisma, {
      tagId,
      contactUserId: userId,
      orgUserIds: req.dataScope?.userIds,
    })
    if (!tag) return res.status(404).json({ error: "NOT_FOUND", message: "Tag não encontrada." })

    const existingLink = await prisma.crmContactTag.findUnique({
      where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
    })
    const tagWasCreated = !existingLink
    if (tagWasCreated) {
      try {
        await prisma.crmContactTag.create({
          data: { contactId: contact.id, tagId: tag.id },
        })
      } catch (err) {
        if (err?.code !== "P2002") throw err
      }
      logContactActivity(prisma, {
        userId,
        contactId: contact.id,
        type: "tag_added",
        payload: { tagId: tag.id, tagName: tag.name },
      }).catch((err) => console.error("[crm-activity] tag_added:", err?.message || err))
    }

    const updated = await prisma.crmContact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } },
    })

    // Meta / fluxos / WA labels em background — resposta imediata pro toque da tag no mobile
    if (tagWasCreated) {
      if (isQualifiedTagName(tag.name) || isQuoteTagName(tag.name) || tag.name === "Comprou") {
        trackMetaForContactTag(prisma, { userId, contact: updated, tagName: tag.name })
          .then((metaTracking) => {
            if (metaTracking) {
              emitCrmEvent(io, userId, "crm:tag_meta", {
                contactId: contact.id,
                metaTracking,
              })
            }
          })
          .catch((err) => {
            console.error("[crm-tag] meta:", err?.message || err)
            emitCrmEvent(io, userId, "crm:tag_meta", {
              contactId: contact.id,
              metaTracking: {
                sent: false,
                error: err?.message || "Falha ao enviar evento à Meta.",
                eventName: isQualifiedTagName(tag.name) ? "LeadQualified" : tag.name,
              },
            })
          })
      }
      notifyTagAddedForContact({ prisma, io, sendText }, { userId, contactId: contact.id, tagId: tag.id }).catch(
        (err) => console.error("[crm-flow] tag_added:", err?.message || err),
      )
      if (isQualifiedTagName(tag.name)) {
        mirrorQualifiedTagToWhatsapp(prisma, { userId, contact: updated, action: "add" }).catch((err) =>
          console.warn("[wa-labels] QUALIFICADO→WA:", err?.message || err),
        )
      }
    }

    return res.json({
      contact: formatContactRow(updated),
      metaTracking: null,
    })
  })

  router.delete("/contacts/:id/tags/:tagId", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Somente o vendedor responsável pode alterar tags deste contato." })
    }
    const userId = contact.userId
    const tag = await resolveTagForContactUser(prisma, {
      tagId: req.params.tagId,
      contactUserId: userId,
      orgUserIds: req.dataScope?.userIds,
    })
    const idsToRemove = [...new Set([req.params.tagId, tag?.id].filter(Boolean))]
    for (const id of idsToRemove) {
      await prisma.crmContactTag
        .delete({ where: { contactId_tagId: { contactId: contact.id, tagId: id } } })
        .catch(() => {})
    }
    if (tag) {
      logContactActivity(prisma, {
        userId,
        contactId: contact.id,
        type: "tag_removed",
        payload: { tagId: tag.id, tagName: tag.name },
      }).catch((err) => console.error("[crm-activity] tag_removed:", err?.message || err))
    }
    const updated = await prisma.crmContact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } },
    })
    return res.json({ contact: formatContactRow(updated) })
  })

  router.get("/contacts/:id/activity", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    const activities = await getContactActivityTimeline(prisma, contact.userId, contact.id)
    const refreshed = await prisma.crmContact.findFirst({
      where: { id: contact.id },
      include: {
        tags: { include: { tag: true } },
        reminders: { where: { status: "pending" }, orderBy: { scheduledAt: "asc" } },
      },
    })
    return res.json({
      activities,
      contact: refreshed ? formatContactRow(refreshed) : null,
    })
  })

  router.get("/sales", async (req, res) => {
    const schema = z.object({
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
      q: z.string().max(120).optional().nullable(),
      sellerUserId: z.string().optional().nullable(),
      tagId: z.string().optional().nullable(),
      customerType: z.preprocess(
        (value) => (value === "" || value == null ? undefined : value),
        z.enum(["new", "returning"]).optional(),
      ),
      page: z.coerce.number().int().min(1).optional().default(1),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Parâmetros inválidos." })
    }
    const sellerUserId = parsed.data.sellerUserId || null
    if (sellerUserId && !assertUserInScope(req.dataScope, sellerUserId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Vendedor fora do escopo da empresa." })
    }
    const result = await listCrmSales(prisma, req.dataScope.userIds, parsed.data)
    return res.json(result)
  })

  /** Registra venda manual: contactId existente ou phone (+ cria contato se preciso). */
  router.post("/sales", async (req, res) => {
    const schema = z
      .object({
        contactId: z.string().min(1).optional().nullable(),
        phone: z.string().min(8).max(32).optional().nullable(),
        name: z.string().max(120).optional().nullable(),
        amount: z.coerce.number().positive(),
        ticket: z.string().max(120).optional().nullable(),
        customerType: z.enum(["new", "returning"]),
        moveToClosed: z.boolean().optional().default(true),
        sellerUserId: z.string().min(1).optional().nullable(),
      })
      .refine((d) => Boolean(d.contactId) || Boolean(d.phone), {
        message: "Informe o contato ou o telefone.",
      })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      const missingType = parsed.error.issues?.some((i) => i.path?.includes("customerType"))
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: missingType
          ? "Selecione se é Cliente Novo ou Cliente Antigo."
          : parsed.error.issues?.[0]?.message || "Dados inválidos para registrar a venda.",
      })
    }

    let targetUserId = req.user.sub
    const sellerUserId = parsed.data.sellerUserId ? String(parsed.data.sellerUserId).trim() : ""
    if (sellerUserId) {
      if (!req.dataScope?.isOwner) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Apenas o dono da empresa pode atribuir a venda a um vendedor.",
        })
      }
      if (!assertUserInScope(req.dataScope, sellerUserId)) {
        return res.status(403).json({ error: "FORBIDDEN", message: "Vendedor fora da empresa." })
      }
      targetUserId = sellerUserId
    }

    let contact = null
    let contactCreated = false
    let conversation = null

    if (parsed.data.contactId) {
      contact = await findScopedContact(req, parsed.data.contactId)
      if (!contact) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
      }
      if (!canMutateAsActor(req, contact.userId)) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Sem permissão para registrar venda neste lead.",
        })
      }
      // Se owner escolheu outro vendedor e o contato não é dele, recusa (evita venda órfã).
      if (sellerUserId && contact.userId !== targetUserId) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Este contato não pertence ao vendedor selecionado. Use o telefone ou reatribua o lead antes.",
        })
      }
      targetUserId = contact.userId
    } else {
      const phone =
        normalizeManualCrmPhone(parsed.data.phone) || phoneDigitsFromValue(parsed.data.phone)
      if (!phone) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Telefone inválido. Use DDD + número (ex.: 11987654321).",
        })
      }
      const remoteJid = `${phone}@s.whatsapp.net`
      const existing = await findContactByPhone(prisma, { userId: targetUserId, phone })
      contactCreated = !existing
      const name = parsed.data.name != null ? String(parsed.data.name).trim() || null : null
      try {
        const ensured = await ensureContactAndConversation(prisma, targetUserId, remoteJid, {
          phone,
          pushName: contactCreated && name ? name : undefined,
        })
        contact = ensured.contact
        conversation = ensured.conversation
        if (contactCreated && name) {
          contact = await prisma.crmContact.update({
            where: { id: contact.id },
            data: { name },
          })
        }
      } catch (err) {
        console.error("[crm] create sale contact:", err)
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          message: err?.message || "Falha ao preparar o contato da venda.",
        })
      }
    }

    const actor = await resolveActorProfile(req)
    const result = await confirmContactPurchase(prisma, io, {
      userId: targetUserId,
      contactId: contact.id,
      amount: parsed.data.amount,
      ticket: parsed.data.ticket,
      customerType: parsed.data.customerType,
      moveToClosed: parsed.data.moveToClosed,
      actorUserId: actor.actorUserId,
      actorName: actor.actorName,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }
    if (result.error === "INVALID_AMOUNT") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Valor inválido." })
    }
    if (result.error === "INVALID_CUSTOMER_TYPE") {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Selecione se é Cliente Novo ou Cliente Antigo.",
      })
    }

    return res.status(201).json({
      ok: true,
      contactCreated,
      contact: result.contact,
      conversation: result.conversation || (conversation ? formatConversationRow(conversation) : null),
      tracking: result.tracking || null,
      message: contactCreated
        ? "Contato criado e venda registrada."
        : "Venda registrada.",
    })
  })

  router.delete("/contacts/:id/activity/:activityId", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para editar este histórico." })
    }
    const result = await deleteContactActivity(prisma, contact.userId, req.params.id, req.params.activityId)
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: result.message || "Etapa não encontrada.",
      })
    }
    return res.json({ ok: true, contact: result.contact || null })
  })

  router.patch("/contacts/:id/activity/:activityId", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para editar este histórico." })
    }
    const schema = z.object({
      amount: z.coerce.number().positive().optional(),
      ticket: z.string().max(120).optional().nullable(),
      customerType: z.enum(["new", "returning"]).optional(),
      at: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos para editar a etapa." })
    }
    if (
      parsed.data.amount == null &&
      parsed.data.ticket === undefined &&
      parsed.data.customerType === undefined &&
      !parsed.data.at
    ) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Informe valor, ticket, tipo de cliente ou data para editar.",
      })
    }
    const actor = await resolveActorProfile(req)
    const result = await updateContactActivity(prisma, io, {
      userId: contact.userId,
      contactId: req.params.id,
      activityId: req.params.activityId,
      amount: parsed.data.amount,
      ticket: parsed.data.ticket,
      customerType: parsed.data.customerType,
      at: parsed.data.at,
      actorUserId: actor.actorUserId,
      actorName: actor.actorName,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: result.message || "Etapa não encontrada." })
    }
    if (result.error === "INVALID_TYPE") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: result.message })
    }
    if (result.error === "INVALID_AMOUNT") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Valor inválido." })
    }
    if (result.error === "INVALID_CUSTOMER_TYPE") {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Selecione se é Cliente Novo ou Cliente Antigo.",
      })
    }
    if (result.error === "INVALID_DATE") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Data inválida." })
    }
    return res.json({ activity: result.activity, contact: result.contact })
  })

  router.post("/contacts/:id/quote", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para registrar orçamento neste lead." })
    }
    const schema = z.object({ amount: z.coerce.number().positive() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um valor de orçamento válido." })
    }
    const actor = await resolveActorProfile(req)
    const result = await saveContactQuote(prisma, io, {
      userId: contact.userId,
      contactId: req.params.id,
      amount: parsed.data.amount,
      actorUserId: actor.actorUserId,
      actorName: actor.actorName,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }
    if (result.error === "INVALID_AMOUNT") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Valor inválido." })
    }
    return res.json({ contact: result.contact, tracking: result.tracking || null })
  })

  router.post("/contacts/:id/purchase/confirm", async (req, res) => {
    const contact = await findScopedContact(req, req.params.id)
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    if (!canMutateAsActor(req, contact.userId)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para confirmar venda neste lead." })
    }
    const schema = z.object({
      amount: z.coerce.number().positive(),
      ticket: z.string().max(120).optional().nullable(),
      customerType: z.enum(["new", "returning"]),
      moveToClosed: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      const missingType = parsed.error.issues?.some((i) => i.path?.includes("customerType"))
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: missingType
          ? "Selecione se é Cliente Novo ou Cliente Antigo."
          : "Informe um valor de compra válido.",
      })
    }
    const actor = await resolveActorProfile(req)
    const result = await confirmContactPurchase(prisma, io, {
      userId: contact.userId,
      contactId: req.params.id,
      amount: parsed.data.amount,
      ticket: parsed.data.ticket,
      customerType: parsed.data.customerType,
      moveToClosed: parsed.data.moveToClosed,
      actorUserId: actor.actorUserId,
      actorName: actor.actorName,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }
    if (result.error === "INVALID_AMOUNT") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Valor inválido." })
    }
    if (result.error === "INVALID_CUSTOMER_TYPE") {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Selecione se é Cliente Novo ou Cliente Antigo.",
      })
    }
    return res.json({ contact: result.contact, conversation: result.conversation, tracking: result.tracking || null })
  })

  router.get("/contacts/:id/reminders", async (req, res) => {
    const userId = req.user.sub
    const result = await listContactReminders(prisma, userId, req.params.id)
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }
    return res.json({ reminders: result.reminders })
  })

  router.post("/contacts/:id/reminders", async (req, res) => {
    const userId = req.user.sub
    const schema = z.object({
      scheduledAt: z.string().min(1),
      note: z.string().max(500).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe data e hora válidas." })
    }
    const result = await createContactReminder(prisma, io, {
      userId,
      contactId: req.params.id,
      scheduledAt: parsed.data.scheduledAt,
      note: parsed.data.note,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    }
    if (result.error === "INVALID_DATE") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Data ou hora inválida." })
    }
    if (result.error === "PAST_DATE") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: result.message || "O lembrete precisa ser no futuro." })
    }
    return res.status(201).json({ reminder: result.reminder, contact: result.contact })
  })

  router.delete("/contacts/:id/reminders/:reminderId", async (req, res) => {
    const userId = req.user.sub
    const result = await cancelContactReminder(prisma, io, {
      userId,
      contactId: req.params.id,
      reminderId: req.params.reminderId,
    })
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Lembrete não encontrado." })
    }
    return res.json({ contact: result.contact })
  })

  router.get("/reminders/alerts", async (req, res) => {
    const alerts = await listReminderAlerts(prisma, req.user.sub)
    return res.json({ alerts })
  })

  router.post("/reminders/:id/dismiss", async (req, res) => {
    const result = await dismissReminderAlert(prisma, req.user.sub, req.params.id)
    if (result.error === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Lembrete não encontrado." })
    }
    return res.json({ ok: true })
  })

  // ------------------------- Tags -------------------------

  router.get("/tags", async (req, res) => {
    const tags = await prisma.crmTag.findMany({
      where: { ...readUserFilter(req.dataScope) },
      orderBy: { name: "asc" },
    })
    const actorId = req.user.sub
    tags.sort((a, b) => {
      const own = Number(b.userId === actorId) - Number(a.userId === actorId)
      if (own) return own
      return String(a.name || "").localeCompare(String(b.name || ""), "pt")
    })
    // Deduplica por nome quando o dono vê tags de vários vendedores.
    const seen = new Set()
    const unique = []
    for (const tag of tags) {
      const key = tagNameKey(tag.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      unique.push(tag)
    }
    return res.json({ tags: unique.map(formatTagRow) })
  })

  router.post("/tags", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(40),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nome de tag inválido." })
    try {
      const tag = await prisma.crmTag.create({
        data: { userId: req.user.sub, name: parsed.data.name.trim(), color: parsed.data.color || "#22c55e" },
      })
      return res.status(201).json({ tag: formatTagRow(tag) })
    } catch {
      return res.status(409).json({ error: "TAG_EXISTS", message: "Já existe uma tag com esse nome." })
    }
  })

  router.patch("/tags/:id", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(40).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const tag = await prisma.crmTag.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!tag) return res.status(404).json({ error: "NOT_FOUND", message: "Tag não encontrada." })
    const updated = await prisma.crmTag.update({ where: { id: tag.id }, data: parsed.data })
    return res.json({ tag: formatTagRow(updated) })
  })

  router.delete("/tags/:id", async (req, res) => {
    const tag = await prisma.crmTag.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!tag) return res.status(404).json({ error: "NOT_FOUND", message: "Tag não encontrada." })
    await prisma.crmTag.delete({ where: { id: tag.id } })
    return res.json({ ok: true })
  })

  // ------------------------- Estágios (Kanban) -------------------------

  router.get("/stages", async (req, res) => {
    const userId = req.user.sub
    await ensureDefaultStages(userId)
    const stages = await prisma.crmKanbanStage.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } })
    return res.json({ stages: stages.map(formatStageRow) })
  })

  router.post("/stages", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(40),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nome inválido." })
    const userId = req.user.sub
    const max = await prisma.crmKanbanStage.aggregate({ where: { userId }, _max: { sortOrder: true } })
    const stage = await prisma.crmKanbanStage.create({
      data: {
        userId,
        name: parsed.data.name.trim(),
        color: parsed.data.color || "#64748b",
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    })
    syncWhatsappLabelsForUser(prisma, userId, { forceResync: false }).catch(() => {})
    return res.status(201).json({ stage: formatStageRow(stage) })
  })

  router.patch("/stages/:id", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(40).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      isDefault: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const userId = req.user.sub
    const stage = await prisma.crmKanbanStage.findFirst({ where: { id: req.params.id, userId } })
    if (!stage) return res.status(404).json({ error: "NOT_FOUND", message: "Estágio não encontrado." })
    if (parsed.data.isDefault === true) {
      await prisma.crmKanbanStage.updateMany({ where: { userId }, data: { isDefault: false } })
    }
    const updated = await prisma.crmKanbanStage.update({ where: { id: stage.id }, data: parsed.data })
    if (parsed.data.name != null) {
      syncWhatsappLabelsForUser(prisma, userId, { forceResync: false }).catch(() => {})
    }
    return res.json({ stage: formatStageRow(updated) })
  })

  router.post("/stages/reorder", async (req, res) => {
    const schema = z.object({ order: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Ordem inválida." })
    const userId = req.user.sub
    const stages = await prisma.crmKanbanStage.findMany({ where: { userId } })
    const owned = new Set(stages.map((s) => s.id))
    const updates = parsed.data.order
      .filter((id) => owned.has(id))
      .map((id, i) => prisma.crmKanbanStage.update({ where: { id }, data: { sortOrder: i } }))
    await prisma.$transaction(updates)
    const fresh = await prisma.crmKanbanStage.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } })
    return res.json({ stages: fresh.map(formatStageRow) })
  })

  router.delete("/stages/:id", async (req, res) => {
    const userId = req.user.sub
    const stage = await prisma.crmKanbanStage.findFirst({ where: { id: req.params.id, userId } })
    if (!stage) return res.status(404).json({ error: "NOT_FOUND", message: "Estágio não encontrado." })
    const total = await prisma.crmKanbanStage.count({ where: { userId } })
    if (total <= 1) {
      return res.status(400).json({ error: "LAST_STAGE", message: "Mantenha pelo menos um estágio no Kanban." })
    }
    await prisma.crmKanbanStage.delete({ where: { id: stage.id } })
    return res.json({ ok: true })
  })

  // ------------------------- Etiquetas WhatsApp Business -------------------------

  router.get("/whatsapp-labels", async (req, res) => {
    try {
      const status = await getWhatsappLabelsStatus(prisma, req.user.sub)
      return res.json(status)
    } catch (err) {
      console.error("[wa-labels] status:", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao carregar etiquetas do WhatsApp.",
      })
    }
  })

  router.post("/whatsapp-labels/sync", async (req, res) => {
    try {
      const result = await syncWhatsappLabelsForUser(prisma, req.user.sub, { forceResync: true })
      if (!result.ok) {
        const code = result.error === "NO_CONNECTION" || result.error === "DISCONNECTED" ? 400 : 502
        return res.status(code).json({ error: result.error, message: result.message })
      }
      return res.json(result)
    } catch (err) {
      console.error("[wa-labels] sync:", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao sincronizar etiquetas.",
      })
    }
  })

  // ------------------------- Atalhos (quick replies) -------------------------

  router.get("/quick-replies", async (req, res) => {
    const rows = await prisma.crmQuickReply.findMany({
      where: { userId: req.user.sub },
      orderBy: { shortcut: "asc" },
    })
    return res.json({ quickReplies: rows.map(formatQuickReplyRow) })
  })

  const quickReplySchema = z.object({
    shortcut: z
      .string()
      .min(1)
      .max(30)
      .regex(/^[a-z0-9_-]+$/i, "Use apenas letras, números, hífen e underline."),
    title: z.string().max(80).optional().default(""),
    body: z.string().max(4096).optional().default(""),
    mediaType: z.enum(["none", "image", "video", "audio", "document"]).optional().default("none"),
    mediaBase64: z.string().optional().nullable(),
    mediaMime: z.string().max(120).optional().nullable(),
    mediaName: z.string().max(255).optional().nullable(),
  })

  function validateQuickReplyPayload(data) {
    return validateMediaContentSize({
      body: data.body || "",
      mediaType: data.mediaType || "none",
      mediaBase64: data.mediaBase64,
      mediaMime: data.mediaMime,
      mediaName: data.mediaName,
    })
  }

  router.post("/quick-replies", async (req, res) => {
    const parsed = quickReplySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Atalho inválido. Use letras/números sem espaços." })
    }
    const qrError = validateQuickReplyPayload(parsed.data)
    if (qrError) return res.status(400).json({ error: "VALIDATION_ERROR", message: qrError })
    try {
      const qr = await prisma.crmQuickReply.create({
        data: { userId: req.user.sub, ...parsed.data, shortcut: parsed.data.shortcut.toLowerCase() },
      })
      return res.status(201).json({ quickReply: formatQuickReplyRow(qr) })
    } catch {
      return res.status(409).json({ error: "SHORTCUT_EXISTS", message: "Já existe um atalho com esse nome." })
    }
  })

  router.put("/quick-replies/:id", async (req, res) => {
    const parsed = quickReplySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Atalho inválido." })
    const qrError = validateQuickReplyPayload(parsed.data)
    if (qrError) return res.status(400).json({ error: "VALIDATION_ERROR", message: qrError })
    const qr = await prisma.crmQuickReply.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!qr) return res.status(404).json({ error: "NOT_FOUND", message: "Atalho não encontrado." })
    const updated = await prisma.crmQuickReply.update({
      where: { id: qr.id },
      data: { ...parsed.data, shortcut: parsed.data.shortcut.toLowerCase() },
    })
    return res.json({ quickReply: formatQuickReplyRow(updated) })
  })

  router.delete("/quick-replies/:id", async (req, res) => {
    const qr = await prisma.crmQuickReply.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!qr) return res.status(404).json({ error: "NOT_FOUND", message: "Atalho não encontrado." })
    await prisma.crmQuickReply.delete({ where: { id: qr.id } })
    return res.json({ ok: true })
  })

  /** Conteúdo completo (com mídia) para aplicar o atalho no composer. */
  router.get("/quick-replies/:id/content", async (req, res) => {
    const qr = await prisma.crmQuickReply.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!qr) return res.status(404).json({ error: "NOT_FOUND", message: "Atalho não encontrado." })
    return res.json({
      quickReply: {
        ...formatQuickReplyRow(qr),
        mediaBase64: qr.mediaBase64 || null,
      },
    })
  })

  // ------------------------- Fluxos -------------------------

  const flowSchema = z.object({
    name: z.string().min(1).max(80),
    enabled: z.boolean().optional().default(false),
    trigger: z.object({
      type: z.enum(["new_conversation", "keyword", "no_reply", "stage_change", "tag_added", "contact_reply"]),
      keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
      matchMode: z.enum(["contains", "exact"]).optional(),
      hours: z.number().int().min(1).max(720).optional(),
      minutes: z.number().int().min(1).max(43200).optional(),
      delayUnit: z.enum(["hours", "minutes"]).optional(),
      delayValue: z.number().int().min(1).max(43200).optional(),
      onlyAfterFlowCreated: z.boolean().optional(),
      stageId: z.string().nullable().optional(),
      tagId: z.string().nullable().optional(),
      tagIds: z.array(z.string().min(1)).max(20).optional(),
    }),
    conditions: z
      .array(
        z.object({
          type: z.enum([
            "has_tag",
            "not_has_tag",
            "stage_is",
            "status_is",
            "keyword_in_last",
            "has_any_tag",
            "no_reply_minutes",
          ]),
          value: z.string(),
        }),
      )
      .max(10)
      .optional()
      .default([]),
    actions: z
      .array(
        z.object({
          type: z.enum(["send_message", "add_tag", "remove_tag", "move_stage", "assign_ai", "set_status", "stop_flows"]),
          body: z.string().max(4096).optional(),
          mediaType: z.enum(["none", "image", "video", "audio", "document"]).optional(),
          mediaBase64: z.string().optional().nullable(),
          mediaMime: z.string().max(120).optional().nullable(),
          mediaName: z.string().max(255).optional().nullable(),
          tagId: z.string().optional(),
          stageId: z.string().optional(),
          agentId: z.string().optional(),
          value: z.string().optional(),
          delayUnit: z.enum(["seconds", "minutes", "hours"]).optional(),
          delayValue: z.number().min(0).max(86400).optional(),
          recordingDelayValue: z.number().min(0).max(120).optional(),
        }),
      )
      .min(1)
      .max(10),
    cooldownPerContactHours: z.number().int().min(0).max(720).optional().default(24),
    quietHours: quietHoursSchema,
  })

  router.get("/flows", async (req, res) => {
    const flows = await prisma.crmFlow.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "desc" } })
    return res.json({ flows: flows.map(formatFlowRow) })
  })

  router.post("/flows", async (req, res) => {
    const parsed = flowSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Fluxo inválido." })
    if (parsed.data.trigger.type === "keyword" && !parsed.data.trigger.keywords?.length) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe pelo menos uma palavra-chave." })
    }
    if (parsed.data.trigger.type === "tag_added" && !parsed.data.trigger.tagId) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Selecione a tag do gatilho." })
    }
    if (parsed.data.trigger.type === "contact_reply" && !parsed.data.trigger.tagIds?.length) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Selecione ao menos uma tag para o gatilho de resposta.",
      })
    }
    const actionError = validateFlowActions(parsed.data.actions)
    if (actionError) return res.status(400).json({ error: "VALIDATION_ERROR", message: actionError })
    const flow = await prisma.crmFlow.create({
      data: {
        userId: req.user.sub,
        ...parsed.data,
        ...flowEnabledAtData(parsed.data.enabled === true, false),
      },
    })
    return res.status(201).json({ flow: formatFlowRow(flow) })
  })

  router.put("/flows/:id", async (req, res) => {
    const parsed = flowSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Fluxo inválido." })
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    if (parsed.data.trigger.type === "keyword" && !parsed.data.trigger.keywords?.length) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe pelo menos uma palavra-chave." })
    }
    if (parsed.data.trigger.type === "tag_added" && !parsed.data.trigger.tagId) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Selecione a tag do gatilho." })
    }
    if (parsed.data.trigger.type === "contact_reply" && !parsed.data.trigger.tagIds?.length) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Selecione ao menos uma tag para o gatilho de resposta.",
      })
    }
    const actionError = validateFlowActions(parsed.data.actions)
    if (actionError) return res.status(400).json({ error: "VALIDATION_ERROR", message: actionError })
    const updated = await prisma.crmFlow.update({
      where: { id: flow.id },
      data: {
        ...parsed.data,
        ...flowEnabledAtData(parsed.data.enabled === true, flow.enabled),
      },
    })
    return res.json({ flow: formatFlowRow(updated) })
  })

  router.patch("/flows/:id", async (req, res) => {
    const schema = z.object({ enabled: z.boolean() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    const updated = await prisma.crmFlow.update({
      where: { id: flow.id },
      data: {
        enabled: parsed.data.enabled,
        ...flowEnabledAtData(parsed.data.enabled, flow.enabled),
      },
    })
    return res.json({ flow: formatFlowRow(updated) })
  })

  router.delete("/flows/:id", async (req, res) => {
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    await prisma.crmFlow.delete({ where: { id: flow.id } })
    return res.json({ ok: true })
  })

  router.post("/packs/import", async (req, res) => {
    try {
      const result = await importCrmPack(prisma, req.user.sub, req.body)
      return res.status(201).json(result)
    } catch (err) {
      if (err?.code === "VALIDATION_ERROR") {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message || "Pack inválido." })
      }
      console.error("[crm] pack import:", err)
      return res.status(500).json({ error: "IMPORT_FAILED", message: "Falha ao importar o pack." })
    }
  })

  router.get("/flows/:id/runs", async (req, res) => {
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    const runs = await prisma.crmFlowRun.findMany({
      where: { flowId: flow.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    return res.json({
      runs: runs.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        status: r.status,
        detail: r.detail || "",
        createdAt: r.createdAt.toISOString(),
      })),
    })
  })

  const flowTestDeps = { prisma, io, sendText, sendMedia, sendWhatsAppAudio, sendPresence, fetchChatMessages, findMessageById }

  router.post("/flows/:id/test", async (req, res) => {
    const conversationId = String(req.body?.conversationId || "").trim()
    if (!conversationId) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Escolha uma conversa para testar." })
    }
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    try {
      const result = await testFlowOnConversation(flowTestDeps, {
        flow,
        conversationId,
        userId: req.user.sub,
      })
      const flush = await flushCrmDeliveries(flowTestDeps, { conversationId, maxMs: 90000 })
      if (!flush.flushed) {
        return res.status(502).json({
          error: "DELIVERY_PENDING",
          message: "Fluxo enfileirado mas o envio não concluiu a tempo. Tente de novo em instantes.",
          detail: result.detail,
          flush,
        })
      }
      return res.json({
        ok: true,
        detail: result.detail,
        conversationId: result.conversationId,
        contactName: result.contactName,
        message:
          result.detail.length > 0
            ? `Teste enviado para ${result.contactName || "o contato"}. Confira a conversa no chat.`
            : "Nenhuma ação executada. Verifique se há mensagem ou mídia configurada.",
      })
    } catch (err) {
      if (err?.code === "NOT_FOUND") return res.status(404).json({ error: err.code, message: err.message })
      if (err?.code === "WHATSAPP_NOT_CONNECTED") return res.status(409).json({ error: err.code, message: err.message })
      console.error("[crm] flow test:", err?.message || err)
      return res.status(500).json({ error: "FLOW_TEST_FAILED", message: "Falha ao testar o fluxo." })
    }
  })

  router.post("/flows/test", async (req, res) => {
    const schema = z.object({
      conversationId: z.string().min(1),
      flow: flowSchema,
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const hint = first?.path?.length ? `${first.path.join(".")}: ` : ""
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: `Fluxo inválido (${hint}${first?.message || "verifique os campos"}).`,
      })
    }
    if (parsed.data.flow.trigger.type === "keyword" && !parsed.data.flow.trigger.keywords?.length) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe pelo menos uma palavra-chave." })
    }
    const actionError = validateFlowActions(parsed.data.flow.actions)
    if (actionError) return res.status(400).json({ error: "VALIDATION_ERROR", message: actionError })
    try {
      const result = await testFlowOnConversation(flowTestDeps, {
        flow: { ...parsed.data.flow, id: null },
        conversationId: parsed.data.conversationId,
        userId: req.user.sub,
      })
      const flush = await flushCrmDeliveries(flowTestDeps, {
        conversationId: parsed.data.conversationId,
        maxMs: 90000,
      })
      if (!flush.flushed) {
        return res.status(502).json({
          error: "DELIVERY_PENDING",
          message: "Fluxo enfileirado mas o envio não concluiu a tempo.",
          detail: result.detail,
          flush,
        })
      }
      return res.json({
        ok: true,
        detail: result.detail,
        conversationId: result.conversationId,
        contactName: result.contactName,
        message:
          result.detail.length > 0
            ? `Teste enviado para ${result.contactName || "o contato"}. Confira a conversa no chat.`
            : "Nenhuma ação executada. Verifique se há mensagem ou mídia configurada.",
      })
    } catch (err) {
      if (err?.code === "NOT_FOUND") return res.status(404).json({ error: err.code, message: err.message })
      if (err?.code === "WHATSAPP_NOT_CONNECTED") return res.status(409).json({ error: err.code, message: err.message })
      console.error("[crm] flow test draft:", err?.message || err)
      return res.status(500).json({ error: "FLOW_TEST_FAILED", message: "Falha ao testar o fluxo." })
    }
  })

  // ------------------------- Agentes IA -------------------------

  const activationConfigSchema = z
    .object({
      keywords: z.array(z.string().max(60)).max(20).optional(),
      matchMode: z.enum(["contains", "exact"]).optional(),
      tagIds: z.array(z.string()).max(40).optional(),
      stageIds: z.array(z.string()).max(40).optional(),
      autoEnableOnMatch: z.boolean().optional(),
    })
    .nullable()
    .optional()

  const agentSchema = z.object({
    name: z.string().min(1).max(80),
    enabled: z.boolean().optional().default(false),
    systemPrompt: z.string().min(10).max(8000),
    model: z.string().min(1).max(80).optional().default("gpt-4o-mini"),
    temperature: z.number().min(0).max(2).optional().default(0.7),
    maxTokens: z.number().int().min(50).max(2000).optional().default(400),
    maxRepliesPerConversation: z.number().int().min(1).max(100).optional().default(10),
    handoffKeywords: z.array(z.string().min(1).max(40)).max(20).optional().default(["humano", "atendente"]),
    quietHours: quietHoursSchema,
    replyDelayMinSec: z.number().int().min(1).max(120).optional().default(5),
    replyDelayMaxSec: z.number().int().min(1).max(300).optional().default(20),
    activationMode: z.enum(["manual", "auto_new", "auto_keyword", "auto_tag", "auto_stage"]).optional().default("manual"),
    activationConfig: activationConfigSchema,
    allowedTools: z.array(z.enum(["add_tag", "remove_tag", "move_stage", "handoff"])).max(8).optional().default([]),
    allowedTagIds: z.array(z.string()).max(40).optional().default([]),
    knowledgeText: z.string().max(20000).optional().default(""),
    promptTemplateId: z.string().max(40).optional().nullable(),
    locale: z.string().max(16).optional().default("pt-BR"),
    numberScope: z.enum(["all", "member"]).optional().default("all"),
    numberUserId: z.string().optional().nullable(),
    boardScope: z.enum(["all", "member"]).optional().default("all"),
    boardUserId: z.string().optional().nullable(),
  })

  function agentWriteData(parsed, scope) {
    const audience = normalizeAudience(parsed)
    const err = audienceError(audience, scope.userIds || [])
    if (err) {
      const e = new Error(err)
      e.code = "VALIDATION_ERROR"
      throw e
    }
    return {
      ...parsed,
      ...audience,
      knowledgeText: parsed.knowledgeText || null,
      promptTemplateId: parsed.promptTemplateId || null,
      organizationId: scope.orgId || null,
    }
  }

  function visibleAgents(rows, scope) {
    return rows.filter((agent) => {
      if (!agentInOrganization(agent, scope)) return false
      if (scope.isOwner) return true
      return agentCoversMember(agent, scope.actorId || scope.userIds?.[0])
    })
  }

  async function findOrgAgent(req, id) {
    const agent = await prisma.crmAiAgent.findFirst({ where: { id } })
    if (!agent || !agentInOrganization(agent, req.dataScope)) return null
    if (!req.dataScope.isOwner && !agentCoversMember(agent, req.user.sub)) return null
    return agent
  }

  router.get("/ai/settings", async (req, res) => {
    const row = req.dataScope.orgId
      ? await prisma.organizationAiConfig.findUnique({ where: { organizationId: req.dataScope.orgId } })
      : null
    return res.json(publicAiStatus(row))
  })

  router.put("/ai/settings", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode conectar a API de IA." })
    }
    if (!req.dataScope.orgId) {
      return res.status(400).json({ error: "NO_ORG", message: "Empresa não encontrada." })
    }
    const schema = z.object({
      apiKey: z.string().min(12).max(300),
      baseUrl: z.string().url().max(200).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe uma chave de API válida." })
    }
    const baseUrl = (parsed.data.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")
    const saved = await prisma.organizationAiConfig.upsert({
      where: { organizationId: req.dataScope.orgId },
      create: {
        organizationId: req.dataScope.orgId,
        apiKeyEnc: encryptApiKey(parsed.data.apiKey.trim()),
        apiKeyLast4: last4(parsed.data.apiKey.trim()),
        baseUrl,
      },
      update: {
        apiKeyEnc: encryptApiKey(parsed.data.apiKey.trim()),
        apiKeyLast4: last4(parsed.data.apiKey.trim()),
        baseUrl,
      },
    })
    return res.json(publicAiStatus(saved))
  })

  router.delete("/ai/settings", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode remover a API de IA." })
    }
    if (req.dataScope.orgId) {
      await prisma.organizationAiConfig.deleteMany({ where: { organizationId: req.dataScope.orgId } })
    }
    return res.json({ configured: false, last4: null, baseUrl: "https://api.openai.com/v1" })
  })

  router.post("/ai/generate-prompt", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode gerar o prompt." })
    }
    const brief = String(req.body?.brief || "").trim()
    if (brief.length < 20) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Explique com um pouco mais de detalhe o que o agente deve fazer.",
      })
    }
    if (brief.length > 4000) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "O texto ficou longo demais. Resuma em até 4000 caracteres." })
    }
    const aiClient = await resolveOrgAiClient(prisma, req.dataScope.orgId)
    if (!aiClient.configured) {
      return res.status(503).json({
        error: "AI_NOT_CONFIGURED",
        message: "Conecte a chave de API da empresa antes de gerar o prompt.",
      })
    }
    try {
      const systemPrompt = await generateSystemPrompt({
        apiKey: aiClient.apiKey,
        baseUrl: aiClient.baseUrl,
        brief,
        name: req.body?.name,
      })
      if (!systemPrompt || systemPrompt.length < 10) {
        return res.status(502).json({ error: "AI_ERROR", message: "A IA não devolveu um prompt utilizável." })
      }
      return res.json({ systemPrompt })
    } catch (err) {
      return res.status(502).json({ error: "AI_ERROR", message: String(err?.message || "Falha ao gerar o prompt.") })
    }
  })

  router.get("/agents", async (req, res) => {
    const orgId = req.dataScope.orgId
    const agents = await prisma.crmAiAgent.findMany({
      where: orgId
        ? { OR: [{ organizationId: orgId }, { organizationId: null, userId: { in: req.dataScope.userIds } }] }
        : { userId: req.user.sub },
      orderBy: { createdAt: "asc" },
    })
    const row = orgId
      ? await prisma.organizationAiConfig.findUnique({ where: { organizationId: orgId } })
      : null
    const status = publicAiStatus(row)
    return res.json({
      agents: visibleAgents(agents, { ...req.dataScope, actorId: req.user.sub }).map(formatAgentRow),
      aiConfigured: Boolean(status.configured),
      aiKeyLast4: status.last4 || null,
    })
  })

  router.post("/agents", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode criar agentes." })
    }
    const parsed = agentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados do agente inválidos." })
    let data
    try {
      data = agentWriteData(parsed.data, req.dataScope)
    } catch (err) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message })
    }
    const agent = await prisma.crmAiAgent.create({ data: { userId: req.user.sub, ...data } })
    return res.status(201).json({ agent: formatAgentRow(agent) })
  })

  router.put("/agents/:id", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode editar agentes." })
    }
    const parsed = agentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados do agente inválidos." })
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    let data
    try {
      data = agentWriteData(parsed.data, req.dataScope)
    } catch (err) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message })
    }
    const updated = await prisma.crmAiAgent.update({ where: { id: agent.id }, data })
    return res.json({ agent: formatAgentRow(updated) })
  })

  router.delete("/agents/:id", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode remover agentes." })
    }
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    await prisma.crmConversation.updateMany({
      where: { aiAgentId: agent.id },
      data: { aiAgentId: null, aiEnabled: false, assignedTo: "human" },
    })
    await prisma.crmAiAgent.delete({ where: { id: agent.id } })
    return res.json({ ok: true })
  })

  router.get("/agents/:id/knowledge", async (req, res) => {
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    const items = await loadKnowledgeChunks(prisma, agent.id)
    return res.json({
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        chars: (item.contentText || "").length,
        // O editor reabre tag/etapa a partir deste Markdown. O resto da lista fica sem o texto.
        ...(item.name === "Ferramentas deste agente.md" ? { contentText: item.contentText || "" } : {}),
      })),
    })
  })

  router.post("/agents/:id/knowledge", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode anexar conhecimento." })
    }
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    try {
      const parsed = await parseKnowledgeUpload(req.body || {})
      const last = await prisma.crmAiAgentKnowledge.aggregate({
        where: { agentId: agent.id },
        _max: { sortOrder: true },
      })
      const item = await prisma.crmAiAgentKnowledge.create({
        data: {
          userId: req.user.sub,
          agentId: agent.id,
          ...parsed,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      })
      return res.status(201).json({
        item: { id: item.id, name: item.name, type: item.type, chars: item.contentText.length },
      })
    } catch (err) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message || "Arquivo inválido." })
    }
  })

  router.put("/agents/:id/knowledge/order", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode organizar a base." })
    }
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)) : []
    const existing = await prisma.crmAiAgentKnowledge.findMany({
      where: { agentId: agent.id },
      select: { id: true },
    })
    const known = new Set(existing.map((row) => row.id))
    if (!ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "A ordem dos documentos não confere." })
    }
    await prisma.$transaction(
      ids.map((id, index) => prisma.crmAiAgentKnowledge.update({ where: { id }, data: { sortOrder: index } })),
    )
    return res.json({ ok: true })
  })

  router.delete("/agents/:id/knowledge/:kid", async (req, res) => {
    if (!req.dataScope.isOwner) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Apenas o dono da empresa pode remover conhecimento." })
    }
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    await prisma.crmAiAgentKnowledge.deleteMany({ where: { id: req.params.kid, agentId: agent.id } })
    return res.json({ ok: true })
  })

  router.post("/agents/:id/test", async (req, res) => {
    const agent = await findOrgAgent(req, req.params.id)
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    const aiClient = await resolveOrgAiClient(prisma, req.dataScope.orgId)
    if (!aiClient.configured) {
      return res.status(503).json({
        error: "AI_NOT_CONFIGURED",
        message: "Conecte a chave de API da empresa antes de testar o agente.",
      })
    }
    const message = String(req.body?.message || "").trim()
    if (!message) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Escreva uma mensagem de teste." })
    try {
      const chunks = await loadKnowledgeChunks(prisma, agent.id)
      const scopeUsers = req.dataScope.userIds?.length ? req.dataScope.userIds : [req.user.sub]
      const tagUsers = agent.numberScope === "member" && agent.numberUserId ? [agent.numberUserId] : scopeUsers
      const stageUsers = agent.boardScope === "member" && agent.boardUserId ? [agent.boardUserId] : scopeUsers
      const [tags, stages] = await Promise.all([
        prisma.crmTag.findMany({ where: { userId: { in: tagUsers } }, select: { id: true, name: true } }),
        prisma.crmKanbanStage.findMany({
          where: { userId: { in: stageUsers } },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        }),
      ])
      const result = await testAgentReply(agent, message, req.body?.history || [], chunks, aiClient, { tags, stages })
      return res.json(result)
    } catch (err) {
      return res.status(502).json({ error: "AI_ERROR", message: String(err?.message || "Falha ao consultar a IA.") })
    }
  })

  // ------------------------- Sincronização -------------------------

  router.post("/sync", async (req, res) => {
    const schema = z.object({
      scope: z.string().optional().default("all"),
      days: z.number().int().min(1).max(365).optional(),
      cutoffDate: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

    let cutoffDate = null
    if (parsed.data.cutoffDate) {
      const d = new Date(parsed.data.cutoffDate)
      if (!Number.isNaN(d.getTime())) cutoffDate = d
    } else {
      const days = parsed.data.days || 30
      cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000)
    }

    try {
      const result = await startCrmSync(syncDeps, req.user.sub, {
        scope: parsed.data.scope || "all",
        cutoffDate,
      })
      if (result.rateLimited) {
        return res.status(429).json({
          error: "SYNC_RATE_LIMITED",
          message: "WhatsApp limitou consultas há pouco. Aguarde antes de sincronizar de novo.",
          job: result.job,
        })
      }
      return res.json(result)
    } catch (err) {
      if (err?.code === "WHATSAPP_NOT_CONNECTED") {
        return res.status(409).json({ error: err.code, message: err.message })
      }
      console.error("[crm] sync start:", err?.message || err)
      return res.status(500).json({ error: "SYNC_FAILED", message: "Falha ao iniciar a sincronização." })
    }
  })

  router.get("/sync/status", async (req, res) => {
    const job = await getCrmSyncStatus(prisma, req.user.sub)
    return res.json({ job })
  })

  router.post("/sync/cancel", async (req, res) => {
    try {
      const result = await cancelCrmSync(syncDeps, req.user.sub)
      if (!result.cancelled) {
        return res.json({
          ok: true,
          cancelled: false,
          alreadyIdle: true,
          job: result.job,
          message: "Nenhuma sincronização em andamento.",
        })
      }
      return res.json({
        ok: true,
        cancelled: true,
        job: result.job,
        message: "Sincronização cancelada.",
      })
    } catch (err) {
      console.error("[crm] sync cancel:", err?.message || err)
      return res.status(500).json({ error: "SYNC_CANCEL_FAILED", message: "Falha ao cancelar a sincronização." })
    }
  })

  router.post("/avatars/enqueue", async (req, res) => {
    try {
      const userId = req.user.sub
      const conn = await ensureWhatsAppConnected(prisma, userId)
      if (!conn) {
        return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
      }

      const schema = z.object({
        contactIds: z.array(z.string().min(1).max(64)).optional(),
        limit: z.number().int().min(1).max(30).optional(),
      })
      const parsed = schema.safeParse(req.body || {})
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })
      }

      const result = await enqueueAvatarFetches(syncDeps, {
        userId,
        instanceName: conn.instanceName,
        contactIds: parsed.data.contactIds,
        limit: parsed.data.limit,
      })

      return res.json({ ok: true, ...result })
    } catch (err) {
      console.error("[crm] avatars/enqueue:", err?.message || err)
      return res.status(500).json({ error: "ENQUEUE_FAILED", message: "Falha ao enfileirar fotos de perfil." })
    }
  })

  router.post("/profiles/refresh", async (req, res) => {
    const userId = req.user.sub
    const conn = await ensureWhatsAppConnected(prisma, userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    const result = await syncContactProfiles(syncDeps, { userId, instanceName: conn.instanceName })
    const total = (result.queued || 0) + (result.avatarQueued || 0)
    return res.json({
      ok: true,
      enriched: result.enriched,
      queued: result.queued,
      avatarQueued: result.avatarQueued,
      lidPhonesResolved: result.lidPhonesResolved,
      phonesBackfilled: result.phonesBackfilled,
      directorySize: result.directorySize,
      message:
        result.enriched || total || result.namesFromMessages || result.phonesBackfilled || result.lidPhonesResolved
          ? `Perfis atualizados: ${result.lidPhonesResolved || 0} telefone(s) de conversas @lid, ${result.phonesBackfilled || 0} do JID, ${result.namesFromMessages || 0} das mensagens, ${result.enriched} imediato(s), ${total} na fila.`
          : "Nenhum perfil novo encontrado. Alguns contatos podem não expor foto no WhatsApp.",
    })
  })

  // ------------------------- Visão geral (contadores) -------------------------

  registerCrmAnalysisRoutes(router)

  router.get("/overview", async (req, res) => {
    const uf = readUserFilter(req.dataScope)
    const [open, pending, resolved, unread, contacts] = await prisma.$transaction([
      prisma.crmConversation.count({ where: { ...uf, status: "open" } }),
      prisma.crmConversation.count({ where: { ...uf, status: "pending" } }),
      prisma.crmConversation.count({ where: { ...uf, status: "resolved" } }),
      prisma.crmConversation.count({ where: { ...uf, unreadCount: { gt: 0 } } }),
      prisma.crmContact.count({ where: uf }),
    ])
    const aiRow = req.dataScope?.orgId
      ? await prisma.organizationAiConfig.findUnique({ where: { organizationId: req.dataScope.orgId } })
      : null
    const ai = publicAiStatus(aiRow)
    return res.json({ open, pending, resolved, unread, contacts, aiConfigured: Boolean(ai.configured) })
  })

  return router
}

module.exports = { createCrmRouter }

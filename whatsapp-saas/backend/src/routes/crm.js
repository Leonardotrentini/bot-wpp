/**
 * Rotas do módulo CRM (conversas 1:1, kanban, tags, atalhos, fluxos, agentes IA, sync).
 * Fábrica: recebe `io` para eventos em tempo real.
 */

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const {
  sendText,
  sendMedia,
  sendWhatsAppAudio,
  findChats,
  findContacts,
  fetchChatMessages,
  fetchProfile,
  fetchProfilePictureUrl,
  saveContact,
  getBase64FromMediaMessage,
  extractMediaBase64Payload,
} = require("../lib/evolution")
const { enqueueUserSend } = require("../lib/sendQueue")
const { validateMediaContentSize } = require("../lib/mediaLimits")
const {
  formatContactRow,
  formatConversationRow,
  formatMessageRow,
  previewFromBody,
  emitCrmEvent,
  CONVERSATION_INCLUDE,
  normalizeMessageMediaKind,
} = require("../lib/crmCore")
const { startCrmSync, getCrmSyncStatus } = require("../lib/crmSync")
const { syncContactProfiles } = require("../lib/crmProfile")
const { ensureMessageRaw, readStoredMessageMedia, buildOutboundMessageRaw } = require("../lib/crmMedia")
const { onStageChange } = require("../lib/crmFlows")
const { ensureWhatsAppConnected } = require("../lib/whatsappConnection")
const { pickAvatarFromPicturePayload, pickProfileFields } = require("../lib/crmProfile")
const { aiConfigured, testAgentReply } = require("../lib/crmAiAgent")

const DEFAULT_STAGES = [
  { name: "Novo", color: "#38bdf8", isDefault: true },
  { name: "Em atendimento", color: "#fbbf24" },
  { name: "Negociando", color: "#a78bfa" },
  { name: "Fechado", color: "#34d399" },
]

async function ensureDefaultStages(userId) {
  const count = await prisma.crmKanbanStage.count({ where: { userId } })
  if (count > 0) return
  await prisma.crmKanbanStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ userId, sortOrder: i, ...s })),
  })
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
    trigger: flow.trigger,
    conditions: flow.conditions || [],
    actions: flow.actions,
    cooldownPerContactHours: flow.cooldownPerContactHours,
    quietHours: flow.quietHours || null,
    createdAt: flow.createdAt.toISOString(),
  }
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

  const syncDeps = { prisma, io, findChats, findContacts, fetchChatMessages, fetchProfile, fetchProfilePictureUrl }

  // ------------------------- Conversas -------------------------

  router.get("/conversations", async (req, res) => {
    const userId = req.user.sub
    await ensureDefaultStages(userId)

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "100", 10) || 100))
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0)
    const { status, stageId, tagId, q } = req.query

    const where = { userId }
    if (status && ["open", "pending", "resolved", "archived"].includes(status)) where.status = status
    if (stageId === "none") where.kanbanStageId = null
    else if (stageId) where.kanbanStageId = String(stageId)
    if (tagId) where.contact = { tags: { some: { tagId: String(tagId) } } }
    if (q && String(q).trim()) {
      const term = String(q).trim()
      where.OR = [
        { contact: { name: { contains: term, mode: "insensitive" } } },
        { contact: { pushName: { contains: term, mode: "insensitive" } } },
        { contact: { phone: { contains: term.replace(/\D/g, "") || term } } },
        { lastMessagePreview: { contains: term, mode: "insensitive" } },
      ]
    }

    const [total, rows] = await prisma.$transaction([
      prisma.crmConversation.count({ where }),
      prisma.crmConversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        skip: offset,
        take: limit,
      }),
    ])

    return res.json({
      conversations: rows.map(formatConversationRow),
      total,
      limit,
      offset,
    })
  })

  router.get("/conversations/:id/messages", async (req, res) => {
    const userId = req.user.sub
    const convo = await prisma.crmConversation.findFirst({
      where: { id: req.params.id, userId },
    })
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10) || 50))
    const before = req.query.before ? new Date(String(req.query.before)) : null

    const where = { conversationId: convo.id }
    if (before && !Number.isNaN(before.getTime())) where.timestamp = { lt: before }

    const rows = await prisma.crmMessage.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
    })
    rows.reverse()

    return res.json({
      messages: rows.map(formatMessageRow),
      hasMore: rows.length === limit,
    })
  })

  router.get("/messages/:messageId/media", async (req, res) => {
    const userId = req.user.sub
    const msg = await prisma.crmMessage.findFirst({
      where: { id: req.params.messageId, userId },
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

    const conn = await ensureWhatsAppConnected(prisma, userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    const rawRecord = await ensureMessageRaw({ prisma, fetchChatMessages }, msg)
    if (!rawRecord || typeof rawRecord !== "object") {
      return res.status(409).json({ error: "MEDIA_UNAVAILABLE", message: "Mídia indisponível para esta mensagem." })
    }

    try {
      const resp = await getBase64FromMediaMessage(conn.instanceName, rawRecord, {
        convertToMp4: mediaKind === "video",
      })
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
    const userId = req.user.sub
    const schema = z.object({
      body: z.string().max(4096).optional().default(""),
      mediaType: z.enum(["none", "image", "video", "audio", "document"]).optional().default("none"),
      mediaBase64: z.string().optional().nullable(),
      mediaMime: z.string().max(120).optional().nullable(),
      mediaName: z.string().max(255).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const content = parsed.data

    const mediaError = validateMediaContentSize(content)
    if (mediaError) return res.status(400).json({ error: "MEDIA_INVALID", message: mediaError })

    const convo = await prisma.crmConversation.findFirst({
      where: { id: req.params.id, userId },
      include: CONVERSATION_INCLUDE,
    })
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const conn = await ensureWhatsAppConnected(prisma, userId)
    if (!conn) {
      return res.status(409).json({ error: "WHATSAPP_DISCONNECTED", message: "WhatsApp não está conectado." })
    }

    try {
      const resp = await enqueueUserSend(userId, async () => {
        if (content.mediaType === "audio") {
          const media = String(content.mediaBase64 || "").replace(/^data:[^;]+;base64,/, "")
          const mimetype = content.mediaMime || "audio/ogg; codecs=opus"
          const audioPayload = media.startsWith("data:") ? media : `data:${mimetype};base64,${media}`
          return sendWhatsAppAudio(conn.instanceName, convo.remoteJid, {
            audio: audioPayload,
            mimetype,
            encoding: true,
          })
        }
        if (content.mediaType !== "none") {
          const media = String(content.mediaBase64 || "").replace(/^data:[^;]+;base64,/, "")
          return sendMedia(conn.instanceName, convo.remoteJid, {
            mediatype: content.mediaType,
            media,
            mimetype: content.mediaMime || undefined,
            caption: content.body || undefined,
            fileName: content.mediaName || undefined,
          })
        }
        return sendText(conn.instanceName, convo.remoteJid, content.body)
      })

      const providerMessageId = resp?.key?.id || resp?.messageId || resp?.id || null
      const now = new Date()
      const hasMedia = content.mediaType !== "none"
      const mediaB64 = hasMedia ? String(content.mediaBase64 || "").replace(/^data:[^;]+;base64,/, "") : null
      const messageRaw = hasMedia
        ? buildOutboundMessageRaw({
            providerMessageId,
            remoteJid: convo.remoteJid,
            evolutionResp: resp,
            mediaBase64: mediaB64,
            mediaMime: content.mediaMime,
            mediaName: content.mediaName,
          })
        : null

      const message = await prisma.crmMessage.create({
        data: {
          userId,
          conversationId: convo.id,
          messageId: providerMessageId || `manual-${Date.now()}`,
          fromMe: true,
          type: content.mediaType === "none" ? "text" : content.mediaType,
          body: content.body || "",
          mediaMime: content.mediaMime || null,
          status: "sent",
          source: "manual",
          timestamp: now,
          raw: messageRaw,
        },
      })

      const updated = await prisma.crmConversation.update({
        where: { id: convo.id },
        data: {
          lastMessageAt: now,
          lastMessagePreview: previewFromBody(content.body, content.mediaType === "none" ? "text" : content.mediaType),
          lastMessageFromMe: true,
          status: convo.status === "resolved" ? "open" : convo.status,
        },
        include: CONVERSATION_INCLUDE,
      })

      emitCrmEvent(io, userId, "crm:message", {
        conversationId: convo.id,
        message: formatMessageRow(message),
        conversation: formatConversationRow(updated),
      })

      return res.json({ message: formatMessageRow(message), conversation: formatConversationRow(updated) })
    } catch (err) {
      console.error("[crm] envio manual falhou:", err?.message || err)
      return res.status(502).json({ error: "SEND_FAILED", message: "Falha ao enviar. Tente novamente." })
    }
  })

  router.post("/conversations/:id/read", async (req, res) => {
    const userId = req.user.sub
    const convo = await prisma.crmConversation.findFirst({ where: { id: req.params.id, userId } })
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })
    const updated = await prisma.crmConversation.update({
      where: { id: convo.id },
      data: { unreadCount: 0 },
      include: CONVERSATION_INCLUDE,
    })
    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(updated) })
    return res.json({ conversation: formatConversationRow(updated) })
  })

  router.patch("/conversations/:id", async (req, res) => {
    const userId = req.user.sub
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

    const convo = await prisma.crmConversation.findFirst({ where: { id: req.params.id, userId } })
    if (!convo) return res.status(404).json({ error: "NOT_FOUND", message: "Conversa não encontrada." })

    const data = { ...parsed.data }
    if (data.kanbanStageId) {
      const stage = await prisma.crmKanbanStage.findFirst({ where: { id: data.kanbanStageId, userId } })
      if (!stage) return res.status(400).json({ error: "STAGE_NOT_FOUND", message: "Estágio inválido." })
    }
    if (data.aiAgentId) {
      const agent = await prisma.crmAiAgent.findFirst({ where: { id: data.aiAgentId, userId } })
      if (!agent) return res.status(400).json({ error: "AGENT_NOT_FOUND", message: "Agente inválido." })
    }
    if (data.aiEnabled === true) data.assignedTo = "ai"
    if (data.aiEnabled === false && !data.assignedTo) data.assignedTo = "human"

    const updated = await prisma.crmConversation.update({
      where: { id: convo.id },
      data,
      include: CONVERSATION_INCLUDE,
    })

    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(updated) })

    const stageChanged = data.kanbanStageId && data.kanbanStageId !== convo.kanbanStageId
    if (stageChanged) {
      onStageChange({ prisma, io, sendText }, { conversation: updated, stageId: data.kanbanStageId }).catch((err) =>
        console.error("[crm-flow] stage_change:", err?.message || err),
      )
    }

    return res.json({ conversation: formatConversationRow(updated) })
  })

  // ------------------------- Contatos -------------------------

  router.patch("/contacts/:id", async (req, res) => {
    const userId = req.user.sub
    const schema = z.object({
      name: z.string().max(120).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } })
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })

    const data = { ...parsed.data }
    if (data.name !== undefined) data.name = data.name ? String(data.name).trim() : null

    const updated = await prisma.crmContact.update({
      where: { id: contact.id },
      data,
      include: { tags: { include: { tag: true } } },
    })

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
    const userId = req.user.sub
    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } })
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })

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
    const userId = req.user.sub
    const schema = z.object({
      name: z.string().min(1).max(120),
      saveOnWhatsapp: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um nome válido." })

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } })
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })

    const savedName = parsed.data.name.trim()
    const phone = contact.phone || contact.remoteJid.split("@")[0].replace(/\D/g, "")
    if (!phone || phone.length < 8) {
      return res.status(400).json({
        error: "NO_PHONE",
        message: "Este contato não tem número de telefone — não é possível salvar na agenda do WhatsApp.",
      })
    }

    let whatsappSaved = false
    let whatsappWarning = null
    if (parsed.data.saveOnWhatsapp) {
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

  router.post("/contacts/:id/tags", async (req, res) => {
    const userId = req.user.sub
    const tagId = String(req.body?.tagId || "")
    const [contact, tag] = await Promise.all([
      prisma.crmContact.findFirst({ where: { id: req.params.id, userId } }),
      prisma.crmTag.findFirst({ where: { id: tagId, userId } }),
    ])
    if (!contact || !tag) return res.status(404).json({ error: "NOT_FOUND", message: "Contato ou tag não encontrados." })

    await prisma.crmContactTag.upsert({
      where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
      create: { contactId: contact.id, tagId: tag.id },
      update: {},
    })
    const updated = await prisma.crmContact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } },
    })
    return res.json({ contact: formatContactRow(updated) })
  })

  router.delete("/contacts/:id/tags/:tagId", async (req, res) => {
    const userId = req.user.sub
    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } })
    if (!contact) return res.status(404).json({ error: "NOT_FOUND", message: "Contato não encontrado." })
    await prisma.crmContactTag
      .delete({ where: { contactId_tagId: { contactId: contact.id, tagId: req.params.tagId } } })
      .catch(() => {})
    const updated = await prisma.crmContact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } },
    })
    return res.json({ contact: formatContactRow(updated) })
  })

  // ------------------------- Tags -------------------------

  router.get("/tags", async (req, res) => {
    const tags = await prisma.crmTag.findMany({ where: { userId: req.user.sub }, orderBy: { name: "asc" } })
    return res.json({ tags: tags.map(formatTagRow) })
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
      type: z.enum(["new_conversation", "keyword", "no_reply", "stage_change"]),
      keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
      matchMode: z.enum(["contains", "exact"]).optional(),
      hours: z.number().int().min(1).max(720).optional(),
      stageId: z.string().nullable().optional(),
    }),
    conditions: z
      .array(
        z.object({
          type: z.enum(["has_tag", "not_has_tag", "stage_is", "status_is"]),
          value: z.string(),
        }),
      )
      .max(10)
      .optional()
      .default([]),
    actions: z
      .array(
        z.object({
          type: z.enum(["send_message", "add_tag", "move_stage", "assign_ai", "set_status"]),
          body: z.string().max(4096).optional(),
          mediaType: z.enum(["none", "image", "video", "audio"]).optional(),
          mediaBase64: z.string().optional().nullable(),
          mediaMime: z.string().max(120).optional().nullable(),
          mediaName: z.string().max(255).optional().nullable(),
          tagId: z.string().optional(),
          stageId: z.string().optional(),
          agentId: z.string().optional(),
          value: z.string().optional(),
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
    const actionError = validateFlowActions(parsed.data.actions)
    if (actionError) return res.status(400).json({ error: "VALIDATION_ERROR", message: actionError })
    const flow = await prisma.crmFlow.create({ data: { userId: req.user.sub, ...parsed.data } })
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
    const actionError = validateFlowActions(parsed.data.actions)
    if (actionError) return res.status(400).json({ error: "VALIDATION_ERROR", message: actionError })
    const updated = await prisma.crmFlow.update({ where: { id: flow.id }, data: parsed.data })
    return res.json({ flow: formatFlowRow(updated) })
  })

  router.patch("/flows/:id", async (req, res) => {
    const schema = z.object({ enabled: z.boolean() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    const updated = await prisma.crmFlow.update({ where: { id: flow.id }, data: { enabled: parsed.data.enabled } })
    return res.json({ flow: formatFlowRow(updated) })
  })

  router.delete("/flows/:id", async (req, res) => {
    const flow = await prisma.crmFlow.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Fluxo não encontrado." })
    await prisma.crmFlow.delete({ where: { id: flow.id } })
    return res.json({ ok: true })
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

  // ------------------------- Agentes IA -------------------------

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
  })

  router.get("/agents", async (req, res) => {
    const agents = await prisma.crmAiAgent.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "asc" } })
    return res.json({ agents: agents.map(formatAgentRow), aiConfigured: aiConfigured() })
  })

  router.post("/agents", async (req, res) => {
    const parsed = agentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados do agente inválidos." })
    const agent = await prisma.crmAiAgent.create({ data: { userId: req.user.sub, ...parsed.data } })
    return res.status(201).json({ agent: formatAgentRow(agent) })
  })

  router.put("/agents/:id", async (req, res) => {
    const parsed = agentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados do agente inválidos." })
    const agent = await prisma.crmAiAgent.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    const updated = await prisma.crmAiAgent.update({ where: { id: agent.id }, data: parsed.data })
    return res.json({ agent: formatAgentRow(updated) })
  })

  router.delete("/agents/:id", async (req, res) => {
    const agent = await prisma.crmAiAgent.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    await prisma.crmConversation.updateMany({
      where: { userId: req.user.sub, aiAgentId: agent.id },
      data: { aiAgentId: null, aiEnabled: false, assignedTo: "human" },
    })
    await prisma.crmAiAgent.delete({ where: { id: agent.id } })
    return res.json({ ok: true })
  })

  router.post("/agents/:id/test", async (req, res) => {
    const agent = await prisma.crmAiAgent.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!agent) return res.status(404).json({ error: "NOT_FOUND", message: "Agente não encontrado." })
    if (!aiConfigured()) {
      return res.status(503).json({
        error: "AI_NOT_CONFIGURED",
        message: "Chave de IA ainda não configurada no servidor (OPENAI_API_KEY).",
      })
    }
    const message = String(req.body?.message || "").trim()
    if (!message) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Escreva uma mensagem de teste." })
    try {
      const reply = await testAgentReply(agent, message)
      return res.json({ reply })
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

  router.get("/overview", async (req, res) => {
    const userId = req.user.sub
    const [open, pending, resolved, unread, contacts] = await prisma.$transaction([
      prisma.crmConversation.count({ where: { userId, status: "open" } }),
      prisma.crmConversation.count({ where: { userId, status: "pending" } }),
      prisma.crmConversation.count({ where: { userId, status: "resolved" } }),
      prisma.crmConversation.count({ where: { userId, unreadCount: { gt: 0 } } }),
      prisma.crmContact.count({ where: { userId } }),
    ])
    return res.json({ open, pending, resolved, unread, contacts, aiConfigured: aiConfigured() })
  })

  return router
}

module.exports = { createCrmRouter }

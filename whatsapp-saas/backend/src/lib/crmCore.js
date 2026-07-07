/**
 * Núcleo do CRM — contatos, conversas e mensagens 1:1.
 *
 * Mensagens em tempo real chegam pelo webhook (MESSAGES_UPSERT) e são roteadas
 * para cá quando o remoteJid NÃO é grupo (@s.whatsapp.net / @lid).
 * Histórico antigo entra pelo crmSync.js (importação paginada).
 */

const { mapEvolutionMessage } = require("./evolutionMessages")

const INDIVIDUAL_JID_RE = /@(s\.whatsapp\.net|lid)$/i

function isIndividualJid(jid) {
  return INDIVIDUAL_JID_RE.test(String(jid || "").trim())
}

function isLidJid(jid) {
  return /@lid$/i.test(String(jid || "").trim())
}

function phoneFromJid(jid) {
  const raw = String(jid || "").split("@")[0]
  const digits = raw.replace(/\D/g, "")
  // JIDs @lid não são números de telefone
  if (isLidJid(jid)) return null
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

function previewFromBody(body, type) {
  const text = String(body || "").trim()
  if (text) return text.slice(0, 160)
  const t = String(type || "").toLowerCase()
  if (t.includes("image")) return "📷 Imagem"
  if (t.includes("video")) return "🎬 Vídeo"
  if (t.includes("audio") || t.includes("ptt")) return "🎤 Áudio"
  if (t.includes("document")) return "📄 Documento"
  if (t.includes("sticker")) return "💟 Figurinha"
  if (t.includes("contact")) return "👤 Contato"
  if (t.includes("location")) return "📍 Localização"
  return "Mensagem"
}

function formatContactRow(contact, { tags } = {}) {
  if (!contact) return null
  return {
    id: contact.id,
    remoteJid: contact.remoteJid,
    name: contact.name || contact.pushName || contact.phone || contact.remoteJid.split("@")[0],
    pushName: contact.pushName || null,
    phone: contact.phone || null,
    avatarUrl: contact.avatarUrl || null,
    isLid: Boolean(contact.isLid),
    notes: contact.notes || "",
    lastSeenAt: contact.lastSeenAt ? contact.lastSeenAt.toISOString() : null,
    tags: (tags || contact.tags || []).map((ct) => ({
      id: ct.tag?.id ?? ct.id,
      name: ct.tag?.name ?? ct.name,
      color: ct.tag?.color ?? ct.color,
    })),
  }
}

function formatConversationRow(convo) {
  if (!convo) return null
  return {
    id: convo.id,
    remoteJid: convo.remoteJid,
    status: convo.status,
    unreadCount: convo.unreadCount,
    lastMessageAt: convo.lastMessageAt ? convo.lastMessageAt.toISOString() : null,
    lastMessagePreview: convo.lastMessagePreview || "",
    lastMessageFromMe: Boolean(convo.lastMessageFromMe),
    assignedTo: convo.assignedTo,
    aiEnabled: Boolean(convo.aiEnabled),
    aiAgentId: convo.aiAgentId || null,
    kanbanStageId: convo.kanbanStageId || null,
    kanbanOrder: convo.kanbanOrder,
    syncStatus: convo.syncStatus,
    syncedCount: convo.syncedCount,
    oldestSyncedAt: convo.oldestSyncedAt ? convo.oldestSyncedAt.toISOString() : null,
    createdAt: convo.createdAt ? convo.createdAt.toISOString() : null,
    contact: formatContactRow(convo.contact),
  }
}

function formatMessageRow(msg) {
  if (!msg) return null
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    messageId: msg.messageId,
    fromMe: Boolean(msg.fromMe),
    senderJid: msg.senderJid || null,
    type: msg.type || "text",
    body: msg.body || "",
    mediaMime: msg.mediaMime || null,
    status: msg.status,
    source: msg.source,
    timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
  }
}

const CONVERSATION_INCLUDE = {
  contact: { include: { tags: { include: { tag: true } } } },
}

/** Garante contato + conversa para um JID individual. */
async function ensureContactAndConversation(prisma, userId, remoteJid, { pushName } = {}) {
  const jid = String(remoteJid).trim()
  const phone = phoneFromJid(jid)

  let contact = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId, remoteJid: jid } },
  })
  if (!contact) {
    contact = await prisma.crmContact.create({
      data: {
        userId,
        remoteJid: jid,
        pushName: pushName || null,
        phone,
        isLid: isLidJid(jid),
      },
    })
  } else if (pushName && contact.pushName !== pushName) {
    contact = await prisma.crmContact.update({
      where: { id: contact.id },
      data: { pushName },
    })
  }

  let conversation = await prisma.crmConversation.findUnique({
    where: { userId_remoteJid: { userId, remoteJid: jid } },
    include: CONVERSATION_INCLUDE,
  })
  if (!conversation) {
    const defaultStage = await prisma.crmKanbanStage.findFirst({
      where: { userId, isDefault: true },
      orderBy: { sortOrder: "asc" },
    })
    conversation = await prisma.crmConversation.create({
      data: {
        userId,
        contactId: contact.id,
        remoteJid: jid,
        kanbanStageId: defaultStage?.id || null,
      },
      include: CONVERSATION_INCLUDE,
    })
    conversation.__isNew = true
  }

  return { contact, conversation }
}

function extractMediaMime(record) {
  const m = record?.message || {}
  return (
    m.imageMessage?.mimetype ||
    m.videoMessage?.mimetype ||
    m.audioMessage?.mimetype ||
    m.documentMessage?.mimetype ||
    m.stickerMessage?.mimetype ||
    null
  )
}

/**
 * Grava uma mensagem 1:1 (webhook ou import) de forma idempotente.
 * Retorna { message, conversation, created, isNewConversation }.
 */
async function ingestCrmMessage(deps, { userId, record, source = "webhook", updateUnread = true }) {
  const { prisma } = deps
  const remoteJid = record?.key?.remoteJid || record?.remoteJid
  if (!remoteJid || !isIndividualJid(remoteJid)) return null

  const mapped = mapEvolutionMessage(record)
  if (!mapped.messageId || !mapped.timestamp || Number.isNaN(mapped.timestamp.getTime())) return null

  const { conversation } = await ensureContactAndConversation(prisma, userId, remoteJid, {
    pushName: !mapped.fromMe ? record?.pushName || null : null,
  })
  const isNewConversation = Boolean(conversation.__isNew)

  const existing = await prisma.crmMessage.findUnique({
    where: { conversationId_messageId: { conversationId: conversation.id, messageId: mapped.messageId } },
  })

  const message = await prisma.crmMessage.upsert({
    where: { conversationId_messageId: { conversationId: conversation.id, messageId: mapped.messageId } },
    create: {
      userId,
      conversationId: conversation.id,
      messageId: mapped.messageId,
      fromMe: mapped.fromMe,
      senderJid: mapped.senderJid,
      type: mapped.type,
      body: mapped.body,
      mediaMime: extractMediaMime(record),
      status: mapped.fromMe ? "sent" : "received",
      source,
      timestamp: mapped.timestamp,
      raw: mapped.raw,
    },
    update: {
      body: mapped.body,
      type: mapped.type,
    },
  })
  const created = !existing

  const convData = {}
  if (!conversation.lastMessageAt || mapped.timestamp >= conversation.lastMessageAt) {
    convData.lastMessageAt = mapped.timestamp
    convData.lastMessagePreview = previewFromBody(mapped.body, mapped.type)
    convData.lastMessageFromMe = mapped.fromMe
  }
  if (created && source !== "import") {
    if (!mapped.fromMe && updateUnread) convData.unreadCount = { increment: 1 }
    // resposta do contato reabre conversa resolvida
    if (!mapped.fromMe && conversation.status === "resolved") convData.status = "open"
  }
  if (source === "import") {
    convData.syncedCount = { increment: created ? 1 : 0 }
    if (!conversation.oldestSyncedAt || mapped.timestamp < conversation.oldestSyncedAt) {
      convData.oldestSyncedAt = mapped.timestamp
    }
  }

  let updatedConversation = conversation
  if (Object.keys(convData).length) {
    updatedConversation = await prisma.crmConversation.update({
      where: { id: conversation.id },
      data: convData,
      include: CONVERSATION_INCLUDE,
    })
  }

  if (!mapped.fromMe) {
    await prisma.crmContact
      .update({ where: { id: conversation.contactId }, data: { lastSeenAt: mapped.timestamp } })
      .catch(() => {})
  }

  return { message, conversation: updatedConversation, created, isNewConversation }
}

/** Emite eventos socket para o usuário dono da conversa. */
function emitCrmEvent(io, userId, event, payload) {
  if (!io) return
  io.to(`user:${userId}`).emit(event, payload)
}

module.exports = {
  isIndividualJid,
  isLidJid,
  phoneFromJid,
  previewFromBody,
  formatContactRow,
  formatConversationRow,
  formatMessageRow,
  ensureContactAndConversation,
  ingestCrmMessage,
  emitCrmEvent,
  CONVERSATION_INCLUDE,
}

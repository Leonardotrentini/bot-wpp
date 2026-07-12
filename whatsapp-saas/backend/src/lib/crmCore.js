/**
 * Núcleo do CRM — contatos, conversas e mensagens 1:1.
 *
 * Mensagens em tempo real chegam pelo webhook (MESSAGES_UPSERT) e são roteadas
 * para cá quando o remoteJid NÃO é grupo (@s.whatsapp.net / @lid).
 * Histórico antigo entra pelo crmSync.js (importação paginada).
 */

const { mapEvolutionMessage } = require("./evolutionMessages")
const { prisma } = require("./prisma")
const {
  displayNameFromParticipant,
  formatPhoneBr,
  looksLikeInternalIdName,
  phoneDigitsFromJid,
  phoneDigitsFromValue,
} = require("./participantIdentity")

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

function isGenericSavedName(name) {
  const n = String(name || "").trim()
  return !n || n.toLowerCase() === "contato" || n.startsWith("Contato #")
}

function resolvePhoneDigits(contact) {
  if (!contact) return null
  return contact.phone || phoneDigitsFromJid(contact.remoteJid) || null
}

function lidFallbackLabel(_remoteJid) {
  return null
}

/** Telefone a partir de um item de chat/contato da Evolution (remoteJidAlt, senderPn, etc.). */
function phoneFromChatItem(chat) {
  if (!chat || typeof chat !== "object") return null
  const altJid =
    chat.remoteJidAlt ||
    chat.jidAlt ||
    chat.alternateJid ||
    chat.key?.remoteJidAlt ||
    chat.key?.participantAlt
  const candidates = [
    altJid,
    chat.senderPn,
    chat.phoneNumber,
    chat.phone,
    chat.pn,
    chat.remoteJid,
    chat.id,
    chat.jid,
    chat.key?.remoteJid,
  ]
  for (const c of candidates) {
    const phone = phoneFromJid(c) || phoneDigitsFromValue(c)
    if (phone) return phone
  }
  return null
}

function isSelfOrGenericPushName(name) {
  const n = String(name || "").trim().toLowerCase()
  if (!n) return true
  if (n === "você" || n === "voce" || n === "you" || n === "me") return true
  if (n === "contato") return true
  return false
}

function sanitizePushName(value, phoneDigits) {
  const raw = String(value || "").trim()
  if (!raw || isSelfOrGenericPushName(raw)) return null
  if (looksLikeInternalIdName(raw, phoneDigits)) return null
  return displayNameFromParticipant({ pushName: raw, name: raw }, phoneDigits) || raw
}

/** true quando não há nome salvo, pushName nem telefone utilizável. */
function contactNeedsIdentification(contact) {
  if (!contact) return false
  if (!isGenericSavedName(contact.name)) return false
  const phoneDigits = resolvePhoneDigits(contact)
  if (phoneDigits) return false
  const push = sanitizePushName(contact.pushName, phoneDigits)
  if (push) return false
  return true
}

function resolveContactDisplayName(contact) {
  if (!contact) return "Contato"
  const manual = String(contact.name || "").trim()
  if (!isGenericSavedName(manual)) return manual

  const phoneDigits = resolvePhoneDigits(contact)
  if (phoneDigits) return formatPhoneBr(phoneDigits)

  const fromWa = sanitizePushName(contact.pushName, phoneDigits)
  if (fromWa) return fromWa

  return "Contato"
}

function extractAltPhoneFromRecord(record, remoteJid) {
  const key = record?.key || {}
  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    record?.remoteJidAlt,
    key.senderPn,
    key.senderLid,
    key.participant,
    record?.senderPn,
    record?.participant,
    record?.participantAlt,
  ]
  for (const alt of candidates) {
    const phone = phoneFromJid(alt) || phoneDigitsFromValue(alt)
    if (phone) return phone
  }
  return phoneFromJid(remoteJid) || phoneDigitsFromJid(remoteJid)
}

function extractIdentityHintsFromRecord(record, remoteJid) {
  const phoneDigits = phoneFromJid(remoteJid) || phoneDigitsFromJid(remoteJid)
  const pushName = sanitizePushName(record?.pushName, phoneDigits)
  const phone = extractAltPhoneFromRecord(record, remoteJid)
  return { pushName, phone }
}

function parseContactCommerceField(customFields, key) {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return null
  const row = customFields[key]
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  return row
}

const { contactHasLpAttribution } = require("./metaAttributionLead")

function formatContactMetaFunnel(contact) {
  if (!contact) return null
  return {
    conversationStarted: Boolean(contact.conversationStartedEventSentAt),
    leadQualified: Boolean(contact.qualifiedEventSentAt),
    quote: Boolean(contact.quoteEventSentAt),
    hasAttribution: contactHasLpAttribution(contact),
  }
}

function formatContactRow(contact, { tags } = {}) {
  if (!contact) return null
  const phoneDigits = contact.phone || phoneDigitsFromJid(contact.remoteJid)
  const pushName = sanitizePushName(contact.pushName, phoneDigits)
  return {
    id: contact.id,
    remoteJid: contact.remoteJid,
    name: resolveContactDisplayName(contact),
    savedName: !isGenericSavedName(contact.name) ? contact.name : null,
    pushName,
    phone: phoneDigits || null,
    avatarUrl: contact.avatarUrl || null,
    isLid: Boolean(contact.isLid),
    needsIdentification: contactNeedsIdentification({ ...contact, phone: phoneDigits }),
    notes: contact.notes || "",
    createdAt: contact.createdAt ? contact.createdAt.toISOString() : null,
    quote: parseContactCommerceField(contact.customFields, "quote"),
    purchase: parseContactCommerceField(contact.customFields, "purchase"),
    reminders: (contact.reminders || [])
      .filter((r) => r.status === "pending")
      .map((r) => ({
        id: r.id,
        note: r.note || "",
        scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
        status: r.status,
      })),
    nextReminder: (() => {
      const pending = (contact.reminders || []).filter((r) => r.status === "pending")
      if (!pending.length) return null
      const next = pending.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0]
      return {
        id: next.id,
        note: next.note || "",
        scheduledAt: next.scheduledAt.toISOString(),
      }
    })(),
    lastSeenAt: contact.lastSeenAt ? contact.lastSeenAt.toISOString() : null,
    tags: (tags || contact.tags || []).map((ct) => ({
      id: ct.tag?.id ?? ct.id,
      name: ct.tag?.name ?? ct.name,
      color: ct.tag?.color ?? ct.color,
    })),
    metaFunnel: formatContactMetaFunnel(contact),
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

function normalizeMessageMediaKind(type) {
  const t = String(type || "").toLowerCase()
  if (t.includes("image") || t.includes("sticker")) return "image"
  if (t.includes("video")) return "video"
  if (t.includes("audio") || t.includes("ptt")) return "audio"
  if (t.includes("document")) return "document"
  return null
}

function formatMessageRow(msg) {
  if (!msg) return null
  const mediaKind = normalizeMessageMediaKind(msg.type)
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    messageId: msg.messageId,
    fromMe: Boolean(msg.fromMe),
    senderJid: msg.senderJid || null,
    type: msg.type || "text",
    mediaKind,
    hasMedia: Boolean(mediaKind),
    body: msg.body || "",
    mediaMime: msg.mediaMime || null,
    mediaName: extractMediaFileName(msg),
    status: msg.status,
    source: msg.source,
    timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
  }
}

const CONVERSATION_INCLUDE = {
  contact: {
    include: {
      tags: { include: { tag: true } },
      reminders: {
        where: { status: "pending" },
        orderBy: { scheduledAt: "asc" },
        take: 20,
      },
    },
  },
}

function cleanIncomingPushName(value, remoteJid) {
  const phoneDigits = phoneFromJid(remoteJid) || phoneDigitsFromJid(remoteJid)
  return sanitizePushName(value, phoneDigits)
}

/** Garante contato + conversa para um JID individual. */
async function ensureContactAndConversation(prisma, userId, remoteJid, { pushName, avatarUrl, phone: phoneHint } = {}) {
  const jid = String(remoteJid).trim()
  const phone = phoneHint || phoneFromJid(jid) || phoneDigitsFromJid(jid)

  let contact = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId, remoteJid: jid } },
  })
  if (!contact) {
    try {
      contact = await prisma.crmContact.create({
        data: {
          userId,
          remoteJid: jid,
          pushName: pushName || null,
          avatarUrl: avatarUrl || null,
          phone,
          isLid: isLidJid(jid),
        },
      })
    } catch (err) {
      if (err?.code !== "P2002") throw err
      contact = await prisma.crmContact.findUnique({
        where: { userId_remoteJid: { userId, remoteJid: jid } },
      })
      if (!contact) throw err
    }
  } else {
    const data = {}
    if (pushName && contact.pushName !== pushName) data.pushName = pushName
    if (avatarUrl && contact.avatarUrl !== avatarUrl) data.avatarUrl = avatarUrl
    if (!contact.phone && phone) data.phone = phone
    if (Object.keys(data).length) {
      contact = await prisma.crmContact.update({
        where: { id: contact.id },
        data,
      })
    }
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
    try {
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
    } catch (err) {
      if (err?.code !== "P2002") throw err
      conversation = await prisma.crmConversation.findUnique({
        where: { userId_remoteJid: { userId, remoteJid: jid } },
        include: CONVERSATION_INCLUDE,
      })
      if (!conversation) throw err
    }
  }

  return { contact, conversation }
}

const { unwrapBaileysMessage, mergeInboundMessageRaw } = require("./crmMedia")
const { extractCtwaClidFromRecord, storeContactCtwaClid } = require("./metaMessaging")
const { resolveAndApplyAttributionFromMessage, resolveAndApplyAttributionFromPendingLead, extractVstRefFromText } = require("./metaAttributionLead")

function extractMediaMime(record) {
  const m = unwrapBaileysMessage(record?.message) || record?.message || {}
  return (
    m.imageMessage?.mimetype ||
    m.videoMessage?.mimetype ||
    m.audioMessage?.mimetype ||
    m.pttMessage?.mimetype ||
    m.documentMessage?.mimetype ||
    m.stickerMessage?.mimetype ||
    null
  )
}

function extractMediaFileName(msg) {
  const local = msg?.raw?._localMedia
  if (local?.fileName) return String(local.fileName)
  const m = unwrapBaileysMessage(msg?.raw?.message) || msg?.raw?.message || {}
  const name = m.documentMessage?.fileName || m.documentMessage?.title || null
  return name ? String(name) : null
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

  const pushName = !mapped.fromMe
    ? cleanIncomingPushName(record?.pushName, remoteJid)
    : source === "import"
      ? cleanIncomingPushName(record?.pushName, remoteJid)
      : null

  const hints = extractIdentityHintsFromRecord(record, remoteJid)

  const { conversation } = await ensureContactAndConversation(prisma, userId, remoteJid, {
    pushName: pushName || (!mapped.fromMe ? hints.pushName : null),
    phone: hints.phone,
  })
  const isNewConversation = Boolean(conversation.__isNew)

  if (!mapped.fromMe) {
    const ctwaClid = extractCtwaClidFromRecord(record)
    if (ctwaClid) {
      await storeContactCtwaClid(prisma, conversation.contact, ctwaClid).catch(() => {})
    }
    if (mapped.body) {
      let contact = conversation.contact
      contact =
        (await resolveAndApplyAttributionFromMessage(prisma, {
          userId,
          contact,
          messageBody: mapped.body,
        }).catch(() => contact)) || contact

      if (isNewConversation && !extractVstRefFromText(mapped.body)) {
        contact =
          (await resolveAndApplyAttributionFromPendingLead(prisma, {
            userId,
            contact,
          }).catch(() => contact)) || contact
      }

      if (contact?.id) conversation.contact = contact
    }
  }

  const existing = await prisma.crmMessage.findUnique({
    where: { conversationId_messageId: { conversationId: conversation.id, messageId: mapped.messageId } },
  })

  const rawForWrite = existing
    ? mergeInboundMessageRaw(existing.raw, mapped.raw)
    : mapped.raw

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
      raw: rawForWrite,
      mediaMime: extractMediaMime(record) || existing?.mediaMime || null,
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

  updatedConversation = await prisma.crmConversation.findUnique({
    where: { id: conversation.id },
    include: CONVERSATION_INCLUDE,
  })

  if (isNewConversation) {
    const { logContactActivity } = require("./crmContactActivity")
    await logContactActivity(prisma, {
      userId,
      contactId: conversation.contactId,
      type: "lead_created",
      at: mapped.timestamp,
    }).catch(() => {})
  }

  return { message, conversation: updatedConversation, created, isNewConversation }
}

/** Emite eventos socket para o usuário dono da conversa e para a sala da empresa. */
function emitCrmEvent(io, userId, event, payload) {
  if (!io) return
  io.to(`user:${userId}`).emit(event, payload)
  void prisma.organizationMember
    .findUnique({ where: { userId }, select: { organizationId: true } })
    .then((member) => {
      if (member?.organizationId) {
        io.to(`org:${member.organizationId}`).emit(event, payload)
      }
    })
    .catch(() => {})
}

module.exports = {
  isIndividualJid,
  isLidJid,
  phoneFromJid,
  previewFromBody,
  isGenericSavedName,
  resolvePhoneDigits,
  contactNeedsIdentification,
  resolveContactDisplayName,
  isSelfOrGenericPushName,
  sanitizePushName,
  cleanIncomingPushName,
  extractAltPhoneFromRecord,
  extractIdentityHintsFromRecord,
  phoneFromChatItem,
  lidFallbackLabel,
  parseContactCommerceField,
  formatContactMetaFunnel,
  formatContactRow,
  formatConversationRow,
  formatMessageRow,
  normalizeMessageMediaKind,
  ensureContactAndConversation,
  ingestCrmMessage,
  emitCrmEvent,
  CONVERSATION_INCLUDE,
}

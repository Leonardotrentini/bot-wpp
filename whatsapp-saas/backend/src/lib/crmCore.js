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
  phoneLookupVariants,
} = require("./participantIdentity")

const INDIVIDUAL_JID_RE = /@(s\.whatsapp\.net|lid)$/i

function isIndividualJid(jid) {
  return INDIVIDUAL_JID_RE.test(String(jid || "").trim())
}

function isLidJid(jid) {
  return /@lid$/i.test(String(jid || "").trim())
}

/** Destino para a Evolution: telefone E.164 quando existir; senão JID @lid completo (nunca tratar LID como telefone). */
function resolveEvolutionRecipient(conversation) {
  const jid = String(conversation?.remoteJid || "").trim()
  const contact = conversation?.contact
  const phone = resolvePhoneDigits(contact) || phoneDigitsFromValue(contact?.phone)
  const phoneDigits = phone ? String(phone).replace(/\D/g, "") : ""
  if (phoneDigits.length >= 8 && phoneDigits.length <= 15) {
    return phoneDigits
  }
  const lid = contact?.lidJid && isLidJid(contact.lidJid) ? String(contact.lidJid).trim() : null
  if (isLidJid(jid)) return jid
  if (lid) return lid
  return jid
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
  const fromWa = sanitizePushName(contact.pushName, phoneDigits)
  if (fromWa) return fromWa

  if (phoneDigits) return formatPhoneBr(phoneDigits)

  return "Contato"
}

function siblingPhoneWhere(userId, contactId, phone) {
  const variants = phoneLookupVariants(phone)
  if (!variants.length) return null
  return {
    userId,
    id: { not: contactId },
    OR: [
      { phone: { in: variants } },
      { remoteJid: { in: variants.map((v) => `${v}@s.whatsapp.net`) } },
    ],
  }
}

/** Copia o nome CRM para outros JIDs do mesmo telefone (@lid e @s.whatsapp.net). */
async function propagateSavedNameToPhoneSiblings(prisma, { userId, contactId, phone, savedName }) {
  const where = siblingPhoneWhere(userId, contactId, phone)
  if (!where || isGenericSavedName(savedName)) return 0
  const siblings = await prisma.crmContact.findMany({
    where,
    select: { id: true, name: true },
  })
  const ids = siblings.filter((row) => isGenericSavedName(row.name)).map((row) => row.id)
  if (!ids.length) return 0
  const result = await prisma.crmContact.updateMany({
    where: { id: { in: ids } },
    data: { name: savedName },
  })
  return result.count
}

/** Se este JID ainda não tem nome salvo, herda de outro contato do mesmo telefone. */
async function inheritSavedNameFromPhoneSiblings(prisma, { userId, contact }) {
  if (!contact?.id || !isGenericSavedName(contact.name)) return contact
  const phone = resolvePhoneDigits(contact)
  const where = siblingPhoneWhere(userId, contact.id, phone)
  if (!where) return contact
  const siblings = await prisma.crmContact.findMany({
    where,
    select: { name: true },
    take: 8,
  })
  const inherited = siblings.find((row) => !isGenericSavedName(row.name))?.name
  if (!inherited) return contact
  return prisma.crmContact.update({
    where: { id: contact.id },
    data: { name: inherited },
  })
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
    contact: Boolean(contact.contactEventSentAt),
    purchase: Boolean(contact.purchaseEventSentAt),
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
    userId: convo.userId || null,
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

async function lookupExistingContact(prisma, { userId, jid, phone }) {
  let contact = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId, remoteJid: jid } },
  })
  if (contact) return contact

  const { findContactByLidJid, findContactByPhone } = require("./crmContactMerge")

  if (isLidJid(jid)) {
    contact = await findContactByLidJid(prisma, { userId, lidJid: jid })
    if (contact) return contact
  }

  if (phone) {
    contact = await findContactByPhone(prisma, { userId, phone })
    if (contact) return contact
  }
  return null
}

async function promoteLidContactToPhoneJid(prisma, contact, { phoneJid, phone }) {
  if (!contact || !phoneJid || !isLidJid(contact.remoteJid)) return contact
  if (contact.remoteJid === phoneJid) return contact
  const taken = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId: contact.userId, remoteJid: phoneJid } },
    select: { id: true },
  })
  if (taken && taken.id !== contact.id) return contact

  try {
    const previousLid = contact.lidJid || contact.remoteJid
    contact = await prisma.crmContact.update({
      where: { id: contact.id },
      data: {
        remoteJid: phoneJid,
        phone: phone || contact.phone,
        isLid: false,
        lidJid: previousLid,
      },
    })
    await prisma.crmConversation.updateMany({
      where: { contactId: contact.id },
      data: { remoteJid: phoneJid },
    })
  } catch (err) {
    if (err?.code !== "P2002") throw err
  }
  return contact
}

/** Garante contato + conversa para um JID individual (reusa LID↔telefone da mesma inbox). */
async function ensureContactAndConversation(prisma, userId, remoteJid, { pushName, avatarUrl, phone: phoneHint } = {}) {
  const jid = String(remoteJid).trim()
  const phone = phoneHint || phoneFromJid(jid) || phoneDigitsFromJid(jid)
  const incomingIsLid = isLidJid(jid)
  const { unifyContactSiblings } = require("./crmContactMerge")

  let contact = await lookupExistingContact(prisma, { userId, jid, phone })
  let shouldInheritName = false

  if (!contact) {
    try {
      contact = await prisma.crmContact.create({
        data: {
          userId,
          remoteJid: jid,
          lidJid: incomingIsLid ? jid : null,
          pushName: pushName || null,
          avatarUrl: avatarUrl || null,
          phone,
          isLid: incomingIsLid,
        },
      })
      shouldInheritName = true
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
    if (!contact.phone && phone) {
      data.phone = phone
      shouldInheritName = isGenericSavedName(contact.name)
    }
    if (incomingIsLid && !contact.lidJid && !isLidJid(contact.remoteJid)) {
      data.lidJid = jid
    }
    if (Object.keys(data).length) {
      contact = await prisma.crmContact.update({
        where: { id: contact.id },
        data,
      })
    }
  }

  if (!incomingIsLid && phone && isLidJid(contact.remoteJid)) {
    contact = await promoteLidContactToPhoneJid(prisma, contact, {
      phoneJid: `${phone}@s.whatsapp.net`,
      phone,
    })
  }

  if (shouldInheritName) {
    contact = await inheritSavedNameFromPhoneSiblings(prisma, { userId, contact })
  }

  const unification = await unifyContactSiblings(prisma, { userId, contactId: contact.id }).catch((err) => {
    console.warn("[crm] unifyContactSiblings:", err?.message || err)
    return null
  })
  if (unification?.contact) contact = unification.contact

  let conversation = await prisma.crmConversation.findUnique({
    where: { contactId: contact.id },
    include: CONVERSATION_INCLUDE,
  })
  if (!conversation) {
    conversation = await prisma.crmConversation.findUnique({
      where: { userId_remoteJid: { userId, remoteJid: contact.remoteJid } },
      include: CONVERSATION_INCLUDE,
    })
  }
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
          remoteJid: contact.remoteJid,
          kanbanStageId: defaultStage?.id || null,
        },
        include: CONVERSATION_INCLUDE,
      })
      conversation.__isNew = true
    } catch (err) {
      if (err?.code !== "P2002") throw err
      conversation = await prisma.crmConversation.findUnique({
        where: { userId_remoteJid: { userId, remoteJid: contact.remoteJid } },
        include: CONVERSATION_INCLUDE,
      })
      if (!conversation) {
        conversation = await prisma.crmConversation.findUnique({
          where: { contactId: contact.id },
          include: CONVERSATION_INCLUDE,
        })
      }
      if (!conversation) throw err
    }
  }

  return { contact, conversation, unification }
}

const { unwrapBaileysMessage, mergeInboundMessageRaw } = require("./crmMedia")
const { extractCtwaClidFromRecord, storeContactCtwaClid } = require("./metaMessaging")
const {
  resolveAndApplyAttributionFromMessage,
  resolveAndApplyAttributionFromPendingLead,
  extractVstRefFromText,
} = require("./metaAttributionLead")

function maybeTrackContactAfterAttribution(prisma, userId, contactBefore, contactAfter) {
  if (!contactAfter?.id) return
  if (!contactHasLpAttribution(contactAfter) || contactAfter.contactEventSentAt) return
  // Lazy require evita ciclo crmCore ↔ metaConversions
  const { trackContactEvent } = require("./metaConversions")
  trackContactEvent(prisma, { userId, contact: contactAfter }).catch((err) => {
    console.error("[trackContactEvent]", err?.message || err)
  })
}

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

  const { conversation, unification } = await ensureContactAndConversation(prisma, userId, remoteJid, {
    pushName: pushName || (!mapped.fromMe ? hints.pushName : null),
    phone: hints.phone,
  })
  const { emitUnificationEvents, unifyContactSiblings } = require("./crmContactMerge")
  emitUnificationEvents(emitCrmEvent, deps.io, userId, unification)
  const isNewConversation = Boolean(conversation.__isNew)

  if (!mapped.fromMe) {
    const ctwaClid = extractCtwaClidFromRecord(record)
    if (ctwaClid) {
      const withCtwa = await storeContactCtwaClid(prisma, conversation.contact, ctwaClid).catch(() => null)
      if (withCtwa) conversation.contact = withCtwa
    }
    if (mapped.body) {
      let contact = conversation.contact
      const contactBefore = contact
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
            eventAt: mapped.timestamp,
          }).catch(() => contact)) || contact
      }

      if (contact?.id) {
        conversation.contact = contact
        maybeTrackContactAfterAttribution(prisma, userId, contactBefore, contact)
      }
    }
  }

  const existing = await prisma.crmMessage.findUnique({
    where: { conversationId_messageId: { conversationId: conversation.id, messageId: mapped.messageId } },
  })

  const rawForWrite = existing
    ? mergeInboundMessageRaw(existing.raw, mapped.raw)
    : mapped.raw

  let message = await prisma.crmMessage.upsert({
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
  let created = !existing

  const convData = {}
  if (!conversation.lastMessageAt || mapped.timestamp >= conversation.lastMessageAt) {
    convData.lastMessageAt = mapped.timestamp
    convData.lastMessagePreview = previewFromBody(mapped.body, mapped.type)
    convData.lastMessageFromMe = mapped.fromMe
  }
  if (created && source !== "import") {
    if (!mapped.fromMe && updateUnread) convData.unreadCount = { increment: 1 }
    // resposta do contato reabre conversa resolvida ou arquivada
    if (!mapped.fromMe && ["resolved", "archived"].includes(conversation.status)) convData.status = "open"
    // Lead respondeu → zera âncora do no_reply (só volta a contar após envio humano).
    if (!mapped.fromMe) convData.noReplySinceAt = null
    // Outbound humano (WhatsApp/app): reinicia timer. flow/ai/import não passam aqui.
    if (mapped.fromMe && !["flow", "ai"].includes(String(source))) {
      convData.noReplySinceAt = mapped.timestamp
    }
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

  let lateUnify = null
  if (updatedConversation?.contact && isLidJid(updatedConversation.remoteJid || remoteJid)) {
    lateUnify = await unifyContactSiblings(prisma, {
      userId,
      contactId: updatedConversation.contact.id,
    }).catch(() => null)
    emitUnificationEvents(emitCrmEvent, deps.io, userId, lateUnify)
    if (lateUnify?.merged && lateUnify.conversationId) {
      const kept = await prisma.crmConversation.findUnique({
        where: { id: lateUnify.conversationId },
        include: CONVERSATION_INCLUDE,
      })
      if (kept) updatedConversation = kept
      const keptMsg = await prisma.crmMessage.findUnique({
        where: {
          conversationId_messageId: {
            conversationId: lateUnify.conversationId,
            messageId: mapped.messageId,
          },
        },
      })
      if (keptMsg) {
        if (keptMsg.id !== message.id) created = false
        message = keptMsg
      }
    }
  }

  if (isNewConversation && !lateUnify?.merged) {
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

/**
 * Emite eventos CRM para o dono da inbox (`user:`) e, se houver org,
 * para a sala `org:` (somente OWNER entra nela — vendedores não recebem inbox alheia).
 */
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

const CRM_MSG_STATUS_RANK = { failed: 0, sent: 1, delivered: 2, read: 3 }

/** Mapeia ACK do webhook Evolution → status do CrmMessage. */
function mapEvolutionAckToCrmStatus(statusRaw) {
  const s = String(statusRaw || "").toUpperCase()
  if (s.includes("READ") || s === "4") return "read"
  if (s.includes("DELIVERY") || s === "3") return "delivered"
  if (s.includes("ERROR") || s.includes("FAIL")) return "failed"
  if (s.includes("SERVER") || s === "2") return "sent"
  return null
}

/** Atualiza status de entrega de CrmMessage e emite evento em tempo real. */
async function applyCrmMessageAck(prisma, io, { userId, providerMessageId, ackStatus }) {
  const nextStatus = mapEvolutionAckToCrmStatus(ackStatus)
  if (!nextStatus || !providerMessageId) return null

  const row = await prisma.crmMessage.findFirst({
    where: { userId, messageId: providerMessageId, fromMe: true },
  })
  if (!row) return null

  const current = String(row.status || "sent")
  const curRank = CRM_MSG_STATUS_RANK[current] ?? 1
  const nextRank = CRM_MSG_STATUS_RANK[nextStatus] ?? 1
  if (nextStatus !== "failed" && nextRank <= curRank) return null

  const updated = await prisma.crmMessage.update({
    where: { id: row.id },
    data: { status: nextStatus },
  })

  emitCrmEvent(io, userId, "crm:message_status", {
    conversationId: updated.conversationId,
    messageId: updated.messageId,
    status: nextStatus,
    message: formatMessageRow(updated),
  })
  return updated
}

module.exports = {
  isIndividualJid,
  isLidJid,
  resolveEvolutionRecipient,
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
  applyCrmMessageAck,
  mapEvolutionAckToCrmStatus,
  propagateSavedNameToPhoneSiblings,
  CONVERSATION_INCLUDE,
}

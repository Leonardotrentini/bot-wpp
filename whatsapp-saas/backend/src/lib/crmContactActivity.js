/**
 * Timeline de atividades do lead (histórico, orçamento, compra).
 */

const { formatContactRow, formatConversationRow, emitCrmEvent, CONVERSATION_INCLUDE } = require("./crmCore")
const { trackCrmQuoteEvent, trackCrmPurchaseEvent } = require("./metaConversions")

const QUOTE_TAG_NAME = "Orçamento"
const LEGACY_QUOTE_TAG_PREFIX = "Orçamento "
const PURCHASE_TAG_NAME = "Comprou"
const PURCHASE_STAGE_PATTERN = /fechado|ganho|vendido/i

function formatBrl(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "R$ 0,00"
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

function isQuoteTagName(name) {
  const n = String(name || "")
  return n === QUOTE_TAG_NAME || n.startsWith(LEGACY_QUOTE_TAG_PREFIX)
}

function parseCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

function activityLabel(type, payload = {}) {
  switch (type) {
    case "lead_created":
      return "Lead entrou no CRM"
    case "stage_changed":
      return payload.stageName ? `Movido para ${payload.stageName}` : "Estágio alterado"
    case "tag_added":
      return payload.tagName ? `Tag adicionada: ${payload.tagName}` : "Tag adicionada"
    case "tag_removed":
      return payload.tagName ? `Tag removida: ${payload.tagName}` : "Tag removida"
    case "quote_saved":
      return payload.amount != null ? `Orçamento salvo: ${formatBrl(payload.amount)}` : "Orçamento salvo"
    case "purchase_confirmed":
      return payload.amount != null ? `Compra confirmada: ${formatBrl(payload.amount)}` : "Compra confirmada"
    case "contact_named":
      return payload.name ? `Contato salvo como ${payload.name}` : "Nome do contato atualizado"
    case "notes_updated":
      return "Notas internas atualizadas"
    case "reminder_set":
      return payload.label ? `Lembrete agendado: ${payload.label}` : "Lembrete agendado"
    case "reminder_cancelled":
      return payload.label ? `Lembrete cancelado: ${payload.label}` : "Lembrete cancelado"
    case "reminder_triggered":
      return payload.label ? `Lembrete disparado: ${payload.label}` : "Lembrete disparado"
    default:
      return type
  }
}

function formatActivityRow(row) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}
  return {
    id: row.id,
    type: row.type,
    label: activityLabel(row.type, payload),
    payload,
    at: row.createdAt.toISOString(),
  }
}

async function logContactActivity(prisma, { userId, contactId, type, payload = {}, at }) {
  return prisma.crmContactActivity.create({
    data: {
      userId,
      contactId,
      type,
      payload,
      ...(at ? { createdAt: new Date(at) } : {}),
    },
  })
}

async function ensureTag(prisma, userId, name, color = "#fbbf24") {
  let tag = await prisma.crmTag.findFirst({ where: { userId, name } })
  if (!tag) {
    tag = await prisma.crmTag.create({ data: { userId, name, color } })
  }
  return tag
}

async function removeContactTagsByPrefix(prisma, contactId, prefix) {
  const links = await prisma.crmContactTag.findMany({
    where: { contactId, tag: { name: { startsWith: prefix } } },
    include: { tag: true },
  })
  if (!links.length) return []
  await prisma.crmContactTag.deleteMany({ where: { id: { in: links.map((l) => l.id) } } })
  return links.map((l) => l.tag)
}

async function addContactTagLink(prisma, contactId, tagId) {
  const existing = await prisma.crmContactTag.findUnique({
    where: { contactId_tagId: { contactId, tagId } },
  })
  if (existing) return { created: false, link: existing }
  const link = await prisma.crmContactTag.create({
    data: { contactId, tagId },
  })
  return { created: true, link }
}

function fireTagAddedFlows(prisma, io, { userId, contactId, tagId }) {
  if (!prisma || !io || !userId || !contactId || !tagId) return
  // lazy require evita ciclo com crmFlows
  const { notifyTagAddedForContact } = require("./crmFlows")
  const { sendText } = require("./evolution")
  notifyTagAddedForContact({ prisma, io, sendText }, { userId, contactId, tagId }).catch((err) =>
    console.error("[crm-flow] tag_added:", err?.message || err),
  )
}

async function findPurchaseStage(prisma, userId) {
  const stages = await prisma.crmKanbanStage.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } })
  return stages.find((s) => PURCHASE_STAGE_PATTERN.test(s.name)) || null
}

async function backfillContactActivity(prisma, userId, contactId) {
  const existing = await prisma.crmContactActivity.count({ where: { contactId } })
  if (existing > 0) return

  const contact = await prisma.crmContact.findFirst({
    where: { id: contactId, userId },
    include: {
      tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
      conversation: true,
    },
  })
  if (!contact) return

  const rows = []

  rows.push({
    userId,
    contactId,
    type: "lead_created",
    payload: {},
    createdAt: contact.createdAt,
  })

  const convo = contact.conversation
  if (convo?.kanbanStageId) {
    const stage = await prisma.crmKanbanStage.findUnique({ where: { id: convo.kanbanStageId } })
    rows.push({
      userId,
      contactId,
      type: "stage_changed",
      payload: { stageId: stage?.id || convo.kanbanStageId, stageName: stage?.name || null },
      createdAt: convo.createdAt,
    })
  }

  for (const link of contact.tags || []) {
    if (isQuoteTagName(link.tag?.name) || link.tag?.name === PURCHASE_TAG_NAME) continue
    rows.push({
      userId,
      contactId,
      type: "tag_added",
      payload: { tagId: link.tagId, tagName: link.tag?.name || null },
      createdAt: link.createdAt,
    })
  }

  const custom = parseCustomFields(contact.customFields)
  if (custom.quote?.amount != null) {
    rows.push({
      userId,
      contactId,
      type: "quote_saved",
      payload: { amount: custom.quote.amount, tagName: custom.quote.tagName || null },
      createdAt: custom.quote.savedAt ? new Date(custom.quote.savedAt) : contact.updatedAt,
    })
  }
  if (custom.purchase?.amount != null) {
    rows.push({
      userId,
      contactId,
      type: "purchase_confirmed",
      payload: {
        amount: custom.purchase.amount,
        ticket: custom.purchase.ticket || null,
      },
      createdAt: custom.purchase.confirmedAt ? new Date(custom.purchase.confirmedAt) : contact.updatedAt,
    })
  }

  if (rows.length) {
    await prisma.crmContactActivity.createMany({ data: rows })
  }
}

async function getContactActivityTimeline(prisma, userId, contactId) {
  await normalizeContactQuoteTags(prisma, userId, contactId)
  await backfillContactActivity(prisma, userId, contactId)
  const rows = await prisma.crmContactActivity.findMany({
    where: { contactId, userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  return rows.map(formatActivityRow)
}

async function deleteContactActivity(prisma, userId, contactId, activityId) {
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, userId } })
  if (!contact) return { error: "NOT_FOUND" }

  const activity = await prisma.crmContactActivity.findFirst({
    where: { id: activityId, contactId, userId },
  })
  if (!activity) return { error: "NOT_FOUND", message: "Etapa não encontrada." }

  await prisma.crmContactActivity.delete({ where: { id: activityId } })

  const custom = parseCustomFields(contact.customFields)
  let customChanged = false

  if (activity.type === "purchase_confirmed") {
    const remaining = await prisma.crmContactActivity.findFirst({
      where: { contactId, userId, type: "purchase_confirmed" },
      orderBy: { createdAt: "desc" },
    })
    if (remaining) {
      const payload =
        remaining.payload && typeof remaining.payload === "object" && !Array.isArray(remaining.payload)
          ? remaining.payload
          : {}
      custom.purchase = {
        amount: Number(payload.amount) || custom.purchase?.amount,
        currency: "BRL",
        ticket: payload.ticket ? String(payload.ticket) : null,
        confirmedAt: remaining.createdAt.toISOString(),
      }
    } else {
      delete custom.purchase
    }
    customChanged = true
  }

  if (activity.type === "quote_saved") {
    const remaining = await prisma.crmContactActivity.findFirst({
      where: { contactId, userId, type: "quote_saved" },
      orderBy: { createdAt: "desc" },
    })
    if (remaining) {
      const payload =
        remaining.payload && typeof remaining.payload === "object" && !Array.isArray(remaining.payload)
          ? remaining.payload
          : {}
      custom.quote = {
        amount: Number(payload.amount) || custom.quote?.amount,
        currency: "BRL",
        savedAt: remaining.createdAt.toISOString(),
        tagName: QUOTE_TAG_NAME,
      }
    } else {
      delete custom.quote
    }
    customChanged = true
  }

  let contactRow = contact
  if (customChanged) {
    contactRow = await prisma.crmContact.update({
      where: { id: contact.id },
      data: { customFields: custom },
      include: { tags: { include: { tag: true } } },
    })
  } else {
    contactRow = await reloadContact(prisma, contact.id)
  }

  return { ok: true, contact: formatContactRow(contactRow) }
}

async function updateContactActivity(
  prisma,
  io,
  { userId, contactId, activityId, amount, ticket, at, actorUserId, actorName },
) {
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, userId } })
  if (!contact) return { error: "NOT_FOUND" }

  const activity = await prisma.crmContactActivity.findFirst({
    where: { id: activityId, contactId, userId },
  })
  if (!activity) return { error: "NOT_FOUND", message: "Etapa não encontrada." }
  if (!["purchase_confirmed", "quote_saved"].includes(activity.type)) {
    return { error: "INVALID_TYPE", message: "Só é possível editar orçamento ou compra." }
  }

  const prevPayload =
    activity.payload && typeof activity.payload === "object" && !Array.isArray(activity.payload)
      ? { ...activity.payload }
      : {}

  const nextPayload = { ...prevPayload }
  if (amount != null) {
    const value = Math.round(Number(amount) * 100) / 100
    if (!Number.isFinite(value) || value <= 0) return { error: "INVALID_AMOUNT" }
    nextPayload.amount = value
  }
  if (activity.type === "purchase_confirmed" && ticket !== undefined) {
    nextPayload.ticket = ticket ? String(ticket).trim() : null
  }
  if (actorUserId && !nextPayload.actorUserId) {
    nextPayload.actorUserId = actorUserId
    if (actorName) nextPayload.actorName = actorName
  }

  const data = { payload: nextPayload }
  if (at) {
    const when = new Date(at)
    if (Number.isNaN(when.getTime())) return { error: "INVALID_DATE" }
    data.createdAt = when
  }

  const updatedActivity = await prisma.crmContactActivity.update({
    where: { id: activity.id },
    data,
  })

  const latestSameType = await prisma.crmContactActivity.findFirst({
    where: { contactId, userId, type: activity.type },
    orderBy: { createdAt: "desc" },
  })

  const custom = parseCustomFields(contact.customFields)
  if (latestSameType?.id === updatedActivity.id) {
    if (activity.type === "purchase_confirmed") {
      custom.purchase = {
        amount: nextPayload.amount,
        currency: "BRL",
        ticket: nextPayload.ticket || null,
        confirmedAt: updatedActivity.createdAt.toISOString(),
      }
    } else {
      custom.quote = {
        amount: nextPayload.amount,
        currency: "BRL",
        savedAt: updatedActivity.createdAt.toISOString(),
        tagName: QUOTE_TAG_NAME,
      }
    }
    await prisma.crmContact.update({
      where: { id: contact.id },
      data: { customFields: custom },
    })
  }

  const contactRow = await reloadContact(prisma, contact.id)
  await emitContactConversation(prisma, io, userId, contact.id)

  return {
    activity: formatActivityRow(updatedActivity),
    contact: formatContactRow(contactRow),
  }
}

async function reloadContact(prisma, contactId) {
  return prisma.crmContact.findUnique({
    where: { id: contactId },
    include: { tags: { include: { tag: true } } },
  })
}

async function emitContactConversation(prisma, io, userId, contactId) {
  const conversation = await prisma.crmConversation.findFirst({
    where: { contactId, userId },
    include: CONVERSATION_INCLUDE,
  })
  if (conversation) {
    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
  }
  return conversation
}

async function normalizeContactQuoteTags(prisma, userId, contactId) {
  const contact = await prisma.crmContact.findFirst({
    where: { id: contactId, userId },
    include: { tags: { include: { tag: true } } },
  })
  if (!contact) return { normalized: false, contact: null }

  const quoteTagLinks = (contact.tags || []).filter((link) => isQuoteTagName(link.tag?.name))
  const custom = parseCustomFields(contact.customFields)
  const hasQuote = custom.quote?.amount != null

  const needsCleanup =
    quoteTagLinks.length > 1 ||
    quoteTagLinks.some((link) => link.tag?.name !== QUOTE_TAG_NAME) ||
    (hasQuote && quoteTagLinks.length === 0)

  if (!needsCleanup) return { normalized: false, contact }

  await removeContactTagsByPrefix(prisma, contact.id, QUOTE_TAG_NAME)

  if (hasQuote) {
    const tag = await ensureTag(prisma, userId, QUOTE_TAG_NAME, "#fbbf24")
    await addContactTagLink(prisma, contact.id, tag.id)
    custom.quote.tagName = QUOTE_TAG_NAME
    custom.quote.tagId = tag.id
    const updated = await prisma.crmContact.update({
      where: { id: contact.id },
      data: { customFields: custom },
      include: { tags: { include: { tag: true } } },
    })
    return { normalized: true, contact: updated }
  }

  const updated = await reloadContact(prisma, contact.id)
  return { normalized: true, contact: updated }
}

async function saveContactQuote(prisma, io, { userId, contactId, amount, actorUserId, actorName }) {
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, userId } })
  if (!contact) return { error: "NOT_FOUND" }

  const value = Math.round(Number(amount) * 100) / 100
  if (!Number.isFinite(value) || value <= 0) return { error: "INVALID_AMOUNT" }

  await removeContactTagsByPrefix(prisma, contact.id, QUOTE_TAG_NAME)

  const tag = await ensureTag(prisma, userId, QUOTE_TAG_NAME, "#fbbf24")
  const tagLink = await addContactTagLink(prisma, contact.id, tag.id)
  if (tagLink.created) {
    fireTagAddedFlows(prisma, io, { userId, contactId: contact.id, tagId: tag.id })
  }

  const custom = parseCustomFields(contact.customFields)
  const savedAt = new Date().toISOString()
  custom.quote = { amount: value, currency: "BRL", savedAt, tagId: tag.id, tagName: QUOTE_TAG_NAME }

  const updated = await prisma.crmContact.update({
    where: { id: contact.id },
    data: { customFields: custom },
    include: { tags: { include: { tag: true } } },
  })

  const quotePayload = {
    amount: value,
    tagName: QUOTE_TAG_NAME,
    ...(actorUserId ? { actorUserId, actorName: actorName || null } : {}),
  }

  const existingQuote = await prisma.crmContactActivity.findFirst({
    where: { contactId: contact.id, userId, type: "quote_saved" },
    orderBy: { createdAt: "desc" },
  })
  if (existingQuote) {
    const prev =
      existingQuote.payload && typeof existingQuote.payload === "object" && !Array.isArray(existingQuote.payload)
        ? existingQuote.payload
        : {}
    await prisma.crmContactActivity.update({
      where: { id: existingQuote.id },
      data: { payload: { ...prev, ...quotePayload } },
    })
  } else {
    await logContactActivity(prisma, {
      userId,
      contactId: contact.id,
      type: "quote_saved",
      payload: quotePayload,
    })
  }

  await emitContactConversation(prisma, io, userId, contact.id)
  const tracking = await trackCrmQuoteEvent(prisma, { userId, contact: updated, amount: value })
  return { contact: formatContactRow(updated), tracking }
}

async function confirmContactPurchase(
  prisma,
  io,
  { userId, contactId, amount, ticket, moveToClosed = true, actorUserId, actorName },
) {
  const contact = await prisma.crmContact.findFirst({
    where: { id: contactId, userId },
    include: { conversation: true },
  })
  if (!contact) return { error: "NOT_FOUND" }

  const value = Math.round(Number(amount) * 100) / 100
  if (!Number.isFinite(value) || value <= 0) return { error: "INVALID_AMOUNT" }

  const tag = await ensureTag(prisma, userId, PURCHASE_TAG_NAME, "#34d399")
  const tagLink = await addContactTagLink(prisma, contact.id, tag.id)
  if (tagLink.created) {
    fireTagAddedFlows(prisma, io, { userId, contactId: contact.id, tagId: tag.id })
  }

  const custom = parseCustomFields(contact.customFields)
  const confirmedAt = new Date().toISOString()
  const ticketValue = ticket ? String(ticket).trim() : null
  custom.purchase = {
    amount: value,
    currency: "BRL",
    ticket: ticketValue,
    confirmedAt,
  }

  await prisma.crmContact.update({
    where: { id: contact.id },
    data: { customFields: custom },
  })

  let conversation = contact.conversation
  if (moveToClosed && conversation) {
    const stage = await findPurchaseStage(prisma, userId)
    if (stage && conversation.kanbanStageId !== stage.id) {
      conversation = await prisma.crmConversation.update({
        where: { id: conversation.id },
        data: { kanbanStageId: stage.id },
        include: CONVERSATION_INCLUDE,
      })
      await logContactActivity(prisma, {
        userId,
        contactId: contact.id,
        type: "stage_changed",
        payload: { stageId: stage.id, stageName: stage.name, source: "purchase" },
      })
    }
  }

  const purchasePayload = {
    amount: value,
    ticket: ticketValue,
    actorUserId: actorUserId || userId,
    actorName: actorName || null,
  }

  // Sempre cria um novo registro de venda (mesmo lead pode ter várias compras).
  await logContactActivity(prisma, {
    userId,
    contactId: contact.id,
    type: "purchase_confirmed",
    payload: purchasePayload,
  })

  const updated = await reloadContact(prisma, contact.id)
  if (conversation) {
    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
  } else {
    await emitContactConversation(prisma, io, userId, contact.id)
  }

  const tracking = await trackCrmPurchaseEvent(prisma, {
    userId,
    contact: updated,
    amount: value,
    ticket: ticketValue,
  })

  return {
    contact: formatContactRow(updated),
    conversation: conversation ? formatConversationRow(conversation) : null,
    tracking,
  }
}

module.exports = {
  QUOTE_TAG_NAME,
  LEGACY_QUOTE_TAG_PREFIX,
  PURCHASE_TAG_NAME,
  formatBrl,
  logContactActivity,
  getContactActivityTimeline,
  deleteContactActivity,
  updateContactActivity,
  normalizeContactQuoteTags,
  saveContactQuote,
  confirmContactPurchase,
  activityLabel,
}

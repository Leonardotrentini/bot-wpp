/**
 * Lembretes agendados por contato/lead.
 */

const { formatContactRow, formatConversationRow, emitCrmEvent, CONVERSATION_INCLUDE, resolveContactDisplayName } = require("./crmCore")
const { logContactActivity } = require("./crmContactActivity")

function formatReminderRow(row) {
  if (!row) return null
  return {
    id: row.id,
    note: row.note || "",
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}

function formatReminderLabel(scheduledAt) {
  return new Date(scheduledAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

async function loadPendingReminders(prisma, contactId) {
  return prisma.crmContactReminder.findMany({
    where: { contactId, status: "pending" },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  })
}

async function reloadContactWithReminders(prisma, contactId) {
  const contact = await prisma.crmContact.findUnique({
    where: { id: contactId },
    include: {
      tags: { include: { tag: true } },
      reminders: {
        where: { status: "pending" },
        orderBy: { scheduledAt: "asc" },
        take: 20,
      },
    },
  })
  return contact
}

async function emitContactConversation(prisma, io, userId, contactId) {
  const conversation = await prisma.crmConversation.findFirst({
    where: { contactId, userId },
    include: CONVERSATION_INCLUDE,
  })
  if (conversation) {
    const full = await reloadContactWithReminders(prisma, contactId)
    if (full) {
      conversation.contact = full
    }
    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
  }
  return conversation
}

async function listContactReminders(prisma, userId, contactId) {
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, userId } })
  if (!contact) return { error: "NOT_FOUND" }
  const rows = await loadPendingReminders(prisma, contact.id)
  return { reminders: rows.map(formatReminderRow) }
}

async function createContactReminder(prisma, io, { userId, contactId, scheduledAt, note }) {
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, userId } })
  if (!contact) return { error: "NOT_FOUND" }

  const when = new Date(scheduledAt)
  if (Number.isNaN(when.getTime())) return { error: "INVALID_DATE" }
  if (when.getTime() < Date.now() - 60_000) {
    return { error: "PAST_DATE", message: "O lembrete precisa ser no futuro." }
  }

  const trimmedNote = note ? String(note).trim().slice(0, 500) : null

  const reminder = await prisma.crmContactReminder.create({
    data: {
      userId,
      contactId: contact.id,
      note: trimmedNote,
      scheduledAt: when,
      status: "pending",
    },
  })

  await logContactActivity(prisma, {
    userId,
    contactId: contact.id,
    type: "reminder_set",
    payload: {
      reminderId: reminder.id,
      scheduledAt: reminder.scheduledAt.toISOString(),
      note: trimmedNote,
      label: formatReminderLabel(reminder.scheduledAt),
    },
  })

  const updated = await reloadContactWithReminders(prisma, contact.id)
  await emitContactConversation(prisma, io, userId, contact.id)

  return {
    reminder: formatReminderRow(reminder),
    contact: formatContactRow(updated),
  }
}

async function cancelContactReminder(prisma, io, { userId, contactId, reminderId }) {
  const reminder = await prisma.crmContactReminder.findFirst({
    where: { id: reminderId, contactId, userId, status: "pending" },
  })
  if (!reminder) return { error: "NOT_FOUND" }

  await prisma.crmContactReminder.update({
    where: { id: reminder.id },
    data: { status: "cancelled" },
  })

  await logContactActivity(prisma, {
    userId,
    contactId,
    type: "reminder_cancelled",
    payload: {
      reminderId: reminder.id,
      scheduledAt: reminder.scheduledAt.toISOString(),
      label: formatReminderLabel(reminder.scheduledAt),
    },
  })

  const updated = await reloadContactWithReminders(prisma, contactId)
  await emitContactConversation(prisma, io, userId, contactId)

  return { contact: formatContactRow(updated) }
}

function formatReminderAlert(row, contact, conversationId) {
  const contactName = contact ? resolveContactDisplayName(contact) : "Contato"
  return {
    id: row.id,
    reminderId: row.id,
    userId: row.userId || null,
    contactId: row.contactId,
    conversationId: conversationId || null,
    contactName,
    note: row.note || "",
    scheduledAt: row.scheduledAt.toISOString(),
    triggeredAt: row.triggeredAt ? row.triggeredAt.toISOString() : new Date().toISOString(),
  }
}

async function resolveConversationId(prisma, userId, contactId) {
  const conversation = await prisma.crmConversation.findFirst({
    where: { userId, contactId },
    select: { id: true },
  })
  return conversation?.id || null
}

async function processDueContactReminders(prisma, io) {
  if (!prisma) return 0
  const now = new Date()
  const due = await prisma.crmContactReminder.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
    include: { contact: true },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  })
  if (!due.length) return 0

  let fired = 0
  for (const row of due) {
    const updated = await prisma.crmContactReminder.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "done", triggeredAt: now },
    })
    if (!updated.count) continue

    fired += 1
    const conversationId = await resolveConversationId(prisma, row.userId, row.contactId)
    const alert = formatReminderAlert({ ...row, triggeredAt: now }, row.contact, conversationId)

    await logContactActivity(prisma, {
      userId: row.userId,
      contactId: row.contactId,
      type: "reminder_triggered",
      payload: {
        reminderId: row.id,
        scheduledAt: row.scheduledAt.toISOString(),
        note: row.note || null,
        label: formatReminderLabel(row.scheduledAt),
      },
    }).catch((err) => console.error("[crm-reminder] activity:", err?.message || err))

    emitCrmEvent(io, row.userId, "crm:reminder_due", { alert })
    await emitContactConversation(prisma, io, row.userId, row.contactId)
  }

  return fired
}

async function listReminderAlerts(prisma, userId) {
  const rows = await prisma.crmContactReminder.findMany({
    where: {
      userId,
      status: "done",
      dismissedAt: null,
      triggeredAt: { not: null },
    },
    include: { contact: true },
    orderBy: { triggeredAt: "desc" },
    take: 50,
  })

  const alerts = []
  for (const row of rows) {
    const conversationId = await resolveConversationId(prisma, userId, row.contactId)
    alerts.push(formatReminderAlert(row, row.contact, conversationId))
  }
  return alerts
}

async function dismissReminderAlert(prisma, userId, reminderId) {
  const reminder = await prisma.crmContactReminder.findFirst({
    where: { id: reminderId, userId, status: "done", dismissedAt: null },
  })
  if (!reminder) return { error: "NOT_FOUND" }

  await prisma.crmContactReminder.update({
    where: { id: reminder.id },
    data: { dismissedAt: new Date() },
  })

  return { ok: true }
}

module.exports = {
  formatReminderRow,
  formatReminderLabel,
  formatReminderAlert,
  listContactReminders,
  createContactReminder,
  cancelContactReminder,
  loadPendingReminders,
  processDueContactReminders,
  listReminderAlerts,
  dismissReminderAlert,
}

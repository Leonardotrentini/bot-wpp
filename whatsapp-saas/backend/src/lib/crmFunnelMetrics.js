/**
 * Agregações CRM para relatórios (funil, atividades, conversões, vendas).
 */

const { prisma } = require("./prisma")
const { dayKeyInSp } = require("./messageMetrics")

const FUNNEL_ACTIVITY_TYPES = ["lead_created", "quote_saved", "purchase_confirmed", "stage_changed"]

function parsePayloadAmount(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const amount = Number(payload.amount)
  return Number.isFinite(amount) ? amount : null
}

async function buildCrmConversationsStarted(userId, start, end) {
  /** Primeira mensagem recebida do lead define quando a conversa começou (ignora data do sync). */
  const rows = await prisma.crmMessage.groupBy({
    by: ["conversationId"],
    where: { userId, fromMe: false },
    _min: { timestamp: true },
  })

  let count = 0
  for (const row of rows) {
    const firstAt = row._min?.timestamp
    if (firstAt && firstAt >= start && firstAt <= end) count += 1
  }
  return count
}

async function buildCrmOverview(userId, start, end) {
  const [open, pending, resolved, unread, contacts, conversationsStarted] = await Promise.all([
    prisma.crmConversation.count({ where: { userId, status: "open" } }),
    prisma.crmConversation.count({ where: { userId, status: "pending" } }),
    prisma.crmConversation.count({ where: { userId, status: "resolved" } }),
    prisma.crmConversation.count({ where: { userId, unreadCount: { gt: 0 } } }),
    prisma.crmContact.count({ where: { userId } }),
    buildCrmConversationsStarted(userId, start, end),
  ])
  return { open, pending, resolved, unread, contacts, conversationsStarted }
}

async function buildCrmFunnelByStage(userId) {
  const stages = await prisma.crmKanbanStage.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, color: true, sortOrder: true },
  })
  if (!stages.length) return []

  const counts = await prisma.crmConversation.groupBy({
    by: ["kanbanStageId"],
    where: { userId },
    _count: { id: true },
  })
  const countMap = new Map(counts.map((c) => [c.kanbanStageId, c._count.id]))

  return stages.map((s) => ({
    stageId: s.id,
    stageName: s.name,
    color: s.color || "#22c55e",
    count: countMap.get(s.id) || 0,
  }))
}

async function buildCrmActivitySeries(userId, start, end) {
  const rows = await prisma.crmContactActivity.findMany({
    where: {
      userId,
      type: { in: FUNNEL_ACTIVITY_TYPES },
      createdAt: { gte: start, lte: end },
    },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

  const byDay = new Map()
  for (const row of rows) {
    const date = dayKeyInSp(row.createdAt)
    if (!byDay.has(date)) {
      byDay.set(date, {
        date,
        lead_created: 0,
        quote_saved: 0,
        purchase_confirmed: 0,
        stage_changed: 0,
      })
    }
    const bucket = byDay.get(date)
    if (Object.prototype.hasOwnProperty.call(bucket, row.type)) {
      bucket[row.type] += 1
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function buildCrmConversionCounts(userId, start, end) {
  const range = { gte: start, lte: end }
  const [conversationStarted, leadQualified, quote, purchase, metaConversationStarted] = await Promise.all([
    buildCrmConversationsStarted(userId, start, end),
    prisma.crmContact.count({
      where: { userId, qualifiedEventSentAt: range },
    }),
    prisma.crmContact.count({
      where: { userId, quoteEventSentAt: range },
    }),
    prisma.crmContactActivity.count({
      where: { userId, type: "purchase_confirmed", createdAt: range },
    }),
    prisma.crmContact.count({
      where: { userId, conversationStartedEventSentAt: range },
    }),
  ])

  return { conversationStarted, leadQualified, quote, purchase, metaConversationStarted }
}

async function buildCrmSalesByDay(userId, start, end) {
  const rows = await prisma.crmContactActivity.findMany({
    where: {
      userId,
      type: "purchase_confirmed",
      createdAt: { gte: start, lte: end },
    },
    select: { createdAt: true, payload: true },
    orderBy: { createdAt: "asc" },
  })

  const byDay = new Map()
  for (const row of rows) {
    const date = dayKeyInSp(row.createdAt)
    if (!byDay.has(date)) {
      byDay.set(date, { date, count: 0, amount: 0 })
    }
    const bucket = byDay.get(date)
    bucket.count += 1
    const amount = parsePayloadAmount(row.payload)
    if (amount != null) bucket.amount += amount
  }

  return [...byDay.values()]
    .map((d) => ({ ...d, amount: Math.round(d.amount * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

module.exports = {
  buildCrmConversationsStarted,
  buildCrmOverview,
  buildCrmFunnelByStage,
  buildCrmActivitySeries,
  buildCrmConversionCounts,
  buildCrmSalesByDay,
}

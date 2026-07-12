/**
 * Agregações CRM para relatórios (funil, atividades, conversões, vendas).
 */

const { prisma } = require("./prisma")
const { dayKeyInSp } = require("./messageMetrics")
const { readUserFilter } = require("./orgScope")

const FUNNEL_ACTIVITY_TYPES = ["lead_created", "quote_saved", "purchase_confirmed", "stage_changed"]

function uFilter(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  return readUserFilter({ userIds: ids })
}

function parsePayloadAmount(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const amount = Number(payload.amount)
  return Number.isFinite(amount) ? amount : null
}

async function buildCrmConversationsStarted(userIds, start, end) {
  const rows = await prisma.crmMessage.groupBy({
    by: ["conversationId"],
    where: { ...uFilter(userIds), fromMe: false },
    _min: { timestamp: true },
  })

  let count = 0
  for (const row of rows) {
    const firstAt = row._min?.timestamp
    if (firstAt && firstAt >= start && firstAt <= end) count += 1
  }
  return count
}

async function buildCrmOverview(userIds, start, end) {
  const uf = uFilter(userIds)
  const [open, pending, resolved, unread, contacts, conversationsStarted] = await Promise.all([
    prisma.crmConversation.count({ where: { ...uf, status: "open" } }),
    prisma.crmConversation.count({ where: { ...uf, status: "pending" } }),
    prisma.crmConversation.count({ where: { ...uf, status: "resolved" } }),
    prisma.crmConversation.count({ where: { ...uf, unreadCount: { gt: 0 } } }),
    prisma.crmContact.count({ where: uf }),
    buildCrmConversationsStarted(userIds, start, end),
  ])
  return { open, pending, resolved, unread, contacts, conversationsStarted }
}

async function buildCrmFunnelByStage(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  const stages = await prisma.crmKanbanStage.findMany({
    where: uFilter(userIds),
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, color: true, sortOrder: true },
  })
  if (!stages.length) return []

  const counts = await prisma.crmConversation.groupBy({
    by: ["kanbanStageId"],
    where: uFilter(userIds),
    _count: { id: true },
  })
  const countMap = new Map(counts.map((c) => [c.kanbanStageId, c._count.id]))

  if (ids.length === 1) {
    return stages.map((s) => ({
      stageId: s.id,
      stageName: s.name,
      color: s.color || "#22c55e",
      count: countMap.get(s.id) || 0,
    }))
  }

  const byName = new Map()
  for (const s of stages) {
    const key = s.name
    if (!byName.has(key)) {
      byName.set(key, {
        stageId: s.id,
        stageName: s.name,
        color: s.color || "#22c55e",
        sortOrder: s.sortOrder,
        count: 0,
      })
    }
    const bucket = byName.get(key)
    bucket.count += countMap.get(s.id) || 0
  }

  return [...byName.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}

async function buildCrmActivitySeries(userIds, start, end) {
  const rows = await prisma.crmContactActivity.findMany({
    where: {
      ...uFilter(userIds),
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

async function buildCrmConversionCounts(userIds, start, end) {
  const uf = uFilter(userIds)
  const range = { gte: start, lte: end }
  const [conversationStarted, leadQualified, quote, purchase, metaConversationStarted] = await Promise.all([
    buildCrmConversationsStarted(userIds, start, end),
    prisma.crmContact.count({
      where: { ...uf, qualifiedEventSentAt: range },
    }),
    prisma.crmContact.count({
      where: { ...uf, quoteEventSentAt: range },
    }),
    prisma.crmContactActivity.count({
      where: { ...uf, type: "purchase_confirmed", createdAt: range },
    }),
    prisma.crmContact.count({
      where: { ...uf, conversationStartedEventSentAt: range },
    }),
  ])

  return { conversationStarted, leadQualified, quote, purchase, metaConversationStarted }
}

async function buildCrmQuotesSummary(userIds, start, end) {
  const rows = await prisma.crmContactActivity.findMany({
    where: {
      ...uFilter(userIds),
      type: "quote_saved",
      createdAt: { gte: start, lte: end },
    },
    select: { payload: true },
  })

  let totalAmount = 0
  let withAmount = 0
  for (const row of rows) {
    const amount = parsePayloadAmount(row.payload)
    if (amount != null) {
      totalAmount += amount
      withAmount += 1
    }
  }

  return {
    count: rows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    withAmount,
  }
}

async function buildCrmSalesByDay(userIds, start, end) {
  const rows = await prisma.crmContactActivity.findMany({
    where: {
      ...uFilter(userIds),
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
  buildCrmQuotesSummary,
  buildCrmSalesByDay,
}

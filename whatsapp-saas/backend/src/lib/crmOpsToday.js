/**
 * Painel Operação hoje — filas do dia (não respondidas, orçamentos abertos, vendas, lembretes).
 */

const { listCrmSales } = require("./crmSales")
const { readUserFilter, assertUserInScope } = require("./orgScope")

function saoPauloTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

function saoPauloDayRange(ymd) {
  const day = ymd || saoPauloTodayYmd()
  return {
    day,
    from: new Date(`${day}T00:00:00-03:00`),
    to: new Date(`${day}T23:59:59.999-03:00`),
  }
}

function parseCustomFields(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw
}

function quoteAmount(custom) {
  const amount = Number(custom?.quote?.amount)
  return Number.isFinite(amount) ? amount : null
}

async function loadSellerNames(prisma, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  })
  return Object.fromEntries(users.map((u) => [u.id, u.name]))
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ userIds: string[], isOwner?: boolean, orgId?: string|null }} scope
 * @param {{ sellerUserId?: string|null }} [opts]
 */
async function buildOpsToday(prisma, scope, opts = {}) {
  const { day, from, to } = saoPauloDayRange()
  let scopedIds = Array.isArray(scope.userIds) ? [...scope.userIds] : []

  if (opts.sellerUserId) {
    const sid = String(opts.sellerUserId).trim()
    if (!scope.isOwner || !assertUserInScope(scope, sid)) {
      const err = new Error("FORBIDDEN")
      err.code = "FORBIDDEN"
      throw err
    }
    scopedIds = [sid]
  }

  if (!scopedIds.length) {
    return emptyOpsPayload(day)
  }

  const userFilter = readUserFilter({ userIds: scopedIds })

  const [unansweredRows, contactRows, salesResult, reminderRows, org] = await Promise.all([
    prisma.crmConversation.findMany({
      where: {
        ...userFilter,
        lastMessageFromMe: false,
        status: { in: ["open", "pending"] },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 40,
      include: {
        contact: { select: { id: true, name: true, pushName: true, phone: true } },
      },
    }),
    prisma.crmContact.findMany({
      where: userFilter,
      select: {
        id: true,
        userId: true,
        name: true,
        pushName: true,
        phone: true,
        customFields: true,
        conversation: { select: { id: true } },
      },
      take: 800,
    }),
    listCrmSales(prisma, scopedIds, {
      from: from.toISOString(),
      to: to.toISOString(),
      page: 1,
      limit: 100,
    }),
    prisma.crmContactReminder.findMany({
      where: {
        ...userFilter,
        OR: [
          { status: "pending", scheduledAt: { lte: new Date() } },
          { status: "done", dismissedAt: null, triggeredAt: { not: null } },
        ],
      },
      orderBy: [{ scheduledAt: "asc" }],
      take: 30,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            pushName: true,
            phone: true,
            conversation: { select: { id: true } },
          },
        },
      },
    }),
    scope.orgId
      ? prisma.organization.findUnique({
          where: { id: scope.orgId },
          select: { dailySalesGoal: true },
        })
      : Promise.resolve(null),
  ])

  const sellerNames = await loadSellerNames(prisma, [
    ...unansweredRows.map((r) => r.userId),
    ...contactRows.map((r) => r.userId),
    ...reminderRows.map((r) => r.userId),
    ...scopedIds,
  ])

  const unansweredItems = unansweredRows.map((row) => ({
    conversationId: row.id,
    contactId: row.contactId,
    contactName: row.contact?.name || row.contact?.pushName || row.contact?.phone || "Contato",
    phone: row.contact?.phone || null,
    lastMessageAt: row.lastMessageAt?.toISOString() || null,
    lastMessagePreview: row.lastMessagePreview || null,
    unreadCount: row.unreadCount || 0,
    userId: row.userId,
    sellerName: sellerNames[row.userId] || null,
  }))

  const openQuoteItems = []
  let openQuotesTotal = 0
  for (const contact of contactRows) {
    const custom = parseCustomFields(contact.customFields)
    if (!custom.quote || custom.purchase) continue
    const amount = quoteAmount(custom)
    if (amount != null) openQuotesTotal += amount
    openQuoteItems.push({
      contactId: contact.id,
      conversationId: contact.conversation?.id || null,
      contactName: contact.name || contact.pushName || contact.phone || "Contato",
      phone: contact.phone || null,
      amount,
      savedAt: custom.quote?.savedAt || null,
      userId: contact.userId,
      sellerName: sellerNames[contact.userId] || null,
    })
  }
  openQuoteItems.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))

  const salesTodayAmount = Number(salesResult.summary?.totalAmount) || 0
  const salesTodayCount = Number(salesResult.summary?.count) || 0

  const bySellerMap = new Map()
  for (const id of scopedIds) {
    bySellerMap.set(id, {
      userId: id,
      name: sellerNames[id] || null,
      salesCount: 0,
      salesAmount: 0,
      unansweredCount: 0,
      openQuotesCount: 0,
    })
  }
  for (const item of unansweredItems) {
    const row = bySellerMap.get(item.userId)
    if (row) row.unansweredCount += 1
  }
  for (const item of openQuoteItems) {
    const row = bySellerMap.get(item.userId)
    if (row) row.openQuotesCount += 1
  }
  for (const sale of salesResult.sales || []) {
    const sid = sale.seller?.userId || null
    if (!sid || !bySellerMap.has(sid)) continue
    const row = bySellerMap.get(sid)
    row.salesCount += 1
    row.salesAmount += Number(sale.amount) || 0
    if (!row.name && sale.seller?.name) row.name = sale.seller.name
  }

  const remindersDue = reminderRows.map((row) => ({
    id: row.id,
    contactId: row.contactId,
    conversationId: row.contact?.conversation?.id || null,
    contactName: row.contact?.name || row.contact?.pushName || row.contact?.phone || "Contato",
    note: row.note || null,
    remindAt: row.scheduledAt?.toISOString() || null,
    status: row.status,
    userId: row.userId,
    sellerName: sellerNames[row.userId] || null,
  }))

  const targetAmount =
    org?.dailySalesGoal != null && Number.isFinite(Number(org.dailySalesGoal))
      ? Number(org.dailySalesGoal)
      : null

  return {
    date: day,
    unanswered: {
      count: unansweredItems.length,
      items: unansweredItems.slice(0, 25),
    },
    openQuotes: {
      count: openQuoteItems.length,
      totalAmount: Math.round(openQuotesTotal * 100) / 100,
      items: openQuoteItems.slice(0, 25),
    },
    salesToday: {
      count: salesTodayCount,
      totalAmount: Math.round(salesTodayAmount * 100) / 100,
    },
    remindersDue: {
      count: remindersDue.length,
      items: remindersDue.slice(0, 20),
    },
    goal: {
      targetAmount,
      achievedAmount: Math.round(salesTodayAmount * 100) / 100,
    },
    bySeller: [...bySellerMap.values()].map((row) => ({
      ...row,
      salesAmount: Math.round(row.salesAmount * 100) / 100,
    })),
  }
}

function emptyOpsPayload(day) {
  return {
    date: day,
    unanswered: { count: 0, items: [] },
    openQuotes: { count: 0, totalAmount: 0, items: [] },
    salesToday: { count: 0, totalAmount: 0 },
    remindersDue: { count: 0, items: [] },
    goal: { targetAmount: null, achievedAmount: 0 },
    bySeller: [],
  }
}

module.exports = {
  buildOpsToday,
  saoPauloTodayYmd,
  saoPauloDayRange,
}

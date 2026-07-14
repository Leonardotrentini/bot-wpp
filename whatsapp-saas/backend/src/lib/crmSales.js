/**
 * Registro de vendas — lista purchase_confirmed do histórico de atividades.
 */

const { formatContactRow } = require("./crmCore")
const { readUserFilter } = require("./orgScope")

function uFilter(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  return readUserFilter({ userIds: ids })
}

function parsePayloadAmount(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const amount = Number(payload.amount)
  return Number.isFinite(amount) ? amount : null
}

function formatSaleRow(row, sellerById = {}) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}
  const contact = row.contact
  const formatted = contact ? formatContactRow(contact) : null
  const sellerUserId = payload.actorUserId || row.userId
  const seller =
    sellerById[sellerUserId] ||
    (payload.actorName
      ? { userId: sellerUserId, name: String(payload.actorName), email: null }
      : sellerUserId
        ? { userId: sellerUserId, name: null, email: null }
        : null)

  return {
    id: row.id,
    amount: parsePayloadAmount(payload),
    ticket: payload.ticket ? String(payload.ticket) : null,
    confirmedAt: row.createdAt.toISOString(),
    seller,
    tags: (contact?.tags || []).map((link) => ({
      id: link.tag?.id || link.tagId,
      name: link.tag?.name || "",
      color: link.tag?.color || "#a8a29e",
    })).filter((t) => t.id && t.name),
    contact: formatted
      ? {
          id: formatted.id,
          name: formatted.name,
          phone: formatted.phone,
          conversationId: contact.conversation?.id || null,
        }
      : null,
  }
}

function buildSalesWhere(userIds, { from, to, q, sellerUserId, tagName }) {
  const where = {
    ...uFilter(userIds),
    type: "purchase_confirmed",
  }

  if (sellerUserId) {
    const sid = String(sellerUserId)
    where.AND = [
      ...(where.AND || []),
      {
        OR: [{ userId: sid }, { payload: { path: ["actorUserId"], equals: sid } }],
      },
    ]
  }

  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }

  const contactFilter = {}
  if (tagName) {
    contactFilter.tags = { some: { tag: { name: String(tagName) } } }
  }

  const term = String(q || "").trim()
  if (term) {
    const digits = term.replace(/\D/g, "")
    const or = [
      { contact: { name: { contains: term, mode: "insensitive" } } },
      { contact: { pushName: { contains: term, mode: "insensitive" } } },
    ]
    if (digits) {
      or.push({ contact: { phone: { contains: digits } } })
    }
    or.push({
      payload: {
        path: ["ticket"],
        string_contains: term,
      },
    })
    where.AND = [...(where.AND || []), { OR: or }]
  }

  if (Object.keys(contactFilter).length) {
    where.contact = { ...(where.contact || {}), ...contactFilter }
  }

  return where
}

async function loadSellersMap(prisma, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  })
  return Object.fromEntries(users.map((u) => [u.id, { userId: u.id, name: u.name, email: u.email }]))
}

async function listCrmSales(prisma, userIds, { from, to, q, page = 1, limit = 50, sellerUserId, tagId } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const skip = (safePage - 1) * safeLimit

  let tagName = null
  if (tagId) {
    const tag = await prisma.crmTag.findFirst({
      where: { id: String(tagId), ...uFilter(userIds) },
      select: { name: true },
    })
    tagName = tag?.name || null
  }

  const where = buildSalesWhere(userIds, { from, to, q, sellerUserId, tagName })

  const [rows, total, amountRows] = await Promise.all([
    prisma.crmContactActivity.findMany({
      where,
      include: {
        contact: {
          include: {
            conversation: { select: { id: true } },
            tags: { include: { tag: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
    }),
    prisma.crmContactActivity.count({ where }),
    prisma.crmContactActivity.findMany({
      where,
      select: { payload: true },
    }),
  ])

  const sellerIds = new Set()
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {}
    sellerIds.add(payload.actorUserId || row.userId)
  }
  const sellerById = await loadSellersMap(prisma, [...sellerIds])

  let totalAmount = 0
  let amountCount = 0
  for (const row of amountRows) {
    const amount = parsePayloadAmount(row.payload)
    if (amount != null) {
      totalAmount += amount
      amountCount += 1
    }
  }

  const count = total
  const averageAmount = amountCount > 0 ? Math.round((totalAmount / amountCount) * 100) / 100 : 0

  return {
    sales: rows.map((row) => formatSaleRow(row, sellerById)),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: count,
      pages: count > 0 ? Math.ceil(count / safeLimit) : 0,
    },
    summary: {
      count,
      totalAmount: Math.round(totalAmount * 100) / 100,
      averageAmount,
    },
  }
}

module.exports = {
  listCrmSales,
  formatSaleRow,
  parsePayloadAmount,
}

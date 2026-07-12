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

function formatSaleRow(row) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}
  const contact = row.contact
  const formatted = contact ? formatContactRow(contact) : null
  return {
    id: row.id,
    amount: parsePayloadAmount(payload),
    ticket: payload.ticket ? String(payload.ticket) : null,
    confirmedAt: row.createdAt.toISOString(),
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

function buildSalesWhere(userIds, { from, to, q }) {
  const where = {
    ...uFilter(userIds),
    type: "purchase_confirmed",
  }

  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
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
    where.AND = [{ OR: or }]
  }

  return where
}

async function listCrmSales(prisma, userIds, { from, to, q, page = 1, limit = 50 } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const skip = (safePage - 1) * safeLimit
  const where = buildSalesWhere(userIds, { from, to, q })

  const [rows, total, amountRows] = await Promise.all([
    prisma.crmContactActivity.findMany({
      where,
      include: {
        contact: {
          include: {
            conversation: { select: { id: true } },
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
    sales: rows.map(formatSaleRow),
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
}

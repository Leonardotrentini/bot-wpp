/**
 * Agregações de atribuição LP (MetaAttributionLead).
 */

const { prisma } = require("./prisma")
const { readUserFilter } = require("./orgScope")
const { parseCustomFields } = require("./metaMessaging")

function uFilter(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  return readUserFilter({ userIds: ids })
}

function aggregateByField(rows, field, outKey, fallback = "—") {
  const map = new Map()
  for (const row of rows) {
    const key = String(row[field] || "").trim() || fallback
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ [outKey]: name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

function normalizeAdKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

async function buildAttributionSummary(userIds, start, end) {
  const rows = await prisma.metaAttributionLead.findMany({
    where: {
      ...uFilter(userIds),
      OR: [
        { clickAt: { gte: start, lte: end } },
        { clickAt: null, createdAt: { gte: start, lte: end } },
      ],
    },
    select: {
      utmSource: true,
      utmCampaign: true,
      utmContent: true,
      contactId: true,
    },
  })

  return {
    total: rows.length,
    bySource: aggregateByField(rows, "utmSource", "source"),
    byCampaign: aggregateByField(rows, "utmCampaign", "campaign"),
    byContent: aggregateByField(rows, "utmContent", "content"),
    rows,
  }
}

/**
 * Vendas no período agrupadas por utm_content / nome do anúncio.
 */
async function buildSalesByAdContent(userIds, start, end) {
  const purchases = await prisma.crmContactActivity.findMany({
    where: {
      ...uFilter(userIds),
      type: "purchase_confirmed",
      createdAt: { gte: start, lte: end },
    },
    select: { contactId: true },
  })

  const contactIds = [...new Set(purchases.map((p) => p.contactId).filter(Boolean))]
  if (!contactIds.length) return new Map()

  const [attrs, contacts] = await Promise.all([
    prisma.metaAttributionLead.findMany({
      where: { ...uFilter(userIds), contactId: { in: contactIds } },
      select: { contactId: true, utmContent: true },
    }),
    prisma.crmContact.findMany({
      where: { id: { in: contactIds }, ...uFilter(userIds) },
      select: { id: true, customFields: true },
    }),
  ])

  const contentByContact = new Map()
  for (const row of attrs) {
    const key = normalizeAdKey(row.utmContent)
    if (!key || key === "—") continue
    if (!contentByContact.has(row.contactId)) contentByContact.set(row.contactId, key)
  }
  for (const contact of contacts) {
    if (contentByContact.has(contact.id)) continue
    const custom = parseCustomFields(contact.customFields)
    const utm =
      custom?.meta?.utm?.content ||
      custom?.meta?.utm?.utm_content ||
      custom?.meta?.utmContent ||
      custom?.utm_content
    const key = normalizeAdKey(utm)
    if (key) contentByContact.set(contact.id, key)
  }

  const salesByContent = new Map()
  for (const purchase of purchases) {
    const key = contentByContact.get(purchase.contactId)
    if (!key) continue
    salesByContent.set(key, (salesByContent.get(key) || 0) + 1)
  }
  return salesByContent
}

/**
 * Cruza top ads da Meta com leads (utm_content) e vendas atribuídas.
 */
function rankAdsByLeadsAndSales(ads, attributionByContent, salesByContent) {
  const leadMap = new Map()
  for (const row of attributionByContent || []) {
    const key = normalizeAdKey(row.content)
    if (!key || key === "—") continue
    leadMap.set(key, (leadMap.get(key) || 0) + (row.count || 0))
  }

  return (ads || [])
    .map((ad) => {
      const key = normalizeAdKey(ad.name)
      const leads = leadMap.get(key) || 0
      const sales = salesByContent?.get(key) || 0
      return {
        ...ad,
        leads,
        sales,
        score: leads + sales * 3,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.sales !== a.sales) return b.sales - a.sales
      if (b.leads !== a.leads) return b.leads - a.leads
      return (b.clicks || 0) - (a.clicks || 0)
    })
    .slice(0, 5)
}

module.exports = {
  buildAttributionSummary,
  buildSalesByAdContent,
  rankAdsByLeadsAndSales,
}

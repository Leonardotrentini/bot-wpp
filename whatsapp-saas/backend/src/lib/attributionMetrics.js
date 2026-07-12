/**
 * Agregações de atribuição LP (MetaAttributionLead).
 */

const { prisma } = require("./prisma")

function aggregateByField(rows, field, fallback = "—") {
  const map = new Map()
  for (const row of rows) {
    const key = String(row[field] || "").trim() || fallback
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ [field === "utmSource" ? "source" : "campaign"]: name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

async function buildAttributionSummary(userId, start, end) {
  const rows = await prisma.metaAttributionLead.findMany({
    where: {
      userId,
      OR: [
        { clickAt: { gte: start, lte: end } },
        { clickAt: null, createdAt: { gte: start, lte: end } },
      ],
    },
    select: {
      utmSource: true,
      utmCampaign: true,
    },
  })

  return {
    total: rows.length,
    bySource: aggregateByField(rows, "utmSource"),
    byCampaign: aggregateByField(rows, "utmCampaign"),
  }
}

module.exports = {
  buildAttributionSummary,
}

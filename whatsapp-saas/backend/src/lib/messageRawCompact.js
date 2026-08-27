/**
 * Compacta JSON `raw` pesado já gravado (thumbnails, buffers, base64).
 * Usa a mesma sanitização das gravações novas (crmMedia.sanitizeMessageRaw).
 */

const { sanitizeMessageRaw } = require("./crmMedia")

function jsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8")
  } catch {
    return 0
  }
}

function compactRawValue(raw) {
  if (raw == null) return { next: raw, changed: false, saved: 0 }
  const before = jsonBytes(raw)
  const next = sanitizeMessageRaw(raw)
  const after = jsonBytes(next)
  const changed = before !== after
  return { next, changed, saved: Math.max(0, before - after) }
}

async function compactCrmMessageRawBatch(prisma, { cursorId = null, limit = 200 } = {}) {
  const rows = await prisma.crmMessage.findMany({
    where: {
      raw: { not: null },
      ...(cursorId ? { id: { gt: cursorId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, raw: true },
  })

  let processed = 0
  let updated = 0
  let bytesSaved = 0
  let lastId = cursorId

  for (const row of rows) {
    processed += 1
    lastId = row.id
    const { next, changed, saved } = compactRawValue(row.raw)
    if (!changed) continue
    await prisma.crmMessage.update({ where: { id: row.id }, data: { raw: next } })
    updated += 1
    bytesSaved += saved
  }

  return {
    processed,
    updated,
    bytesSaved,
    nextCursor: rows.length === limit ? lastId : null,
    done: rows.length < limit,
  }
}

async function compactWhatsAppMessageRawBatch(prisma, { cursorId = null, limit = 200 } = {}) {
  const rows = await prisma.whatsAppMessage.findMany({
    where: {
      raw: { not: null },
      ...(cursorId ? { id: { gt: cursorId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, raw: true },
  })

  let processed = 0
  let updated = 0
  let bytesSaved = 0
  let lastId = cursorId

  for (const row of rows) {
    processed += 1
    lastId = row.id
    const { next, changed, saved } = compactRawValue(row.raw)
    if (!changed) continue
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { raw: next } })
    updated += 1
    bytesSaved += saved
  }

  return {
    processed,
    updated,
    bytesSaved,
    nextCursor: rows.length === limit ? lastId : null,
    done: rows.length < limit,
  }
}

/**
 * Roda vários lotes até `maxBatches` ou esgotar filas.
 */
async function compactMessageRawAll(prisma, { limit = 200, maxBatches = 20, target = "both" } = {}) {
  const summary = {
    crm: { processed: 0, updated: 0, bytesSaved: 0, done: false },
    group: { processed: 0, updated: 0, bytesSaved: 0, done: false },
  }

  let crmCursor = null
  let groupCursor = null

  for (let batch = 0; batch < maxBatches; batch += 1) {
    let didWork = false

    if (target === "both" || target === "crm") {
      if (!summary.crm.done) {
        const r = await compactCrmMessageRawBatch(prisma, { cursorId: crmCursor, limit })
        summary.crm.processed += r.processed
        summary.crm.updated += r.updated
        summary.crm.bytesSaved += r.bytesSaved
        summary.crm.done = r.done
        crmCursor = r.nextCursor
        if (r.processed > 0) didWork = true
      }
    } else {
      summary.crm.done = true
    }

    if (target === "both" || target === "group") {
      if (!summary.group.done) {
        const r = await compactWhatsAppMessageRawBatch(prisma, { cursorId: groupCursor, limit })
        summary.group.processed += r.processed
        summary.group.updated += r.updated
        summary.group.bytesSaved += r.bytesSaved
        summary.group.done = r.done
        groupCursor = r.nextCursor
        if (r.processed > 0) didWork = true
      }
    } else {
      summary.group.done = true
    }

    if (summary.crm.done && summary.group.done) break
    if (!didWork) break
  }

  summary.bytesSavedTotal = summary.crm.bytesSaved + summary.group.bytesSaved
  summary.finished = summary.crm.done && summary.group.done
  return summary
}

module.exports = {
  compactRawValue,
  compactCrmMessageRawBatch,
  compactWhatsAppMessageRawBatch,
  compactMessageRawAll,
}

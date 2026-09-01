/**
 * Manutenção de armazenamento CRM — evita encher o disco do Postgres.
 * - Remove mediaBase64 de entregas concluídas
 * - Apaga entregas antigas (sent/failed)
 * - Compacta JSON raw pesado em mensagens
 * - Opcional: apaga mensagens CRM e flow runs muito antigos
 */

const { compactMessageRawAll } = require("./messageRawCompact")

const CRM_DELIVERY_RETENTION_DAYS = Math.max(
  1,
  Math.min(90, Number(process.env.CRM_DELIVERY_RETENTION_DAYS || 7)),
)
const CRM_MESSAGE_RETENTION_DAYS = Number(process.env.CRM_MESSAGE_RETENTION_DAYS ?? 90)
const CRM_FLOW_RUN_RETENTION_DAYS = Math.max(
  0,
  Math.min(365, Number(process.env.CRM_FLOW_RUN_RETENTION_DAYS || 60)),
)
const CRM_MAINTENANCE_COMPACT_BATCHES = Math.max(
  1,
  Math.min(20, Number(process.env.CRM_MAINTENANCE_COMPACT_BATCHES || 3)),
)
const CRM_MAINTENANCE_PURGE_LIMIT = Math.max(
  1000,
  Math.min(100000, Number(process.env.CRM_MAINTENANCE_PURGE_LIMIT || 10000)),
)

let maintenanceBusy = false

async function stripCompletedDeliveryMedia(prisma, { limit = 500 } = {}) {
  const rows = await prisma.crmDelivery.findMany({
    where: {
      status: { in: ["sent", "failed", "cancelled"] },
      NOT: { mediaBase64: null },
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  })
  if (!rows.length) return { cleared: 0 }

  const result = await prisma.crmDelivery.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { mediaBase64: null },
  })
  return { cleared: result.count }
}

async function deleteOldCrmDeliveries(prisma) {
  const cutoff = new Date(Date.now() - CRM_DELIVERY_RETENTION_DAYS * 86400000)
  const result = await prisma.crmDelivery.deleteMany({
    where: {
      status: { in: ["sent", "failed", "cancelled"] },
      updatedAt: { lt: cutoff },
    },
  })
  return { deleted: result.count, retentionDays: CRM_DELIVERY_RETENTION_DAYS }
}

async function pruneOldCrmMessages(prisma) {
  if (!CRM_MESSAGE_RETENTION_DAYS || CRM_MESSAGE_RETENTION_DAYS <= 0) {
    return { deleted: 0, disabled: true }
  }
  const cutoff = new Date(Date.now() - CRM_MESSAGE_RETENTION_DAYS * 86400000)
  const result = await prisma.crmMessage.deleteMany({
    where: { timestamp: { lt: cutoff } },
  })
  return { deleted: result.count, retentionDays: CRM_MESSAGE_RETENTION_DAYS }
}

async function pruneOldCrmFlowRuns(prisma) {
  if (!CRM_FLOW_RUN_RETENTION_DAYS || CRM_FLOW_RUN_RETENTION_DAYS <= 0) {
    return { deleted: 0, disabled: true }
  }
  const cutoff = new Date(Date.now() - CRM_FLOW_RUN_RETENTION_DAYS * 86400000)
  const result = await prisma.crmFlowRun.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return { deleted: result.count, retentionDays: CRM_FLOW_RUN_RETENTION_DAYS }
}

async function compactMessageRawTick(prisma) {
  return compactMessageRawAll(prisma, {
    limit: 150,
    maxBatches: CRM_MAINTENANCE_COMPACT_BATCHES,
    target: "both",
  })
}

/**
 * Tick periódico — lotes pequenos para não travar o banco.
 */
async function runCrmStorageMaintenance(prisma, { full = false } = {}) {
  if (maintenanceBusy) return { skipped: true, reason: "busy" }
  maintenanceBusy = true
  const started = Date.now()

  try {
    const media = await stripCompletedDeliveryMedia(prisma, {
      limit: full ? CRM_MAINTENANCE_PURGE_LIMIT : 500,
    })
    const deliveries = await deleteOldCrmDeliveries(prisma)
    const compact = await compactMessageRawTick(prisma)

    let messages = { deleted: 0, disabled: true }
    let flowRuns = { deleted: 0, disabled: true }
    if (full) {
      messages = await pruneOldCrmMessages(prisma)
      flowRuns = await pruneOldCrmFlowRuns(prisma)
    }

    const summary = {
      ok: true,
      durationMs: Date.now() - started,
      mediaBase64Cleared: media.cleared,
      deliveriesDeleted: deliveries.deleted,
      compact,
      messagesPruned: messages.deleted,
      flowRunsPruned: flowRuns.deleted,
    }

    if (media.cleared > 0 || deliveries.deleted > 0 || compact.bytesSavedTotal > 0 || messages.deleted > 0) {
      console.log("[crm-maintenance]", JSON.stringify(summary))
    }

    return summary
  } finally {
    maintenanceBusy = false
  }
}

module.exports = {
  runCrmStorageMaintenance,
  stripCompletedDeliveryMedia,
  deleteOldCrmDeliveries,
  pruneOldCrmMessages,
  pruneOldCrmFlowRuns,
  compactMessageRawTick,
  CRM_DELIVERY_RETENTION_DAYS,
  CRM_MESSAGE_RETENTION_DAYS,
  CRM_FLOW_RUN_RETENTION_DAYS,
}

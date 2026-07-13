const { prisma } = require("./prisma")

const RETENTION_MODE = String(process.env.MESSAGE_RETENTION_MODE || "activation").toLowerCase()
const IS_ACTIVATION_RETENTION = RETENTION_MODE !== "rolling"

/** Janela rolling (modo legado): importação, webhook, analytics e limpeza. */
const MESSAGE_RETENTION_DAYS = Math.max(
  1,
  Math.min(30, Number(process.env.MESSAGE_BACKFILL_DAYS || process.env.MESSAGE_RETENTION_DAYS || 2)),
)

const MESSAGE_REPORT_MAX_DAYS = Math.max(
  30,
  Math.min(365, Number(process.env.MESSAGE_REPORT_MAX_DAYS || 365)),
)

function isActivationRetention() {
  return IS_ACTIVATION_RETENTION
}

function getRetentionMs() {
  return MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
}

function getRetentionCutoffDate(now = new Date()) {
  return new Date(now.getTime() - getRetentionMs())
}

function getRetentionCutoffMs(now = new Date()) {
  return getRetentionCutoffDate(now).getTime()
}

/** Piso de armazenamento por grupo: desde activatedAt (modo activation) ou janela rolling. */
function getGroupMessageFloorMs(group, now = new Date()) {
  if (group?.activatedAt) return new Date(group.activatedAt).getTime()
  if (IS_ACTIVATION_RETENTION) return now.getTime()
  return getRetentionCutoffMs(now)
}

function retentionStartYmd(now = new Date()) {
  return getRetentionCutoffDate(now).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

/** Limita intervalo de relatório ao que existe no banco. */
function clampRangeToRetention(start, end, now = new Date()) {
  const endClamped = end > now ? now : end

  if (!IS_ACTIVATION_RETENTION) {
    const cutoff = getRetentionCutoffDate(now)
    let startClamped = start < cutoff ? new Date(cutoff) : start
    if (startClamped > endClamped) startClamped = new Date(cutoff)
    return { start: startClamped, end: endClamped, cutoff, retentionDays: MESSAGE_RETENTION_DAYS, retentionMode: "rolling" }
  }

  const earliest = new Date(now.getTime() - MESSAGE_REPORT_MAX_DAYS * 86400000)
  let startClamped = start < earliest ? earliest : start
  if (startClamped > endClamped) startClamped = new Date(earliest)
  return { start: startClamped, end: endClamped, cutoff: null, retentionDays: null, retentionMode: "activation" }
}

async function pruneUserMessagesBeyondRetention(userId, { groupIds } = {}) {
  if (IS_ACTIVATION_RETENTION) {
    const groups = await prisma.whatsAppGroup.findMany({
      where: {
        userId,
        monitoringEnabled: true,
        activatedAt: { not: null },
        ...(groupIds?.length ? { id: { in: groupIds } } : {}),
      },
      select: { id: true, activatedAt: true },
    })
    let count = 0
    for (const g of groups) {
      const result = await prisma.whatsAppMessage.deleteMany({
        where: { groupId: g.id, timestamp: { lt: g.activatedAt } },
      })
      count += result.count
    }
    return count
  }

  const cutoff = getRetentionCutoffDate()
  const where = {
    userId,
    timestamp: { lt: cutoff },
    ...(groupIds?.length ? { groupId: { in: groupIds } } : {}),
  }
  const result = await prisma.whatsAppMessage.deleteMany({ where })
  return result.count
}

module.exports = {
  RETENTION_MODE,
  IS_ACTIVATION_RETENTION,
  isActivationRetention,
  MESSAGE_RETENTION_DAYS,
  MESSAGE_REPORT_MAX_DAYS,
  getRetentionMs,
  getRetentionCutoffDate,
  getRetentionCutoffMs,
  getGroupMessageFloorMs,
  retentionStartYmd,
  clampRangeToRetention,
  pruneUserMessagesBeyondRetention,
}

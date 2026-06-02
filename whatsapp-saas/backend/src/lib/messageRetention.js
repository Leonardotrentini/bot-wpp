const { prisma } = require("./prisma")

/** Janela única: importação, webhook, analytics e limpeza do banco. */
const MESSAGE_RETENTION_DAYS = Math.max(
  1,
  Math.min(30, Number(process.env.MESSAGE_BACKFILL_DAYS || process.env.MESSAGE_RETENTION_DAYS || 2)),
)

function getRetentionMs() {
  return MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
}

function getRetentionCutoffDate(now = new Date()) {
  return new Date(now.getTime() - getRetentionMs())
}

function getRetentionCutoffMs(now = new Date()) {
  return getRetentionCutoffDate(now).getTime()
}

function retentionStartYmd(now = new Date()) {
  return getRetentionCutoffDate(now).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

/** Limita qualquer intervalo ao que existe no banco (últimos N dias). */
function clampRangeToRetention(start, end, now = new Date()) {
  const cutoff = getRetentionCutoffDate(now)
  const endClamped = end > now ? now : end
  let startClamped = start < cutoff ? new Date(cutoff) : start
  if (startClamped > endClamped) startClamped = new Date(cutoff)
  return { start: startClamped, end: endClamped, cutoff, retentionDays: MESSAGE_RETENTION_DAYS }
}

async function pruneUserMessagesBeyondRetention(userId, { groupIds } = {}) {
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
  MESSAGE_RETENTION_DAYS,
  getRetentionMs,
  getRetentionCutoffDate,
  getRetentionCutoffMs,
  retentionStartYmd,
  clampRangeToRetention,
  pruneUserMessagesBeyondRetention,
}

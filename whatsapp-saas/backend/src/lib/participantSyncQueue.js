const { prisma } = require("./prisma")

const ITEM_DELAY_MS = Number(process.env.PARTICIPANTS_SYNC_ITEM_DELAY_MS || 500)
const activeSyncs = new Set()

function isRateLimitError(err) {
  const message = String(err?.message || err || "").toLowerCase()
  return err?.status === 429 || err?.details?.status === 429 || message.includes("429") || message.includes("rate-overlimit") || message.includes("rate limit")
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sincroniza participantes em background com pausa entre grupos (safe para 50 grupos).
 */
function scheduleParticipantSync(userId, groupJids, syncFn) {
  const unique = [...new Set((groupJids || []).filter(Boolean))]
  if (!unique.length) return

  const key = userId
  if (activeSyncs.has(key)) return
  activeSyncs.add(key)

  void (async () => {
    try {
      for (let i = 0; i < unique.length; i += 1) {
        const groupJid = unique[i]
        try {
          await syncFn(groupJid)
        } catch (err) {
          if (isRateLimitError(err)) {
            console.warn("[participants-sync] rate limit, pausando fila:", userId)
            await prisma.whatsAppConnection
              .update({
                where: { userId },
                data: {
                  groupSyncStatus: "RATE_LIMITED",
                  groupSyncMessage: "WhatsApp limitou sync de participantes. Retomaremos depois.",
                  groupSyncRetryAfter: new Date(Date.now() + Number(process.env.GROUP_SYNC_RATE_LIMIT_BACKOFF_MS || 600000)),
                },
              })
              .catch(() => {})
            break
          }
          console.warn("[participants-sync]", groupJid, err?.message || err)
        }
        if (i < unique.length - 1 && ITEM_DELAY_MS > 0) await wait(ITEM_DELAY_MS)
      }
    } finally {
      activeSyncs.delete(key)
    }
  })()
}

module.exports = { scheduleParticipantSync }

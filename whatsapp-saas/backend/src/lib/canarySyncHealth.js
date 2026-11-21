/**
 * Critérios de sucesso do canário Evolution (patch shouldSyncHistoryMessage).
 * 72h sem empty_store_zombie, findChats > 0, msgs após ociosidade.
 */

const CANARY_WINDOW_MS = Number(process.env.WHATSAPP_CANARY_WINDOW_MS || 72 * 60 * 60 * 1000)
const CANARY_IDLE_GAP_MS = Number(process.env.WHATSAPP_CANARY_IDLE_GAP_MS || 30 * 60 * 1000)

async function evaluateCanaryInstance(deps, { instanceName, userId = null, host = "canary" } = {}) {
  const { prisma, findChats } = deps
  const { bindInstanceHost } = require("./evolution")
  const since = new Date(Date.now() - CANARY_WINDOW_MS)

  const conn = await prisma.whatsAppConnection.findFirst({
    where: userId ? { userId } : { instanceName },
    select: {
      userId: true,
      instanceName: true,
      evolutionHost: true,
      connected: true,
      status: true,
      syncHealth: true,
      lastWebhookAt: true,
      staleRecoveryCount: true,
    },
  })

  const events = prisma.whatsAppZombieEvent
    ? await prisma.whatsAppZombieEvent.findMany({
        where: {
          instanceName: conn?.instanceName || instanceName,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : []

  const emptyStoreEvents = events.filter((e) =>
    ["empty_store_zombie", "banner_qr"].includes(String(e.eventType || e.proofReason || "")),
  )
  const softRestarts = events.filter((e) => e.eventType === "soft_restart")

  let findChatsCount = null
  let findChatsError = null
  try {
    bindInstanceHost(conn?.instanceName || instanceName, conn?.evolutionHost || host)
    const raw = await findChats(conn?.instanceName || instanceName, { limit: 50 })
    const list = Array.isArray(raw) ? raw : raw?.records || raw?.chats || raw?.data || []
    findChatsCount = Array.isArray(list) ? list.length : 0
  } catch (err) {
    findChatsError = err?.message || String(err)
    findChatsCount = 0
  }

  const uid = conn?.userId || userId
  let messagesAfterIdle = false
  let newestMsgAt = null
  if (uid) {
    const msgs = await prisma.crmMessage.findMany({
      where: { userId: uid, timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
      take: 500,
      select: { timestamp: true },
    })
    if (msgs.length) {
      newestMsgAt = msgs[msgs.length - 1].timestamp
      for (let i = 1; i < msgs.length; i += 1) {
        const gap = new Date(msgs[i].timestamp).getTime() - new Date(msgs[i - 1].timestamp).getTime()
        if (gap >= CANARY_IDLE_GAP_MS) {
          messagesAfterIdle = true
          break
        }
      }
      // Também conta se houve msg recente após silêncio de webhook longo.
      if (!messagesAfterIdle && conn?.lastWebhookAt && newestMsgAt) {
        const webhookMs = new Date(conn.lastWebhookAt).getTime()
        const newestMs = new Date(newestMsgAt).getTime()
        if (newestMs > webhookMs) messagesAfterIdle = true
      }
    }
  }

  const noEmptyStore = emptyStoreEvents.length === 0
  const hasChats = Number(findChatsCount) > 0
  const ok = Boolean(noEmptyStore && hasChats && (messagesAfterIdle || !uid))

  const result = {
    ok,
    instanceName: conn?.instanceName || instanceName,
    host: conn?.evolutionHost || host,
    windowHours: Math.round(CANARY_WINDOW_MS / 3600000),
    checks: {
      noEmptyStoreZombie72h: noEmptyStore,
      findChatsGt0: hasChats,
      messagesAfterIdle,
    },
    metrics: {
      emptyStoreEvents: emptyStoreEvents.length,
      softRestarts: softRestarts.length,
      findChatsCount,
      findChatsError,
      newestMsgAt,
      syncHealth: conn?.syncHealth || null,
      connected: conn?.connected ?? null,
    },
  }

  try {
    const { recordZombieEvent } = require("./zombieEvents")
    await recordZombieEvent(prisma, {
      instanceName: result.instanceName,
      userId: uid || null,
      host: result.host,
      eventType: "canary_check",
      proofReason: ok ? "canary_ok" : "canary_fail",
      outcome: ok ? "cured" : "failed",
      meta: result,
    })
  } catch {
    /* ignore */
  }

  return result
}

module.exports = {
  CANARY_WINDOW_MS,
  CANARY_IDLE_GAP_MS,
  evaluateCanaryInstance,
}

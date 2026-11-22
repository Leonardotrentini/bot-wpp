/**
 * Limpa STALE/RECOVERING/banner falso no CRM quando sonda socket OK recente.
 * NÃO toca Evolution (sem restart/logout/connect).
 *
 * node scripts/_ops-overnight-cleanup-false-stale.js [--apply]
 */
const APPLY = process.argv.includes("--apply")
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()
const WITHIN_MS = 30 * 60 * 1000

;(async () => {
  const open = await p.whatsAppConnection.findMany({
    where: {
      connected: true,
      status: { in: ["OPEN", "CONNECTED", "open", "connected"] },
      syncHealth: { in: ["STALE", "RECOVERING"] },
    },
    select: {
      userId: true,
      instanceName: true,
      evolutionHost: true,
      syncHealth: true,
      staleRecoveryCount: true,
      staleDetectedAt: true,
      phone: true,
    },
  })

  const cleaned = []
  const skipped = []
  for (const row of open) {
    const probe = await p.whatsAppProbeResult.findFirst({
      where: {
        instanceName: row.instanceName,
        probeOk: true,
        probedAt: { gte: new Date(Date.now() - WITHIN_MS) },
        NOT: { error: "skipped_not_open" },
      },
      orderBy: { probedAt: "desc" },
    })
    if (!probe) {
      skipped.push({
        instance: row.instanceName,
        host: row.evolutionHost,
        syncHealth: row.syncHealth,
        reason: "no_recent_probe_ok",
        staleRecoveryCount: row.staleRecoveryCount,
      })
      continue
    }
    const item = {
      instance: row.instanceName,
      host: row.evolutionHost,
      before: row.syncHealth,
      staleRecoveryCount: row.staleRecoveryCount,
      probeAt: probe.probedAt,
      latencyMs: probe.latencyMs,
    }
    if (APPLY) {
      await p.whatsAppConnection.update({
        where: { userId: row.userId },
        data: {
          syncHealth: "UNKNOWN",
          staleDetectedAt: null,
          staleRecoveryCount: 0,
          staleLastRecoveryAt: null,
        },
      })
      item.applied = true
    }
    cleaned.push(item)
  }

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        candidates: open.length,
        cleaned: cleaned.length,
        skipped: skipped.length,
        cleanedRows: cleaned,
        skippedRows: skipped,
      },
      null,
      2,
    ),
  )
  await p.$disconnect()
})().catch(async (e) => {
  console.error(e)
  await p.$disconnect()
  process.exit(1)
})

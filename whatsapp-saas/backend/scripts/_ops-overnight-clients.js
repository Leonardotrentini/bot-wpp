/**
 * Só leitura: conexões não-OPEN — ativo vs inativo (7d).
 * node scripts/_ops-overnight-clients.js
 */
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()
const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000)
const since48h = new Date(Date.now() - 48 * 3600 * 1000)

;(async () => {
  const rows = await p.$queryRawUnsafe(
    `
    SELECT
      c."instanceName",
      COALESCE(c."evolutionHost",'primary') AS host,
      c.status,
      c.connected,
      c."syncHealth",
      c.phone,
      c."lastWebhookAt",
      c."lastFromMeAt",
      c."lastInboundAt",
      c."staleDetectedAt",
      c."staleRecoveryCount",
      c."updatedAt",
      c."createdAt",
      c."userId",
      u.email,
      u.name AS user_name,
      (
        SELECT o.name FROM "OrganizationMember" om
        JOIN "Organization" o ON o.id = om."organizationId"
        WHERE om."userId" = c."userId"
        LIMIT 1
      ) AS org_name,
      (
        SELECT MAX(m.timestamp)
        FROM "CrmMessage" m
        JOIN "CrmConversation" conv ON conv.id = m."conversationId"
        WHERE conv."userId" = c."userId"
      ) AS last_msg_at,
      (
        SELECT COUNT(*)::int
        FROM "CrmMessage" m
        JOIN "CrmConversation" conv ON conv.id = m."conversationId"
        WHERE conv."userId" = c."userId" AND m.timestamp >= $1 AND m."fromMe" = false
      ) AS inbound_7d,
      (
        SELECT COUNT(*)::int
        FROM "CrmMessage" m
        JOIN "CrmConversation" conv ON conv.id = m."conversationId"
        WHERE conv."userId" = c."userId" AND m.timestamp >= $1
      ) AS msgs_7d,
      (
        SELECT COUNT(*)::int
        FROM "CrmContact" ct
        WHERE ct."userId" = c."userId" AND ct."createdAt" >= $1
      ) AS contacts_7d
    FROM "WhatsAppConnection" c
    JOIN "User" u ON u.id = c."userId"
    WHERE UPPER(c.status) NOT IN ('OPEN','CONNECTED') OR c.connected = false
    ORDER BY c."updatedAt" DESC
  `,
    since7d,
  )

  const active = []
  const inactive = []
  for (const r of rows) {
    const lastMsg = r.last_msg_at ? new Date(r.last_msg_at).getTime() : 0
    const lastWh = r.lastWebhookAt ? new Date(r.lastWebhookAt).getTime() : 0
    const lastAct = Math.max(lastMsg, lastWh)
    const isActive =
      Number(r.inbound_7d) > 0 ||
      Number(r.contacts_7d) > 0 ||
      Number(r.msgs_7d) >= 5 ||
      (lastAct > 0 && lastAct >= since7d.getTime())
    const item = {
      email: r.email,
      name: r.user_name,
      org: r.org_name,
      instance: r.instanceName,
      host: r.host,
      status: r.status,
      syncHealth: r.syncHealth,
      updatedAt: r.updatedAt,
      lastMsgAt: r.last_msg_at,
      lastWebhookAt: r.lastWebhookAt,
      inbound7d: r.inbound_7d,
      msgs7d: r.msgs_7d,
      contacts7d: r.contacts_7d,
      staleRecoveryCount: r.staleRecoveryCount,
      priority: isActive ? "ATIVO_SEM_RECEBER_AGORA" : "inativo",
    }
    ;(isActive ? active : inactive).push(item)
  }

  const open = await p.$queryRawUnsafe(
    `
    SELECT c."instanceName", COALESCE(c."evolutionHost",'primary') host, c."syncHealth",
           c."staleRecoveryCount", c.phone, u.email, u.name,
           (SELECT COUNT(*)::int FROM "CrmMessage" m
            JOIN "CrmConversation" conv ON conv.id=m."conversationId"
            WHERE conv."userId"=c."userId" AND m.timestamp >= $1 AND m."fromMe"=false) inbound7d
    FROM "WhatsAppConnection" c
    JOIN "User" u ON u.id=c."userId"
    WHERE c.connected=true AND UPPER(c.status) IN ('OPEN','CONNECTED')
    ORDER BY host, email
  `,
    since7d,
  )

  const banners = await p.$queryRawUnsafe(
    `
    SELECT "instanceName", host, "eventType", "proofReason", outcome, "softRestartsTried", "createdAt"
    FROM "WhatsAppZombieEvent"
    WHERE "createdAt" >= $1
      AND ("eventType" IN ('banner_qr','mutual_freeze_zombie','soft_restart','chat_activity')
           OR outcome IN ('banner_qr','soft_restart_ok','soft_restart_failed'))
    ORDER BY "createdAt" DESC
    LIMIT 200
  `,
    since48h,
  )

  const restartHist = await p.$queryRawUnsafe(
    `
    SELECT "instanceName", host, "eventType", outcome, "proofReason", COUNT(*)::int AS n,
           MIN("createdAt") AS first_at, MAX("createdAt") AS last_at
    FROM "WhatsAppZombieEvent"
    WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      AND "eventType" IN ('soft_restart','banner_qr','mutual_freeze_zombie','empty_store_zombie','chat_activity')
    GROUP BY 1,2,3,4,5
    ORDER BY n DESC
  `,
  )

  const probes = await p.$queryRawUnsafe(`
    SELECT DISTINCT ON ("instanceName")
      "instanceName", host, "probeOk", "zombieSuspect", error, "latencyMs", "connectionState", "probedAt"
    FROM "WhatsAppProbeResult"
    WHERE error IS DISTINCT FROM 'skipped_not_open'
    ORDER BY "instanceName", "probedAt" DESC
  `)

  const out = {
    generatedAt: new Date().toISOString(),
    nonOpenTotal: rows.length,
    activePriorityCount: active.length,
    inactiveCount: inactive.length,
    active,
    inactive,
    open,
    banners,
    restartHist,
    probes,
  }
  console.log(JSON.stringify(out, null, 2))
  await p.$disconnect()
})().catch(async (e) => {
  console.error(e)
  await p.$disconnect()
  process.exit(1)
})

/**
 * Job periódico: resolve órfãos LID (sem telefone) em todas as contas connected.
 * Depois do resolve, arquiva LID legado inativo (não inventa telefone — só limpa inbox/métrica).
 * Quota por ciclo para não saturar Evolution.
 */

const {
  resolveLidPhonesFromChats,
  reidentifyContactsFromMessages,
  backfillPhonesFromJid,
} = require("./crmProfile")
const { unifyLidPhoneDuplicates } = require("./crmContactMerge")

const LID_ORPHAN_INTERVAL_MS = Number(process.env.CRM_LID_ORPHAN_INTERVAL_MS || 5 * 60 * 1000)
const LID_ORPHAN_ACCOUNTS_PER_TICK = Number(process.env.CRM_LID_ORPHAN_ACCOUNTS_PER_TICK || 3)
const LID_ORPHAN_UNIFY_LIMIT = Number(process.env.CRM_LID_ORPHAN_UNIFY_LIMIT || 120)
/** LID sem msg recente → arquivar (soma da inbox / métrica ativa). Default 60 dias. */
const LID_LEGACY_INACTIVE_DAYS = Math.max(
  14,
  Math.min(365, Number(process.env.CRM_LID_LEGACY_INACTIVE_DAYS || 60)),
)
const LID_ARCHIVE_LIMIT_PER_ACCOUNT = Math.max(
  20,
  Math.min(2000, Number(process.env.CRM_LID_ARCHIVE_LIMIT || 400)),
)

let cursor = 0
let tickBusy = false

function lidOrphanContactWhere(userId) {
  return {
    userId,
    phone: null,
    OR: [{ isLid: true }, { remoteJid: { contains: "@lid" } }],
  }
}

/**
 * Dívida ativa: órfãos LID cuja conversa NÃO está archived.
 * Contato sem conversa ainda conta (ainda polui sync/stats).
 */
async function countOrphanLids(prisma, userId) {
  return prisma.crmContact.count({
    where: {
      userId,
      phone: null,
      AND: [
        { OR: [{ isLid: true }, { remoteJid: { contains: "@lid" } }] },
        {
          OR: [
            { conversation: null },
            { conversation: { is: { status: { not: "archived" } } } },
          ],
        },
      ],
    },
  })
}

async function countArchivedLidOrphans(prisma, userId) {
  return prisma.crmContact.count({
    where: {
      ...lidOrphanContactWhere(userId),
      conversation: { is: { status: "archived" } },
    },
  })
}

/**
 * Arquiva conversas LID sem telefone e sem atividade recente.
 * Não apaga dados: msg nova reabre (crmCore → archived → open).
 */
async function archiveInactiveLidOrphans(prisma, userId, opts = {}) {
  const inactiveDays = Math.max(14, Number(opts.inactiveDays || LID_LEGACY_INACTIVE_DAYS))
  const limit = Math.max(1, Math.min(2000, Number(opts.limit || LID_ARCHIVE_LIMIT_PER_ACCOUNT)))
  const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000)

  const candidates = await prisma.crmConversation.findMany({
    where: {
      userId,
      status: { not: "archived" },
      OR: [
        { lastMessageAt: { lt: cutoff } },
        { AND: [{ lastMessageAt: null }, { createdAt: { lt: cutoff } }] },
      ],
      contact: lidOrphanContactWhere(userId),
    },
    select: { id: true, contactId: true, remoteJid: true, lastMessageAt: true },
    take: limit,
    orderBy: [{ lastMessageAt: "asc" }, { createdAt: "asc" }],
  })

  if (!candidates.length) {
    return { archived: 0, inactiveDays, cutoff: cutoff.toISOString() }
  }

  const ids = candidates.map((c) => c.id)
  await prisma.crmConversation.updateMany({
    where: { id: { in: ids }, userId },
    data: { status: "archived" },
  })

  const archivedAt = new Date().toISOString()
  await prisma.crmContactActivity
    .createMany({
      data: candidates.map((c) => ({
        userId,
        contactId: c.contactId,
        type: "lid_legacy_archived",
        payload: {
          reason: "inactive_lid_orphan",
          inactiveDays,
          lastMessageAt: c.lastMessageAt || null,
          remoteJid: c.remoteJid,
          archivedAt,
        },
      })),
    })
    .catch(() => {})

  return {
    archived: ids.length,
    inactiveDays,
    cutoff: cutoff.toISOString(),
  }
}

async function listConnectedAccounts(prisma) {
  return prisma.whatsAppConnection.findMany({
    where: { connected: true, status: { not: "NUMBER_CONFLICT" } },
    select: {
      userId: true,
      instanceName: true,
      evolutionHost: true,
      lastWebhookAt: true,
      syncHealth: true,
      status: true,
    },
    orderBy: { updatedAt: "desc" },
  })
}

/**
 * Prioriza contas com mais órfãos / webhook atrasado.
 */
async function rankAccounts(prisma, rows) {
  const scored = []
  for (const row of rows) {
    const orphans = await countOrphanLids(prisma, row.userId)
    const webhookAgeMs = row.lastWebhookAt ? Date.now() - new Date(row.lastWebhookAt).getTime() : Number.MAX_SAFE_INTEGER
    scored.push({ ...row, orphans, webhookAgeMs })
  }
  scored.sort((a, b) => {
    if (b.orphans !== a.orphans) return b.orphans - a.orphans
    return b.webhookAgeMs - a.webhookAgeMs
  })
  return scored
}

async function processAccount(deps, account) {
  const { prisma, bindInstanceHost } = deps
  if (typeof bindInstanceHost === "function") {
    bindInstanceHost(account.instanceName, account.evolutionHost || "primary")
  }

  const lid = await resolveLidPhonesFromChats(deps, {
    userId: account.userId,
    instanceName: account.instanceName,
  }).catch((err) => {
    console.warn("[lid-orphan] resolveLid:", err?.message || err)
    return { resolved: 0, mapSize: 0 }
  })

  const phonesFromJid = await backfillPhonesFromJid(prisma, account.userId).catch(() => 0)
  const reidentified = await reidentifyContactsFromMessages(deps, account.userId).catch(() => 0)
  const unify = await unifyLidPhoneDuplicates(prisma, {
    userIds: [account.userId],
    limit: LID_ORPHAN_UNIFY_LIMIT,
  }).catch(() => ({ results: [] }))

  const archived = await archiveInactiveLidOrphans(prisma, account.userId).catch((err) => {
    console.warn("[lid-orphan] archive:", err?.message || err)
    return { archived: 0 }
  })

  const orphansAfter = await countOrphanLids(prisma, account.userId)
  const archivedOrphans = await countArchivedLidOrphans(prisma, account.userId).catch(() => 0)
  return {
    userId: account.userId,
    resolved: lid.resolved || 0,
    mapSize: lid.mapSize || 0,
    phonesFromJid,
    reidentified,
    unified: Array.isArray(unify?.results) ? unify.results.filter((r) => r?.merged).length : 0,
    archivedInactive: archived?.archived || 0,
    archiveCutoff: archived?.cutoff || null,
    archiveInactiveDays: archived?.inactiveDays || LID_LEGACY_INACTIVE_DAYS,
    orphansAfter,
    archivedOrphans,
  }
}

async function runLidOrphanTick(deps) {
  if (tickBusy) return { skipped: true }
  tickBusy = true
  try {
    const { prisma } = deps
    const connected = await listConnectedAccounts(prisma)
    if (!connected.length) return { processed: 0 }

    const ranked = await rankAccounts(prisma, connected)
    // Round-robin suave a partir do cursor, mas sempre puxando os piores órfãos primeiro.
    const batch = []
    const n = ranked.length
    for (let i = 0; i < Math.min(LID_ORPHAN_ACCOUNTS_PER_TICK, n); i += 1) {
      const idx = (cursor + i) % n
      batch.push(ranked[idx])
    }
    cursor = (cursor + LID_ORPHAN_ACCOUNTS_PER_TICK) % Math.max(1, n)

    const results = []
    for (const account of batch) {
      if (!account.orphans && account.webhookAgeMs < 30 * 60 * 1000) continue
      const result = await processAccount(deps, account)
      results.push({ ...result, orphansBefore: account.orphans })
      if (result.resolved || result.unified || result.reidentified || result.archivedInactive) {
        console.log(
          `[lid-orphan] user=${account.userId.slice(0, 8)}… resolved=${result.resolved} unified=${result.unified} reidentified=${result.reidentified} archived=${result.archivedInactive} orphans=${account.orphans}→${result.orphansAfter}`,
        )
      }
    }
    return { processed: results.length, results }
  } finally {
    tickBusy = false
  }
}

async function getOrphanLidStats(prisma, { limit = 25 } = {}) {
  const connected = await listConnectedAccounts(prisma)
  const rows = []
  let totalArchived = 0
  for (const c of connected) {
    const orphans = await countOrphanLids(prisma, c.userId)
    const archivedOrphans = await countArchivedLidOrphans(prisma, c.userId).catch(() => 0)
    totalArchived += archivedOrphans
    if (!orphans && !archivedOrphans) continue
    const user = await prisma.user.findUnique({
      where: { id: c.userId },
      select: { email: true, name: true },
    })
    rows.push({
      userId: c.userId,
      email: user?.email || null,
      name: user?.name || null,
      orphans,
      archivedOrphans,
      lastWebhookAt: c.lastWebhookAt,
      syncHealth: c.syncHealth || null,
      instanceName: c.instanceName,
    })
  }
  rows.sort((a, b) => b.orphans - a.orphans)

  let webhookSilence = null
  try {
    const { getWebhookSilenceAlerts } = require("./whatsappSyncHealth")
    webhookSilence = await getWebhookSilenceAlerts(prisma, { limit })
  } catch (err) {
    webhookSilence = { error: err?.message || String(err) }
  }

  return {
    accountsWithOrphans: rows.filter((r) => r.orphans > 0).length,
    totalOrphans: rows.reduce((s, r) => s + r.orphans, 0),
    totalArchivedLidOrphans: totalArchived,
    legacyInactiveDays: LID_LEGACY_INACTIVE_DAYS,
    top: rows.slice(0, limit),
    webhookSilence,
  }
}

module.exports = {
  runLidOrphanTick,
  getOrphanLidStats,
  countOrphanLids,
  countArchivedLidOrphans,
  archiveInactiveLidOrphans,
  LID_ORPHAN_INTERVAL_MS,
  LID_LEGACY_INACTIVE_DAYS,
  LID_ARCHIVE_LIMIT_PER_ACCOUNT,
  processAccount,
}

const { prisma } = require("./prisma")

const DEFAULT_MAX_GROUPS = 50

async function getUserMaxGroups(userId) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    include: { plan: { select: { maxGroups: true } } },
  })
  const planLimit = sub?.plan?.maxGroups
  if (planLimit != null && Number.isFinite(planLimit)) return planLimit
  return Number(process.env.DEFAULT_MAX_GROUPS || DEFAULT_MAX_GROUPS)
}

async function countMonitoredGroups(userId) {
  return prisma.whatsAppGroup.count({
    where: { userId, monitoringEnabled: true, status: "ativo" },
  })
}

async function getGroupLimitsPayload(userId) {
  const maxGroups = await getUserMaxGroups(userId)
  const monitored = await countMonitoredGroups(userId)
  return { maxGroups, monitored, remaining: Math.max(0, maxGroups - monitored) }
}

/**
 * Resolve quais groupJids podem ser ativados respeitando o limite.
 * Ativa parcialmente quando a seleção excede vagas restantes (ex.: 55 selecionados, 50 vagas).
 */
async function resolveActivationBatch(userId, groupJids) {
  const limit = await getUserMaxGroups(userId)
  const unique = [...new Set((groupJids || []).filter(Boolean))]
  const current = await countMonitoredGroups(userId)
  const remaining = Math.max(0, limit - current)

  if (!unique.length) {
    return { jids: [], skipped: 0, limit, current, remaining, partial: false }
  }

  const existingRows = await prisma.whatsAppGroup.findMany({
    where: { userId, groupJid: { in: unique } },
    select: { groupJid: true, monitoringEnabled: true, status: true },
  })
  const existingSet = new Set(existingRows.map((g) => g.groupJid))
  const monitoredSet = new Set(
    existingRows.filter((g) => g.monitoringEnabled && g.status === "ativo").map((g) => g.groupJid),
  )

  const unknown = unique.filter((jid) => !existingSet.has(jid))
  const valid = unique.filter((jid) => existingSet.has(jid))
  const alreadyMonitored = valid.filter((jid) => monitoredSet.has(jid))
  const newCandidates = valid.filter((jid) => !monitoredSet.has(jid))

  if (remaining === 0 && newCandidates.length > 0) {
    const err = new Error(
      `Limite de ${limit} grupos monitorados por número. Você já tem ${current} ativo(s). Desative um grupo para liberar vaga.`,
    )
    err.code = "GROUP_LIMIT_EXCEEDED"
    err.status = 409
    err.meta = { limit, current, requested: newCandidates.length, remaining: 0 }
    throw err
  }

  const toActivateNew = newCandidates.slice(0, remaining)
  const skipped = Math.max(0, newCandidates.length - toActivateNew.length)
  const jids = [...new Set([...alreadyMonitored, ...toActivateNew])]

  return {
    jids,
    skipped,
    unknown: unknown.length,
    limit,
    current,
    remaining: Math.max(0, remaining - toActivateNew.length),
    partial: skipped > 0,
  }
}

async function assertCanActivateGroups(userId, groupJids) {
  const batch = await resolveActivationBatch(userId, groupJids)
  return batch
}

/** Retorna apenas groupJids monitorados e ativos; lança se nenhum válido. */
async function resolveMonitoredGroupJidsForSend(userId, groupJids) {
  const unique = [...new Set((groupJids || []).filter(Boolean))]
  if (!unique.length) {
    const err = new Error("Selecione ao menos um grupo monitorado.")
    err.code = "VALIDATION_ERROR"
    err.status = 400
    throw err
  }

  const rows = await prisma.whatsAppGroup.findMany({
    where: { userId, groupJid: { in: unique }, monitoringEnabled: true, status: "ativo" },
    select: { groupJid: true },
  })
  const ok = new Set(rows.map((r) => r.groupJid))
  const valid = unique.filter((jid) => ok.has(jid))
  const invalid = unique.filter((jid) => !ok.has(jid))

  if (!valid.length) {
    const err = new Error("Nenhum dos grupos selecionados está ativo e monitorado.")
    err.code = "GROUPS_NOT_MONITORED"
    err.status = 400
    err.meta = { invalid }
    throw err
  }

  return { valid, invalid }
}

module.exports = {
  DEFAULT_MAX_GROUPS,
  getUserMaxGroups,
  countMonitoredGroups,
  getGroupLimitsPayload,
  assertCanActivateGroups,
  resolveActivationBatch,
  resolveMonitoredGroupJidsForSend,
}

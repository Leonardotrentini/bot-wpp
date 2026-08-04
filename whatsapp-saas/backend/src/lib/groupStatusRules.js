/**
 * Regra simples de status do grupo:
 * - Sem atividade por X horas → inativo
 * - Qualquer mensagem inbound → volta para ativo
 * Admins são ignorados.
 */

const { phoneDigitsFromJid } = require("./participantIdentity")

const DEFAULT_RULES = {
  enabled: false,
  inactiveAfterHours: 72,
}

function clampHours(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_RULES.inactiveAfterHours
  return Math.max(1, Math.min(8760, Math.round(n)))
}

/** Aceita formato novo { enabled, inactiveAfterHours } ou legado { rules: [...] }. */
function normalizeStatusRules(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RULES }

  if (Array.isArray(raw.rules)) {
    const first = raw.rules.find((r) => r && r.enabled !== false) || raw.rules[0]
    if (!first || typeof first !== "object") return { ...DEFAULT_RULES }
    const hoursFromDays =
      first.days != null && Number.isFinite(Number(first.days)) ? Math.round(Number(first.days) * 24) : null
    return {
      enabled: first.enabled !== false && raw.rules.some((r) => r && r.enabled !== false),
      inactiveAfterHours: clampHours(first.inactiveAfterHours ?? hoursFromDays ?? DEFAULT_RULES.inactiveAfterHours),
    }
  }

  return {
    enabled: raw.enabled === true,
    inactiveAfterHours: clampHours(raw.inactiveAfterHours ?? DEFAULT_RULES.inactiveAfterHours),
  }
}

function isAdminRole(role) {
  return role === "admin" || role === "superadmin"
}

function digitsMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const minLen = Math.min(a.length, b.length)
  if (minLen < 8) return false
  return a.slice(-Math.min(minLen, 12)) === b.slice(-Math.min(minLen, 12))
}

function findParticipantForSender(participants, senderJid) {
  if (!senderJid || !participants?.length) return null
  const direct = participants.find((p) => p.participantJid === senderJid)
  if (direct) return direct
  const senderDigits = phoneDigitsFromJid(senderJid)
  if (!senderDigits) return null
  return (
    participants.find((p) => {
      const pd = phoneDigitsFromJid(p.participantJid) || (p.phone ? String(p.phone).replace(/\D/g, "") : "")
      return digitsMatch(senderDigits, pd)
    }) || null
  )
}

/**
 * Reativa participante inativo quando envia mensagem no grupo (se a regra estiver ligada).
 */
async function reactivateParticipantOnActivity(prisma, { group, senderJid }) {
  if (!group?.id || !senderJid) return null
  const rules = normalizeStatusRules(group.groupStatusRules)
  if (!rules.enabled) return null

  const participants = await prisma.whatsAppGroupParticipant.findMany({
    where: { groupId: group.id, status: { not: "saiu" } },
    select: { id: true, participantJid: true, phone: true, role: true, status: true },
  })
  const participant = findParticipantForSender(participants, senderJid)
  if (!participant) return null
  if (isAdminRole(participant.role)) return null
  if (participant.status === "ativo") return null
  if (participant.status !== "inativo") return null

  await prisma.whatsAppGroupParticipant.update({
    where: { id: participant.id },
    data: { status: "ativo", leftAt: null, lastSyncedAt: new Date() },
  })
  return participant.participantJid
}

/**
 * Marca como inativo quem está ativo e sem mensagem inbound há X horas.
 * Usa createdAt do participante se nunca falou no grupo.
 */
async function applyInactiveStatusForGroup(prisma, group, now = new Date()) {
  const rules = normalizeStatusRules(group.groupStatusRules)
  if (!rules.enabled) return { updated: 0, participantJids: [] }

  const cutoffMs = now.getTime() - rules.inactiveAfterHours * 60 * 60 * 1000

  const participants = await prisma.whatsAppGroupParticipant.findMany({
    where: {
      groupId: group.id,
      status: "ativo",
      role: { notIn: ["admin", "superadmin"] },
    },
    select: { id: true, participantJid: true, phone: true, createdAt: true },
  })
  if (!participants.length) return { updated: 0, participantJids: [] }

  const lastBySender = await prisma.whatsAppMessage.groupBy({
    by: ["senderJid"],
    where: { groupId: group.id, fromMe: false, senderJid: { not: null } },
    _max: { timestamp: true },
  })

  const lastByDigits = new Map()
  for (const row of lastBySender) {
    const jid = row.senderJid
    const ts = row._max?.timestamp
    if (!jid || !ts) continue
    const t = ts.getTime()
    lastByDigits.set(jid, t)
    const d = phoneDigitsFromJid(jid)
    if (d) {
      const prev = lastByDigits.get(d)
      if (!prev || t > prev) lastByDigits.set(d, t)
    }
  }

  const toInactivate = []
  for (const p of participants) {
    let lastMs = lastByDigits.get(p.participantJid) || null
    if (lastMs == null) {
      const d = phoneDigitsFromJid(p.participantJid) || (p.phone ? String(p.phone).replace(/\D/g, "") : "")
      if (d) lastMs = lastByDigits.get(d) || null
    }
    if (lastMs == null) {
      lastMs = p.createdAt ? new Date(p.createdAt).getTime() : 0
    }
    if (lastMs <= cutoffMs) toInactivate.push(p)
  }

  if (!toInactivate.length) return { updated: 0, participantJids: [] }

  const ids = toInactivate.map((p) => p.id)
  const { count } = await prisma.whatsAppGroupParticipant.updateMany({
    where: { id: { in: ids } },
    data: { status: "inativo", lastSyncedAt: now },
  })

  return {
    updated: count,
    participantJids: toInactivate.map((p) => p.participantJid),
  }
}

/** Varre grupos monitorados com regra ativa. */
async function tickGroupStatusRules(prisma) {
  const groups = await prisma.whatsAppGroup.findMany({
    where: {
      monitoringEnabled: true,
      groupStatusRules: { not: null },
    },
    select: {
      id: true,
      groupJid: true,
      groupStatusRules: true,
    },
  })

  let groupsChecked = 0
  let totalUpdated = 0
  for (const group of groups) {
    const rules = normalizeStatusRules(group.groupStatusRules)
    if (!rules.enabled) continue
    groupsChecked += 1
    const result = await applyInactiveStatusForGroup(prisma, group)
    totalUpdated += result.updated
  }

  return { groupsChecked, totalUpdated }
}

module.exports = {
  DEFAULT_RULES,
  normalizeStatusRules,
  reactivateParticipantOnActivity,
  applyInactiveStatusForGroup,
  tickGroupStatusRules,
}

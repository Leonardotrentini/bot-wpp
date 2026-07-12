/**
 * Novos leads unificados: CRM (1:1) + grupos, sem duplicar a mesma pessoa.
 */

const { prisma } = require("./prisma")
const { phoneDigitsFromJid, phoneDigitsFromValue } = require("./participantIdentity")

function isInRange(date, start, end) {
  if (!date) return false
  const t = new Date(date).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function isGroupConnected(group) {
  return group.status === "ativo" && Boolean(group.monitoringEnabled)
}

/** Registro canônico por telefone (preferido) ou JID. */
class LeadRegistry {
  constructor() {
    this.canonical = new Set()
    this.phoneToCanonical = new Map()
    this.jidToCanonical = new Map()
    this.sources = new Map()
  }

  add({ phone, jid }, source) {
    const digits = phoneDigitsFromValue(phone) || phoneDigitsFromJid(jid)
    const j = String(jid || "")
      .trim()
      .toLowerCase()

    let canonical = null

    if (digits && this.phoneToCanonical.has(digits)) {
      canonical = this.phoneToCanonical.get(digits)
    } else if (j && this.jidToCanonical.has(j)) {
      canonical = this.jidToCanonical.get(j)
    } else if (digits) {
      canonical = `p:${digits}`
      this.phoneToCanonical.set(digits, canonical)
    } else if (j) {
      canonical = `j:${j}`
    }

    if (!canonical) return false

    if (digits) this.phoneToCanonical.set(digits, canonical)
    if (j) this.jidToCanonical.set(j, canonical)

    const isNew = !this.canonical.has(canonical)
    this.canonical.add(canonical)

    if (!this.sources.has(canonical)) this.sources.set(canonical, new Set())
    this.sources.get(canonical).add(source)

    return isNew
  }

  getSummary() {
    let crmOnly = 0
    let groupOnly = 0
    let both = 0

    for (const src of this.sources.values()) {
      const hasCrm = src.has("crm")
      const hasGroup = src.has("group")
      if (hasCrm && hasGroup) both += 1
      else if (hasCrm) crmOnly += 1
      else if (hasGroup) groupOnly += 1
    }

    const fromCrm = crmOnly + both
    const fromGroups = groupOnly + both

    return {
      total: this.canonical.size,
      fromCrm,
      fromGroups,
      crmOnly,
      groupOnly,
      both,
    }
  }
}

async function loadGroupsScope(userId, groupJids) {
  const allGroups = await prisma.whatsAppGroup.findMany({
    where: { userId },
    include: {
      participants: {
        select: {
          participantJid: true,
          phone: true,
          createdAt: true,
        },
      },
    },
  })

  const connected = allGroups.filter(isGroupConnected)
  if (!groupJids?.length) return connected
  const set = new Set(groupJids)
  return connected.filter((g) => set.has(g.groupJid))
}

async function collectCrmLeadsInPeriod(userId, start, end) {
  const grouped = await prisma.crmMessage.groupBy({
    by: ["conversationId"],
    where: { userId, fromMe: false },
    _min: { timestamp: true },
  })

  const conversationIds = grouped
    .filter((row) => {
      const firstAt = row._min?.timestamp
      return firstAt && firstAt >= start && firstAt <= end
    })
    .map((row) => row.conversationId)

  if (!conversationIds.length) return []

  const convos = await prisma.crmConversation.findMany({
    where: { id: { in: conversationIds } },
    select: {
      remoteJid: true,
      contact: { select: { phone: true, remoteJid: true } },
    },
  })

  return convos.map((c) => ({
    phone: c.contact?.phone || null,
    jid: c.remoteJid || c.contact?.remoteJid || null,
  }))
}

function collectGroupLeadsInPeriod(groups, start, end) {
  const leads = []
  const seenJid = new Set()

  for (const group of groups) {
    const activatedAt = group.activatedAt ? new Date(group.activatedAt) : null
    const effectiveStart =
      activatedAt && activatedAt.getTime() > start.getTime() ? activatedAt : start

    for (const p of group.participants || []) {
      const jid = p.participantJid
      if (!jid || !isInRange(p.createdAt, effectiveStart, end)) continue
      if (seenJid.has(jid)) continue
      seenJid.add(jid)
      leads.push({ phone: p.phone || null, jid })
    }
  }

  return leads
}

/**
 * Total de novos leads no período (CRM + grupos), deduplicado por telefone/JID.
 */
async function buildUnifiedLeadsMetrics(userId, start, end, { groupJids = null } = {}) {
  const [crmLeads, groups] = await Promise.all([
    collectCrmLeadsInPeriod(userId, start, end),
    loadGroupsScope(userId, groupJids),
  ])

  const groupLeads = collectGroupLeadsInPeriod(groups, start, end)
  const registry = new LeadRegistry()

  for (const lead of crmLeads) registry.add(lead, "crm")
  for (const lead of groupLeads) registry.add(lead, "group")

  const summary = registry.getSummary()

  return {
    ...summary,
    conversationsStarted: summary.fromCrm,
    newGroupMembers: summary.fromGroups,
  }
}

module.exports = {
  LeadRegistry,
  buildUnifiedLeadsMetrics,
  collectCrmLeadsInPeriod,
  collectGroupLeadsInPeriod,
}

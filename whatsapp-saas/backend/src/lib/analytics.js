const { prisma } = require("./prisma")
const {
  MESSAGE_RETENTION_DAYS,
  loadUnifiedMessages,
  messagesByDaySeries,
  messagesByHourBuckets,
  buildMetricsMeta,
  periodToRange,
  countMessagesToday,
  topGroupsByMessageCount,
  retentionRange,
} = require("./messageMetrics")

function timeAgoPt(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "Agora"
  if (min < 60) return `Há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Há ${h} h`
  const d = Math.floor(h / 24)
  return `Há ${d} dia${d > 1 ? "s" : ""}`
}

function participantEngagementPct(participants) {
  if (!participants?.length) return 0
  const active = participants.filter((p) => p.status === "ativo").length
  return (active / participants.length) * 100
}

function isInRange(date, start, end) {
  if (!date) return false
  const t = new Date(date).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function isGroupConnected(group) {
  return group.status === "ativo" || Boolean(group.monitoringEnabled)
}

/** Novos leads, saídas e % ativos no período (participantes únicos por JID). */
function computeLeadMetrics(groups, start, end) {
  const seenNew = new Set()
  const seenExit = new Set()
  const byJid = new Map()

  for (const g of groups) {
    const activatedAt = g.activatedAt ? new Date(g.activatedAt) : null
    const effectiveStart =
      activatedAt && activatedAt.getTime() > start.getTime() ? activatedAt : start

    for (const p of g.participants || []) {
      const jid = p.participantJid
      if (!jid) continue

      if (isInRange(p.createdAt, effectiveStart, end)) seenNew.add(jid)
      if (isInRange(p.leftAt, start, end)) seenExit.add(jid)
      else if (p.status === "saiu" && isInRange(p.updatedAt, start, end)) seenExit.add(jid)

      const cur = byJid.get(jid)
      if (!cur) {
        byJid.set(jid, { status: p.status, leftAt: p.leftAt })
      } else {
        if (p.status === "ativo") cur.status = "ativo"
        else if (p.status === "saiu") cur.status = "saiu"
        if (p.leftAt) cur.leftAt = p.leftAt
        if (p.status === "inativo") cur.status = "inativo"
      }
    }
  }

  let active = 0
  let excludedLeft = 0
  let excludedInactive = 0
  for (const [, p] of byJid) {
    if (p.status === "saiu" || p.leftAt) {
      excludedLeft++
      continue
    }
    if (p.status === "inativo") {
      excludedInactive++
      continue
    }
    if (p.status === "ativo") active++
  }

  const eligible = byJid.size - excludedLeft - excludedInactive
  const activeLeadsPct = eligible > 0 ? Number(((active / eligible) * 100).toFixed(1)) : 0

  return {
    newLeads: seenNew.size,
    exits: seenExit.size,
    activeLeadsPct,
    activeLeads: active,
    eligibleLeads: eligible,
    totalLeadsTracked: byJid.size,
  }
}

function isEngagementAfter(base, next) {
  if (base.groupId !== next.groupId) return false
  if (!base.fromMe && !next.fromMe) {
    return Boolean(base.senderJid && next.senderJid && base.senderJid !== next.senderJid)
  }
  if (base.fromMe && !next.fromMe) return true
  if (!base.fromMe && next.fromMe) return true
  return false
}

function scoreMessagesEngagement(messages, windowMs = 60 * 60 * 1000) {
  const byGroup = new Map()
  for (const m of messages) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, [])
    byGroup.get(m.groupId).push(m)
  }
  const scores = []
  for (const list of byGroup.values()) {
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    for (let i = 0; i < list.length; i++) {
      const base = list[i]
      const body = String(base.body || "").trim()
      let replies = 0
      for (let j = i + 1; j < list.length; j++) {
        const bt = new Date(list[j].timestamp).getTime()
        const at = new Date(base.timestamp).getTime()
        if (bt - at > windowMs) break
        if (isEngagementAfter(base, list[j])) replies++
      }
      const score = replies * 100 + Math.min(body.length, 80)
      if (replies > 0 || body.length >= 4) {
        scores.push({ message: base, replies, score })
      }
    }
  }
  return scores.sort((a, b) => b.score - a.score || b.replies - a.replies)
}

function truncateBody(text, max = 72) {
  const t = String(text || "").trim() || "[mídia]"
  return t.length > max ? `${t.slice(0, max)}…` : t
}

async function loadReactionsMap(userId, messages) {
  const keys = new Map()
  for (const m of messages) {
    if (!m.messageId) continue
    keys.set(`${m.groupId}:${m.messageId}`, { groupId: m.groupId, messageId: m.messageId })
  }
  if (!keys.size) return new Map()
  const groupIds = [...new Set([...keys.values()].map((k) => k.groupId))]
  const messageIds = [...new Set([...keys.values()].map((k) => k.messageId))]
  const rows = await prisma.messageEngagement.findMany({
    where: { userId, groupId: { in: groupIds }, messageId: { in: messageIds } },
    select: { groupId: true, messageId: true, reactionsCount: true },
  })
  return new Map(rows.map((r) => [`${r.groupId}:${r.messageId}`, r.reactionsCount]))
}

function readCountForMessage(m) {
  if (!m.fromMe) return 0
  if (m.outboundStatus === "lido") return 1
  return 0
}

async function buildTopEngagedMessages(userId, messages, groupIdToName, limit = 12) {
  const reactionMap = await loadReactionsMap(userId, messages)
  const normalized = messages.map((m) => ({
    ...m,
    timestamp: new Date(m.timestamp).getTime(),
  }))

  const scored = scoreMessagesEngagement(normalized)
  const used = new Set()
  const picked = []

  const inboundScored = scored.filter((item) => !item.message.fromMe)
  const minInbound = Math.min(6, limit)

  for (const item of inboundScored) {
    if (picked.filter((p) => !p.message.fromMe).length >= minInbound) break
    if (picked.length >= limit) break
    if (used.has(item.message.id)) continue
    used.add(item.message.id)
    picked.push(item)
  }

  for (const item of scored) {
    if (picked.length >= limit) break
    if (used.has(item.message.id)) continue
    used.add(item.message.id)
    picked.push(item)
  }

  if (picked.length < limit) {
    const fillers = normalized
      .filter((m) => !used.has(m.id) && String(m.body || "").trim().length >= 2)
      .sort((a, b) => {
        if (Boolean(a.fromMe) !== Boolean(b.fromMe)) return a.fromMe ? 1 : -1
        return b.timestamp - a.timestamp
      })
    for (const m of fillers) {
      if (picked.length >= limit) break
      used.add(m.id)
      picked.push({ message: m, replies: 0, score: 0 })
    }
  }

  return picked.map((item, idx) => {
    const m = item.message
    const isPlatformOnly = String(m.id).startsWith("outbound-")
    const reactions =
      m.messageId && reactionMap.has(`${m.groupId}:${m.messageId}`)
        ? reactionMap.get(`${m.groupId}:${m.messageId}`)
        : 0
    const reads = readCountForMessage(m)
    const interactions = item.replies + reactions
    return {
      id: m.id || `top-${idx}`,
      title: truncateBody(m.body),
      group: groupIdToName.get(m.groupId) || "Grupo",
      senderName: m.senderName || (m.fromMe ? "Você" : "Membro"),
      fromMe: Boolean(m.fromMe),
      replies: item.replies,
      reactions,
      reads,
      interactions,
      engagementRate: interactions > 0 ? Math.min(99, interactions * 10 + 5) : 0,
      isOutbound: isPlatformOnly,
      at: new Date(m.timestamp).toISOString(),
    }
  })
}

async function buildAnalytics(userId, period = "2d", startDate, endDate, groupsIn = null) {
  const { start, end, retentionDays } = periodToRange(period, startDate, endDate)

  const groups =
    groupsIn ||
    (await prisma.whatsAppGroup.findMany({
      where: { userId, status: "ativo" },
      include: {
        participants: { select: { status: true, participantJid: true, name: true, createdAt: true } },
      },
      orderBy: { name: "asc" },
    }))

  if (!groups.length) {
    return emptyAnalytics(period)
  }

  const { messages, importedCount, outboundCount } = await loadUnifiedMessages(userId, groups, start, end)

  const totalMessages = messages.length
  const inbound = messages.filter((m) => !m.fromMe)

  const senderSet = new Set()
  const senderNames = new Map()
  const senderMsgCount = new Map()
  for (const m of inbound) {
    if (!m.senderJid) continue
    senderSet.add(m.senderJid)
    if (m.senderName) senderNames.set(m.senderJid, m.senderName)
    senderMsgCount.set(m.senderJid, (senderMsgCount.get(m.senderJid) || 0) + 1)
  }

  const uniqueParticipantStatus = new Map()
  let newMembersInPeriod = 0
  const groupComparison = []
  const engagementByGroup = []

  for (const g of groups) {
    const members = g.participants.length || g.memberCount || 0
    const active = g.participants.filter((p) => p.status === "ativo").length
    const msgsInPeriod = messages.filter((m) => m.groupId === g.id).length
    const engagement = participantEngagementPct(g.participants)

    for (const p of g.participants) {
      if (!uniqueParticipantStatus.has(p.participantJid) || p.status === "ativo") {
        uniqueParticipantStatus.set(p.participantJid, p.status)
      }
      if (p.createdAt >= start) newMembersInPeriod++
    }

    groupComparison.push({
      id: g.groupJid,
      name: g.name,
      status: g.status,
      messages: msgsInPeriod,
      members: members || g.memberCount || 0,
      engagement: Number(engagement.toFixed(1)),
    })

    engagementByGroup.push({
      name: g.name,
      value: active || Math.round(msgsInPeriod * 0.1) || 1,
    })
  }

  const totalUniqueMembers = uniqueParticipantStatus.size
  const activeMembers = [...uniqueParticipantStatus.values()].filter((s) => s === "ativo").length
  const responseRate =
    totalUniqueMembers > 0 ? Number(((senderSet.size / totalUniqueMembers) * 100).toFixed(1)) : 0

  const memberGrowthPct =
    totalUniqueMembers > 0
      ? Number(((newMembersInPeriod / totalUniqueMembers) * 100).toFixed(1))
      : 0

  const daySeries = messagesByDaySeries(messages, start, end)
  const messagesByDay = daySeries.map((d) => ({
    day: d.day,
    full: d.full,
    count: d.msgs,
  }))

  const topMembers = [...senderMsgCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([jid, msgs]) => ({
      name: senderNames.get(jid) || jid.split("@")[0] || "Membro",
      msgs,
    }))

  const groupIdToName = new Map(groups.map((g) => [g.id, g.name]))
  const topMessages = await buildTopEngagedMessages(userId, messages, groupIdToName, 12)

  return {
    period,
    totalMessages,
    responseRate,
    activeMembers: activeMembers || senderSet.size,
    inactiveMembers: Math.max(totalUniqueMembers - activeMembers, 0),
    memberGrowthPct,
    messagesByDay,
    messagesByHour: messagesByHourBuckets(messages),
    engagementByGroup,
    topMembers,
    topMessages,
    groupComparison,
    meta: {
      groupsCount: groups.length,
      activeGroupsOnly: true,
      ...buildMetricsMeta({ messages, importedCount, outboundCount, start, end, retentionDays }),
    },
  }
}

function emptyAnalytics(period) {
  return {
    period,
    totalMessages: 0,
    responseRate: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    memberGrowthPct: 0,
    messagesByDay: [],
    messagesByHour: Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, count: 0 })),
    engagementByGroup: [],
    topMembers: [],
    topMessages: [],
    groupComparison: [],
    meta: {
      groupsCount: 0,
      messagesImported: false,
      outboundCount: 0,
      hasActivity: false,
      messageRetentionDays: MESSAGE_RETENTION_DAYS,
    },
  }
}

async function buildDashboard(userId, groupsIn = null) {
  const groups =
    groupsIn ||
    (await prisma.whatsAppGroup.findMany({
      where: { userId, status: "ativo" },
      include: { participants: { select: { participantJid: true, status: true } } },
      orderBy: { name: "asc" },
    }))

  const now = new Date()
  const { start, end, retentionDays } = retentionRange(now)

  const { messages, importedCount, outboundCount } = await loadUnifiedMessages(userId, groups, start, end)

  const uniqueMembers = new Set()
  let activeCount = 0
  for (const g of groups) {
    for (const p of g.participants) {
      uniqueMembers.add(p.participantJid)
      if (p.status === "ativo") activeCount++
    }
  }
  const totalMembers = uniqueMembers.size || groups.reduce((s, g) => s + (g.memberCount || 0), 0)
  const engagementRate =
    totalMembers > 0 ? Number(((activeCount / totalMembers) * 100).toFixed(1)) : 0

  const messagesToday = countMessagesToday(messages, now)
  const messagesByDay = messagesByDaySeries(messages, start, end)
  const last24h = new Date(now.getTime() - 86400000)
  const topGroups = topGroupsByMessageCount(messages, groups, last24h)

  const [recentOutbound, recentAutomations, recentInbound] = await Promise.all([
    prisma.outboundMessage.findMany({
      where: { userId },
      orderBy: { sentAt: "desc" },
      take: 4,
      select: { id: true, groupName: true, body: true, sentAt: true, status: true },
    }),
    prisma.automation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, name: true, status: true, updatedAt: true },
    }),
    Promise.resolve(
      [...messages]
        .filter((m) => !m.fromMe)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 3),
    ),
  ])

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]))

  const recentActivities = []
  for (const o of recentOutbound) {
    recentActivities.push({
      id: `out-${o.id}`,
      text: `Mensagem enviada para ${o.groupName}: ${(o.body || "").slice(0, 48)}${(o.body || "").length > 48 ? "…" : ""}`,
      time: timeAgoPt(o.sentAt),
      at: o.sentAt.toISOString(),
    })
  }
  for (const m of recentInbound) {
    const gName = groupNameById.get(m.groupId) || "Grupo"
    const who = m.senderName || "Membro"
    recentActivities.push({
      id: `in-${m.id}`,
      text: `${who} em ${gName}: ${truncateBody(m.body, 40)}`,
      time: timeAgoPt(m.timestamp),
      at: new Date(m.timestamp).toISOString(),
    })
  }
  for (const a of recentAutomations) {
    recentActivities.push({
      id: `auto-${a.id}`,
      text: `Automação “${a.name}” — ${a.status}`,
      time: timeAgoPt(a.updatedAt),
      at: a.updatedAt.toISOString(),
    })
  }
  for (const g of groups.filter((x) => x.messagesLastSyncAt).slice(0, 2)) {
    recentActivities.push({
      id: `sync-${g.id}`,
      text: `Mensagens sincronizadas em “${g.name}”`,
      time: timeAgoPt(g.messagesLastSyncAt),
      at: g.messagesLastSyncAt.toISOString(),
    })
  }
  recentActivities.sort((a, b) => new Date(b.at) - new Date(a.at))

  const activeLeadsPct = engagementRate

  return {
    totalGroups: groups.length,
    totalMembers,
    messagesToday,
    engagementRate,
    activeLeadsPct,
    messagesByDay,
    messagesLast7Days: messagesByDay,
    topGroups,
    recentActivities: recentActivities.slice(0, 6).map(({ id, text, time }) => ({ id, text, time })),
    meta: {
      whatsappConnected: groups.length > 0,
      ...buildMetricsMeta({ messages, importedCount, outboundCount, start, end, retentionDays }),
    },
  }
}

/** Visão geral unificada (Dashboard + Analytics enxuto). */
async function buildOverview(userId, { groupJids = null, period = "2d" } = {}) {
  const allGroups = await prisma.whatsAppGroup.findMany({
    where: { userId },
    include: {
      participants: {
        select: {
          participantJid: true,
          status: true,
          createdAt: true,
          leftAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { name: "asc" },
  })

  const connected = allGroups.filter(isGroupConnected)
  const selected =
    groupJids?.length > 0
      ? groupJids.filter((jid) => connected.some((g) => g.groupJid === jid))
      : null
  const scope = selected?.length ? connected.filter((g) => selected.includes(g.groupJid)) : connected

  const { start, end, retentionDays } = periodToRange(period)
  const leadMetrics = computeLeadMetrics(scope, start, end)

  const dashboard = await buildDashboard(userId, scope)
  const analytics = await buildAnalytics(userId, period, undefined, undefined, scope)

  const connectedGroupsList = (selected?.length ? scope : connected).map((g) => ({
    id: g.groupJid,
    name: g.name,
  }))

  let connectedGroupsLabel = ""
  if (!connected.length) {
    connectedGroupsLabel = "Nenhum grupo conectado"
  } else if (selected?.length === 1) {
    connectedGroupsLabel = scope[0]?.name || ""
  } else if (selected?.length > 1) {
    connectedGroupsLabel = `${selected.length} grupos selecionados`
  } else if (connected.length === 1) {
    connectedGroupsLabel = connected[0].name
  } else {
    connectedGroupsLabel = `${connected.length} grupos conectados`
  }

  return {
    ...dashboard,
    period,
    totalGroups: scope.length,
    connectedGroupsCount: connectedGroupsList.length,
    connectedGroups: connectedGroupsList,
    connectedGroupsLabel,
    filterMode: selected?.length ? "selected" : "all",
    selectedGroupJids: selected || [],
    newLeads: leadMetrics.newLeads,
    exits: leadMetrics.exits,
    activeLeadsPct: leadMetrics.activeLeadsPct,
    activeLeads: leadMetrics.activeLeads,
    eligibleLeads: leadMetrics.eligibleLeads,
    totalMessagesInPeriod: analytics.totalMessages,
    topMembers: (analytics.topMembers || []).slice(0, 8),
    topMessages: analytics.topMessages || [],
    groupComparison: (analytics.groupComparison || []).slice(0, 10),
    meta: {
      ...dashboard.meta,
      ...analytics.meta,
      hasInboundMessages: analytics.meta?.hasInboundMessages,
      messageRetentionDays: retentionDays,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    },
  }
}

module.exports = {
  buildAnalytics,
  buildDashboard,
  buildOverview,
  periodToRange,
  MESSAGE_RETENTION_DAYS,
  timeAgoPt,
}

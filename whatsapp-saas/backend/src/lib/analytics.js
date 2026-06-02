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

function buildTopEngagedMessages(messages, groupIdToName, limit = 12) {
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
    return {
      id: m.id || `top-${idx}`,
      title: truncateBody(m.body),
      group: groupIdToName.get(m.groupId) || "Grupo",
      senderName: m.senderName || (m.fromMe ? "Você" : "Membro"),
      fromMe: Boolean(m.fromMe),
      replies: item.replies,
      reactions: 0,
      engagementRate: item.replies > 0 ? Math.min(99, item.replies * 12 + 5) : 0,
      isOutbound: isPlatformOnly,
      at: new Date(m.timestamp).toISOString(),
    }
  })
}

async function buildAnalytics(userId, period = "2d", startDate, endDate) {
  const { start, end, retentionDays } = periodToRange(period, startDate, endDate)

  const groups = await prisma.whatsAppGroup.findMany({
    where: { userId, status: "ativo" },
    include: {
      participants: { select: { status: true, participantJid: true, name: true, createdAt: true } },
    },
    orderBy: { name: "asc" },
  })

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
  const topMessages = buildTopEngagedMessages(messages, groupIdToName, 12)

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

async function buildDashboard(userId) {
  const groups = await prisma.whatsAppGroup.findMany({
    where: { userId, status: "ativo" },
    include: { participants: { select: { participantJid: true, status: true } } },
    orderBy: { name: "asc" },
  })

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

  return {
    totalGroups: groups.length,
    totalMembers,
    messagesToday,
    engagementRate,
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

module.exports = { buildAnalytics, buildDashboard, periodToRange, MESSAGE_RETENTION_DAYS, timeAgoPt }

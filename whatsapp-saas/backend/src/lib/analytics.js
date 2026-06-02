const { prisma } = require("./prisma")

const PT_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

function periodToRange(period, startDate, endDate) {
  const end = endDate ? new Date(`${endDate}T23:59:59.999-03:00`) : new Date()
  let start
  if (period === "hoje") {
    start = new Date(`${end.toISOString().slice(0, 10)}T00:00:00.000-03:00`)
  } else if (period === "30d") {
    start = new Date(end.getTime() - 30 * 86400000)
  } else if (period === "custom" && startDate) {
    start = new Date(`${startDate}T00:00:00.000-03:00`)
  } else {
    start = new Date(end.getTime() - 7 * 86400000)
  }
  if (start > end) start = new Date(end.getTime() - 86400000)
  return { start, end }
}

function dayKeyInSp(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

function hourInSp(date) {
  return Number(
    date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }),
  )
}

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

function countRepliesAfter(messages, windowMs = 30 * 60 * 1000) {
  const byGroup = new Map()
  for (const m of messages) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, [])
    byGroup.get(m.groupId).push(m)
  }
  const scores = []
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp)
    for (let i = 0; i < list.length; i++) {
      const base = list[i]
      if (base.fromMe) continue
      let replies = 0
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].timestamp - base.timestamp > windowMs) break
        if (!list[j].fromMe && list[j].senderJid && list[j].senderJid !== base.senderJid) replies++
      }
      if (replies > 0 || (base.body && base.body.length > 10)) {
        scores.push({ message: base, replies })
      }
    }
  }
  return scores.sort((a, b) => b.replies - a.replies)
}

async function buildAnalytics(userId, period = "7d", startDate, endDate) {
  const { start, end } = periodToRange(period, startDate, endDate)

  const groups = await prisma.whatsAppGroup.findMany({
    where: { userId, status: "ativo" },
    include: {
      participants: { select: { status: true, participantJid: true, name: true, createdAt: true } },
    },
    orderBy: { name: "asc" },
  })

  const groupDbIds = groups.map((g) => g.id)
  if (!groupDbIds.length) {
    return emptyAnalytics(period)
  }

  const messages = await prisma.whatsAppMessage.findMany({
    where: {
      userId,
      groupId: { in: groupDbIds },
      timestamp: { gte: start, lte: end },
    },
    select: {
      id: true,
      groupId: true,
      timestamp: true,
      fromMe: true,
      senderJid: true,
      senderName: true,
      body: true,
    },
    orderBy: { timestamp: "asc" },
  })

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

  const dayBuckets = new Map()
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, count: 0 }))

  for (const m of messages) {
    const dk = dayKeyInSp(m.timestamp)
    dayBuckets.set(dk, (dayBuckets.get(dk) || 0) + 1)
    const h = hourInSp(m.timestamp)
    if (h >= 0 && h < 24) hourBuckets[h].count++
  }

  const messagesByDay = [...dayBuckets.keys()]
    .sort()
    .map((key) => {
      const d = new Date(`${key}T12:00:00-03:00`)
      return {
        day: PT_DAYS[d.getDay()],
        full: key,
        count: dayBuckets.get(key) || 0,
      }
    })

  const topMembers = [...senderMsgCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([jid, msgs]) => ({
      name: senderNames.get(jid) || jid.split("@")[0] || "Membro",
      msgs,
    }))

  const groupIdToName = new Map(groups.map((g) => [g.id, g.name]))
  const replyScores = countRepliesAfter(
    messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp).getTime() })),
  )
  const topMessages = replyScores.slice(0, 6).map((item, idx) => {
    const body = item.message.body || "[mídia]"
    const replies = item.replies
    const rate = totalMessages > 0 ? Number(((replies / Math.max(inbound.length, 1)) * 100 + replies * 2).toFixed(1)) : 0
    return {
      id: item.message.id || `msg-${idx}`,
      title: body.length > 72 ? `${body.slice(0, 72)}…` : body,
      group: groupIdToName.get(item.message.groupId) || "Grupo",
      engagementRate: Math.min(99, Math.max(rate, replies > 0 ? 8 : 2)),
      reactions: 0,
      replies,
    }
  })

  return {
    period,
    totalMessages,
    responseRate,
    activeMembers: activeMembers || senderSet.size,
    inactiveMembers: Math.max(totalUniqueMembers - activeMembers, 0),
    memberGrowthPct,
    messagesByDay,
    messagesByHour: hourBuckets,
    engagementByGroup,
    topMembers,
    topMessages,
    groupComparison,
    meta: {
      groupsCount: groups.length,
      activeGroupsOnly: true,
      messagesImported: totalMessages > 0,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
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
    meta: { groupsCount: 0, messagesImported: false },
  }
}

async function buildDashboard(userId) {
  const groups = await prisma.whatsAppGroup.findMany({
    where: { userId, status: "ativo" },
    include: { participants: { select: { participantJid: true, status: true } } },
    orderBy: { name: "asc" },
  })

  const now = new Date()
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000-03:00`)
  const last7Start = new Date(now.getTime() - 7 * 86400000)
  const last24h = new Date(now.getTime() - 86400000)

  const groupDbIds = groups.map((g) => g.id)

  const [messagesToday, messagesLast7DaysRaw, topGroupsRaw, recentOutbound, recentAutomations] =
    await Promise.all([
      groupDbIds.length
        ? prisma.whatsAppMessage.count({
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: todayStart } },
          })
        : 0,
      groupDbIds.length
        ? prisma.whatsAppMessage.findMany({
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: last7Start } },
            select: { timestamp: true },
          })
        : [],
      groupDbIds.length
        ? prisma.whatsAppMessage.groupBy({
            by: ["groupId"],
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: last24h } },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
          })
        : [],
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
    ])

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

  const dayBuckets = new Map()
  for (const m of messagesLast7DaysRaw) {
    const dk = dayKeyInSp(m.timestamp)
    dayBuckets.set(dk, (dayBuckets.get(dk) || 0) + 1)
  }
  const messagesLast7Days = []
  const cursor = new Date(last7Start)
  while (cursor <= now) {
    const key = dayKeyInSp(cursor)
    messagesLast7Days.push({
      day: PT_DAYS[cursor.getDay()],
      count: dayBuckets.get(key) || 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  const groupByDbId = new Map(groups.map((g) => [g.id, g]))
  const topGroups = topGroupsRaw.map((row) => {
    const g = groupByDbId.get(row.groupId)
    return {
      id: g?.groupJid || row.groupId,
      name: g?.name || "Grupo",
      messages24h: row._count.id,
    }
  })

  const recentActivities = []
  for (const o of recentOutbound) {
    recentActivities.push({
      id: `out-${o.id}`,
      text: `Mensagem enviada para ${o.groupName}: ${(o.body || "").slice(0, 48)}${(o.body || "").length > 48 ? "…" : ""}`,
      time: timeAgoPt(o.sentAt),
      at: o.sentAt.toISOString(),
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
    messagesLast7Days,
    topGroups,
    recentActivities: recentActivities.slice(0, 6).map(({ id, text, time }) => ({ id, text, time })),
    meta: {
      whatsappConnected: groups.length > 0,
      hasImportedMessages: messagesLast7DaysRaw.length > 0,
    },
  }
}

module.exports = { buildAnalytics, buildDashboard, periodToRange }

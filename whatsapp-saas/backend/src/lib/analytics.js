const { prisma } = require("./prisma")
const { MESSAGE_RETENTION_DAYS, clampRangeToRetention } = require("./messageRetention")

const PT_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
const OUTBOUND_OK_STATUSES = ["enviado", "entregue", "lido"]

async function loadUnifiedGroupMessages(userId, groups, start, end) {
  const groupDbIds = groups.map((g) => g.id)
  const groupJids = groups.map((g) => g.groupJid)
  const jidToDbId = new Map(groups.map((g) => [g.groupJid, g.id]))

  const [imported, outbound] = await Promise.all([
    prisma.whatsAppMessage.findMany({
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
    }),
    groupJids.length
      ? prisma.outboundMessage.findMany({
          where: {
            userId,
            groupJid: { in: groupJids },
            sentAt: { gte: start, lte: end },
            status: { in: OUTBOUND_OK_STATUSES },
          },
          select: { id: true, groupJid: true, groupName: true, body: true, sentAt: true },
          orderBy: { sentAt: "asc" },
        })
      : [],
  ])

  const importedKeys = new Set()
  for (const m of imported) {
    if (!m.fromMe) continue
    const day = dayKeyInSp(m.timestamp)
    importedKeys.add(`${m.groupId}:${String(m.body || "").trim().toLowerCase()}:${day}`)
  }

  const merged = [...imported]
  for (const o of outbound) {
    const groupId = jidToDbId.get(o.groupJid)
    if (!groupId) continue
    const day = dayKeyInSp(o.sentAt)
    const key = `${groupId}:${String(o.body || "").trim().toLowerCase()}:${day}`
    if (importedKeys.has(key)) continue
    merged.push({
      id: `outbound-${o.id}`,
      groupId,
      timestamp: o.sentAt,
      fromMe: true,
      senderJid: null,
      senderName: "Você",
      body: o.body || "",
    })
  }

  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  return { messages: merged, importedCount: imported.length, outboundCount: outbound.length }
}

function periodToRange(period, startDate, endDate) {
  const now = new Date()
  const end = endDate ? new Date(`${endDate}T23:59:59.999-03:00`) : now
  let start
  if (period === "hoje") {
    start = new Date(`${end.toISOString().slice(0, 10)}T00:00:00.000-03:00`)
  } else if (period === "custom" && startDate) {
    start = new Date(`${startDate}T00:00:00.000-03:00`)
  } else if (period === "7d" || period === "30d") {
    start = new Date(end.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  } else {
    start = new Date(end.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  }
  if (start > end) start = new Date(end.getTime() - 86400000)
  return clampRangeToRetention(start, end, now)
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
    list.sort((a, b) => a.timestamp - b.timestamp)
    for (let i = 0; i < list.length; i++) {
      const base = list[i]
      const body = String(base.body || "").trim()
      let replies = 0
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].timestamp - base.timestamp > windowMs) break
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

  const { messages, importedCount, outboundCount } = await loadUnifiedGroupMessages(
    userId,
    groups,
    start,
    end,
  )

  const totalMessages = messages.length
  const inbound = messages.filter((m) => !m.fromMe)
  const inboundCount = inbound.length
  const outboundOnlyCount = messages.filter((m) => String(m.id).startsWith("outbound-")).length

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
  const topMessages = buildTopEngagedMessages(messages, groupIdToName, 12)

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
      messagesImported: importedCount > 0,
      inboundCount,
      outboundCount,
      hasInboundMessages: inboundCount > 0,
      hasActivity: totalMessages > 0,
      messageRetentionDays: retentionDays,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      onlyPlatformOutbound: inboundCount === 0 && outboundOnlyCount > 0,
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
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000-03:00`)
  const { start: retentionStart } = clampRangeToRetention(
    new Date(now.getTime() - MESSAGE_RETENTION_DAYS * 86400000),
    now,
    now,
  )
  const last24h = new Date(now.getTime() - 86400000)

  const groupDbIds = groups.map((g) => g.id)
  const groupJids = groups.map((g) => g.groupJid)

  const outboundWhere = (from) => ({
    userId,
    groupJid: { in: groupJids },
    sentAt: { gte: from },
    status: { in: OUTBOUND_OK_STATUSES },
  })

  const [messagesTodayWa, messagesTodayOut, messagesInWindowWa, messagesInWindowOut, topGroupsWa, topGroupsOut, recentOutbound, recentAutomations] =
    await Promise.all([
      groupDbIds.length
        ? prisma.whatsAppMessage.count({
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: todayStart } },
          })
        : 0,
      groupJids.length ? prisma.outboundMessage.count({ where: outboundWhere(todayStart) }) : 0,
      groupDbIds.length
        ? prisma.whatsAppMessage.findMany({
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: retentionStart } },
            select: { timestamp: true },
          })
        : [],
      groupJids.length
        ? prisma.outboundMessage.findMany({
            where: outboundWhere(retentionStart),
            select: { sentAt: true },
          })
        : [],
      groupDbIds.length
        ? prisma.whatsAppMessage.groupBy({
            by: ["groupId"],
            where: { userId, groupId: { in: groupDbIds }, timestamp: { gte: last24h } },
            _count: { id: true },
          })
        : [],
      groupJids.length
        ? prisma.outboundMessage.groupBy({
            by: ["groupJid"],
            where: outboundWhere(last24h),
            _count: { id: true },
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

  const messagesToday = messagesTodayWa + messagesTodayOut

  const dayBuckets = new Map()
  for (const m of messagesInWindowWa) {
    const dk = dayKeyInSp(m.timestamp)
    dayBuckets.set(dk, (dayBuckets.get(dk) || 0) + 1)
  }
  for (const m of messagesInWindowOut) {
    const dk = dayKeyInSp(m.sentAt)
    dayBuckets.set(dk, (dayBuckets.get(dk) || 0) + 1)
  }
  const messagesByDay = []
  const cursor = new Date(retentionStart)
  while (cursor <= now) {
    const key = dayKeyInSp(cursor)
    messagesByDay.push({
      day: PT_DAYS[cursor.getDay()],
      count: dayBuckets.get(key) || 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  const groupByDbId = new Map(groups.map((g) => [g.id, g]))
  const msg24hByJid = new Map()
  for (const row of topGroupsWa) {
    const g = groupByDbId.get(row.groupId)
    if (g) msg24hByJid.set(g.groupJid, (msg24hByJid.get(g.groupJid) || 0) + row._count.id)
  }
  for (const row of topGroupsOut) {
    msg24hByJid.set(row.groupJid, (msg24hByJid.get(row.groupJid) || 0) + row._count.id)
  }
  const topGroups = [...msg24hByJid.entries()]
    .map(([jid, count]) => {
      const g = groups.find((x) => x.groupJid === jid)
      return {
        id: jid,
        name: g?.name || jid,
        messages24h: count,
      }
    })
    .sort((a, b) => b.messages24h - a.messages24h)
    .slice(0, 5)

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
    messagesByDay,
    messagesLast7Days: messagesByDay,
    topGroups,
    recentActivities: recentActivities.slice(0, 6).map(({ id, text, time }) => ({ id, text, time })),
    meta: {
      whatsappConnected: groups.length > 0,
      hasImportedMessages: messagesInWindowWa.length + messagesInWindowOut.length > 0,
      messageRetentionDays: MESSAGE_RETENTION_DAYS,
    },
  }
}

module.exports = { buildAnalytics, buildDashboard, periodToRange, MESSAGE_RETENTION_DAYS }

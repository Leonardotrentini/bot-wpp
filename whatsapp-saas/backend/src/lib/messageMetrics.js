const { prisma } = require("./prisma")
const { MESSAGE_RETENTION_DAYS, clampRangeToRetention, getRetentionCutoffDate } = require("./messageRetention")

const PT_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
const OUTBOUND_OK_STATUSES = ["enviado", "entregue", "lido"]

function dayKeyInSp(date) {
  return new Date(date).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

function hourInSp(date) {
  return Number(
    new Date(date).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }),
  )
}

function todayStartInSp(now = new Date()) {
  const key = dayKeyInSp(now)
  return new Date(`${key}T00:00:00.000-03:00`)
}

function retentionRange(now = new Date()) {
  return clampRangeToRetention(
    new Date(now.getTime() - MESSAGE_RETENTION_DAYS * 86400000),
    now,
    now,
  )
}

async function loadUnifiedMessages(userId, groups, start, end) {
  const groupDbIds = groups.map((g) => g.id)
  const groupJids = groups.map((g) => g.groupJid)
  const jidToDbId = new Map(groups.map((g) => [g.groupJid, g.id]))

  if (!groupDbIds.length) {
    return { messages: [], importedCount: 0, outboundCount: 0, inboundCount: 0 }
  }

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
        messageId: true,
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
          select: {
            id: true,
            groupJid: true,
            groupName: true,
            body: true,
            sentAt: true,
            providerMessageId: true,
            status: true,
          },
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
      groupJid: o.groupJid,
      messageId: o.providerMessageId || null,
      timestamp: o.sentAt,
      fromMe: true,
      senderJid: null,
      senderName: "Você",
      body: o.body || "",
      outboundStatus: o.status,
    })
  }

  const activatedByGroupId = new Map(
    groups.map((g) => [g.id, g.activatedAt ? new Date(g.activatedAt) : null]),
  )
  const filtered = merged.filter((m) => {
    const activated = activatedByGroupId.get(m.groupId)
    if (!activated) return true
    return new Date(m.timestamp).getTime() >= activated.getTime()
  })

  filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const inboundCount = filtered.filter((m) => !m.fromMe).length

  return {
    messages: filtered,
    importedCount: filtered.filter((m) => !String(m.id).startsWith("outbound-")).length,
    outboundCount: outbound.length,
    inboundCount,
  }
}

function filterMessagesByTime(messages, start, end) {
  const t0 = start.getTime()
  const t1 = end.getTime()
  return messages.filter((m) => {
    const t = new Date(m.timestamp).getTime()
    return t >= t0 && t <= t1
  })
}

function countMessagesToday(messages, now = new Date()) {
  const start = todayStartInSp(now)
  return filterMessagesByTime(messages, start, now).length
}

function messagesByDaySeries(messages, start, end, { valueKey = "count" } = {}) {
  const dayBuckets = new Map()
  for (const m of messages) {
    const dk = dayKeyInSp(m.timestamp)
    dayBuckets.set(dk, (dayBuckets.get(dk) || 0) + 1)
  }

  const series = []
  const cursor = new Date(start)
  const endTime = end.getTime()
  while (cursor.getTime() <= endTime) {
    const key = dayKeyInSp(cursor)
    const row = {
      day: PT_DAYS[cursor.getDay()],
      full: key,
      msgs: dayBuckets.get(key) || 0,
    }
    row[valueKey] = row.msgs
    series.push(row)
    cursor.setDate(cursor.getDate() + 1)
  }
  return series
}

function computePeakHour(messages) {
  const hours = Array.from({ length: 24 }, () => 0)
  for (const m of messages) {
    const h = hourInSp(m.timestamp)
    if (h >= 0 && h < 24) hours[h]++
  }
  let peak = -1
  let peakH = 0
  for (let h = 0; h < 24; h++) {
    if (hours[h] > peak) {
      peak = hours[h]
      peakH = h
    }
  }
  return peak > 0 ? `${peakH}h` : "—"
}

function computeMessagesPerDayAvg(messages, start, end) {
  const series = messagesByDaySeries(messages, start, end)
  if (!series.length) return 0
  const total = series.reduce((s, d) => s + d.msgs, 0)
  const daysWithData = series.filter((d) => d.msgs > 0).length || series.length
  return Number((total / daysWithData).toFixed(1))
}

function messagesByHourBuckets(messages) {
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, count: 0 }))
  for (const m of messages) {
    const h = hourInSp(m.timestamp)
    if (h >= 0 && h < 24) hourBuckets[h].count++
  }
  return hourBuckets
}

function topGroupsByMessageCount(messages, groups, since) {
  const counts = new Map()
  const jidByDbId = new Map(groups.map((g) => [g.id, g.groupJid]))
  const nameByJid = new Map(groups.map((g) => [g.groupJid, g.name]))
  const t0 = since.getTime()

  for (const m of messages) {
    if (new Date(m.timestamp).getTime() < t0) continue
    const jid = m.groupJid || jidByDbId.get(m.groupId)
    if (!jid) continue
    counts.set(jid, (counts.get(jid) || 0) + 1)
  }

  return [...counts.entries()]
    .map(([jid, count]) => ({
      id: jid,
      name: nameByJid.get(jid) || jid,
      messages24h: count,
    }))
    .sort((a, b) => b.messages24h - a.messages24h)
    .slice(0, 5)
}

function buildMetricsMeta({ messages, importedCount, outboundCount, start, end, retentionDays = MESSAGE_RETENTION_DAYS }) {
  const inboundCount = messages.filter((m) => !m.fromMe).length
  const outboundOnlyCount = messages.filter((m) => String(m.id).startsWith("outbound-")).length
  return {
    messageRetentionDays: retentionDays,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    messagesImported: importedCount > 0,
    inboundCount,
    outboundCount,
    totalUnified: messages.length,
    hasInboundMessages: inboundCount > 0,
    hasActivity: messages.length > 0,
    onlyPlatformOutbound: inboundCount === 0 && outboundOnlyCount > 0,
  }
}

function computeGroupOverview(messages, groupDbId, start, end) {
  const groupMsgs = messages.filter((m) => m.groupId === groupDbId)
  return {
    messagesPerDay: computeMessagesPerDayAvg(groupMsgs, start, end),
    peakHour: computePeakHour(groupMsgs),
    activity: messagesByDaySeries(groupMsgs, start, end),
    totalMessagesInPeriod: groupMsgs.length,
  }
}

function periodToRange(period, startDate, endDate) {
  const now = new Date()
  const end = endDate ? new Date(`${endDate}T23:59:59.999-03:00`) : now
  let start
  if (period === "hoje") {
    start = todayStartInSp(end)
  } else if (period === "custom" && startDate) {
    start = new Date(`${startDate}T00:00:00.000-03:00`)
  } else {
    start = new Date(end.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  }
  if (start > end) start = new Date(end.getTime() - 86400000)
  return clampRangeToRetention(start, end, now)
}

module.exports = {
  PT_DAYS,
  OUTBOUND_OK_STATUSES,
  MESSAGE_RETENTION_DAYS,
  dayKeyInSp,
  hourInSp,
  todayStartInSp,
  retentionRange,
  getRetentionCutoffDate,
  loadUnifiedMessages,
  filterMessagesByTime,
  countMessagesToday,
  messagesByDaySeries,
  messagesByHourBuckets,
  computePeakHour,
  computeMessagesPerDayAvg,
  topGroupsByMessageCount,
  buildMetricsMeta,
  computeGroupOverview,
  periodToRange,
}

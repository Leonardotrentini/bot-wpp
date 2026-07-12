/**
 * Painel unificado de relatórios — Grupos + CRM + Meta Ads + Atribuição.
 */

const { prisma } = require("./prisma")
const { buildOverview } = require("./analytics")
const { listCrmSales } = require("./crmSales")
const { fetchMetaAdsDashboard, formatAdsFields } = require("./metaAds")
const { MESSAGE_RETENTION_DAYS, todayStartInSp } = require("./messageMetrics")
const {
  buildCrmOverview,
  buildCrmFunnelByStage,
  buildCrmActivitySeries,
  buildCrmConversionCounts,
  buildCrmSalesByDay,
} = require("./crmFunnelMetrics")
const { buildAttributionSummary } = require("./attributionMetrics")

function reportPeriodToRange(period, startDate, endDate) {
  const now = new Date()
  const end = endDate ? new Date(`${endDate}T23:59:59.999-03:00`) : now
  let start

  if (period === "hoje") {
    start = todayStartInSp(end)
  } else if (period === "7d") {
    start = new Date(end.getTime() - 7 * 86400000)
  } else if (period === "30d") {
    start = new Date(end.getTime() - 30 * 86400000)
  } else if (period === "custom" && startDate) {
    start = new Date(`${startDate}T00:00:00.000-03:00`)
  } else {
    start = new Date(end.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  }

  if (start > end) start = new Date(end.getTime() - 86400000)
  return { start, end }
}

function mapPeriodToMetaPeriod(period) {
  if (period === "hoje") return "today"
  if (period === "30d") return "30d"
  if (period === "custom") return "30d"
  return "7d"
}

function parseReportQuery(req) {
  const rawIds = req.query?.groupIds || req.query?.groupId
  const groupJids = rawIds
    ? String(rawIds)
        .split(",")
        .map((s) => String(s).trim())
        .filter(Boolean)
    : null
  const period = typeof req.query?.period === "string" ? req.query.period : "7d"
  const startDate = typeof req.query?.startDate === "string" ? req.query.startDate : undefined
  const endDate = typeof req.query?.endDate === "string" ? req.query.endDate : undefined
  const metaPeriod =
    typeof req.query?.metaPeriod === "string" ? req.query.metaPeriod : mapPeriodToMetaPeriod(period)

  return { groupJids, period, startDate, endDate, metaPeriod }
}

async function buildReportDashboard(userId, options = {}) {
  const { groupJids, period, startDate, endDate, metaPeriod } = options
  const { start, end } = reportPeriodToRange(period, startDate, endDate)
  const partialErrors = []

  const groupsPromise = buildOverview(userId, {
    groupJids,
    period,
    startDate,
    endDate,
  }).catch((err) => {
    partialErrors.push({ source: "groups", message: err?.message || "Falha ao carregar grupos." })
    return null
  })

  const crmPromise = Promise.all([
    buildCrmOverview(userId),
    buildCrmFunnelByStage(userId),
    buildCrmActivitySeries(userId, start, end),
    buildCrmConversionCounts(userId, start, end),
    buildCrmSalesByDay(userId, start, end),
    listCrmSales(prisma, userId, {
      from: start.toISOString(),
      to: end.toISOString(),
      page: 1,
      limit: 1,
    }),
  ]).catch((err) => {
    partialErrors.push({ source: "crm", message: err?.message || "Falha ao carregar CRM." })
    return null
  })

  const metaIntegration = await prisma.metaIntegration.findUnique({ where: { userId } }).catch(() => null)
  const adsFields = formatAdsFields(metaIntegration)

  const metaPromise =
    metaIntegration && adsFields.adsConnected
      ? fetchMetaAdsDashboard(prisma, userId, metaIntegration, { period: metaPeriod }).catch((err) => {
          partialErrors.push({ source: "meta", message: err?.message || "Falha ao carregar Meta Ads." })
          return { error: "META_FETCH_FAILED", message: err?.message }
        })
      : Promise.resolve({
          error: "NOT_CONNECTED",
          message: metaIntegration ? "Meta Ads não configurado ou desativado." : "Integração Meta não configurada.",
        })

  const attrPromise = buildAttributionSummary(userId, start, end).catch((err) => {
    partialErrors.push({ source: "attribution", message: err?.message || "Falha ao carregar atribuição." })
    return { total: 0, bySource: [], byCampaign: [] }
  })

  const [groupsRaw, crmRaw, metaRaw, attribution] = await Promise.all([
    groupsPromise,
    crmPromise,
    metaPromise,
    attrPromise,
  ])

  let crm = null
  if (crmRaw) {
    const [overview, funnel, funnelEvents, conversions, salesByDay, salesList] = crmRaw
    crm = {
      overview,
      funnel,
      funnelEvents,
      conversions,
      sales: {
        summary: salesList.summary,
        byDay: salesByDay,
      },
    }
  }

  const metaConnected = Boolean(metaIntegration?.enabled)
  const metaAdsOk = Boolean(metaRaw?.ok)
  let meta = {
    connected: metaConnected,
    adsEnabled: adsFields.adsEnabled,
    adsConfigured: adsFields.adsConfigured,
    summary: null,
    conversions: crm?.conversions || {
      conversationStarted: 0,
      leadQualified: 0,
      quote: 0,
      purchase: 0,
    },
    campaigns: [],
    error: metaRaw?.error || null,
    message: metaRaw?.message || null,
    lastSyncAt: adsFields.lastAdsSyncAt,
  }

  if (metaAdsOk && metaRaw.summary) {
    meta = {
      ...meta,
      summary: metaRaw.summary,
      campaigns: metaRaw.campaigns || [],
      account: metaRaw.account || null,
      syncedAt: metaRaw.syncedAt || null,
      error: null,
      message: null,
    }
  } else if (metaRaw?.error && metaRaw.error !== "NOT_CONNECTED") {
    partialErrors.push({ source: "meta", message: metaRaw.message || "Meta Ads indisponível." })
  }

  const groups = groupsRaw
    ? {
        connectedGroupsCount: groupsRaw.connectedGroupsCount,
        connectedGroupsLabel: groupsRaw.connectedGroupsLabel,
        connectedGroups: groupsRaw.connectedGroups,
        newLeads: groupsRaw.newLeads,
        exits: groupsRaw.exits,
        activeLeadsPct: groupsRaw.activeLeadsPct,
        activeLeads: groupsRaw.activeLeads,
        inactiveLeads: groupsRaw.inactiveLeads,
        messagesToday: groupsRaw.messagesToday,
        messagesByDay: groupsRaw.messagesByDay || groupsRaw.messagesLast7Days,
        messagesByHour: groupsRaw.messagesByHour,
        topGroups: groupsRaw.topGroups,
        topMembers: groupsRaw.topMembers,
        topMessages: groupsRaw.topMessages,
        groupComparison: groupsRaw.groupComparison,
        recentActivities: groupsRaw.recentActivities,
        engagementRate: groupsRaw.engagementRate,
        totalMembers: groupsRaw.totalMembers,
        responseRate: groupsRaw.responseRate,
        meta: groupsRaw.meta,
      }
    : null

  return {
    filters: {
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      groupIds: groupJids || [],
      metaPeriod,
    },
    groups,
    crm,
    meta,
    attribution,
    meta_info: {
      groupsRetentionDays: MESSAGE_RETENTION_DAYS,
      crmRangeNote: "CRM usa o período completo selecionado.",
      metaLastSyncAt: adsFields.lastAdsSyncAt,
      partialErrors,
    },
  }
}

module.exports = {
  parseReportQuery,
  reportPeriodToRange,
  mapPeriodToMetaPeriod,
  buildReportDashboard,
}

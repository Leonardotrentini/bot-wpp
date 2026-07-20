/**
 * Painel unificado de relatórios — Grupos + CRM + Meta Ads + Atribuição.
 */

const { prisma } = require("./prisma")
const { buildOverview } = require("./analytics")
const { listCrmSales } = require("./crmSales")
const { fetchMetaAdsDashboard, formatAdsFields } = require("./metaAds")
const { MESSAGE_RETENTION_DAYS, todayStartInSp, isActivationRetention } = require("./messageMetrics")
const { assertUserInScope } = require("./orgScope")
const {
  buildCrmOverview,
  buildCrmFunnelByStage,
  buildCrmActivitySeries,
  buildCrmConversionCounts,
  buildCrmQuotesSummary,
  buildCrmSalesByDay,
  buildCrmTagFunnelCounts,
  buildCrmTagsList,
} = require("./crmFunnelMetrics")
const {
  buildAttributionSummary,
  buildSalesByAdContent,
  rankAdsByLeadsAndSales,
} = require("./attributionMetrics")
const { buildUnifiedLeadsMetrics } = require("./reportLeadsMetrics")

function toSpDateStr(date) {
  return new Date(date).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

function reportPeriodToRange(period, startDate, endDate) {
  const now = new Date()
  // startDate/endDate só valem em "custom". Em hoje/2d/7d/30d usam "agora",
  // senão um personalizado antigo no localStorage contamina o filtro (ex.: "Hoje" com vendas de outro dia).
  const useCustom = period === "custom" && Boolean(startDate)
  const end = useCustom
    ? new Date(`${endDate || startDate}T23:59:59.999-03:00`)
    : now
  let start

  if (period === "hoje") {
    start = todayStartInSp(now)
  } else if (period === "2d") {
    start = new Date(now.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  } else if (period === "7d") {
    start = new Date(now.getTime() - 7 * 86400000)
  } else if (period === "30d") {
    start = new Date(now.getTime() - 30 * 86400000)
  } else if (useCustom) {
    start = new Date(`${startDate}T00:00:00.000-03:00`)
  } else {
    start = new Date(now.getTime() - MESSAGE_RETENTION_DAYS * 86400000)
  }

  if (start > end) start = new Date(end.getTime() - 86400000)
  return { start, end }
}

/** Alinha metaPeriod ao filtro do painel (custom/2d usam time_range na Meta). */
function mapPeriodToMetaPeriod(period) {
  if (period === "hoje") return "today"
  if (period === "2d") return "2d"
  if (period === "30d") return "30d"
  if (period === "custom") return "custom"
  return "7d"
}

function parseFunnelTagGroups(raw) {
  if (!raw || typeof raw !== "string") return []
  return String(raw)
    .split(";")
    .map((group) =>
      group
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .filter((g) => g.length > 0)
    .slice(0, 12)
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
  const sellerUserId =
    typeof req.query?.sellerUserId === "string" && req.query.sellerUserId.trim()
      ? req.query.sellerUserId.trim()
      : undefined
  const funnelTagGroups = parseFunnelTagGroups(req.query?.funnelTagGroups)

  return { groupJids, period, startDate, endDate, metaPeriod, sellerUserId, funnelTagGroups }
}

function costPerMetric(spend, count) {
  if (!spend || spend <= 0 || !count || count <= 0) return null
  return Math.round((spend / count) * 100) / 100
}

async function buildReportDashboard(scopeUserIds, options = {}) {
  let userIds = Array.isArray(scopeUserIds) ? [...scopeUserIds] : [scopeUserIds]
  const {
    groupJids,
    period,
    startDate,
    endDate,
    metaPeriod,
    sellerUserId,
    metaOwnerUserId,
    funnelTagGroups = [],
  } = options

  if (sellerUserId) {
    if (!assertUserInScope({ userIds }, sellerUserId)) {
      throw new Error("Vendedor fora do escopo da empresa.")
    }
    userIds = [sellerUserId]
  }

  const { start, end } = reportPeriodToRange(period, startDate, endDate)
  const partialErrors = []
  const useCustomDates = period === "custom" && Boolean(startDate)
  const metaStartDate = useCustomDates ? startDate : toSpDateStr(start)
  const metaEndDate = useCustomDates ? endDate || startDate : toSpDateStr(end)
  // Sempre deriva do período do painel (evita metaPeriod antigo "30d" em filtro custom).
  const resolvedMetaPeriod = mapPeriodToMetaPeriod(period)

  const groupsPromise = buildOverview(userIds, {
    groupJids,
    period,
    startDate: useCustomDates ? startDate : undefined,
    endDate: useCustomDates ? endDate : undefined,
  }).catch((err) => {
    partialErrors.push({ source: "groups", message: err?.message || "Falha ao carregar grupos." })
    return null
  })

  const crmPromise = Promise.all([
    buildCrmOverview(userIds, start, end),
    buildCrmFunnelByStage(userIds),
    buildCrmActivitySeries(userIds, start, end),
    buildCrmConversionCounts(userIds, start, end),
    buildCrmQuotesSummary(userIds, start, end),
    buildCrmSalesByDay(userIds, start, end),
    listCrmSales(prisma, userIds, {
      from: start.toISOString(),
      to: end.toISOString(),
      page: 1,
      limit: 1,
    }),
    buildCrmTagsList(userIds),
    buildCrmTagFunnelCounts(userIds, start, end, funnelTagGroups),
  ]).catch((err) => {
    partialErrors.push({ source: "crm", message: err?.message || "Falha ao carregar CRM." })
    return null
  })

  const metaUserId = metaOwnerUserId || userIds[0]
  const metaIntegration = await prisma.metaIntegration.findUnique({ where: { userId: metaUserId } }).catch(() => null)
  const adsFields = formatAdsFields(metaIntegration)

  const metaPromise =
    metaIntegration && adsFields.adsConnected
      ? fetchMetaAdsDashboard(prisma, metaUserId, metaIntegration, {
          period: resolvedMetaPeriod,
          startDate: metaStartDate,
          endDate: metaEndDate,
        }).catch((err) => {
          partialErrors.push({ source: "meta", message: err?.message || "Falha ao carregar Meta Ads." })
          return { error: "META_FETCH_FAILED", message: err?.message }
        })
      : Promise.resolve({
          error: "NOT_CONNECTED",
          message: metaIntegration ? "Meta Ads não configurado ou desativado." : "Integração Meta não configurada.",
        })

  const attrPromise = buildAttributionSummary(userIds, start, end).catch((err) => {
    partialErrors.push({ source: "attribution", message: err?.message || "Falha ao carregar atribuição." })
    return { total: 0, bySource: [], byCampaign: [], byContent: [], rows: [] }
  })

  const salesByAdPromise = buildSalesByAdContent(userIds, start, end).catch((err) => {
    partialErrors.push({ source: "attribution", message: err?.message || "Falha ao atribuir vendas a anúncios." })
    return new Map()
  })

  const leadsPromise = buildUnifiedLeadsMetrics(userIds, start, end, { groupJids }).catch((err) => {
    partialErrors.push({ source: "leads", message: err?.message || "Falha ao contar leads." })
    return {
      total: 0,
      fromCrm: 0,
      fromGroups: 0,
      crmOnly: 0,
      groupOnly: 0,
      both: 0,
      conversationsStarted: 0,
      newGroupMembers: 0,
    }
  })

  const [groupsRaw, crmRaw, metaRaw, attributionRaw, salesByAd, leads] = await Promise.all([
    groupsPromise,
    crmPromise,
    metaPromise,
    attrPromise,
    salesByAdPromise,
    leadsPromise,
  ])

  const attribution = {
    total: attributionRaw?.total || 0,
    bySource: attributionRaw?.bySource || [],
    byCampaign: attributionRaw?.byCampaign || [],
    byContent: attributionRaw?.byContent || [],
  }

  let crm = null
  if (crmRaw) {
    const [
      overview,
      funnel,
      funnelEvents,
      conversions,
      quotes,
      salesByDay,
      salesList,
      tags,
      tagFunnelCounts,
    ] = crmRaw
    crm = {
      overview,
      funnel,
      funnelEvents,
      conversions,
      quotes,
      sales: {
        summary: salesList.summary,
        byDay: salesByDay,
      },
      tags: tags || [],
      tagFunnelCounts: tagFunnelCounts || [],
      funnelTagGroups,
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
    topAdsByClicks: [],
    topAds: [],
    error: metaRaw?.error || null,
    message: metaRaw?.message || null,
    lastSyncAt: adsFields.lastAdsSyncAt,
  }

  if (metaAdsOk && metaRaw.summary) {
    const rankedAds = rankAdsByLeadsAndSales(
      metaRaw.topAdsByClicks || [],
      attribution.byContent,
      salesByAd,
    )
    meta = {
      ...meta,
      summary: metaRaw.summary,
      campaigns: metaRaw.campaigns || [],
      topAdsByClicks: rankedAds,
      topAds: rankedAds,
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

  const spend = meta?.summary?.spend ?? 0
  const leadTotal = leads?.total ?? crm?.overview?.conversationsStarted ?? 0
  const qualified = crm?.conversions?.leadQualified ?? 0
  const purchases = crm?.sales?.summary?.count ?? 0
  const revenue = crm?.sales?.summary?.totalAmount ?? 0

  const computed = {
    costPerLead: costPerMetric(spend, leadTotal),
    costPerQualifiedLead: costPerMetric(spend, qualified),
    costPerSale: costPerMetric(spend, purchases),
    roas: spend > 0 && revenue > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
  }

  return {
    filters: {
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      startDate: metaStartDate,
      endDate: metaEndDate,
      groupIds: groupJids || [],
      metaPeriod: resolvedMetaPeriod,
    },
    groups,
    crm,
    meta,
    attribution,
    leads,
    computed,
    meta_info: {
      groupsRetentionDays: isActivationRetention() ? null : MESSAGE_RETENTION_DAYS,
      groupsRetentionMode: isActivationRetention() ? "activation" : "rolling",
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

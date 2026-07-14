/**
 * Meta Marketing API — leitura de conta de anúncios (gastos, campanhas, criativos).
 * Token manual: System User com permissão ads_read no Business Manager.
 */

const GRAPH_API_VERSION = "v22.0"

const DATE_PRESETS = {
  today: "today",
  yesterday: "yesterday",
  "7d": "last_7d",
  "30d": "last_30d",
  month: "this_month",
}

function formatMetaError(json) {
  const err = json?.error
  if (!err) return "Erro desconhecido na API da Meta"
  const parts = [err.message || "Erro na API da Meta"]
  if (err.error_user_msg && err.error_user_msg !== err.message) {
    parts.push(err.error_user_msg)
  }
  if (err.error_subcode) parts.push(`código ${err.error_subcode}`)
  return parts.join(" — ")
}

function normalizeAdAccountId(raw) {
  const digits = String(raw || "")
    .trim()
    .replace(/^act_/i, "")
    .replace(/\D/g, "")
  if (!digits) return null
  return `act_${digits}`
}

function resolveAdsToken(integration) {
  const adsToken = String(integration?.adsAccessToken || "").trim()
  if (adsToken) return adsToken
  return String(integration?.accessToken || "").trim()
}

function formatAdsFields(row) {
  if (!row) {
    return {
      adAccountId: "",
      adsEnabled: false,
      hasAdsAccessToken: false,
      adsAccessTokenHint: null,
      adsConfigured: false,
      adsVerified: false,
      adsConnected: false,
      lastAdsSyncAt: null,
      lastAdsError: null,
    }
  }

  const adsToken = String(row.adsAccessToken || "")
  const fallbackToken = String(row.accessToken || "")
  const hasAdsToken = adsToken.length > 0 || fallbackToken.length > 0
  const adAccountId = row.adAccountId || ""
  const adsConfigured = Boolean(adAccountId && hasAdsToken)
  const adsVerified = Boolean(adsConfigured && row.lastAdsSyncAt && !row.lastAdsError)

  return {
    adAccountId,
    adsEnabled: row.adsEnabled === true,
    hasAdsAccessToken: adsToken.length > 0,
    adsAccessTokenHint: adsToken.length >= 4 ? `••••${adsToken.slice(-4)}` : null,
    adsConfigured,
    adsVerified,
    adsConnected: Boolean(adsConfigured && row.adsEnabled),
    lastAdsSyncAt: row.lastAdsSyncAt ? row.lastAdsSyncAt.toISOString() : null,
    lastAdsError: row.lastAdsError || null,
  }
}

function parseMetricNumber(value) {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapAdCreatives(ads) {
  return ads.map((ad) => {
    const creativeRaw = ad.creative?.data || ad.creative || {}
    return {
      id: ad.id,
      name: ad.name || creativeRaw.name || "—",
      status: ad.effective_status || ad.status || "—",
      campaignName: ad.campaign?.name || "—",
      thumbnailUrl: creativeRaw.thumbnail_url || creativeRaw.image_url || null,
      destinationUrl: extractCreativeDestinationUrl(creativeRaw),
      body: creativeRaw.body ? String(creativeRaw.body).slice(0, 140) : null,
      title: creativeRaw.title || null,
      callToAction: null,
    }
  })
}

function extractCreativeDestinationUrl(creative) {
  if (!creative || typeof creative !== "object") return null
  if (creative.object_url) return String(creative.object_url)
  if (creative.link_url) return String(creative.link_url)

  const spec = creative.object_story_spec
  if (spec?.link_data?.link) return String(spec.link_data.link)
  if (spec?.video_data?.call_to_action?.value?.link) {
    return String(spec.video_data.call_to_action.value.link)
  }

  const feedLinks = creative.asset_feed_spec?.link_urls
  if (Array.isArray(feedLinks) && feedLinks[0]) {
    const first = feedLinks[0]
    if (typeof first === "string") return first
    if (first?.website_url) return String(first.website_url)
    if (first?.display_url) return String(first.display_url)
  }

  return null
}

async function enrichTopAdsWithCreatives(token, ads) {
  if (!ads.length) return ads

  const ids = ads.map((a) => a.id).filter(Boolean)
  if (!ids.length) return ads

  try {
    const batch = await graphGet("", token, {
      ids: ids.join(","),
      fields:
        "preview_shareable_link,creative{thumbnail_url,image_url,object_url,link_url,object_story_spec,asset_feed_spec}",
    })

    return ads.map((ad) => {
      const row = batch?.[ad.id]
      const creative = row?.creative || {}
      const destinationUrl =
        extractCreativeDestinationUrl(creative) ||
        (row?.preview_shareable_link ? String(row.preview_shareable_link) : null) ||
        ad.destinationUrl ||
        null
      return {
        ...ad,
        thumbnailUrl: creative.thumbnail_url || creative.image_url || ad.thumbnailUrl || null,
        destinationUrl,
        previewUrl: row?.preview_shareable_link ? String(row.preview_shareable_link) : ad.previewUrl || null,
      }
    })
  } catch (err) {
    console.warn("[metaAds] creative enrichment failed:", err.message)
    return ads
  }
}

async function graphGet(path, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`)
  url.searchParams.set("access_token", accessToken)
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value))
  }

  const res = await fetch(url.toString())
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(formatMetaError(json))
    err.metaResponse = json
    throw err
  }
  return json
}

async function recordAdsSyncResult(prisma, userId, { error } = {}) {
  await prisma.metaIntegration
    .update({
      where: { userId },
      data: {
        lastAdsSyncAt: new Date(),
        lastAdsError: error ? String(error).slice(0, 500) : null,
      },
    })
    .catch(() => {})
}

async function fetchMetaAdsDashboard(prisma, userId, integration, { period = "7d" } = {}) {
  const adAccountId = normalizeAdAccountId(integration.adAccountId)
  const token = resolveAdsToken(integration)

  if (!adAccountId || !token) {
    return { error: "NOT_CONFIGURED", message: "Configure o ID da conta de anúncios e o token com permissão ads_read." }
  }

  const datePreset = DATE_PRESETS[period] || DATE_PRESETS["7d"]

  try {
    const account = await graphGet(adAccountId, token, {
      fields: "name,account_status,currency,timezone_name",
    })

    const accountInsights = await graphGet(`${adAccountId}/insights`, token, {
      fields: "spend,impressions,clicks,cpc,cpm,reach,ctr",
      date_preset: datePreset,
    })
    const insightRow = accountInsights.data?.[0] || {}

    const campaignInsights = await graphGet(`${adAccountId}/insights`, token, {
      fields: "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr",
      level: "campaign",
      date_preset: datePreset,
      limit: 25,
    })

    let creatives = []
    try {
      const ads = await graphGet(`${adAccountId}/ads`, token, {
        fields:
          "id,name,status,effective_status,campaign{id,name},creative{id,name,thumbnail_url,body,title,image_url}",
        limit: 20,
      })
      creatives = mapAdCreatives(ads.data || [])
    } catch (creativeErr) {
      console.warn("[metaAds] creatives fetch failed:", creativeErr.message)
    }

    const campaigns = (campaignInsights.data || [])
      .map((row) => ({
        id: row.campaign_id,
        name: row.campaign_name || "—",
        spend: parseMetricNumber(row.spend) || 0,
        impressions: parseInt(row.impressions || 0, 10) || 0,
        clicks: parseInt(row.clicks || 0, 10) || 0,
        cpc: parseMetricNumber(row.cpc),
        ctr: parseMetricNumber(row.ctr),
      }))
      .sort((a, b) => b.spend - a.spend)

    let topAdsByClicks = []
    try {
      const adInsights = await graphGet(`${adAccountId}/insights`, token, {
        fields: "ad_id,ad_name,campaign_name,clicks,spend,ctr,impressions",
        level: "ad",
        date_preset: datePreset,
        limit: 100,
      })
      const accountDigits = adAccountId.replace(/^act_/, "")
      topAdsByClicks = (adInsights.data || [])
        .map((row) => ({
          id: row.ad_id,
          name: row.ad_name || "—",
          campaignName: row.campaign_name || "—",
          clicks: parseInt(row.clicks || 0, 10) || 0,
          spend: parseMetricNumber(row.spend) || 0,
          ctr: parseMetricNumber(row.ctr),
          impressions: parseInt(row.impressions || 0, 10) || 0,
          adsManagerUrl: row.ad_id
            ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountDigits}&selected_ad_ids=${row.ad_id}`
            : null,
        }))
        .sort((a, b) => b.clicks - a.clicks)

      // Enriquecer top 25 para rankear por leads/vendas depois (frontend/backend cruzam atribuição).
      const toEnrich = topAdsByClicks.slice(0, 25)
      const enriched = await enrichTopAdsWithCreatives(token, toEnrich)
      topAdsByClicks = enriched
    } catch (adErr) {
      console.warn("[metaAds] ad-level insights failed:", adErr.message)
    }

    await recordAdsSyncResult(prisma, userId, {})

    return {
      ok: true,
      period,
      datePreset,
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency || "BRL",
        status: account.account_status,
        timezone: account.timezone_name,
      },
      summary: {
        spend: parseMetricNumber(insightRow.spend) || 0,
        impressions: parseInt(insightRow.impressions || 0, 10) || 0,
        clicks: parseInt(insightRow.clicks || 0, 10) || 0,
        cpc: parseMetricNumber(insightRow.cpc),
        cpm: parseMetricNumber(insightRow.cpm),
        reach: insightRow.reach != null ? parseInt(insightRow.reach, 10) : null,
        ctr: parseMetricNumber(insightRow.ctr),
      },
      campaigns,
      topAdsByClicks,
      creatives,
      syncedAt: new Date().toISOString(),
    }
  } catch (err) {
    await recordAdsSyncResult(prisma, userId, { error: err.message })
    return { error: "META_API_ERROR", message: err.message }
  }
}

async function testMetaAdsConnection(prisma, userId, integration) {
  const adAccountId = normalizeAdAccountId(integration.adAccountId)
  const token = resolveAdsToken(integration)

  if (!adAccountId || !token) {
    return { error: "NOT_CONFIGURED", message: "Configure o ID da conta de anúncios e o token." }
  }

  try {
    const account = await graphGet(adAccountId, token, {
      fields: "name,account_status,currency",
    })
    await recordAdsSyncResult(prisma, userId, {})
    return {
      ok: true,
      message: `Conta conectada: ${account.name} (${account.currency || "BRL"}).`,
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency || "BRL",
        status: account.account_status,
      },
    }
  } catch (err) {
    await recordAdsSyncResult(prisma, userId, { error: err.message })
    return { error: "META_API_ERROR", message: err.message }
  }
}

module.exports = {
  normalizeAdAccountId,
  resolveAdsToken,
  formatAdsFields,
  fetchMetaAdsDashboard,
  testMetaAdsConnection,
  DATE_PRESETS,
}

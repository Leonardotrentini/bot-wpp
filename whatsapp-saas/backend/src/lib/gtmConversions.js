/**
 * Conversões GTM/GA4 — mapeamento funil Vesto → eventos dataLayer / GA4 MP.
 */

const GTM_CONVERSION_CATALOG = [
  {
    key: "contact",
    label: "Clique WhatsApp",
    description: "Disparado na LP no clique do botão WhatsApp (equivalente ao Contact do Pixel).",
    defaultEventName: "vesto_contact",
    scope: "lp",
  },
  {
    key: "conversation_started",
    label: "Mensagem iniciada",
    description: "1ª mensagem inbound de contato novo no WhatsApp.",
    defaultEventName: "vesto_conversation_started",
    scope: "server",
  },
  {
    key: "lead_qualified",
    label: "Lead qualificado",
    description: "Tag QUALIFICADO aplicada no CRM (1x por contato).",
    defaultEventName: "vesto_lead_qualified",
    scope: "server",
  },
  {
    key: "quote",
    label: "Orçamento",
    description: "Orçamento salvo no chat com valor.",
    defaultEventName: "vesto_quote",
    scope: "server",
  },
  {
    key: "purchase",
    label: "Compra",
    description: "Compra confirmada no CRM com valor.",
    defaultEventName: "vesto_purchase",
    scope: "server",
  },
]

const META_EVENT_TO_GTM_KEY = {
  ConversationStarted: "conversation_started",
  LeadQualified: "lead_qualified",
  Quote: "quote",
  Purchase: "purchase",
}

const EVENT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/

function sanitizeEventName(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, "_")
  if (!raw || !EVENT_NAME_PATTERN.test(raw)) return null
  return raw
}

function normalizeGa4MeasurementId(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
  if (!raw) return null
  if (!/^G-[A-Z0-9]+$/.test(raw)) return null
  return raw
}

function normalizeConversionTags(input) {
  const savedByKey = new Map()
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item?.key) savedByKey.set(String(item.key), item)
    }
  }

  return GTM_CONVERSION_CATALOG.map((def) => {
    const saved = savedByKey.get(def.key) || {}
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      scope: def.scope,
      enabled: saved.enabled === true,
      eventName: sanitizeEventName(saved.eventName) || def.defaultEventName,
      tagName: String(saved.tagName || "").trim().slice(0, 80),
    }
  })
}

function getEnabledConversionTag(tags, key) {
  const list = normalizeConversionTags(tags)
  const tag = list.find((t) => t.key === key)
  if (!tag?.enabled) return null
  return tag
}

function resolveClientIdFromContact(contact) {
  const custom = contact?.customFields && typeof contact.customFields === "object" ? contact.customFields : {}
  const fbp = String(custom.fbp || custom._fbp || "").trim()
  if (fbp) return fbp.replace(/^fb\.1\./, "fb.1.")
  const phone = String(contact?.phone || contact?.jid || contact?.id || "vesto").replace(/\D/g, "")
  return `vesto.${phone || contact?.id || "anon"}`
}

async function sendGa4MeasurementEvent({ measurementId, apiSecret, clientId, eventName, params = {} }) {
  const mid = normalizeGa4MeasurementId(measurementId)
  const secret = String(apiSecret || "").trim()
  if (!mid || !secret) {
    return { sent: false, skipped: true, reason: "ga4_not_configured" }
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`
  const body = {
    client_id: String(clientId || "vesto.anon"),
    events: [
      {
        name: eventName,
        params: {
          engagement_time_msec: 1,
          ...params,
        },
      },
    ],
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `GA4 MP HTTP ${res.status}`)
  }

  return { sent: true, measurementId: mid, eventName }
}

async function trackGtmServerConversion(prisma, userId, conversionKey, { contact, amount = null, currency = "BRL" } = {}) {
  const row = await prisma.gtmIntegration.findUnique({ where: { userId } })
  if (!row || row.enabled === false) {
    return { sent: false, skipped: true, reason: "gtm_disabled" }
  }

  const tag = getEnabledConversionTag(row.conversionTags, conversionKey)
  if (!tag) {
    return { sent: false, skipped: true, reason: "tag_not_linked" }
  }

  if (tag.scope === "lp") {
    return { sent: false, skipped: true, reason: "lp_only" }
  }

  const params = {
    vesto_event: conversionKey,
    vesto_tag: tag.tagName || tag.label,
  }
  if (Number.isFinite(amount) && amount > 0) {
    params.value = amount
    params.currency = currency
  }

  try {
    return await sendGa4MeasurementEvent({
      measurementId: row.ga4MeasurementId,
      apiSecret: row.ga4ApiSecret,
      clientId: resolveClientIdFromContact(contact),
      eventName: tag.eventName,
      params,
    })
  } catch (err) {
    console.warn("[gtmConversions]", conversionKey, err?.message || err)
    return { sent: false, error: err?.message || "ga4_send_failed" }
  }
}

function trackGtmForMetaEvent(prisma, userId, metaEventName, ctx = {}) {
  const key = META_EVENT_TO_GTM_KEY[metaEventName]
  if (!key) return Promise.resolve({ skipped: true })
  return trackGtmServerConversion(prisma, userId, key, ctx).catch((err) => {
    console.warn("[gtmConversions] hook", metaEventName, err?.message || err)
    return { sent: false, error: err?.message }
  })
}

function getPublicConversionTags(row) {
  if (!row || row.enabled === false) return []
  return normalizeConversionTags(row.conversionTags)
    .filter((t) => t.enabled && t.scope === "lp")
    .map((t) => ({
      key: t.key,
      eventName: t.eventName,
      tagName: t.tagName || t.label,
    }))
}

module.exports = {
  GTM_CONVERSION_CATALOG,
  META_EVENT_TO_GTM_KEY,
  sanitizeEventName,
  normalizeGa4MeasurementId,
  normalizeConversionTags,
  getEnabledConversionTag,
  getPublicConversionTags,
  trackGtmServerConversion,
  trackGtmForMetaEvent,
  sendGa4MeasurementEvent,
}

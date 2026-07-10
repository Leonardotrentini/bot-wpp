/**
 * Meta Conversions API — envia orçamentos e vendas do CRM para otimização de anúncios.
 */

const crypto = require("crypto")

const GRAPH_API_VERSION = "v21.0"

function hashMetaValue(value) {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return null
  return crypto.createHash("sha256").update(normalized).digest("hex")
}

function normalizePhoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    return `55${digits}`
  }
  return digits
}

function buildUserData(contact) {
  const userData = {}
  const phone = normalizePhoneDigits(contact?.phone)
  const hashedPhone = hashMetaValue(phone)
  if (hashedPhone) userData.ph = [hashedPhone]

  if (contact?.id) {
    const externalId = hashMetaValue(contact.id)
    if (externalId) userData.external_id = [externalId]
  }

  return Object.keys(userData).length ? userData : undefined
}

function formatIntegrationRow(row) {
  if (!row) return null
  const token = String(row.accessToken || "")
  return {
    pixelId: row.pixelId,
    enabled: row.enabled,
    sendQuotes: row.sendQuotes,
    sendPurchases: row.sendPurchases,
    testEventCode: row.testEventCode || "",
    hasAccessToken: token.length > 0,
    accessTokenHint: token.length >= 4 ? `••••${token.slice(-4)}` : null,
    connected: Boolean(row.pixelId && token && row.enabled),
    lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
    lastEventName: row.lastEventName || null,
    lastError: row.lastError || null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function getMetaIntegration(prisma, userId) {
  const row = await prisma.metaIntegration.findUnique({ where: { userId } })
  return formatIntegrationRow(row)
}

async function getMetaIntegrationCredentials(prisma, userId) {
  return prisma.metaIntegration.findUnique({ where: { userId } })
}

async function upsertMetaIntegration(prisma, userId, data) {
  const existing = await prisma.metaIntegration.findUnique({ where: { userId } })
  const pixelId = String(data.pixelId || "").trim()
  const accessTokenRaw = data.accessToken != null ? String(data.accessToken).trim() : null
  const accessToken = accessTokenRaw || existing?.accessToken || ""

  if (!pixelId) {
    return { error: "VALIDATION", message: "Informe o ID do Pixel." }
  }
  if (!accessToken) {
    return { error: "VALIDATION", message: "Informe o token de acesso da API de Conversões." }
  }

  const row = await prisma.metaIntegration.upsert({
    where: { userId },
    create: {
      userId,
      pixelId,
      accessToken,
      enabled: data.enabled !== false,
      sendQuotes: data.sendQuotes !== false,
      sendPurchases: data.sendPurchases !== false,
      testEventCode: data.testEventCode ? String(data.testEventCode).trim() : null,
    },
    update: {
      pixelId,
      accessToken,
      enabled: data.enabled !== false,
      sendQuotes: data.sendQuotes !== false,
      sendPurchases: data.sendPurchases !== false,
      testEventCode: data.testEventCode != null ? String(data.testEventCode).trim() || null : undefined,
    },
  })

  return { integration: formatIntegrationRow(row) }
}

async function sendMetaEvent(integration, eventPayload) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.pixelId}/events?access_token=${encodeURIComponent(integration.accessToken)}`
  const body = { data: [eventPayload] }
  if (integration.testEventCode) {
    body.test_event_code = integration.testEventCode
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = json?.error?.message || `Meta API HTTP ${res.status}`
    const err = new Error(message)
    err.metaResponse = json
    throw err
  }

  return json
}

async function recordIntegrationResult(prisma, userId, { eventName, error }) {
  await prisma.metaIntegration.update({
    where: { userId },
    data: {
      lastEventAt: new Date(),
      lastEventName: eventName,
      lastError: error ? String(error).slice(0, 500) : null,
    },
  }).catch(() => {})
}

function buildQuoteEvent({ contact, amount, eventId }) {
  return {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    event_source_url: "https://vesto.group/dashboard/chat",
    user_data: buildUserData(contact),
    custom_data: {
      currency: "BRL",
      value: amount,
      content_category: "quote",
      content_name: contact?.name || contact?.pushName || "Lead WhatsApp",
    },
  }
}

function buildPurchaseEvent({ contact, amount, ticket, eventId }) {
  const custom = {
    currency: "BRL",
    value: amount,
    content_name: contact?.name || contact?.pushName || "Lead WhatsApp",
  }
  if (ticket) custom.order_id = String(ticket).slice(0, 120)

  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    event_source_url: "https://vesto.group/dashboard/chat",
    user_data: buildUserData(contact),
    custom_data: custom,
  }
}

async function trackCrmQuoteEvent(prisma, { userId, contact, amount }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendQuotes) {
    return { sent: false, skipped: true, reason: "disabled" }
  }

  const eventId = `vesto-quote-${contact.id}-${Date.now()}`
  try {
    await sendMetaEvent(integration, buildQuoteEvent({ contact, amount, eventId }))
    await recordIntegrationResult(prisma, userId, { eventName: "Lead" })
    return { sent: true, eventId, eventName: "Lead", value: amount }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: "Lead", error: err.message })
    return { sent: false, eventId, eventName: "Lead", value: amount, error: err.message }
  }
}

async function trackCrmPurchaseEvent(prisma, { userId, contact, amount, ticket }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendPurchases) {
    return { sent: false, skipped: true, reason: "disabled" }
  }

  const eventId = `vesto-purchase-${contact.id}-${Date.now()}`
  try {
    await sendMetaEvent(integration, buildPurchaseEvent({ contact, amount, ticket, eventId }))
    await recordIntegrationResult(prisma, userId, { eventName: "Purchase" })
    return { sent: true, eventId, eventName: "Purchase", value: amount }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: "Purchase", error: err.message })
    return { sent: false, eventId, eventName: "Purchase", value: amount, error: err.message }
  }
}

async function testMetaIntegration(prisma, userId) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.pixelId || !integration?.accessToken) {
    return { error: "NOT_CONFIGURED", message: "Configure o Pixel e o token antes de testar." }
  }

  const eventId = `vesto-test-${userId}-${Date.now()}`
  try {
    await sendMetaEvent(integration, {
      event_name: "PageView",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: "https://vesto.group/dashboard/integrations",
    })
    await recordIntegrationResult(prisma, userId, { eventName: "PageView" })
    return { ok: true, eventId, message: "Evento de teste enviado. Verifique no Gerenciador de Eventos da Meta." }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: "PageView", error: err.message })
    return { error: "META_API_ERROR", message: err.message }
  }
}

module.exports = {
  formatIntegrationRow,
  getMetaIntegration,
  upsertMetaIntegration,
  trackCrmQuoteEvent,
  trackCrmPurchaseEvent,
  testMetaIntegration,
}

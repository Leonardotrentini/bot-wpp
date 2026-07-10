/**
 * Meta Conversions API — envia orçamentos e vendas do CRM para otimização de anúncios.
 */

const crypto = require("crypto")

const GRAPH_API_VERSION = "v22.0"
const DEFAULT_EVENT_SOURCE_URL = "https://vesto.group/dashboard/chat"
const VESTO_USER_AGENT = "Mozilla/5.0 (compatible; VestoCRM/1.0; +https://vesto.group)"
const META_MESSAGING_CHANNEL = "whatsapp"
/** Meta exige LeadSubmitted (não Lead) para action_source business_messaging */
const META_QUOTE_EVENT_NAME = "LeadSubmitted"

function hashMetaValue(value) {
  if (value == null || value === "") return null
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return null
  return crypto.createHash("sha256").update(normalized).digest("hex")
}

function hashPhoneForMeta(phone) {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return null
  return crypto.createHash("sha256").update(digits).digest("hex")
}

function normalizePhoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    return `55${digits}`
  }
  return digits
}

function resolveContactPhone(contact) {
  if (contact?.phone) return contact.phone
  const jid = String(contact?.remoteJid || "")
  const local = jid.split("@")[0]
  if (/^\d{8,15}$/.test(local)) return local
  return null
}

function buildUserData(contact, { userId, clientIp, clientUserAgent } = {}) {
  const userData = {}

  const phone = resolveContactPhone(contact)
  const hashedPhone = hashPhoneForMeta(phone)
  if (hashedPhone) userData.ph = [hashedPhone]

  const externalKey = contact?.id || userId
  if (externalKey) {
    const hashedExternal = hashMetaValue(String(externalKey))
    if (hashedExternal) userData.external_id = [hashedExternal]
  }

  if (clientIp) userData.client_ip_address = String(clientIp)
  if (clientUserAgent) userData.client_user_agent = String(clientUserAgent)

  return userData
}

function ensureUserData(contact, options = {}) {
  const userData = buildUserData(contact, options)
  if (!userData.external_id?.length && options.userId) {
    const hashed = hashMetaValue(String(options.userId))
    if (hashed) userData.external_id = [hashed]
  }
  if (!Object.keys(userData).length) {
    const hashed = hashMetaValue(String(options.userId || "vesto-anonymous"))
    userData.external_id = [hashed]
  }
  return userData
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
    lastSuccess: row.lastError ? null : row.lastEventAt ? true : null,
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

async function sendMetaEvent(integration, eventPayload, { useTestCode = false } = {}) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.pixelId}/events?access_token=${encodeURIComponent(integration.accessToken)}`
  const body = { data: [eventPayload] }

  // test_event_code só no botão de teste — nunca em eventos reais de produção
  if (useTestCode && integration.testEventCode) {
    body.test_event_code = integration.testEventCode
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = formatMetaError(json)
    const err = new Error(message)
    err.metaResponse = json
    throw err
  }

  return json
}

async function recordIntegrationResult(prisma, userId, { eventName, error, eventsReceived }) {
  await prisma.metaIntegration
    .update({
      where: { userId },
      data: {
        lastEventAt: new Date(),
        lastEventName: eventName,
        lastError: error ? String(error).slice(0, 500) : null,
      },
    })
    .catch(() => {})
}

function businessMessagingFields() {
  return {
    action_source: "business_messaging",
    messaging_channel: META_MESSAGING_CHANNEL,
  }
}

function buildQuoteEvent({ contact, amount, eventId, userId }) {
  return {
    event_name: META_QUOTE_EVENT_NAME,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    ...businessMessagingFields(),
    event_source_url: DEFAULT_EVENT_SOURCE_URL,
    user_data: ensureUserData(contact, { userId }),
    custom_data: {
      currency: "BRL",
      value: amount,
      content_category: "quote",
      content_name: contact?.name || contact?.pushName || "Lead WhatsApp",
    },
  }
}

function buildPurchaseEvent({ contact, amount, ticket, eventId, userId }) {
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
    ...businessMessagingFields(),
    event_source_url: DEFAULT_EVENT_SOURCE_URL,
    user_data: ensureUserData(contact, { userId }),
    custom_data: custom,
  }
}

async function trackCrmQuoteEvent(prisma, { userId, contact, amount }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendQuotes) {
    return { sent: false, skipped: true, reason: "disabled" }
  }
  if (!integration.pixelId || !integration.accessToken) {
    return { sent: false, skipped: true, reason: "not_configured" }
  }

  const eventId = `vesto-quote-${contact.id}-${Date.now()}`
  try {
    const result = await sendMetaEvent(integration, buildQuoteEvent({ contact, amount, eventId, userId }))
    await recordIntegrationResult(prisma, userId, {
      eventName: META_QUOTE_EVENT_NAME,
      eventsReceived: result.events_received,
    })
    return {
      sent: true,
      eventId,
      eventName: META_QUOTE_EVENT_NAME,
      value: amount,
      eventsReceived: result.events_received,
    }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: META_QUOTE_EVENT_NAME, error: err.message })
    return { sent: false, eventId, eventName: META_QUOTE_EVENT_NAME, value: amount, error: err.message }
  }
}

async function trackCrmPurchaseEvent(prisma, { userId, contact, amount, ticket }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendPurchases) {
    return { sent: false, skipped: true, reason: "disabled" }
  }
  if (!integration.pixelId || !integration.accessToken) {
    return { sent: false, skipped: true, reason: "not_configured" }
  }

  const eventId = `vesto-purchase-${contact.id}-${Date.now()}`
  try {
    const result = await sendMetaEvent(
      integration,
      buildPurchaseEvent({ contact, amount, ticket, eventId, userId }),
    )
    await recordIntegrationResult(prisma, userId, {
      eventName: "Purchase",
      eventsReceived: result.events_received,
    })
    return {
      sent: true,
      eventId,
      eventName: "Purchase",
      value: amount,
      eventsReceived: result.events_received,
    }
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
  const userData = ensureUserData(null, { userId })
  userData.client_ip_address = "254.254.254.254"
  userData.client_user_agent = VESTO_USER_AGENT

  try {
    const result = await sendMetaEvent(
      integration,
      {
        event_name: "TestEvent",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: "https://vesto.group/dashboard/integrations",
        user_data: userData,
      },
      { useTestCode: true },
    )

    await recordIntegrationResult(prisma, userId, {
      eventName: "TestEvent",
      eventsReceived: result.events_received,
    })

    const testHint = integration.testEventCode
      ? ` Código de teste ${integration.testEventCode} aplicado — veja em Eventos de teste no Gerenciador.`
      : " Adicione um código de teste para visualizar no Gerenciador de Eventos."

    return {
      ok: true,
      eventId,
      eventsReceived: result.events_received,
      message: `Evento TestEvent aceito pela Meta (${result.events_received || 1} recebido).${testHint}`,
    }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: "TestEvent", error: err.message })
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

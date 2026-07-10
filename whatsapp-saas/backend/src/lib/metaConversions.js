/**
 * Meta Conversions API — orçamentos e vendas do CRM.
 *
 * Dois modos (documentação Meta):
 * - CRM (LP → WhatsApp, leads orgânicos): action_source system_generated + Lead/Purchase
 * - CTWA (anúncio Click-to-WhatsApp): action_source business_messaging + ctwa_clid + page_id
 */

const crypto = require("crypto")
const { parseFacebookPageId, resolveCtwaClid } = require("./metaMessaging")

const GRAPH_API_VERSION = "v22.0"
const DEFAULT_EVENT_SOURCE_URL = "https://vesto.group/dashboard/chat"
const VESTO_USER_AGENT = "Mozilla/5.0 (compatible; VestoCRM/1.0; +https://vesto.group)"
const META_MESSAGING_CHANNEL = "whatsapp"
const CRM_LEAD_EVENT = "Lead"
const CTWA_LEAD_EVENT = "LeadSubmitted"
const PURCHASE_EVENT = "Purchase"
const CRM_EVENT_SOURCE = "Vesto"

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

/** Escolhe modo conforme documentação Meta: CTWA só com ctwa_clid capturado no webhook. */
function resolveTrackingMode(contact) {
  const ctwaClid = resolveCtwaClid(contact)
  if (ctwaClid) return { mode: "ctwa", ctwaClid }
  return { mode: "crm" }
}

function contactDisplayName(contact) {
  return contact?.name || contact?.pushName || "Lead WhatsApp"
}

function crmCustomData({ amount, ticket, contentCategory }) {
  const custom = {
    currency: "BRL",
    value: amount,
    lead_event_source: CRM_EVENT_SOURCE,
    event_source: "crm",
    content_name: contentCategory === "quote" ? "Orçamento WhatsApp" : "Compra WhatsApp",
  }
  if (contentCategory) custom.content_category = contentCategory
  if (ticket) custom.order_id = String(ticket).slice(0, 120)
  return custom
}

function buildCtwaUserData(contact, { userId, facebookPageId, ctwaClid }) {
  const pageId = parseFacebookPageId(facebookPageId)
  if (!pageId) {
    const err = new Error("Configure o ID da Página do Facebook para leads de anúncio Click-to-WhatsApp.")
    err.code = "MISSING_PAGE_ID"
    throw err
  }
  const userData = ensureUserData(contact, { userId })
  userData.page_id = pageId
  userData.ctwa_clid = ctwaClid
  return userData
}

function buildQuoteEvent({ contact, amount, eventId, userId, integration, mode }) {
  if (mode.mode === "ctwa") {
    return {
      event_name: CTWA_LEAD_EVENT,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "business_messaging",
      messaging_channel: META_MESSAGING_CHANNEL,
      user_data: buildCtwaUserData(contact, {
        userId,
        facebookPageId: integration.facebookPageId,
        ctwaClid: mode.ctwaClid,
      }),
      custom_data: {
        currency: "BRL",
        value: amount,
        content_category: "quote",
        content_name: contactDisplayName(contact),
      },
    }
  }

  return {
    event_name: CRM_LEAD_EVENT,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    user_data: ensureUserData(contact, { userId }),
    custom_data: crmCustomData({ amount, contentCategory: "quote" }),
  }
}

function buildPurchaseEvent({ contact, amount, ticket, eventId, userId, integration, mode }) {
  if (mode.mode === "ctwa") {
    const custom = {
      currency: "BRL",
      value: amount,
      content_name: contactDisplayName(contact),
    }
    if (ticket) custom.order_id = String(ticket).slice(0, 120)

    return {
      event_name: PURCHASE_EVENT,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "business_messaging",
      messaging_channel: META_MESSAGING_CHANNEL,
      user_data: buildCtwaUserData(contact, {
        userId,
        facebookPageId: integration.facebookPageId,
        ctwaClid: mode.ctwaClid,
      }),
      custom_data: custom,
    }
  }

  return {
    event_name: PURCHASE_EVENT,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    user_data: ensureUserData(contact, { userId }),
    custom_data: crmCustomData({ amount, ticket, contentCategory: "purchase" }),
  }
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
    facebookPageId: row.facebookPageId || "",
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

  const facebookPageIdRaw =
    data.facebookPageId != null ? String(data.facebookPageId).trim() : existing?.facebookPageId || ""
  const facebookPageId = facebookPageIdRaw.replace(/\D/g, "") || null

  const row = await prisma.metaIntegration.upsert({
    where: { userId },
    create: {
      userId,
      pixelId,
      accessToken,
      facebookPageId,
      enabled: data.enabled !== false,
      sendQuotes: data.sendQuotes !== false,
      sendPurchases: data.sendPurchases !== false,
      testEventCode: data.testEventCode ? String(data.testEventCode).trim() : null,
    },
    update: {
      pixelId,
      accessToken,
      facebookPageId: data.facebookPageId != null ? facebookPageId : undefined,
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

async function dispatchCommerceEvent(prisma, {
  userId,
  contact,
  integration,
  buildPayload,
  eventNameForLog,
  eventIdPrefix,
  amount,
  extraReturn = {},
}) {
  const mode = resolveTrackingMode(contact)
  const eventId = `${eventIdPrefix}-${contact.id}-${Date.now()}`
  const eventName = mode.mode === "ctwa" ? (eventNameForLog.ctwa || eventNameForLog.default) : eventNameForLog.default

  if (mode.mode === "ctwa" && !integration.facebookPageId) {
    const message = "Lead veio de anúncio Click-to-WhatsApp. Configure o ID da Página do Facebook em Integrações."
    await recordIntegrationResult(prisma, userId, { eventName, error: message })
    return {
      sent: false,
      eventId,
      eventName,
      value: amount,
      trackingMode: mode.mode,
      error: message,
      reason: "missing_page_id",
      ...extraReturn,
    }
  }

  try {
    const payload = buildPayload({ eventId, mode })
    const result = await sendMetaEvent(integration, payload)
    await recordIntegrationResult(prisma, userId, { eventName, eventsReceived: result.events_received })
    return {
      sent: true,
      eventId,
      eventName,
      value: amount,
      trackingMode: mode.mode,
      eventsReceived: result.events_received,
      ...extraReturn,
    }
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName, error: err.message })
    return {
      sent: false,
      eventId,
      eventName,
      value: amount,
      trackingMode: mode.mode,
      error: err.message,
      ...extraReturn,
    }
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

  return dispatchCommerceEvent(prisma, {
    userId,
    contact,
    integration,
    amount,
    eventIdPrefix: "vesto-quote",
    eventNameForLog: { default: CRM_LEAD_EVENT, ctwa: CTWA_LEAD_EVENT },
    buildPayload: ({ eventId, mode }) =>
      buildQuoteEvent({ contact, amount, eventId, userId, integration, mode }),
  })
}

async function trackCrmPurchaseEvent(prisma, { userId, contact, amount, ticket }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendPurchases) {
    return { sent: false, skipped: true, reason: "disabled" }
  }
  if (!integration.pixelId || !integration.accessToken) {
    return { sent: false, skipped: true, reason: "not_configured" }
  }

  return dispatchCommerceEvent(prisma, {
    userId,
    contact,
    integration,
    amount,
    eventIdPrefix: "vesto-purchase",
    eventNameForLog: { default: PURCHASE_EVENT, ctwa: PURCHASE_EVENT },
    buildPayload: ({ eventId, mode }) =>
      buildPurchaseEvent({ contact, amount, ticket, eventId, userId, integration, mode }),
  })
}

async function testMetaIntegration(prisma, userId) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.pixelId || !integration?.accessToken) {
    return { error: "NOT_CONFIGURED", message: "Configure o Pixel e o token antes de testar." }
  }

  const results = []
  const testHint = integration.testEventCode
    ? ` Código ${integration.testEventCode} — veja em Eventos de teste.`
    : ""

  // 1) Conexão básica (website)
  const testEventId = `vesto-test-${userId}-${Date.now()}`
  const testUserData = ensureUserData(null, { userId })
  testUserData.client_ip_address = "254.254.254.254"
  testUserData.client_user_agent = VESTO_USER_AGENT

  try {
    const websiteResult = await sendMetaEvent(
      integration,
      {
        event_name: "TestEvent",
        event_time: Math.floor(Date.now() / 1000),
        event_id: testEventId,
        action_source: "website",
        event_source_url: "https://vesto.group/dashboard/integrations",
        user_data: testUserData,
      },
      { useTestCode: true },
    )
    results.push({ name: "TestEvent", ok: true, eventsReceived: websiteResult.events_received })
  } catch (err) {
    await recordIntegrationResult(prisma, userId, { eventName: "TestEvent", error: err.message })
    return { error: "META_API_ERROR", message: `TestEvent falhou: ${err.message}` }
  }

  // 2) Orçamento CRM (modo LP → WhatsApp — system_generated)
  const mockContact = {
    id: `test-contact-${userId}`,
    phone: "5547999999999",
    pushName: "Teste Vesto",
    customFields: {},
  }
  const crmLeadId = `vesto-test-lead-${userId}-${Date.now()}`
  try {
    const crmResult = await sendMetaEvent(
      integration,
      buildQuoteEvent({
        contact: mockContact,
        amount: 99.9,
        eventId: crmLeadId,
        userId,
        integration,
        mode: { mode: "crm" },
      }),
      { useTestCode: true },
    )
    results.push({ name: "Lead (CRM)", ok: true, eventsReceived: crmResult.events_received })
  } catch (err) {
    results.push({ name: "Lead (CRM)", ok: false, error: err.message })
  }

  // 3) Compra CRM
  const purchaseId = `vesto-test-purchase-${userId}-${Date.now()}`
  try {
    const purchaseResult = await sendMetaEvent(
      integration,
      buildPurchaseEvent({
        contact: mockContact,
        amount: 199.9,
        ticket: "TEST-001",
        eventId: purchaseId,
        userId,
        integration,
        mode: { mode: "crm" },
      }),
      { useTestCode: true },
    )
    results.push({ name: "Purchase (CRM)", ok: true, eventsReceived: purchaseResult.events_received })
  } catch (err) {
    results.push({ name: "Purchase (CRM)", ok: false, error: err.message })
  }

  const failed = results.filter((r) => !r.ok)
  const lastOk = results.filter((r) => r.ok).pop()
  await recordIntegrationResult(prisma, userId, {
    eventName: lastOk?.name || "TestEvent",
    error: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join("; ") : null,
  })

  if (failed.length === results.length) {
    return { error: "META_API_ERROR", message: failed.map((f) => f.error).join(" | ") }
  }

  const summary = results.map((r) => (r.ok ? `${r.name} ✓` : `${r.name} ✗`)).join(" · ")

  return {
    ok: true,
    results,
    message: `Testes Meta: ${summary}.${testHint}`,
  }
}

module.exports = {
  formatIntegrationRow,
  getMetaIntegration,
  upsertMetaIntegration,
  trackCrmQuoteEvent,
  trackCrmPurchaseEvent,
  testMetaIntegration,
  // exportados para testes
  resolveTrackingMode,
  buildQuoteEvent,
  buildPurchaseEvent,
}

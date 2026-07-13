/**
 * Meta Conversions API — funil do CRM (Vesto).
 *
 * Eventos custom (inglês):
 * - ConversationStarted — 1ª mensagem inbound de contato novo
 * - LeadQualified — tag QUALIFICADO
 * - Quote — orçamento salvo (1x por contato)
 * - Purchase — compra confirmada
 *
 * Modos:
 * - CRM (LP/orgânico): action_source system_generated + fbc/fbp quando disponível
 * - CTWA (anúncio WhatsApp) → pixel (padrão): system_generated + ctwa_clid em user_data
 *   (nomes custom ConversationStarted etc. são rejeitados com business_messaging — erro 2804066)
 * - CTWA → WABA dataset (META_USE_WABA_DATASET=true): business_messaging + messaging_channel
 */

const crypto = require("crypto")
const { formatAdsFields, normalizeAdAccountId } = require("./metaAds")
const { generateVestoPublicKey, parseAllowedOriginsInput } = require("./metaAttributionLead")
const { parseSellersInput, normalizeBrazilPhone, isValidBrazilWhatsapp } = require("./lpSellers")
const { parseFacebookPageId, resolveCtwaClid, resolveFbc, resolveFbp } = require("./metaMessaging")
const { getStoredClickAt } = require("./metaAttributionLead")
const { trackGtmForMetaEvent } = require("./gtmConversions")

const GRAPH_API_VERSION = "v22.0"
const VESTO_USER_AGENT = "Mozilla/5.0 (compatible; VestoCRM/1.0; +https://vesto.group)"
const VESTO_EVENT_SOURCE_URL = "https://vesto.group/dashboard/chat"
const META_MESSAGING_CHANNEL = "whatsapp"
const CRM_EVENT_SOURCE = "Vesto"
const WABA_DATASET_CACHE_MS = 60 * 60 * 1000

/** cache em memória: wabaId → { datasetId, expiresAt } */
const wabaDatasetCache = new Map()

const CONVERSATION_STARTED_EVENT = "ConversationStarted"
const LEAD_QUALIFIED_EVENT = "LeadQualified"
const QUOTE_EVENT = "Quote"
const PURCHASE_EVENT = "Purchase"

/** Mapa central estágio → (event_name, content_category, idempotência). */
const FUNNEL_STAGES = Object.freeze({
  [CONVERSATION_STARTED_EVENT]: {
    eventName: CONVERSATION_STARTED_EVENT,
    contentCategory: "conversation_started",
    eventIdPrefix: "vesto-conversation-started",
    idempotencyField: "conversationStartedEventSentAt",
    stableEventId: true,
  },
  [LEAD_QUALIFIED_EVENT]: {
    eventName: LEAD_QUALIFIED_EVENT,
    contentCategory: "qualified_lead",
    eventIdPrefix: "vesto-lead-qualified",
    idempotencyField: "qualifiedEventSentAt",
    stableEventId: true,
  },
  [QUOTE_EVENT]: {
    eventName: QUOTE_EVENT,
    contentCategory: "quote",
    eventIdPrefix: "vesto-quote",
    idempotencyField: "quoteEventSentAt",
    stableEventId: true,
  },
  [PURCHASE_EVENT]: {
    eventName: PURCHASE_EVENT,
    contentCategory: "purchase",
    eventIdPrefix: "vesto-purchase",
    idempotencyField: null,
    stableEventId: false,
  },
})

/** Nomes legados CTWA (só se META_USE_CTWA_EVENT_ALIASES=true). */
const CTWA_META_EVENT_NAMES = {
  [CONVERSATION_STARTED_EVENT]: "LeadSubmitted",
  [LEAD_QUALIFIED_EVENT]: "QualifiedLead",
  [QUOTE_EVENT]: "InitiateCheckout",
  [PURCHASE_EVENT]: PURCHASE_EVENT,
}

function useCtwaEventAliases() {
  return String(process.env.META_USE_CTWA_EVENT_ALIASES || "").toLowerCase() === "true"
}

function useWabaDatasetTarget() {
  return String(process.env.META_USE_WABA_DATASET || "").toLowerCase() === "true"
}

function resolveMetaPayloadEventName(internalEventName, mode) {
  if (mode?.mode === "ctwa" && useCtwaEventAliases()) {
    return CTWA_META_EVENT_NAMES[internalEventName] || internalEventName
  }
  return internalEventName
}

/** Valores fixos de content_category — espelham FUNNEL_STAGES. */
const CONTENT_CATEGORY = {
  CONVERSATION_STARTED: FUNNEL_STAGES[CONVERSATION_STARTED_EVENT].contentCategory,
  QUALIFIED_LEAD: FUNNEL_STAGES[LEAD_QUALIFIED_EVENT].contentCategory,
  QUOTE: FUNNEL_STAGES[QUOTE_EVENT].contentCategory,
  PURCHASE: FUNNEL_STAGES[PURCHASE_EVENT].contentCategory,
}

function getFunnelStage(eventName) {
  const stage = FUNNEL_STAGES[eventName]
  if (!stage) throw new Error(`Estágio de funil desconhecido: ${eventName}`)
  return stage
}

const FUNNEL_EVENT_NAMES = new Set(Object.keys(FUNNEL_STAGES))

function isFunnelEventName(eventName) {
  return FUNNEL_EVENT_NAMES.has(String(eventName || ""))
}

/** Guardrail: eventos do funil nunca saem sem content_category. */
function assertFunnelPayloadHasContentCategory(eventPayload) {
  const eventName = eventPayload?.event_name
  if (!isFunnelEventName(eventName)) return
  const category = eventPayload?.custom_data?.content_category
  if (!category || typeof category !== "string" || !category.trim()) {
    const err = new Error(
      `Evento ${eventName} bloqueado: custom_data.content_category é obrigatório em eventos contáveis do funil.`,
    )
    err.code = "MISSING_CONTENT_CATEGORY"
    throw err
  }
}

function buildOccurrenceEventId({ eventIdPrefix, contactId, ticket, stable = false }) {
  const base = `${eventIdPrefix}-${contactId}`
  if (stable) return base
  if (ticket) return `${base}-${String(ticket).slice(0, 80)}`
  return `${base}-${Date.now()}`
}

function resolveTestEventCode(integration, { useTestCode = false } = {}) {
  if (!useTestCode) return null
  const envCode = String(process.env.META_TEST_EVENT_CODE || "").trim()
  if (envCode) return envCode
  const dbCode = String(integration?.testEventCode || "").trim()
  return dbCode || null
}

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

function eventSourceForMode(mode) {
  return mode.mode === "ctwa" ? "ctwa" : "crm"
}

/** action_source por origem e destino CAPI (pixel vs WABA dataset). */
function buildActionSourceFields(mode) {
  if (mode.mode === "ctwa" && useWabaDatasetTarget()) {
    return {
      action_source: "business_messaging",
      messaging_channel: META_MESSAGING_CHANNEL,
    }
  }
  return {
    action_source: "system_generated",
    event_source_url: VESTO_EVENT_SOURCE_URL,
  }
}

function buildFunnelCustomData({ contentCategory, eventSource, amount, contentName, ticket }) {
  if (!contentCategory || typeof contentCategory !== "string") {
    throw new Error("custom_data.content_category é obrigatório em todos os eventos do funil")
  }
  const custom = {
    lead_event_source: CRM_EVENT_SOURCE,
    event_source: eventSource,
    content_category: contentCategory,
  }
  if (contentName) custom.content_name = contentName
  if (amount != null) {
    custom.currency = "BRL"
    custom.value = amount
  }
  if (ticket) custom.order_id = String(ticket).slice(0, 120)
  return custom
}

function buildCrmUserData(contact, { userId }) {
  const userData = ensureUserData(contact, { userId })
  attachLpAttributionToUserData(userData, contact)
  return userData
}

/** CTWA: ctwa_clid é obrigatório; WABA id opcional quando o destino é o pixel. */
function buildCtwaUserData(contact, { userId, whatsappBusinessAccountId, ctwaClid }) {
  const userData = ensureUserData(contact, { userId })
  const clid = ctwaClid || resolveCtwaClid(contact)
  if (!clid) {
    const err = new Error("Lead CTWA sem ctwa_clid persistido — evento não pode ser atribuído ao anúncio.")
    err.code = "MISSING_CTWA_CLID"
    throw err
  }
  userData.ctwa_clid = clid

  const wabaId = parseFacebookPageId(whatsappBusinessAccountId)
  if (wabaId) userData.whatsapp_business_account_id = wabaId

  // Híbrido raro (LP → depois CTWA): cookies da LP ajudam atribuição.
  attachLpAttributionToUserData(userData, contact)
  return userData
}

function attachLpAttributionToUserData(userData, contact) {
  const fbc = resolveFbc(contact)
  if (fbc) userData.fbc = fbc
  const fbp = resolveFbp(contact)
  if (fbp) userData.fbp = fbp
}

function buildFunnelEvent({
  eventName,
  contact,
  eventId,
  userId,
  integration,
  mode,
  customData,
  eventTime,
}) {
  const eventSource = eventSourceForMode(mode)
  const eventTimeSec = eventTime != null ? eventTime : Math.floor(Date.now() / 1000)

  const base = {
    event_name: resolveMetaPayloadEventName(eventName, mode),
    event_time: eventTimeSec,
    event_id: eventId,
    custom_data: { ...customData, event_source: eventSource },
    ...buildActionSourceFields(mode),
  }

  if (mode.mode === "ctwa") {
    return {
      ...base,
      user_data: buildCtwaUserData(contact, {
        userId,
        whatsappBusinessAccountId: integration.facebookPageId,
        ctwaClid: mode.ctwaClid,
      }),
    }
  }

  return {
    ...base,
    user_data: buildCrmUserData(contact, { userId }),
  }
}

function buildConversationStartedEvent({ contact, eventId, userId, integration, mode, eventTime }) {
  const stage = getFunnelStage(CONVERSATION_STARTED_EVENT)
  const clickSec = getStoredClickAt(contact)
  return buildFunnelEvent({
    eventName: stage.eventName,
    contact,
    eventId,
    userId,
    integration,
    mode,
    eventTime: eventTime != null ? eventTime : clickSec || undefined,
    customData: buildFunnelCustomData({
      contentCategory: stage.contentCategory,
      eventSource: eventSourceForMode(mode),
    }),
  })
}

function buildLeadQualifiedEvent({ contact, eventId, userId, integration, mode }) {
  const stage = getFunnelStage(LEAD_QUALIFIED_EVENT)
  return buildFunnelEvent({
    eventName: stage.eventName,
    contact,
    eventId,
    userId,
    integration,
    mode,
    customData: buildFunnelCustomData({
      contentCategory: stage.contentCategory,
      eventSource: eventSourceForMode(mode),
    }),
  })
}

function buildQuoteEvent({ contact, amount, eventId, userId, integration, mode }) {
  const stage = getFunnelStage(QUOTE_EVENT)
  const eventSource = eventSourceForMode(mode)
  return buildFunnelEvent({
    eventName: stage.eventName,
    contact,
    eventId,
    userId,
    integration,
    mode,
    customData: buildFunnelCustomData({
      contentCategory: stage.contentCategory,
      eventSource,
      amount,
      contentName: mode.mode === "ctwa" ? contactDisplayName(contact) : "Orçamento WhatsApp",
    }),
  })
}

function buildPurchaseEvent({ contact, amount, ticket, eventId, userId, integration, mode }) {
  const stage = getFunnelStage(PURCHASE_EVENT)
  const eventSource = eventSourceForMode(mode)
  return buildFunnelEvent({
    eventName: stage.eventName,
    contact,
    eventId,
    userId,
    integration,
    mode,
    customData: buildFunnelCustomData({
      contentCategory: stage.contentCategory,
      eventSource,
      amount,
      contentName: mode.mode === "ctwa" ? contactDisplayName(contact) : "Compra WhatsApp",
      ticket,
    }),
  })
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
    ...formatAdsFields(row),
    vestoPublicKey: row.vestoPublicKey || "",
    allowedOrigins: Array.isArray(row.allowedOrigins) ? row.allowedOrigins : [],
    lpWhatsapp: row.lpWhatsapp || "",
    lpWhatsappMsg: row.lpWhatsappMsg || "",
    lpRotatorMode: row.lpRotatorMode || "sequential",
    lpSellers: parseSellersInput(row.lpSellers),
  }
}

async function getMetaIntegration(prisma, userId) {
  const row = await prisma.metaIntegration.findUnique({ where: { userId } })
  return formatIntegrationRow(row)
}

async function getMetaIntegrationEnriched(prisma, userId) {
  const row = await prisma.metaIntegration.findUnique({ where: { userId } })
  const integration = formatIntegrationRow(row)
  if (!integration) return null

  if (!useWabaDatasetTarget()) {
    return { ...integration, wabaDatasetId: null, wabaDatasetSkipped: true }
  }

  const wabaId = parseFacebookPageId(integration.facebookPageId)
  if (!wabaId || !row?.accessToken) {
    return { ...integration, wabaDatasetId: null }
  }

  try {
    const wabaDatasetId = await resolveWabaDatasetId(wabaId, row.accessToken)
    return { ...integration, wabaDatasetId }
  } catch (err) {
    return {
      ...integration,
      wabaDatasetId: null,
      wabaDatasetError: err.message || "Não foi possível obter o dataset do WhatsApp.",
      wabaDatasetOptional: true,
    }
  }
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

  const adAccountIdRaw =
    data.adAccountId != null ? String(data.adAccountId).trim() : existing?.adAccountId || ""
  const adAccountId = adAccountIdRaw ? normalizeAdAccountId(adAccountIdRaw) : null

  const adsAccessTokenRaw = data.adsAccessToken != null ? String(data.adsAccessToken).trim() : null
  const adsAccessToken = adsAccessTokenRaw || existing?.adsAccessToken || null

  const allowedOrigins =
    data.allowedOrigins != null
      ? parseAllowedOriginsInput(data.allowedOrigins)
      : existing?.allowedOrigins || []

  const lpWhatsappMsg =
    data.lpWhatsappMsg != null
      ? String(data.lpWhatsappMsg).trim() || null
      : existing?.lpWhatsappMsg || null

  const lpRotatorMode =
    data.lpRotatorMode != null
      ? String(data.lpRotatorMode).trim() || "sequential"
      : existing?.lpRotatorMode || "sequential"

  const lpSellers =
    data.lpSellers != null ? parseSellersInput(data.lpSellers) : parseSellersInput(existing?.lpSellers)

  if (data.lpSellers != null && lpSellers.length === 0) {
    return { error: "VALIDATION", message: "Informe ao menos um vendedor com WhatsApp válido." }
  }

  if (data.lpSellers != null) {
    for (let i = 0; i < lpSellers.length; i++) {
      if (!isValidBrazilWhatsapp(lpSellers[i].phone)) {
        return {
          error: "VALIDATION",
          message: `Vendedor ${i + 1}: telefone inválido. Use DDI+DDD+número (ex: 5547996747378).`,
        }
      }
    }
  }

  const lpWhatsapp =
    lpSellers.length > 0
      ? lpSellers[0].phone
      : data.lpWhatsapp != null
        ? normalizeBrazilPhone(data.lpWhatsapp) || null
        : existing?.lpWhatsapp || null

  const vestoPublicKey = existing?.vestoPublicKey || generateVestoPublicKey()

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
      adAccountId,
      adsAccessToken,
      adsEnabled: data.adsEnabled === true,
      vestoPublicKey,
      allowedOrigins,
      lpWhatsapp,
      lpWhatsappMsg,
      lpRotatorMode,
      lpSellers,
    },
    update: {
      pixelId,
      accessToken,
      facebookPageId: data.facebookPageId != null ? facebookPageId : undefined,
      enabled: data.enabled !== false,
      sendQuotes: data.sendQuotes !== false,
      sendPurchases: data.sendPurchases !== false,
      testEventCode: data.testEventCode != null ? String(data.testEventCode).trim() || null : undefined,
      adAccountId: data.adAccountId != null ? adAccountId : undefined,
      adsAccessToken: data.adsAccessToken != null ? adsAccessToken || null : undefined,
      adsEnabled: data.adsEnabled != null ? data.adsEnabled === true : undefined,
      allowedOrigins: data.allowedOrigins != null ? allowedOrigins : undefined,
      lpWhatsapp: data.lpWhatsapp != null || data.lpSellers != null ? lpWhatsapp : undefined,
      lpWhatsappMsg: data.lpWhatsappMsg != null ? lpWhatsappMsg : undefined,
      lpRotatorMode: data.lpRotatorMode != null ? lpRotatorMode : undefined,
      lpSellers: data.lpSellers != null ? lpSellers : undefined,
      vestoPublicKey: existing?.vestoPublicKey ? undefined : vestoPublicKey,
    },
  })

  return { integration: formatIntegrationRow(row) }
}

async function updateMetaLpIntegration(prisma, userId, data) {
  const existing = await prisma.metaIntegration.findUnique({ where: { userId } })
  if (!existing) {
    return {
      error: "NOT_CONFIGURED",
      message: "Salve primeiro o Pixel e o token da Meta acima, depois configure a landing page.",
    }
  }

  const allowedOrigins =
    data.allowedOrigins != null
      ? parseAllowedOriginsInput(data.allowedOrigins)
      : existing.allowedOrigins || []

  if (!allowedOrigins.length) {
    return { error: "VALIDATION", message: "Informe ao menos um domínio da landing page." }
  }

  const lpWhatsappMsg =
    data.lpWhatsappMsg != null
      ? String(data.lpWhatsappMsg).trim() || null
      : existing.lpWhatsappMsg || null

  const lpRotatorMode =
    data.lpRotatorMode != null
      ? String(data.lpRotatorMode).trim() || "sequential"
      : existing.lpRotatorMode || "sequential"

  const lpSellers =
    data.lpSellers != null ? parseSellersInput(data.lpSellers) : parseSellersInput(existing.lpSellers)

  if (!lpSellers.length) {
    return { error: "VALIDATION", message: "Informe ao menos um vendedor com WhatsApp válido." }
  }

  for (let i = 0; i < lpSellers.length; i++) {
    if (!isValidBrazilWhatsapp(lpSellers[i].phone)) {
      return {
        error: "VALIDATION",
        message: `Vendedor ${i + 1}: telefone inválido. Use DDI+DDD+número (ex: 5547996747378).`,
      }
    }
  }

  const lpWhatsapp = lpSellers[0].phone
  const vestoPublicKey = existing.vestoPublicKey || generateVestoPublicKey()

  const row = await prisma.metaIntegration.update({
    where: { userId },
    data: {
      allowedOrigins,
      lpWhatsapp,
      lpWhatsappMsg,
      lpRotatorMode,
      lpSellers,
      vestoPublicKey: existing.vestoPublicKey ? undefined : vestoPublicKey,
    },
  })

  return { integration: formatIntegrationRow(row) }
}

async function resolveWabaDatasetId(wabaId, accessToken) {
  const key = String(wabaId)
  const cached = wabaDatasetCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.datasetId

  const token = encodeURIComponent(accessToken)
  const base = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/dataset`

  let res = await fetch(`${base}?access_token=${token}`)
  let json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.id) {
    res = await fetch(`${base}?access_token=${token}`, { method: "POST" })
    json = await res.json().catch(() => ({}))
  }

  if (!res.ok || !json?.id) {
    const message = formatMetaError(json)
    const err = new Error(
      message ||
        "Não foi possível obter o dataset da conta WhatsApp. Verifique o WABA e permissões whatsapp_business_manage_events no token.",
    )
    err.metaResponse = json
    throw err
  }

  wabaDatasetCache.set(key, { datasetId: String(json.id), expiresAt: Date.now() + WABA_DATASET_CACHE_MS })
  return String(json.id)
}

async function resolveEventTargetId(integration, mode) {
  if (mode?.mode === "ctwa" && useWabaDatasetTarget()) {
    const wabaId = parseFacebookPageId(integration.facebookPageId)
    return resolveWabaDatasetId(wabaId, integration.accessToken)
  }
  return integration.pixelId
}

async function sendMetaEvent(integration, eventPayload, { useTestCode = false, eventTargetId = null } = {}) {
  assertFunnelPayloadHasContentCategory(eventPayload)

  const targetId = eventTargetId || integration.pixelId
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${targetId}/events?access_token=${encodeURIComponent(integration.accessToken)}`
  const body = { data: [eventPayload] }

  const testCode = resolveTestEventCode(integration, { useTestCode })
  if (testCode) body.test_event_code = testCode

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

async function dispatchMetaEvent(prisma, {
  userId,
  contact,
  integration,
  eventName,
  eventIdPrefix,
  eventId: eventIdInput,
  stableEventId = false,
  ticket = null,
  buildPayload,
  amount = null,
  extraReturn = {},
}) {
  const mode = resolveTrackingMode(contact)
  const eventId =
    eventIdInput ||
    buildOccurrenceEventId({
      eventIdPrefix,
      contactId: contact.id,
      ticket,
      stable: stableEventId,
    })

  try {
    const payload = buildPayload({ eventId, mode })
    const eventTargetId = await resolveEventTargetId(integration, mode)
    const result = await sendMetaEvent(integration, payload, { eventTargetId })
    await recordIntegrationResult(prisma, userId, { eventName, eventsReceived: result.events_received })

    trackGtmForMetaEvent(prisma, userId, eventName, { contact, amount }).catch(() => {})

    return {
      sent: true,
      eventId,
      eventName,
      contentCategory: payload?.custom_data?.content_category || null,
      value: amount,
      trackingMode: mode.mode,
      eventsReceived: result.events_received,
      metaTargetId: eventTargetId,
      metaResponse: result,
      payload,
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
      metaResponse: err.metaResponse,
      ...extraReturn,
    }
  }
}

async function dispatchIdempotentMetaEvent(prisma, {
  userId,
  contact,
  integration,
  eventName,
  eventIdPrefix,
  idempotencyField,
  buildPayload,
  amount = null,
  ticket = null,
  gate = true,
}) {
  if (!gate) {
    return { sent: false, skipped: true, reason: "disabled" }
  }
  if (!integration?.pixelId || !integration?.accessToken) {
    return { sent: false, skipped: true, reason: "not_configured" }
  }
  if (contact[idempotencyField]) {
    return { sent: false, skipped: true, reason: "already_sent", eventName }
  }

  const result = await dispatchMetaEvent(prisma, {
    userId,
    contact,
    integration,
    eventName,
    eventIdPrefix,
    stableEventId: Boolean(getFunnelStage(eventName).stableEventId),
    buildPayload,
    amount,
    ticket,
  })

  if (result.sent) {
    const claim = await prisma.crmContact.updateMany({
      where: { id: contact.id, [idempotencyField]: null },
      data: { [idempotencyField]: new Date() },
    })
    if (claim.count === 0) {
      return { sent: false, skipped: true, reason: "already_sent", eventName, race: true }
    }
  }

  return result
}

async function getEnabledIntegration(prisma, userId) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled) return { integration: null, skipped: true, reason: "disabled" }
  return { integration }
}

async function trackConversationStartedEvent(prisma, { userId, contact }) {
  const { integration, skipped, reason } = await getEnabledIntegration(prisma, userId)
  if (skipped) return { sent: false, skipped: true, reason }

  return dispatchIdempotentMetaEvent(prisma, {
    userId,
    contact,
    integration,
    eventName: CONVERSATION_STARTED_EVENT,
    eventIdPrefix: "vesto-conversation-started",
    idempotencyField: "conversationStartedEventSentAt",
    buildPayload: ({ eventId, mode }) =>
      buildConversationStartedEvent({ contact, eventId, userId, integration, mode }),
    gate: true,
  })
}

async function trackLeadQualifiedEvent(prisma, { userId, contact }) {
  const { integration, skipped, reason } = await getEnabledIntegration(prisma, userId)
  if (skipped) return { sent: false, skipped: true, reason }

  return dispatchIdempotentMetaEvent(prisma, {
    userId,
    contact,
    integration,
    eventName: LEAD_QUALIFIED_EVENT,
    eventIdPrefix: "vesto-lead-qualified",
    idempotencyField: "qualifiedEventSentAt",
    buildPayload: ({ eventId, mode }) =>
      buildLeadQualifiedEvent({ contact, eventId, userId, integration, mode }),
    gate: true,
  })
}

async function trackCrmQuoteEvent(prisma, { userId, contact, amount }) {
  const integration = await getMetaIntegrationCredentials(prisma, userId)
  if (!integration?.enabled || !integration.sendQuotes) {
    return { sent: false, skipped: true, reason: "disabled" }
  }

  return dispatchIdempotentMetaEvent(prisma, {
    userId,
    contact,
    integration,
    eventName: QUOTE_EVENT,
    eventIdPrefix: "vesto-quote",
    idempotencyField: "quoteEventSentAt",
    amount,
    buildPayload: ({ eventId, mode }) =>
      buildQuoteEvent({ contact, amount, eventId, userId, integration, mode }),
    gate: true,
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

  return dispatchMetaEvent(prisma, {
    userId,
    contact,
    integration,
    eventName: PURCHASE_EVENT,
    eventIdPrefix: getFunnelStage(PURCHASE_EVENT).eventIdPrefix,
    stableEventId: false,
    ticket,
    amount,
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
  const testCode = resolveTestEventCode(integration, { useTestCode: true })
  if (!testCode) {
    return {
      error: "VALIDATION",
      message:
        "Configure o código de eventos de teste em Integrações → Meta antes de usar o botão Testar. Eventos de funil não são enviados ao dataset real por este botão.",
    }
  }
  const testHint = ` Código ${testCode} — veja em Eventos de teste.`

  const mockContact = {
    id: `test-contact-${userId}`,
    phone: "5547999999999",
    pushName: "Teste Vesto",
    customFields: {},
  }

  const testUserData = ensureUserData(mockContact, { userId })
  testUserData.client_ip_address = "254.254.254.254"
  testUserData.client_user_agent = VESTO_USER_AGENT

  const sendTest = async (name, payload) => {
    try {
      const result = await sendMetaEvent(integration, payload, { useTestCode: true })
      results.push({
        name,
        ok: true,
        eventsReceived: result.events_received,
        fbtrace_id: result.fbtrace_id,
        content_category: payload?.custom_data?.content_category,
        event_name: payload?.event_name,
        event_id: payload?.event_id,
      })
      return true
    } catch (err) {
      results.push({ name, ok: false, error: err.message, metaResponse: err.metaResponse })
      return false
    }
  }

  const ok = await sendTest("TestEvent", {
    event_name: "TestEvent",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `vesto-test-${userId}-${Date.now()}`,
    action_source: "website",
    event_source_url: "https://vesto.group/dashboard/integrations",
    user_data: testUserData,
  })

  if (!ok) {
    const failed = results.find((r) => !r.ok)
    await recordIntegrationResult(prisma, userId, { eventName: "TestEvent", error: failed?.error })
    return { error: "META_API_ERROR", message: `TestEvent falhou: ${failed?.error}` }
  }

  const crmMode = { mode: "crm" }
  const tests = [
    {
      name: CONVERSATION_STARTED_EVENT,
      payload: buildConversationStartedEvent({
        contact: mockContact,
        eventId: `vesto-test-conversation-${userId}-${Date.now()}`,
        userId,
        integration,
        mode: crmMode,
      }),
    },
    {
      name: LEAD_QUALIFIED_EVENT,
      payload: buildLeadQualifiedEvent({
        contact: mockContact,
        eventId: `vesto-test-qualified-${userId}-${Date.now()}`,
        userId,
        integration,
        mode: crmMode,
      }),
    },
    {
      name: QUOTE_EVENT,
      payload: buildQuoteEvent({
        contact: mockContact,
        amount: 99.9,
        eventId: `vesto-test-quote-${userId}-${Date.now()}`,
        userId,
        integration,
        mode: crmMode,
      }),
    },
    {
      name: PURCHASE_EVENT,
      payload: buildPurchaseEvent({
        contact: mockContact,
        amount: 199.9,
        ticket: "TEST-001",
        eventId: `vesto-test-purchase-${userId}-${Date.now()}`,
        userId,
        integration,
        mode: crmMode,
      }),
    },
  ]

  for (const t of tests) {
    await sendTest(t.name, t.payload)
  }

  if (useWabaDatasetTarget() && integration.facebookPageId) {
    const wabaId = parseFacebookPageId(integration.facebookPageId)
    try {
      const datasetId = await resolveWabaDatasetId(wabaId, integration.accessToken)
      results.push({ name: "CTWA Dataset (WABA)", ok: true, datasetId, optional: true })
    } catch (err) {
      results.push({
        name: "CTWA Dataset (WABA)",
        ok: false,
        error: err.message,
        optional: true,
      })
    }
  }

  const failed = results.filter((r) => !r.ok && !r.optional)
  const lastOk = results.filter((r) => r.ok && !r.optional).pop() || results.filter((r) => r.ok).pop()
  await recordIntegrationResult(prisma, userId, {
    eventName: lastOk?.name || "TestEvent",
    error: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join("; ") : null,
  })

  if (failed.length > 0 && failed.length === results.filter((r) => !r.optional).length) {
    return { error: "META_API_ERROR", message: failed.map((f) => f.error).join(" | ") }
  }

  const summary = results.map((r) => (r.ok ? `${r.name} ✓` : `${r.name} ✗`)).join(" · ")

  return {
    ok: true,
    results,
    message: `Testes Meta: ${summary}.${testHint}`,
  }
}

const { isQualifiedTagName } = require("./crmDefaults")
const { parseContactCommerceField } = require("./crmCore")

const QUOTE_TAG_NAME = "Orçamento"
const PURCHASE_TAG_NAME = "Comprou"

function isQuoteTagName(name) {
  const n = String(name || "").trim()
  return n === QUOTE_TAG_NAME || n.startsWith(`${QUOTE_TAG_NAME} `)
}

async function trackMetaForContactTag(prisma, { userId, contact, tagName }) {
  const name = String(tagName || "")
  if (isQualifiedTagName(name)) {
    return trackLeadQualifiedEvent(prisma, { userId, contact })
  }
  if (isQuoteTagName(name)) {
    const quote = parseContactCommerceField(contact.customFields, "quote")
    const amount = Number(quote?.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        sent: false,
        skipped: true,
        reason: "no_quote_amount",
        eventName: QUOTE_EVENT,
        message: "Use o botão Orçamento com valor. Só a tag visual não envia Quote à Meta.",
      }
    }
    return trackCrmQuoteEvent(prisma, { userId, contact, amount })
  }
  if (name === PURCHASE_TAG_NAME) {
    const purchase = parseContactCommerceField(contact.customFields, "purchase")
    const amount = Number(purchase?.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        sent: false,
        skipped: true,
        reason: "no_purchase_amount",
        eventName: PURCHASE_EVENT,
        message: "Use o botão Compra com valor. Só a tag visual não envia Purchase à Meta.",
      }
    }
    return trackCrmPurchaseEvent(prisma, {
      userId,
      contact,
      amount,
      ticket: purchase.ticket || null,
    })
  }
  return null
}

module.exports = {
  CONVERSATION_STARTED_EVENT,
  LEAD_QUALIFIED_EVENT,
  QUOTE_EVENT,
  PURCHASE_EVENT,
  CONTENT_CATEGORY,
  FUNNEL_STAGES,
  FUNNEL_EVENT_NAMES,
  isFunnelEventName,
  assertFunnelPayloadHasContentCategory,
  VESTO_EVENT_SOURCE_URL,
  formatIntegrationRow,
  getMetaIntegration,
  getMetaIntegrationEnriched,
  getMetaIntegrationCredentials,
  resolveWabaDatasetId,
  resolveEventTargetId,
  resolveTestEventCode,
  buildOccurrenceEventId,
  upsertMetaIntegration,
  updateMetaLpIntegration,
  trackConversationStartedEvent,
  trackLeadQualifiedEvent,
  trackCrmQuoteEvent,
  trackCrmPurchaseEvent,
  testMetaIntegration,
  sendMetaEvent,
  resolveTrackingMode,
  buildConversationStartedEvent,
  buildLeadQualifiedEvent,
  buildQuoteEvent,
  buildPurchaseEvent,
  buildFunnelCustomData,
  buildCrmUserData,
  buildCtwaUserData,
  attachLpAttributionToUserData,
  trackMetaForContactTag,
  CTWA_META_EVENT_NAMES,
  resolveMetaPayloadEventName,
  useCtwaEventAliases,
  useWabaDatasetTarget,
}

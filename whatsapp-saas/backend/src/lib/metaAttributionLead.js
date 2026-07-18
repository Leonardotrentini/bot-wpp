/**
 * Atribuição LP → WhatsApp (multi-tenant).
 * Cada conta tem vestoPublicKey + allowedOrigins.
 * ref vst_ é interno (POST no clique); CRM também liga via lead pendente na 1ª mensagem (mensagem limpa).
 */

const crypto = require("crypto")
const { storeContactMetaAttribution, parseCustomFields } = require("./metaMessaging")

const REF_PATTERN = /\(?\s*(vst_[a-z0-9]{6,16})\s*\)?/i
const ATTRIBUTION_TTL_DAYS = 14
/** Janela curta para fallback “último clique” sem vst_ na mensagem (evita cruzar leads). */
const PENDING_LEAD_MAX_AGE_MS = 2 * 60 * 60 * 1000
const TEMPORAL_MATCH_WINDOW_MS = 10 * 60 * 1000
const TEMPORAL_MATCH_FUTURE_TOLERANCE_MS = 30 * 1000
const TEMPORAL_MATCH_AMBIGUITY_MS = 20 * 1000

function buildContactEventIdFromRef(ref) {
  const clean = String(ref || "")
    .trim()
    .toLowerCase()
  if (!validateRef(clean)) return null
  return `vst_contact_${clean}`
}

function generateVestoPublicKey() {
  return `vpk_${crypto.randomBytes(16).toString("hex")}`
}

function normalizeHostname(input) {
  if (!input) return null
  let value = String(input).trim().toLowerCase()
  if (!value) return null
  try {
    if (value.includes("://")) value = new URL(value).hostname
    else value = value.split("/")[0].split(":")[0]
  } catch {
    value = value.split("/")[0].split(":")[0]
  }
  value = value.replace(/^www\./, "")
  return value || null
}

function parseAllowedOriginsInput(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((o) => normalizeHostname(o)).filter(Boolean))]
  }
  const text = String(raw || "")
  const parts = text.split(/[\n,;]+/).map((p) => normalizeHostname(p.trim())).filter(Boolean)
  return [...new Set(parts)]
}

function isOriginAllowed(allowedOrigins, originHeader) {
  if (!allowedOrigins?.length) return false
  const originHost = normalizeHostname(originHeader)
  if (!originHost) return false
  return allowedOrigins.some((allowed) => {
    const norm = normalizeHostname(allowed)
    if (!norm) return false
    if (norm.startsWith("*.")) {
      const suffix = norm.slice(1)
      return originHost === norm.slice(2) || originHost.endsWith(suffix)
    }
    return originHost === norm
  })
}

function validateRef(ref) {
  return typeof ref === "string" && /^vst_[a-z0-9]{6,16}$/i.test(ref.trim())
}

function extractVstRefFromText(text) {
  if (!text) return null
  const match = String(text).match(REF_PATTERN)
  return match ? match[1].toLowerCase() : null
}

function attributionExpiryDate() {
  const d = new Date()
  d.setDate(d.getDate() + ATTRIBUTION_TTL_DAYS)
  return d
}

async function getIntegrationByPublicKey(prisma, publicKey) {
  if (!publicKey) return null
  return prisma.metaIntegration.findUnique({
    where: { vestoPublicKey: String(publicKey).trim() },
  })
}

async function createAttributionLead(prisma, userId, payload) {
  const ref = String(payload.ref || "").trim().toLowerCase()
  if (!validateRef(ref)) {
    return { error: "VALIDATION", message: "Ref inválido." }
  }

  const clickAt = payload.clickAt ? new Date(Number(payload.clickAt)) : new Date()
  if (Number.isNaN(clickAt.getTime())) {
    return { error: "VALIDATION", message: "clickAt inválido." }
  }

  const data = {
    userId,
    ref,
    fbclid: payload.fbclid ? String(payload.fbclid).slice(0, 512) : null,
    fbc: payload.fbc ? String(payload.fbc).slice(0, 512) : null,
    fbp: payload.fbp ? String(payload.fbp).slice(0, 512) : null,
    clickAt,
    pageUrl: payload.pageUrl ? String(payload.pageUrl).slice(0, 2048) : null,
    clientIp: payload.clientIp ? String(payload.clientIp).slice(0, 64) : null,
    userAgent: payload.userAgent ? String(payload.userAgent).slice(0, 512) : null,
    contactEventId: payload.contactEventId
      ? String(payload.contactEventId).slice(0, 120)
      : buildContactEventIdFromRef(ref),
    email: payload.email
      ? String(payload.email)
          .trim()
          .toLowerCase()
          .slice(0, 320)
      : null,
    utmSource: payload.utm_source ? String(payload.utm_source).slice(0, 120) : null,
    utmMedium: payload.utm_medium ? String(payload.utm_medium).slice(0, 120) : null,
    utmCampaign: payload.utm_campaign ? String(payload.utm_campaign).slice(0, 120) : null,
    utmContent: payload.utm_content ? String(payload.utm_content).slice(0, 120) : null,
    utmTerm: payload.utm_term ? String(payload.utm_term).slice(0, 120) : null,
    expiresAt: attributionExpiryDate(),
  }

  await prisma.metaAttributionLead.upsert({
    where: { ref },
    create: data,
    update: {
      fbclid: data.fbclid,
      fbc: data.fbc,
      fbp: data.fbp,
      clickAt: data.clickAt,
      pageUrl: data.pageUrl,
      clientIp: data.clientIp,
      userAgent: data.userAgent,
      contactEventId: data.contactEventId,
      email: data.email,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
      utmTerm: data.utmTerm,
      expiresAt: data.expiresAt,
    },
  }).catch((err) => {
    console.error("[createAttributionLead]", err)
    throw err
  })

  return { ok: true, ref, contactEventId: data.contactEventId }
}

function attributionToMetaFields(lead) {
  if (!lead) return {}
  return {
    fbclid: lead.fbclid || undefined,
    fbc: lead.fbc || undefined,
    fbp: lead.fbp || undefined,
    clickAt: lead.clickAt ? lead.clickAt.getTime() : undefined,
    utm: {
      source: lead.utmSource || undefined,
      medium: lead.utmMedium || undefined,
      campaign: lead.utmCampaign || undefined,
      content: lead.utmContent || undefined,
      term: lead.utmTerm || undefined,
    },
    pageUrl: lead.pageUrl || undefined,
    clientIp: lead.clientIp || undefined,
    userAgent: lead.userAgent || undefined,
    contactEventId: lead.contactEventId || buildContactEventIdFromRef(lead.ref) || undefined,
    email: lead.email || undefined,
    attributionRef: lead.ref,
  }
}

async function applyAttributionLeadToContact(prisma, { userId, contact, lead }) {
  if (!contact?.id || !lead) return contact

  const metaFields = attributionToMetaFields(lead)
  const updated = await storeContactMetaAttribution(prisma, contact, metaFields)

  await prisma.metaAttributionLead
    .update({
      where: { ref: lead.ref },
      data: { contactId: contact.id },
    })
    .catch(() => {})

  return updated
}

function contactHasLpAttribution(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const meta = custom.meta || {}
  return Boolean(meta.attributionRef || meta.fbc || meta.fbclid || meta.fbp || meta.clickAt)
}

function contactHasAnyAdsAttribution(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const meta = custom.meta || {}
  return Boolean(meta.ctwaClid || meta.fbc || meta.fbclid || meta.fbp)
}

/** Reaplica lead já ligado ao contato (fbc/fbp) se o customFields perdeu os cookies. */
async function resolveAndApplyAttributionFromLinkedLead(prisma, { userId, contact }) {
  if (!contact?.id || contactHasLpAttribution(contact)) return contact

  // Lead LP fica no OWNER; contato pode ser SELLER — busca só pelo contactId.
  const lead = await prisma.metaAttributionLead.findFirst({
    where: { contactId: contact.id },
    orderBy: { clickAt: "desc" },
  })
  if (!lead) return contact
  return applyAttributionLeadToContact(prisma, { userId: lead.userId || userId, contact, lead })
}

/** Lê últimas mensagens inbound em busca de vst_ref da LP. */
async function resolveAndApplyAttributionFromRecentMessages(prisma, { userId, contact, limit = 30 }) {
  if (!contact?.id || contactHasLpAttribution(contact)) return contact

  const messageUserId = contact.userId || userId
  const messages = await prisma.crmMessage.findMany({
    where: {
      userId: messageUserId,
      conversation: { contactId: contact.id },
      fromMe: false,
      body: { not: null },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { body: true },
  })

  for (const msg of messages) {
    const updated = await resolveAndApplyAttributionFromMessage(prisma, {
      userId,
      contact,
      messageBody: msg.body,
    })
    if (updated && contactHasLpAttribution(updated)) return updated
  }
  return contact
}

/**
 * Antes de Quote/Purchase/LeadQualified: recupera fbc/fbp já ligados ao contato
 * ou vst_ref nas mensagens. NÃO usa lead pendente solto (risco de atribuir clique de outro lead).
 * attributionUserId = dono do Pixel/LP (OWNER); mensagens usam contact.userId.
 */
async function ensureAttributionBeforeMetaEvent(prisma, { userId, contact, attributionUserId }) {
  if (!contact?.id) return contact
  if (contactHasAnyAdsAttribution(contact)) return contact

  const attrUserId = attributionUserId || userId
  let next = contact
  next =
    (await resolveAndApplyAttributionFromLinkedLead(prisma, { userId: attrUserId, contact: next }).catch(
      () => next,
    )) || next
  if (contactHasAnyAdsAttribution(next)) return next

  next =
    (await resolveAndApplyAttributionFromRecentMessages(prisma, {
      userId: attrUserId,
      contact: next,
    }).catch(() => next)) || next
  if (contactHasAnyAdsAttribution(next)) return next

  // Recupera leads limpos da LP que chegaram antes do fix ou cuja conversa já existia.
  // O match é temporal e conservador; não escolhe quando há dois cliques diferentes
  // praticamente empatados.
  next =
    (await resolveAndApplyAttributionFromPendingLead(prisma, {
      userId: attrUserId,
      contact: next,
      eventAt: next.createdAt,
    }).catch(() => next)) || next
  return next
}

/**
 * Clique LP fica no userId do Pixel (OWNER). WhatsApp pode ser do SELLER.
 * Resolve o dono da org para achar o lead pendente certo — mensagem continua limpa (sem vst_).
 */
async function resolveAttributionOwnerUserId(prisma, userId) {
  if (!userId) return null
  const member = await prisma.organizationMember.findUnique({
    where: { userId },
    select: { organizationId: true, role: true },
  })
  if (!member) return userId
  if (member.role === "OWNER") return userId

  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId: member.organizationId, role: "OWNER" },
    select: { userId: true },
  })
  return owner?.userId || userId
}

function attributionSignature(lead) {
  return String(lead?.fbclid || lead?.fbc || lead?.ref || "")
}

/**
 * Escolhe o clique imediatamente anterior à primeira mensagem.
 * Duplicatas do mesmo fbclid são equivalentes; cliques diferentes com distância
 * quase igual são tratados como ambíguos e não são atribuídos.
 */
function selectTemporalAttributionCandidate(candidates, eventAt) {
  const eventMs = new Date(eventAt || Date.now()).getTime()
  if (!Number.isFinite(eventMs)) return null

  const ranked = (candidates || [])
    .map((lead) => ({
      lead,
      delta: Math.abs(eventMs - new Date(lead.clickAt || 0).getTime()),
    }))
    .filter(({ delta }) => Number.isFinite(delta) && delta <= TEMPORAL_MATCH_WINDOW_MS)
    .sort((a, b) => a.delta - b.delta)

  if (!ranked.length) return null
  const nearest = ranked[0]
  const competing = ranked.find(
    ({ lead }) => attributionSignature(lead) !== attributionSignature(nearest.lead),
  )
  if (competing && competing.delta - nearest.delta < TEMPORAL_MATCH_AMBIGUITY_MS) {
    return null
  }
  return nearest.lead
}

/**
 * Fallback para mensagem limpa (sem vst_): busca o clique da LP mais próximo
 * da primeira mensagem, no OWNER do Pixel. Evita o bug antigo que exigia haver
 * exatamente um único clique pendente em duas horas.
 */
async function resolveAndApplyAttributionFromPendingLead(prisma, { userId, contact, eventAt }) {
  if (!contact?.id) return contact
  if (contactHasLpAttribution(contact)) return contact

  const ownerUserId = (await resolveAttributionOwnerUserId(prisma, userId).catch(() => userId)) || userId
  const referenceAt = new Date(eventAt || contact.createdAt || Date.now())
  if (Number.isNaN(referenceAt.getTime())) return contact
  const minClickAt = new Date(referenceAt.getTime() - TEMPORAL_MATCH_WINDOW_MS)
  const maxClickAt = new Date(referenceAt.getTime() + TEMPORAL_MATCH_FUTURE_TOLERANCE_MS)

  const candidates = await prisma.metaAttributionLead.findMany({
    where: {
      userId: ownerUserId,
      contactId: null,
      expiresAt: { gt: new Date() },
      clickAt: { gte: minClickAt, lte: maxClickAt },
    },
    orderBy: { clickAt: "desc" },
    take: 20,
  })

  const lead = selectTemporalAttributionCandidate(candidates, referenceAt)
  if (!lead) return contact
  const claimed = await prisma.metaAttributionLead.updateMany({
    where: { id: lead.id, contactId: null },
    data: { contactId: contact.id },
  })
  if (claimed.count === 0) return contact

  return applyAttributionLeadToContact(prisma, {
    userId: lead.userId || ownerUserId,
    contact,
    lead: { ...lead, contactId: contact.id },
  })
}

async function resolveAndApplyAttributionFromMessage(prisma, { userId, contact, messageBody }) {
  const ref = extractVstRefFromText(messageBody)
  if (!ref) return contact

  // ref é único; lead LP pertence ao OWNER mesmo quando a mensagem é do SELLER
  const lead = await prisma.metaAttributionLead.findFirst({
    where: {
      ref,
      expiresAt: { gt: new Date() },
    },
  })
  if (!lead) return contact

  return applyAttributionLeadToContact(prisma, { userId: lead.userId || userId, contact, lead })
}

async function cleanupExpiredAttributionLeads(prisma) {
  await prisma.metaAttributionLead.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
}

function getStoredClickAt(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const ts = custom.meta?.clickAt
  if (ts == null) return null
  const n = Number(ts)
  return Number.isFinite(n) ? Math.floor(n / 1000) : null
}

module.exports = {
  generateVestoPublicKey,
  normalizeHostname,
  parseAllowedOriginsInput,
  isOriginAllowed,
  validateRef,
  extractVstRefFromText,
  buildContactEventIdFromRef,
  getIntegrationByPublicKey,
  resolveAttributionOwnerUserId,
  createAttributionLead,
  applyAttributionLeadToContact,
  resolveAndApplyAttributionFromMessage,
  resolveAndApplyAttributionFromPendingLead,
  selectTemporalAttributionCandidate,
  resolveAndApplyAttributionFromLinkedLead,
  resolveAndApplyAttributionFromRecentMessages,
  ensureAttributionBeforeMetaEvent,
  contactHasLpAttribution,
  contactHasAnyAdsAttribution,
  cleanupExpiredAttributionLeads,
  getStoredClickAt,
  REF_PATTERN,
  PENDING_LEAD_MAX_AGE_MS,
}

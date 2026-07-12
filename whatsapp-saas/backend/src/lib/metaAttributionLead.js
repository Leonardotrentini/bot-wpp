/**
 * Atribuição LP → WhatsApp (multi-tenant).
 * Cada conta tem vestoPublicKey + allowedOrigins; ref vst_ liga clique ao contato CRM.
 */

const crypto = require("crypto")
const { storeContactMetaAttribution, parseCustomFields } = require("./metaMessaging")

const REF_PATTERN = /\(?\s*(vst_[a-z0-9]{6,16})\s*\)?/i
const ATTRIBUTION_TTL_DAYS = 14

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
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
      utmTerm: data.utmTerm,
      expiresAt: data.expiresAt,
    },
  })

  return { ok: true, ref }
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

async function resolveAndApplyAttributionFromMessage(prisma, { userId, contact, messageBody }) {
  const ref = extractVstRefFromText(messageBody)
  if (!ref) return contact

  const lead = await prisma.metaAttributionLead.findFirst({
    where: {
      ref,
      userId,
      expiresAt: { gt: new Date() },
    },
  })
  if (!lead) return contact

  return applyAttributionLeadToContact(prisma, { userId, contact, lead })
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
  getIntegrationByPublicKey,
  createAttributionLead,
  applyAttributionLeadToContact,
  resolveAndApplyAttributionFromMessage,
  cleanupExpiredAttributionLeads,
  getStoredClickAt,
  REF_PATTERN,
}

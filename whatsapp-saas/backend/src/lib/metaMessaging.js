/**
 * Utilitários Meta — WhatsApp business_messaging (page_id, ctwa_clid) + atribuição LP.
 */

function parseFacebookPageId(value) {
  const digits = String(value || "").replace(/\D/g, "")
  if (!digits) return null
  const num = Number(digits)
  if (!Number.isSafeInteger(num) || num <= 0) return null
  return num
}

function parseCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

/** ctwa_clid real da Meta começa com ARA e é longo (Baileys: externalAdReply.ctwaClid). */
function isValidCtwaClid(value) {
  const s = String(value || "").trim()
  if (s.length < 40) return false
  return /^ARA[A-Za-z0-9_-]+$/.test(s)
}

function extractCtwaFromBaileysMessage(message) {
  if (!message || typeof message !== "object") return null

  const parts = [
    message.extendedTextMessage,
    message.imageMessage,
    message.videoMessage,
    message.documentMessage,
    message.audioMessage,
    message.stickerMessage,
  ].filter(Boolean)

  for (const part of parts) {
    const ad = part.contextInfo?.externalAdReply
    if (!ad) continue
    const clid = ad.ctwaClid || ad.ctwa_clid
    if (isValidCtwaClid(clid)) return String(clid).trim()
  }

  const topAd = message.contextInfo?.externalAdReply
  if (topAd) {
    const clid = topAd.ctwaClid || topAd.ctwa_clid
    if (isValidCtwaClid(clid)) return String(clid).trim()
  }

  return null
}

function resolveCtwaClid(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const clid = custom.meta?.ctwaClid || custom.ctwaClid
  const s = clid ? String(clid).trim() : null
  return isValidCtwaClid(s) ? s : null
}

function resolveFbclid(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const fbclid = custom.meta?.fbclid || custom.fbclid
  return fbclid ? String(fbclid).trim() : null
}

function resolveFbp(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const fbp = custom.meta?.fbp || custom.fbp
  return fbp ? String(fbp).trim() : null
}

/** Monta fbc para CAPI — usa timestamp do clique na LP quando disponível. */
function resolveFbc(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const stored = custom.meta?.fbc || custom.fbc
  if (stored) return String(stored).trim()

  const fbclid = resolveFbclid(contact)
  if (!fbclid) return null

  const clickAt = custom.meta?.clickAt
  const clickSec =
    clickAt != null && Number.isFinite(Number(clickAt))
      ? Math.floor(Number(clickAt) / 1000)
      : Math.floor(Date.now() / 1000)
  return `fb.1.${clickSec}.${fbclid}`
}

function extractCtwaClidFromRecord(record) {
  if (!record || typeof record !== "object") return null

  const fromBaileys = extractCtwaFromBaileysMessage(record.message)
  if (fromBaileys) return fromBaileys

  const direct = [
    record?.referral?.ctwa_clid,
    record?.referral?.ctwaClid,
    record?.context?.referral?.ctwa_clid,
    record?.data?.referral?.ctwa_clid,
  ]
  for (const value of direct) {
    if (isValidCtwaClid(value)) return String(value).trim()
  }

  const seen = new Set()
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12) return null
    if (seen.has(node)) return null
    seen.add(node)

    if (isValidCtwaClid(node.ctwa_clid)) return String(node.ctwa_clid).trim()
    if (isValidCtwaClid(node.ctwaClid)) return String(node.ctwaClid).trim()

    for (const value of Object.values(node)) {
      const found = walk(value, depth + 1)
      if (found) return found
    }
    return null
  }

  return walk(record.message) || walk(record)
}

async function storeContactMetaAttribution(
  prisma,
  contact,
  { ctwaClid, fbclid, fbc, fbp, clickAt, utm, pageUrl, attributionRef } = {},
) {
  if (!contact?.id) return contact

  const custom = parseCustomFields(contact.customFields)
  custom.meta = { ...(custom.meta || {}) }

  let changed = false
  const set = (key, value) => {
    if (value != null && value !== "" && custom.meta[key] !== value) {
      custom.meta[key] = value
      changed = true
    }
  }

  set("ctwaClid", ctwaClid)
  set("fbclid", fbclid)
  set("fbc", fbc)
  set("fbp", fbp)
  if (clickAt != null) set("clickAt", Number(clickAt))
  if (pageUrl) set("pageUrl", String(pageUrl).slice(0, 2048))
  if (attributionRef) set("attributionRef", attributionRef)

  if (utm && typeof utm === "object") {
    custom.meta.utm = { ...(custom.meta.utm || {}) }
    for (const [k, v] of Object.entries(utm)) {
      if (v != null && v !== "") {
        custom.meta.utm[k] = String(v)
        changed = true
      }
    }
  }

  if (!changed) return contact
  return prisma.crmContact.update({
    where: { id: contact.id },
    data: { customFields: custom },
  })
}

async function storeContactCtwaClid(prisma, contact, ctwaClid) {
  if (!contact?.id || !ctwaClid) return contact
  return storeContactMetaAttribution(prisma, contact, { ctwaClid })
}

module.exports = {
  parseFacebookPageId,
  parseCustomFields,
  isValidCtwaClid,
  resolveCtwaClid,
  resolveFbclid,
  resolveFbp,
  resolveFbc,
  extractCtwaClidFromRecord,
  storeContactCtwaClid,
  storeContactMetaAttribution,
}

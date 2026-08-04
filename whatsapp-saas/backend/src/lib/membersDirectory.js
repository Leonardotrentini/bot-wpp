/**
 * Unifica participantes de grupo + leads CRM (1:1) na lista global de membros.
 * Deduplica por remoteJid e, quando possível, por dígitos do telefone.
 */

const { formatPhoneBr, phoneDigitsFromJid, phoneDigitsFromValue } = require("./participantIdentity")
const { resolveContactDisplayName, isIndividualJid } = require("./crmCore")

const X1_GROUP_LABEL = "WhatsApp direto"

function normalizePhoneDigits(value) {
  return phoneDigitsFromValue(value) || phoneDigitsFromJid(value) || null
}

/** Índice phoneDigits → memberKey para merge O(1) em vez de varrer o mapa. */
function buildPhoneIndex(map) {
  const index = new Map()
  for (const [key, member] of map.entries()) {
    const digits =
      member.phoneDigits || normalizePhoneDigits(member.phone) || normalizePhoneDigits(key)
    if (digits && !index.has(digits)) index.set(digits, key)
  }
  return index
}

function findMemberKeyByPhone(phoneIndex, phoneDigits) {
  if (!phoneDigits || !phoneIndex) return null
  return phoneIndex.get(phoneDigits) || null
}

function findMemberKeyForCrmContact(map, contact, phoneIndex) {
  const jid = String(contact.remoteJid || "").trim()
  if (jid && map.has(jid)) return jid
  const phoneDigits = normalizePhoneDigits(contact.phone) || normalizePhoneDigits(jid)
  if (phoneDigits) {
    const byPhone = findMemberKeyByPhone(phoneIndex, phoneDigits)
    if (byPhone) return byPhone
  }
  return null
}

function isWeakMemberName(name) {
  const n = String(name || "").trim()
  if (!n) return true
  return (
    n === "Participante" ||
    n === "Sem nome" ||
    n.includes("número oculto") ||
    n === "Lead WhatsApp" ||
    n === "Lead"
  )
}

function parseCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value
}

/** Resumo de atribuição Meta para a lista de leads. */
function buildMetaAttributionSummary(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const meta = custom.meta && typeof custom.meta === "object" ? custom.meta : {}
  const utm = meta.utm && typeof meta.utm === "object" ? meta.utm : {}
  const hasCtwa = Boolean(meta.ctwaClid)
  const hasLp = Boolean(meta.fbclid || meta.fbc || meta.fbp || meta.attributionRef)
  const hasAttribution = hasCtwa || hasLp
  let source = "none"
  if (hasCtwa && hasLp) source = "both"
  else if (hasCtwa) source = "ctwa"
  else if (hasLp) source = "lp"

  const campaign = utm.campaign || utm.utm_campaign || meta.utmCampaign || meta.campaignName || null
  const adContent = utm.content || utm.utm_content || meta.utmContent || null
  const qualifiedSentAt =
    contact?.qualifiedEventSentAt?.toISOString?.() || contact?.qualifiedEventSentAt || null
  const quoteSentAt = contact?.quoteEventSentAt?.toISOString?.() || contact?.quoteEventSentAt || null
  const purchaseSentAt =
    contact?.purchaseEventSentAt?.toISOString?.() || contact?.purchaseEventSentAt || null
  const contactSentAt =
    contact?.contactEventSentAt?.toISOString?.() || contact?.contactEventSentAt || null

  return {
    source,
    hasAttribution,
    campaign: campaign ? String(campaign) : null,
    adContent: adContent ? String(adContent) : null,
    fbclid: meta.fbclid ? String(meta.fbclid).slice(0, 24) : null,
    ctwa: hasCtwa,
    lp: hasLp,
    qualifiedSentToMeta: Boolean(qualifiedSentAt),
    qualifiedSentAt,
    quoteSentToMeta: Boolean(quoteSentAt),
    purchaseSentToMeta: Boolean(purchaseSentAt),
    contactSentToMeta: Boolean(contactSentAt),
    /** Tem clique/anúncio + LeadQualified aceito no CAPI */
    campaignComputed: Boolean(hasAttribution && qualifiedSentAt),
  }
}

function buildCrmTagLinks(contact) {
  return (contact.tags || [])
    .map((link) => {
      const name = link.tag?.name
      if (!name) return null
      return {
        name: String(name),
        createdAt: link.createdAt?.toISOString?.() || link.createdAt || null,
      }
    })
    .filter(Boolean)
}

function applyCrmEnrichment(member, contact) {
  const crmTags = (contact.tags || []).map((link) => link.tag?.name).filter(Boolean)
  const tagLinks = buildCrmTagLinks(contact)
  member.crmContactId = contact.id
  member.metaAttribution = buildMetaAttributionSummary(contact)
  member.crmTagLinks = tagLinks
  if (crmTags.length) {
    member.crmTags = [...new Set([...(member.crmTags || []), ...crmTags])]
  }
}

/**
 * @param {Map<string, object>} map — mapa mutável de membros (mergeGlobalMember)
 * @param {Array} contacts — CrmContact com conversation + tags
 */
function mergeCrmContactsIntoMembers(map, contacts, { fallbackAvatar }) {
  let merged = 0
  let added = 0
  const phoneIndex = buildPhoneIndex(map)

  for (const contact of contacts) {
    if (!contact?.remoteJid || !isIndividualJid(contact.remoteJid)) continue

    const conversation = contact.conversation
    const phoneDigits = normalizePhoneDigits(contact.phone) || normalizePhoneDigits(contact.remoteJid)
    const displayPhone = phoneDigits ? formatPhoneBr(phoneDigits) : "—"
    const name = resolveContactDisplayName(contact) || displayPhone || "Lead"
    const lastAt =
      conversation?.lastMessageAt?.toISOString?.() ||
      contact.lastSeenAt?.toISOString?.() ||
      contact.createdAt?.toISOString?.() ||
      new Date().toISOString()
    const crmTags = (contact.tags || []).map((link) => link.tag?.name).filter(Boolean)

    const existingKey = findMemberKeyForCrmContact(map, contact, phoneIndex)
    if (existingKey) {
      const existing = map.get(existingKey)
      existing.crmContactId = contact.id
      existing.conversationId = conversation?.id || existing.conversationId || null
      existing.isCrmLead = true
      existing.hasX1 = true
      if (!Array.isArray(existing.sources)) existing.sources = []
      if (!existing.sources.includes("x1")) existing.sources.push("x1")
      if (!existing.groups.includes(X1_GROUP_LABEL)) existing.groups.push(X1_GROUP_LABEL)
      if (isWeakMemberName(existing.name) && !isWeakMemberName(name)) existing.name = name
      if (displayPhone !== "—" && (existing.phone === "—" || !existing.phone)) existing.phone = displayPhone
      if (phoneDigits && !existing.phoneDigits) {
        existing.phoneDigits = phoneDigits
        if (!phoneIndex.has(phoneDigits)) phoneIndex.set(phoneDigits, existingKey)
      }
      if (contact.avatarUrl) existing.avatar = contact.avatarUrl
      if (new Date(lastAt).getTime() > new Date(existing.lastActivity || 0).getTime()) {
        existing.lastActivity = lastAt
      }
      if (crmTags.length) {
        existing.crmTags = [...new Set([...(existing.crmTags || []), ...crmTags])]
      }
      applyCrmEnrichment(existing, contact)
      merged += 1
      continue
    }

    const jid = contact.remoteJid
    const row = {
      id: jid,
      crmContactId: contact.id,
      conversationId: conversation?.id || null,
      isCrmLead: true,
      hasX1: true,
      sources: ["x1"],
      name,
      phone: displayPhone,
      phoneDigits: phoneDigits || undefined,
      mentionable: Boolean(phoneDigits),
      isLid: Boolean(contact.isLid),
      role: "membro",
      status: "ativo",
      tags: [],
      crmTags,
      groups: [X1_GROUP_LABEL],
      groupIds: [],
      lastActivity: lastAt,
      avatar: contact.avatarUrl || fallbackAvatar(name || jid),
    }
    applyCrmEnrichment(row, contact)
    map.set(jid, row)
    if (phoneDigits && !phoneIndex.has(phoneDigits)) phoneIndex.set(phoneDigits, jid)
    added += 1
  }

  return { merged, added, x1Only: added }
}

function resolveTagAppliedAt(member, tagName) {
  if (!tagName || !member) return null
  const norm = String(tagName).toLowerCase()
  const links = member.crmTagLinks || []
  const hit = links.find((l) => String(l.name || "").toLowerCase() === norm)
  return hit?.createdAt || null
}

module.exports = {
  X1_GROUP_LABEL,
  mergeCrmContactsIntoMembers,
  normalizePhoneDigits,
  findMemberKeyForCrmContact,
  buildMetaAttributionSummary,
  resolveTagAppliedAt,
  buildPhoneIndex,
}

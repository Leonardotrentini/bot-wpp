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

function findMemberKeyByPhone(map, phoneDigits) {
  if (!phoneDigits) return null
  for (const [key, member] of map.entries()) {
    const memberDigits =
      member.phoneDigits || normalizePhoneDigits(member.phone) || normalizePhoneDigits(key)
    if (memberDigits && memberDigits === phoneDigits) return key
  }
  return null
}

function findMemberKeyForCrmContact(map, contact) {
  const jid = String(contact.remoteJid || "").trim()
  if (jid && map.has(jid)) return jid
  const phoneDigits = normalizePhoneDigits(contact.phone) || normalizePhoneDigits(jid)
  if (phoneDigits) {
    const byPhone = findMemberKeyByPhone(map, phoneDigits)
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

/**
 * @param {Map<string, object>} map — mapa mutável de membros (mergeGlobalMember)
 * @param {Array} contacts — CrmContact com conversation + tags
 */
function mergeCrmContactsIntoMembers(map, contacts, { fallbackAvatar }) {
  let merged = 0
  let added = 0

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

    const existingKey = findMemberKeyForCrmContact(map, contact)
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
      if (phoneDigits && !existing.phoneDigits) existing.phoneDigits = phoneDigits
      if (contact.avatarUrl) existing.avatar = contact.avatarUrl
      if (new Date(lastAt).getTime() > new Date(existing.lastActivity || 0).getTime()) {
        existing.lastActivity = lastAt
      }
      if (crmTags.length) {
        existing.crmTags = [...new Set([...(existing.crmTags || []), ...crmTags])]
      }
      merged += 1
      continue
    }

    const jid = contact.remoteJid
    map.set(jid, {
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
    })
    added += 1
  }

  return { merged, added, x1Only: added }
}

module.exports = {
  X1_GROUP_LABEL,
  mergeCrmContactsIntoMembers,
  normalizePhoneDigits,
  findMemberKeyForCrmContact,
}

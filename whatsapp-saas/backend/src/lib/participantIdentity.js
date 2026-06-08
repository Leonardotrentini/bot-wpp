/** Utilitários para JID/LID do WhatsApp e exibição de nome/telefone. */

function jidDomain(jid) {
  const s = String(jid || "")
  const at = s.indexOf("@")
  return at >= 0 ? s.slice(at + 1).toLowerCase() : ""
}

function jidUserPart(jid) {
  return String(jid || "").split("@")[0].split(":")[0]
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "")
}

function isLikelyPhoneDigits(digits) {
  if (!digits) return false
  const len = digits.length
  if (len < 10 || len > 13) return false
  if (digits.startsWith("55") && len >= 12 && len <= 13) return true
  if (len === 10 || len === 11) return true
  return false
}

function phoneDigitsFromJid(jid) {
  const domain = jidDomain(jid)
  if (!jid || domain === "lid" || domain === "g.us" || domain.includes("broadcast")) return null
  if (domain.includes("whatsapp") || domain === "c.us") {
    const digits = jidUserPart(jid)
    return isLikelyPhoneDigits(digits) ? digits : null
  }
  return null
}

function phoneDigitsFromValue(value) {
  if (value == null || value === "") return null
  const s = String(value)
  const fromJid = phoneDigitsFromJid(s)
  if (fromJid) return fromJid
  const digits = digitsOnly(s)
  return isLikelyPhoneDigits(digits) ? digits : null
}

function formatPhoneBr(digits) {
  if (!digits) return "—"
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  if (digits.length === 11) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return `+${digits}`
}

function looksLikeInternalIdName(name, phoneDigits) {
  const n = String(name || "").trim()
  if (!n) return true
  const nd = digitsOnly(n)
  if (phoneDigits && nd === phoneDigits) return true
  if (nd.length >= 14 && !n.includes(" ")) return true
  return false
}

function displayNameFromParticipant(participant, phoneDigits) {
  const fields = [
    participant?.name,
    participant?.pushName,
    participant?.notify,
    participant?.verifiedName,
    participant?.displayName,
    participant?.contactName,
    participant?.shortName,
    participant?.profileName,
    participant?.wa_name,
  ]
  for (const f of fields) {
    const n = String(f || "").trim()
    if (!n || looksLikeInternalIdName(n, phoneDigits)) continue
    return n
  }
  return null
}

function resolvePhoneDigits(participant) {
  const candidates = [
    participant?.phoneNumber,
    participant?.phone,
    participant?.pn,
    participant?.wuid,
    participant?.id,
    participant?.jid,
    participant?.number,
  ]
  for (const c of candidates) {
    const digits = phoneDigitsFromValue(c)
    if (digits) return digits
  }
  return null
}

function mapEvolutionParticipant(participant) {
  const rawId = participant?.id || participant?.jid || participant?.number || participant
  const participantJid = String(rawId || "")
  const isLid = jidDomain(participantJid) === "lid"
  const phoneDigits = resolvePhoneDigits(participant)
  const displayName = displayNameFromParticipant(participant, phoneDigits)

  let name = displayName
  if (!name) {
    if (isLid) name = "Contato (número oculto no grupo)"
    else name = null
  }

  const phone = phoneDigits ? formatPhoneBr(phoneDigits) : "—"
  const role = participant?.admin === "superadmin" ? "superadmin" : participant?.admin ? "admin" : "membro"

  return {
    participantJid,
    name,
    phone,
    phoneDigits,
    isLid,
    role,
    status: "ativo",
    raw: participant,
  }
}

function enrichParticipantFromContact(participant, contact) {
  if (!contact) return participant
  const phoneDigits = participant.phoneDigits || resolvePhoneDigits(contact) || phoneDigitsFromJid(contact?.id || contact?.remoteJid)
  const displayName = displayNameFromParticipant(contact, phoneDigits) || participant.name
  return {
    ...participant,
    phoneDigits: phoneDigits || participant.phoneDigits,
    phone: phoneDigits ? formatPhoneBr(phoneDigits) : participant.phone,
    name: displayName && !looksLikeInternalIdName(displayName, phoneDigits) ? displayName : participant.name,
  }
}

function normalizeContactList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.contacts)) return payload.contacts
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.response)) return payload.response
  return []
}

function buildContactIndex(contacts) {
  const index = new Map()
  for (const c of contacts) {
    const keys = [c?.id, c?.remoteJid, c?.jid, c?.lid].filter(Boolean).map(String)
    const pd = resolvePhoneDigits(c) || phoneDigitsFromJid(c?.id || c?.remoteJid)
    if (pd) keys.push(`digits:${pd}`)
    for (const k of keys) index.set(k, c)
  }
  return index
}

function hasRealDisplayName(participant) {
  const n = String(participant?.name || "").trim()
  if (!n) return false
  if (n === "Participante" || n === "Sem nome" || n.includes("número oculto")) return false
  if (participant.phoneDigits && digitsOnly(n) === participant.phoneDigits) return false
  if (looksLikeInternalIdName(n, participant.phoneDigits)) return false
  return true
}

function finalizeParticipantName(participant) {
  if (hasRealDisplayName(participant)) return participant.name
  if (participant.isLid) return participant.name || "Contato (número oculto no grupo)"
  if (participant.phoneDigits) return "Sem nome"
  return participant.name || "Participante"
}

function lookupContact(index, participant) {
  if (!index?.size) return null
  return (
    index.get(participant.participantJid) ||
    (participant.phoneDigits ? index.get(`digits:${participant.phoneDigits}`) : null) ||
    null
  )
}

module.exports = {
  mapEvolutionParticipant,
  enrichParticipantFromContact,
  normalizeContactList,
  buildContactIndex,
  formatPhoneBr,
  jidDomain,
  hasRealDisplayName,
  looksLikeInternalIdName,
  finalizeParticipantName,
  lookupContact,
  resolvePhoneDigits,
  phoneDigitsFromJid,
  displayNameFromParticipant,
  digitsOnly,
  isLikelyPhoneDigits,
}

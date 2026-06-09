const {
  jidDomain,
  resolvePhoneDigits,
  phoneDigitsFromJid,
  digitsOnly,
  isLikelyPhoneDigits,
} = require("./participantIdentity")

const MAX_MENTIONS = 2

function emptyMentionsJson() {
  return { mentionAll: false, mentions: [] }
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeMentionsInput(raw) {
  if (!raw || typeof raw !== "object") return emptyMentionsJson()
  const mentions = Array.isArray(raw.mentions)
    ? raw.mentions
        .filter((m) => m && typeof m === "object" && m.type === "user" && m.label)
        .map((m) => ({
          type: "user",
          label: String(m.label).trim(),
          participantJid: m.participantJid ? String(m.participantJid) : undefined,
          phone: m.phone ? String(m.phone).replace(/\D/g, "") : undefined,
        }))
    : []

  const seen = new Set()
  const unique = []
  for (const m of mentions) {
    const key = m.participantJid || m.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m)
    if (unique.length >= MAX_MENTIONS) break
  }

  return { mentionAll: false, mentions: unique }
}

function mergeMentionsFromBody(_body, mentionsJson) {
  return normalizeMentionsInput(mentionsJson)
}

/** Telefone válido para menção — ignora LID e IDs internos do webhook. */
function resolveMentionPhoneDigits(participant) {
  if (!participant) return null

  const jid = participant.participantJid || participant.id || ""
  const isLid = jidDomain(jid) === "lid"

  const fromRaw = resolvePhoneDigits(participant.raw)
  const fromJid = phoneDigitsFromJid(jid)
  const fromStoredPhone =
    participant.phone && participant.phone !== "—" ? digitsOnly(participant.phone) : null

  const candidates = [fromRaw, fromJid, fromStoredPhone, participant.phoneDigits].filter(Boolean)

  for (const digits of candidates) {
    const d = String(digits).replace(/\D/g, "")
    if (isLikelyPhoneDigits(d)) return d
  }

  if (isLid) return null

  return null
}

/** Valor para mentioned[] da Evolution: telefone (s.whatsapp.net) ou JID completo (@lid). */
function participantMentionTarget(participant) {
  if (!participant) return null
  const phoneDigits = resolveMentionPhoneDigits(participant)
  if (phoneDigits) return phoneDigits
  const jid = String(participant.participantJid || participant.id || "").trim()
  if (jid && (jidDomain(jid) === "lid" || jid.includes("@"))) return jid
  return null
}

function isParticipantMentionable(participant) {
  return Boolean(resolveMentionPhoneDigits(participant))
}

function findParticipantForMention(m, participantByJid, participants) {
  if (m.participantJid && participantByJid.has(m.participantJid)) {
    return participantByJid.get(m.participantJid)
  }
  const label = String(m.label || "").toLowerCase()
  if (!label) return null
  return (
    participants.find((p) => String(p.name || "").toLowerCase().startsWith(label)) ||
    participants.find((p) => String(p.name || "").toLowerCase().includes(label)) ||
    null
  )
}

/** WhatsApp destaca menção quando o texto contém @telefone (só dígitos válidos). */
function formatWhatsAppMentionBody(body, mentionsJson, participants, participantByJid) {
  let text = String(body || "")
  const normalized = normalizeMentionsInput(mentionsJson)

  for (const m of normalized.mentions) {
    if (!m.label) continue
    const p = findParticipantForMention(m, participantByJid, participants)
    const phoneDigits = resolveMentionPhoneDigits(p)
    if (!phoneDigits) continue
    text = text.replace(new RegExp(`@${escapeRegex(m.label)}\\b`, "gi"), `@${phoneDigits}`)
  }
  return text
}

async function resolveMentionsForGroup(prisma, userId, groupJid, content) {
  const linkPreview = content?.linkPreview !== false
  const mentionsJson = mergeMentionsFromBody(content?.body, content?.mentionsJson)

  const group = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId, groupJid } },
    include: { participants: { where: { status: { not: "saiu" } } } },
  })

  const participants = group?.participants || []
  const participantByJid = new Map(participants.map((p) => [p.participantJid, p]))

  if (!mentionsJson.mentions.some((m) => m.type === "user")) {
    return {
      mentioned: [],
      linkPreview,
      whatsappBody: content?.body || "",
      mentionDebug: { reason: "none" },
    }
  }

  const mentioned = []
  for (const m of mentionsJson.mentions) {
    const p = findParticipantForMention(m, participantByJid, participants)
    const target = participantMentionTarget(p)
    if (target && !mentioned.includes(target)) mentioned.push(target)
    if (mentioned.length >= MAX_MENTIONS) break
  }

  const whatsappBody = formatWhatsAppMentionBody(content?.body, mentionsJson, participants, participantByJid)

  return {
    mentioned,
    linkPreview,
    whatsappBody,
    mentionDebug: {
      mentionStrategy: mentioned.length ? "individual" : "none",
      mentionedCount: mentioned.length,
      participantCount: participants.length,
      maxMentions: MAX_MENTIONS,
    },
  }
}

function buildEvolutionSendOptions(mentionOpts = {}) {
  const opts = {}
  if (mentionOpts.linkPreview === true) opts.linkPreview = true
  if (Array.isArray(mentionOpts.mentioned) && mentionOpts.mentioned.length) {
    opts.mentioned = mentionOpts.mentioned.slice(0, MAX_MENTIONS)
  }
  return opts
}

module.exports = {
  MAX_MENTIONS,
  emptyMentionsJson,
  normalizeMentionsInput,
  mergeMentionsFromBody,
  resolveMentionsForGroup,
  buildEvolutionSendOptions,
  formatWhatsAppMentionBody,
  resolveMentionPhoneDigits,
  isParticipantMentionable,
  participantMentionTarget,
}

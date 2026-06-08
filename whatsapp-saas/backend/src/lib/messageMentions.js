const {
  jidDomain,
  resolvePhoneDigits,
  phoneDigitsFromJid,
  digitsOnly,
  isLikelyPhoneDigits,
} = require("./participantIdentity")

const MENTION_ALL_WHATSAPP = "all"
const MENTION_ALL_IN_TEXT_RE = /\B@(todos|all)\b/gi
const MENTION_ALL_DETECT_RE = /\B@(todos|all)\b/i

function hasMentionAllInText(text) {
  return MENTION_ALL_DETECT_RE.test(String(text || ""))
}

/** WhatsApp nativo usa @all no texto (não @todos) junto com mentionsEveryOne. */
function formatWhatsAppMentionAllBody(body, mentionAll) {
  if (!mentionAll) return String(body || "")
  return String(body || "").replace(MENTION_ALL_IN_TEXT_RE, `@${MENTION_ALL_WHATSAPP}`)
}

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
        .filter((m) => m && typeof m === "object" && m.type && m.label)
        .map((m) => ({
          type: m.type === "all" ? "all" : "user",
          label: String(m.label).trim(),
          participantJid: m.participantJid ? String(m.participantJid) : undefined,
          phone: m.phone ? String(m.phone).replace(/\D/g, "") : undefined,
        }))
    : []
  const mentionAll = raw.mentionAll === true || mentions.some((m) => m.type === "all")
  return {
    mentionAll,
    mentions: mentions.filter((m) => m.type === "user" || m.type === "all"),
  }
}

/** Detecta @all / @todos no texto quando mentionsJson não veio do frontend. */
function mergeMentionsFromBody(body, mentionsJson) {
  const normalized = normalizeMentionsInput(mentionsJson)
  if (normalized.mentionAll) return normalized

  const text = String(body || "")
  if (hasMentionAllInText(text)) {
    return {
      mentionAll: true,
      mentions: [...normalized.mentions.filter((m) => m.type !== "all"), { type: "all", label: MENTION_ALL_WHATSAPP }],
    }
  }
  return normalized
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
    if (m.type !== "user" || !m.label) continue
    const p = findParticipantForMention(m, participantByJid, participants)
    const phoneDigits = resolveMentionPhoneDigits(p)
    if (!phoneDigits) continue
    text = text.replace(new RegExp(`@${escapeRegex(m.label)}\\b`, "gi"), `@${phoneDigits}`)
  }
  if (normalized.mentionAll) {
    text = formatWhatsAppMentionAllBody(text, true)
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

  if (!mentionsJson.mentionAll && !mentionsJson.mentions.some((m) => m.type === "user")) {
    return {
      mentioned: [],
      mentionsEveryOne: false,
      linkPreview,
      whatsappBody: content?.body || "",
      mentionDebug: { reason: "none" },
    }
  }

  const mentioned = []

  for (const m of mentionsJson.mentions) {
    if (m.type !== "user") continue
    const p = findParticipantForMention(m, participantByJid, participants)
    const phoneDigits = resolveMentionPhoneDigits(p)
    if (phoneDigits && !mentioned.includes(phoneDigits)) mentioned.push(phoneDigits)
  }

  let mentionsEveryOne = false

  // @all: enviar JIDs do sync local — mentionsEveryOne depende do cache da Evolution (muitas vezes vazio)
  if (mentionsJson.mentionAll === true) {
    const participantJids = participants.map((p) => p.participantJid).filter(Boolean)
    for (const jid of participantJids) {
      if (!mentioned.includes(jid)) mentioned.push(jid)
    }
    if (!participantJids.length) {
      mentionsEveryOne = true
    }
  }

  let whatsappBody = formatWhatsAppMentionBody(content?.body, mentionsJson, participants, participantByJid)
  if (mentionsJson.mentionAll) {
    whatsappBody = formatWhatsAppMentionAllBody(whatsappBody, true)
  }

  return {
    mentioned,
    mentionsEveryOne,
    linkPreview,
    whatsappBody,
    mentionDebug: {
      mentionAll: mentionsJson.mentionAll,
      mentionsEveryOne,
      mentionedCount: mentioned.length,
      participantCount: participants.length,
      participantJidsUsed: mentionsJson.mentionAll && !mentionsEveryOne,
      skippedLid: participants.filter((p) => jidDomain(p.participantJid) === "lid").length,
    },
  }
}

function buildEvolutionSendOptions(mentionOpts = {}) {
  const opts = {}
  if (mentionOpts.linkPreview === true) opts.linkPreview = true
  // mentionsEveryOne só quando não temos JIDs locais; senão mentioned[] tem prioridade na Evolution
  if (mentionOpts.mentionsEveryOne === true && !(mentionOpts.mentioned?.length > 0)) {
    opts.mentionsEveryOne = true
  }
  if (Array.isArray(mentionOpts.mentioned) && mentionOpts.mentioned.length) {
    opts.mentioned = mentionOpts.mentioned
  }
  return opts
}

module.exports = {
  emptyMentionsJson,
  normalizeMentionsInput,
  mergeMentionsFromBody,
  resolveMentionsForGroup,
  buildEvolutionSendOptions,
  formatWhatsAppMentionBody,
  formatWhatsAppMentionAllBody,
  hasMentionAllInText,
  resolveMentionPhoneDigits,
  isParticipantMentionable,
  MENTION_ALL_WHATSAPP,
}

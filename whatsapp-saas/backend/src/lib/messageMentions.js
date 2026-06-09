const {
  jidDomain,
  resolvePhoneDigits,
  phoneDigitsFromJid,
  digitsOnly,
  isLikelyPhoneDigits,
  mapEvolutionParticipant,
} = require("./participantIdentity")

const MENTION_ALL_WHATSAPP = "all"
const MENTION_ALL_IN_TEXT_RE = /\B@(todos|all)\b/gi
const MENTION_ALL_DETECT_RE = /\B@(todos|all)\b/i
const PHONE_MENTION_IN_TEXT_RE = /@(\d{10,13})\b/g

function hasMentionAllInText(text) {
  return MENTION_ALL_DETECT_RE.test(String(text || ""))
}

/** @all no início (linha própria) + resto — melhor compatibilidade Evolution/Baileys. */
function formatWhatsAppMentionAllBody(body, mentionAll) {
  if (!mentionAll) return String(body || "")
  const raw = String(body || "")
  const rest = raw.replace(MENTION_ALL_IN_TEXT_RE, "").replace(/\s{2,}/g, " ").trim()
  if (!rest) return `@${MENTION_ALL_WHATSAPP}`
  return `@${MENTION_ALL_WHATSAPP}\n\n${rest}`
}

/** Baileys/Evolution: incluir @telefone no texto para cada membro notificado. */
function appendMassMentionPhonesToBody(body, targets) {
  let text = String(body || "")
  const phonesInText = new Set()
  for (const match of text.matchAll(PHONE_MENTION_IN_TEXT_RE)) {
    if (match[1]) phonesInText.add(match[1])
  }

  const tokens = []
  for (const target of targets) {
    const phone = String(target).includes("@") ? phoneDigitsFromJid(target) : digitsOnly(target)
    if (!phone || !isLikelyPhoneDigits(phone) || phonesInText.has(phone)) continue
    tokens.push(`@${phone}`)
    phonesInText.add(phone)
  }

  if (!tokens.length) return text
  return `${text}\n${tokens.join(" ")}`.trim()
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

function normalizeEvolutionParticipantsList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.participants)) return payload.participants
  if (Array.isArray(payload?.data?.participants)) return payload.data.participants
  return []
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

function extractMentionTargetsFromEvolutionPayload(payload) {
  const targets = []
  for (const raw of normalizeEvolutionParticipantsList(payload)) {
    const mapped = mapEvolutionParticipant(raw)
    const target = participantMentionTarget(mapped)
    if (target && !targets.includes(target)) targets.push(target)
  }
  return targets
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

async function resolveMentionsForGroup(prisma, userId, groupJid, content, sendContext = {}) {
  const linkPreview = content?.linkPreview !== false
  const mentionsJson = mergeMentionsFromBody(content?.body, content?.mentionsJson)
  const { instanceName, fetchGroupParticipants } = sendContext

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

  const individualMentioned = []
  for (const m of mentionsJson.mentions) {
    if (m.type !== "user") continue
    const p = findParticipantForMention(m, participantByJid, participants)
    const target = participantMentionTarget(p)
    if (target && !individualMentioned.includes(target)) individualMentioned.push(target)
  }

  let mentionsEveryOne = false
  let liveFetchCount = 0
  let allTargets = []
  let mentionStrategy = "none"

  if (mentionsJson.mentionAll === true) {
    if (instanceName && typeof fetchGroupParticipants === "function") {
      try {
        const payload = await fetchGroupParticipants(instanceName, groupJid)
        allTargets = extractMentionTargetsFromEvolutionPayload(payload)
        liveFetchCount = allTargets.length
      } catch (err) {
        console.warn("[mentions] fetchGroupParticipants falhou:", groupJid, err?.message || err)
      }
    }

    const dbTargets = participants.map((p) => participantMentionTarget(p)).filter(Boolean)
    allTargets = [...new Set([...allTargets, ...dbTargets])]

    if (allTargets.length > 0) {
      mentionStrategy = "mentioned+phonesInText"
    } else if (participants.length > 0) {
      mentionsEveryOne = true
      mentionStrategy = "mentionsEveryOne+fallback"
    } else {
      mentionsEveryOne = true
      mentionStrategy = "mentionsEveryOne+bare"
    }
  }

  let whatsappBody = formatWhatsAppMentionBody(content?.body, mentionsJson, participants, participantByJid)

  let mentioned = []

  if (mentionsJson.mentionAll && allTargets.length > 0) {
    // Caminho que funciona na prática: mentioned[] + @telefone de cada membro no texto
    mentioned = [...new Set([...allTargets, ...individualMentioned])]
    whatsappBody = appendMassMentionPhonesToBody(whatsappBody, allTargets)
    mentionsEveryOne = false
    mentionStrategy = "mentioned+phonesInText"
  } else if (mentionsJson.mentionAll) {
    // Último recurso: cache Evolution
    mentionsEveryOne = true
    mentioned = []
    mentionStrategy = "mentionsEveryOne+bare"
  } else {
    mentioned = [...individualMentioned]
  }

  if (mentionsJson.mentionAll && individualMentioned.length && mentionStrategy === "mentioned+phonesInText") {
    mentionStrategy = "mentioned+phonesInText+individual"
  }

  return {
    mentioned,
    mentionsEveryOne,
    mentionAll: mentionsJson.mentionAll === true,
    linkPreview,
    whatsappBody,
    mentionDebug: {
      mentionAll: mentionsJson.mentionAll,
      mentionsEveryOne,
      mentionStrategy,
      mentionedCount: mentioned.length,
      individualCount: individualMentioned.length,
      allTargetsCount: allTargets.length,
      participantCount: participants.length,
      liveFetchCount,
      skippedLid: participants.filter((p) => jidDomain(p.participantJid) === "lid").length,
    },
  }
}

function buildEvolutionSendOptions(mentionOpts = {}) {
  const opts = {}
  if (mentionOpts.linkPreview === true) opts.linkPreview = true

  // mentionsEveryOne tem prioridade para @all (Evolution ignora mentioned[] quando usa if/else interno)
  if (mentionOpts.mentionsEveryOne === true) {
    opts.mentionsEveryOne = true
  } else if (Array.isArray(mentionOpts.mentioned) && mentionOpts.mentioned.length) {
    opts.mentioned = mentionOpts.mentioned
  }

  if (mentionOpts.mentionAll === true) opts.mentionAll = true
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
  appendMassMentionPhonesToBody,
  hasMentionAllInText,
  resolveMentionPhoneDigits,
  isParticipantMentionable,
  participantMentionTarget,
  extractMentionTargetsFromEvolutionPayload,
  MENTION_ALL_WHATSAPP,
}

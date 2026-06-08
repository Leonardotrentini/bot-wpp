function phoneFromJid(jid) {
  if (!jid) return null
  const raw = String(jid).split("@")[0].split(":")[0]
  const digits = raw.replace(/\D/g, "")
  return digits || null
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

/** Detecta @todos / @nome no texto quando mentionsJson não veio do frontend. */
function mergeMentionsFromBody(body, mentionsJson) {
  const normalized = normalizeMentionsInput(mentionsJson)
  if (normalized.mentionAll) return normalized

  const text = String(body || "")
  if (/\B@todos\b/i.test(text)) {
    return {
      mentionAll: true,
      mentions: [...normalized.mentions.filter((m) => m.type !== "all"), { type: "all", label: "todos" }],
    }
  }
  return normalized
}

function participantPhone(participant) {
  return (
    phoneFromJid(participant?.participantJid) ||
    (participant?.phone && String(participant.phone).replace(/\D/g, "").length >= 8
      ? String(participant.phone).replace(/\D/g, "")
      : null)
  )
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

/** WhatsApp precisa de @número no texto para destacar menções individuais. */
function formatWhatsAppMentionBody(body, mentionsJson, participants, participantByJid) {
  let text = String(body || "")
  const normalized = normalizeMentionsInput(mentionsJson)

  for (const m of normalized.mentions) {
    if (m.type !== "user" || !m.label) continue
    const p = findParticipantForMention(m, participantByJid, participants)
    const phone = participantPhone(p) || m.phone
    if (!phone) continue
    text = text.replace(new RegExp(`@${escapeRegex(m.label)}\\b`, "gi"), `@${phone}`)
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
    }
  }

  const mentioned = []

  if (mentionsJson.mentionAll) {
    for (const p of participants) {
      const phone = participantPhone(p)
      if (phone && !mentioned.includes(phone)) mentioned.push(phone)
    }
  }

  for (const m of mentionsJson.mentions) {
    if (m.type !== "user") continue
    const p = findParticipantForMention(m, participantByJid, participants)
    if (!p) continue
    const phone = participantPhone(p) || m.phone
    if (phone && !mentioned.includes(phone)) mentioned.push(phone)
  }

  const whatsappBody = formatWhatsAppMentionBody(content?.body, mentionsJson, participants, participantByJid)

  // Lista explícita de telefones (sync local). mentionsEveryOne só se não houver participantes.
  const mentionsEveryOne = mentionsJson.mentionAll && mentioned.length === 0

  return {
    mentioned,
    mentionsEveryOne,
    linkPreview,
    whatsappBody,
  }
}

function buildEvolutionSendOptions(mentionOpts = {}) {
  const opts = {}
  if (mentionOpts.linkPreview === true) opts.linkPreview = true
  if (mentionOpts.mentionsEveryOne === true) opts.mentionsEveryOne = true
  if (Array.isArray(mentionOpts.mentioned) && mentionOpts.mentioned.length) {
    opts.mentioned = mentionOpts.mentioned
  }
  return opts
}

module.exports = {
  phoneFromJid,
  emptyMentionsJson,
  normalizeMentionsInput,
  mergeMentionsFromBody,
  resolveMentionsForGroup,
  buildEvolutionSendOptions,
  formatWhatsAppMentionBody,
}

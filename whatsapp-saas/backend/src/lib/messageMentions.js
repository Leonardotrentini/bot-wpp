function phoneFromJid(jid) {
  if (!jid) return null
  const raw = String(jid).split("@")[0].split(":")[0]
  const digits = raw.replace(/\D/g, "")
  return digits || null
}

function emptyMentionsJson() {
  return { mentionAll: false, mentions: [] }
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

async function resolveMentionsForGroup(prisma, userId, groupJid, content) {
  const linkPreview = content?.linkPreview !== false
  const mentionsJson = normalizeMentionsInput(content?.mentionsJson)
  if (!mentionsJson.mentionAll && !mentionsJson.mentions.length) {
    return { mentioned: [], mentionsEveryOne: false, linkPreview }
  }

  const group = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId, groupJid } },
    include: { participants: { where: { status: { not: "saiu" } } } },
  })

  const participantByJid = new Map((group?.participants || []).map((p) => [p.participantJid, p]))
  const mentioned = []

  for (const m of mentionsJson.mentions) {
    if (m.type !== "user") continue
    const p = participantByJid.get(m.participantJid)
    if (!p) continue
    const phone =
      phoneFromJid(p.participantJid) ||
      phoneFromJid(m.participantJid) ||
      (p.phone && String(p.phone).replace(/\D/g, "")) ||
      m.phone
    if (phone && !mentioned.includes(phone)) mentioned.push(phone)
  }

  return {
    mentioned,
    mentionsEveryOne: mentionsJson.mentionAll,
    linkPreview,
  }
}

function buildEvolutionSendOptions(mentionOpts = {}) {
  const opts = {}
  if (mentionOpts.linkPreview !== false) opts.linkPreview = true
  if (mentionOpts.mentionsEveryOne) {
    opts.mentionsEveryOne = true
    opts.everyOne = true
  }
  if (Array.isArray(mentionOpts.mentioned) && mentionOpts.mentioned.length) {
    opts.mentioned = mentionOpts.mentioned
  }
  return opts
}

module.exports = {
  phoneFromJid,
  emptyMentionsJson,
  normalizeMentionsInput,
  resolveMentionsForGroup,
  buildEvolutionSendOptions,
}

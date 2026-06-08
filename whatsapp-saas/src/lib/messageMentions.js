export function emptyMentionsJson() {
  return { mentionAll: false, mentions: [] }
}

export function normalizeMentionsJson(raw) {
  if (!raw || typeof raw !== 'object') return emptyMentionsJson()
  const mentions = Array.isArray(raw.mentions)
    ? raw.mentions.filter((m) => m && m.label).map((m) => ({
        type: m.type === 'all' ? 'all' : 'user',
        label: String(m.label).trim(),
        participantJid: m.participantJid || undefined,
        phone: m.phone || undefined,
      }))
    : []
  const mentionAll = raw.mentionAll === true || mentions.some((m) => m.type === 'all')
  return { mentionAll, mentions }
}

export function appendComposerFields(payload, form) {
  const mentionsJson = normalizeMentionsJson(form.mentionsJson)
  if (mentionsJson.mentionAll || mentionsJson.mentions.length) {
    payload.mentionsJson = mentionsJson
  }
  payload.linkPreview = form.linkPreview !== false
}

export function mentionLabel(member) {
  const name = String(member?.name || member?.phone || 'Membro').trim()
  return name.split(/\s+/)[0] || name
}

export function filterMembersForMention(members, groupIds, query = '') {
  let list = members || []
  if (groupIds?.length) {
    list = list.filter((m) => (m.groupIds || []).some((id) => groupIds.includes(id)))
  }
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (m) =>
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.phone || '').toLowerCase().includes(q),
  )
}

const URL_RE = /(https?:\/\/[^\s]+)/g

export function renderMessageBodyParts(text) {
  if (!text) return []
  const parts = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0
    if (idx > last) parts.push({ type: 'text', value: text.slice(last, idx) })
    parts.push({ type: 'link', value: match[0] })
    last = idx + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts.length ? parts : [{ type: 'text', value: text }]
}

export function highlightMentionsInText(text, mentionsJson) {
  const normalized = normalizeMentionsJson(mentionsJson)
  const labels = new Set(['todos'])
  for (const m of normalized.mentions) {
    if (m.label) labels.add(m.label)
  }
  if (!text) return [{ type: 'text', value: '' }]
  const regex = new RegExp(`@(${[...labels].map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = []
  let last = 0
  for (const match of text.matchAll(regex)) {
    const idx = match.index ?? 0
    if (idx > last) parts.push(...renderMessageBodyParts(text.slice(last, idx)))
    const label = match[1] || ''
    parts.push({
      type: label.toLowerCase() === 'todos' ? 'mention-all' : 'mention-user',
      value: match[0],
    })
    last = idx + match[0].length
  }
  if (last < text.length) parts.push(...renderMessageBodyParts(text.slice(last)))
  return parts.length ? parts : renderMessageBodyParts(text)
}

export function mentionPartClass(type) {
  if (type === 'mention-all') return 'mention-inline-all'
  if (type === 'mention-user') return 'mention-inline-user'
  if (type === 'link') return 'mention-inline-link'
  return ''
}

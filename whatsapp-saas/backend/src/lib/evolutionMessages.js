function serializeJson(value) {
  try {
    return value == null ? null : JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function isReactionRecord(record) {
  const t = String(record?.messageType || "").toLowerCase()
  if (t.includes("reaction")) return true
  return Boolean(record?.message?.reactionMessage)
}

/** ID da mensagem alvo de uma reação (emoji). */
function extractReactionTargetMessageId(record) {
  const rm = record?.message?.reactionMessage
  if (!rm) return null
  const id = rm?.key?.id || rm?.text?.key?.id
  return id ? String(id) : null
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") return ""
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  )
}

function unwrapMessageList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.records)) return value.records
  if (Array.isArray(value?.messages)) return value.messages
  return []
}

/** Aceita lista, paginação Evolution ou um único evento MESSAGES_UPSERT / MESSAGES_SET. */
function normalizeEvolutionMessages(payload) {
  if (!payload || typeof payload !== "object") return []
  if (Array.isArray(payload)) return payload

  const nestedLists = [
    payload?.messages,
    payload?.data?.messages,
    payload?.response?.messages,
    payload?.result?.messages,
  ]
  for (const candidate of nestedLists) {
    const list = unwrapMessageList(candidate)
    if (list.length) return list
  }

  if (Array.isArray(payload?.messages?.records)) return payload.messages.records
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data?.messages?.records)) return payload.data.messages.records
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.response)) return payload.response
  if (Array.isArray(payload?.result)) return payload.result

  const single = payload?.data?.key ? payload.data : payload
  if (single?.key && (single?.message || single?.messageType || single?.messageTimestamp)) {
    return [single]
  }
  return []
}

function normalizeJid(jid) {
  return String(jid || "")
    .trim()
    .toLowerCase()
}

function jidsMatch(a, b) {
  const left = normalizeJid(a)
  const right = normalizeJid(b)
  if (!left || !right) return false
  if (left === right) return true
  const leftBase = left.split("@")[0]
  const rightBase = right.split("@")[0]
  return Boolean(leftBase && leftBase === rightBase)
}

/** Extrai registros de webhook (Evolution envia `messages.upsert` com formatos variados). */
function collectWebhookMessageRecords(body) {
  const seen = new Set()
  const out = []
  const push = (records) => {
    for (const record of records || []) {
      const id = record?.key?.id || record?.id
      const dedupeKey = id ? String(id) : null
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
      }
      out.push(record)
    }
  }

  push(normalizeEvolutionMessages(body?.data))
  push(normalizeEvolutionMessages(body))
  return out
}

function messageRemoteJid(record) {
  return record?.key?.remoteJid || record?.remoteJid || null
}

function filterMessagesForGroup(records, groupJid) {
  const target = String(groupJid || "")
  if (!target) return records || []
  return (records || []).filter((record) => {
    const remote = messageRemoteJid(record)
    return remote && jidsMatch(remote, target)
  })
}

function extractTimestampRaw(record) {
  const key = record?.key || {}
  return (
    record?.messageTimestamp ??
    record?.messageTimestampMs ??
    key?.messageTimestamp ??
    record?.timestamp ??
    record?.createdAt ??
    record?.updatedAt ??
    null
  )
}

function mapEvolutionMessage(record) {
  const key = record?.key || {}
  const messageId = key.id || record?.id
  const iso = toIsoFromEvolutionTimestamp(extractTimestampRaw(record))
  const fromMe = Boolean(key.fromMe ?? record?.fromMe ?? false)
  const remoteJid = messageRemoteJid(record)
  const isGroup = remoteJid && String(remoteJid).endsWith("@g.us")
  const senderJid = isGroup
    ? key.participant || record?.participant || null
    : key.remoteJid || key.participant || record?.participant || null
  const body = extractMessageText(record?.message) || record?.body || ""

  let senderName = fromMe ? "Você" : record?.pushName || null
  if (!fromMe && !senderName && senderJid) {
    senderName = String(senderJid).split("@")[0]
  }

  return {
    messageId: messageId ? String(messageId) : null,
    fromMe,
    senderJid: senderJid ? String(senderJid) : null,
    senderName,
    type: record?.messageType || "text",
    body: body ? String(body).slice(0, 4000) : "",
    timestamp: iso ? new Date(iso) : null,
    raw: serializeJson(record),
  }
}

function toIsoFromEvolutionTimestamp(value) {
  if (value == null) return null

  if (typeof value === "object") {
    if (value.$date != null) return toIsoFromEvolutionTimestamp(value.$date)
    if (typeof value.toNumber === "function") return toIsoFromEvolutionTimestamp(value.toNumber())
    const low = value.low ?? value._low
    const high = value.high ?? value._high
    if (low != null) {
      const n = Number(high) * 4294967296 + Number(low)
      if (Number.isFinite(n)) return toIsoFromEvolutionTimestamp(n)
    }
  }

  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    let ms
    if (n < 1e11) ms = n * 1000
    else if (n < 1e14) ms = n
    else ms = Math.floor(n / 1000)
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString()
  }

  const d = new Date(value)
  if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString()
  return null
}

module.exports = {
  normalizeEvolutionMessages,
  collectWebhookMessageRecords,
  filterMessagesForGroup,
  mapEvolutionMessage,
  extractMessageText,
  messageRemoteJid,
  toIsoFromEvolutionTimestamp,
  jidsMatch,
  normalizeJid,
  isReactionRecord,
  extractReactionTargetMessageId,
}

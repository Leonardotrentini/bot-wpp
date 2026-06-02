function serializeJson(value) {
  try {
    return value == null ? null : JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
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

/** Aceita lista, paginação Evolution ou um único evento MESSAGES_UPSERT / MESSAGES_SET. */
function normalizeEvolutionMessages(payload) {
  if (!payload || typeof payload !== "object") return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.messages?.records)) return payload.messages.records
  if (Array.isArray(payload?.messages)) return payload.messages
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data?.messages?.records)) return payload.data.messages.records
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages
  if (Array.isArray(payload?.data)) return payload.data

  const single = payload?.data?.key ? payload.data : payload
  if (single?.key && (single?.message || single?.messageType || single?.messageTimestamp)) {
    return [single]
  }
  return []
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
    return remote && String(remote) === target
  })
}

function mapEvolutionMessage(record) {
  const key = record?.key || {}
  const messageId = key.id || record?.id
  const timestampRaw = record?.messageTimestamp || record?.messageTimestampMs || record?.timestamp
  const iso = toIsoFromEvolutionTimestamp(timestampRaw)
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
    timestamp: iso ? new Date(iso) : new Date(),
    raw: serializeJson(record),
  }
}

function toIsoFromEvolutionTimestamp(value) {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const ms = n < 1e12 ? n * 1000 : n
  return new Date(ms).toISOString()
}

module.exports = {
  normalizeEvolutionMessages,
  collectWebhookMessageRecords,
  filterMessagesForGroup,
  mapEvolutionMessage,
  extractMessageText,
  messageRemoteJid,
  toIsoFromEvolutionTimestamp,
}

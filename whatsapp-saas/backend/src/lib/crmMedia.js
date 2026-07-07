/**
 * Download de mídia de mensagens CRM via Evolution API.
 */

const { fetchChatMessages } = require("./evolution")

function unwrapBaileysMessage(message) {
  if (!message || typeof message !== "object") return message
  let current = message
  for (let i = 0; i < 8; i += 1) {
    const inner =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message ||
      current?.protocolMessage?.editedMessage?.message
    if (!inner) break
    current = inner
  }
  return current
}

function prepareMediaMessageRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== "object") return rawRecord
  const key = rawRecord.key || {}
  const message = unwrapBaileysMessage(rawRecord.message)
  const remoteJid = key.remoteJid || rawRecord.remoteJid || null
  return {
    key: {
      remoteJid,
      fromMe: Boolean(key.fromMe ?? rawRecord.fromMe),
      id: key.id || rawRecord.id || null,
      participant: key.participant || rawRecord.participant || undefined,
    },
    message,
    messageTimestamp: rawRecord.messageTimestamp ?? key.messageTimestamp ?? undefined,
  }
}

function mediaRecordIsComplete(rawRecord) {
  const prepared = prepareMediaMessageRecord(rawRecord)
  const m = prepared?.message
  if (!prepared?.key?.id || !m) return false
  return !!(
    m.audioMessage ||
    m.pttMessage ||
    m.imageMessage ||
    m.videoMessage ||
    m.documentMessage ||
    m.stickerMessage
  )
}

function extractMediaBase64Payload(resp) {
  const queue = [resp]
  const seen = new Set()
  while (queue.length) {
    const node = queue.shift()
    if (!node || typeof node !== "object" || seen.has(node)) continue
    seen.add(node)

    const base64 =
      (typeof node.base64 === "string" && node.base64) ||
      (typeof node.buffer === "string" && node.buffer) ||
      (typeof node.media === "string" && node.media) ||
      null

    if (base64) {
      const mimetype = String(node.mimetype || node.mimeType || node.mediaType || "application/octet-stream")
        .split(";")[0]
        .trim()
      return {
        base64: base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, ""),
        mimetype,
      }
    }

    for (const key of ["data", "response", "result", "message", "media"]) {
      if (node[key] && typeof node[key] === "object") queue.push(node[key])
    }
  }
  return null
}

async function ensureMessageRaw(deps, msg) {
  if (msg.raw && mediaRecordIsComplete(msg.raw)) return prepareMediaMessageRecord(msg.raw)

  const conv = await deps.prisma.crmConversation.findUnique({ where: { id: msg.conversationId } })
  if (!conv) return prepareMediaMessageRecord(msg.raw)

  const conn = await deps.prisma.whatsAppConnection.findUnique({ where: { userId: msg.userId } })
  if (!conn?.instanceName) return prepareMediaMessageRecord(msg.raw)

  const targetId = String(msg.messageId || "")
  for (let page = 1; page <= 5; page += 1) {
    try {
      const { records } = await fetchChatMessages(conn.instanceName, conv.remoteJid, { page, pageSize: 50 })
      const hit = (records || []).find((r) => String(r?.key?.id) === targetId)
      if (hit && mediaRecordIsComplete(hit)) {
        const raw = JSON.parse(JSON.stringify(hit))
        await deps.prisma.crmMessage
          .update({ where: { id: msg.id }, data: { raw } })
          .catch(() => {})
        return prepareMediaMessageRecord(raw)
      }
    } catch {
      /* próxima página */
    }
  }

  return prepareMediaMessageRecord(msg.raw)
}

module.exports = {
  unwrapBaileysMessage,
  prepareMediaMessageRecord,
  mediaRecordIsComplete,
  extractMediaBase64Payload,
  ensureMessageRaw,
}

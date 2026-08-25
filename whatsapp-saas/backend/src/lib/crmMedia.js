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

function stripMediaBase64(value) {
  const s = String(value || "")
  const idx = s.toLowerCase().indexOf("base64,")
  if (s.trimStart().toLowerCase().startsWith("data:") && idx !== -1) {
    return s.slice(idx + "base64,".length).replace(/\s/g, "")
  }
  return s.replace(/\s/g, "")
}

const RAW_BLOB_KEYS = new Set([
  "jpegThumbnail",
  "jpeg_thumbnail",
  "waveform",
  "scansSidecar",
  "firstScanSidecar",
  "midQualityFileSha256",
])

function isNumericByteArray(value) {
  if (!Array.isArray(value) || value.length < 64) return false
  return typeof value[0] === "number"
}

function looksLikeBase64Blob(value) {
  return typeof value === "string" && value.length > 8000
}

/**
 * Remove thumbnails/buffers/base64 do payload Evolution.
 * Mantém key + ponteiros de mídia (mediaKey, url, directPath, mimetype)
 * para o download via getBase64FromMediaMessage continuar igual.
 * Não apaga raw._localMedia (preview de envio do CRM).
 */
function sanitizeMessageRaw(value, depth = 0) {
  if (value == null || depth > 16) return value
  if (typeof value === "string") {
    if (looksLikeBase64Blob(value)) return undefined
    return value
  }
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    if (isNumericByteArray(value)) return undefined
    return value.map((item) => sanitizeMessageRaw(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (value.type === "Buffer" && Array.isArray(value.data)) return undefined

  const out = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === "_localMedia") {
      out[key] = nested
      continue
    }
    if (RAW_BLOB_KEYS.has(key)) continue
    if ((key === "base64" || key === "dataUrl" || key === "buffer") && looksLikeBase64Blob(nested)) continue
    const cleaned = sanitizeMessageRaw(nested, depth + 1)
    if (cleaned !== undefined) out[key] = cleaned
  }
  return out
}

/** Mantém mídia enviada pelo CRM quando o webhook do WhatsApp atualiza a mensagem. */
function mergeInboundMessageRaw(existingRaw, incomingRaw) {
  const local = existingRaw?._localMedia
  const incoming = sanitizeMessageRaw(incomingRaw)
  if (!local?.base64) return incoming ?? sanitizeMessageRaw(existingRaw) ?? null

  const base =
    incoming && typeof incoming === "object"
      ? { ...incoming }
      : existingRaw && typeof existingRaw === "object"
        ? { ...sanitizeMessageRaw(existingRaw) }
        : {}

  return { ...base, _localMedia: local }
}

/** Mídia enviada pelo CRM e guardada em raw._localMedia (antes do WhatsApp indexar). */
function readStoredMessageMedia(msg) {
  const local = msg?.raw?._localMedia
  if (!local?.base64) return null
  return {
    base64: stripMediaBase64(local.base64),
    mimetype: local.mimetype || msg?.mediaMime || "application/octet-stream",
  }
}

/**
 * Acima disto guardamos só o ponteiro do CDN: base64 de vídeo grande no JSON
 * do Postgres estoura a linha e deixa a inbox lenta.
 */
const LOCAL_MEDIA_MAX_BYTES = Number(process.env.LOCAL_MEDIA_MAX_BYTES || 8 * 1024 * 1024)

/** Monta raw para mensagens enviadas manualmente / fila CRM. */
function buildOutboundMessageRaw({ providerMessageId, remoteJid, evolutionResp, mediaBase64, mediaMime, mediaName } = {}) {
  const b64 = stripMediaBase64(mediaBase64)
  const hasCdn = Boolean(evolutionResp && mediaRecordIsComplete(evolutionResp))
  let raw

  if (hasCdn) {
    raw = sanitizeMessageRaw(JSON.parse(JSON.stringify(evolutionResp))) || {}
  } else {
    const id = providerMessageId || `manual-${Date.now()}`
    raw = {
      key: { id, remoteJid, fromMe: true },
    }
  }

  const inlineBytes = b64 ? Math.floor((b64.length * 3) / 4) : 0
  if (b64 && (!hasCdn || inlineBytes <= LOCAL_MEDIA_MAX_BYTES)) {
    raw._localMedia = {
      base64: b64,
      mimetype: mediaMime || null,
      fileName: mediaName || null,
    }
  }

  return raw
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
        base64: stripMediaBase64(base64),
        mimetype,
      }
    }

    for (const key of ["data", "response", "result", "message", "media"]) {
      if (node[key] && typeof node[key] === "object") queue.push(node[key])
    }
  }
  return null
}

/** Procura o registro completo (com ponteiro de CDN) no histórico do chat/grupo. */
async function findCompleteRawInChat({ instanceName, remoteJid, messageId, maxPages = 5 }) {
  if (!instanceName || !remoteJid || !messageId) return null
  const targetId = String(messageId)
  for (let page = 1; page <= maxPages; page += 1) {
    try {
      const { records } = await fetchChatMessages(instanceName, remoteJid, { page, pageSize: 50 })
      const hit = (records || []).find((r) => String(r?.key?.id) === targetId)
      if (hit && mediaRecordIsComplete(hit)) return JSON.parse(JSON.stringify(hit))
    } catch {
      /* próxima página */
    }
  }
  return null
}

async function ensureMessageRaw(deps, msg) {
  const stored = readStoredMessageMedia(msg)
  if (stored) return null

  if (msg.raw && mediaRecordIsComplete(msg.raw)) return prepareMediaMessageRecord(msg.raw)

  const conv = await deps.prisma.crmConversation.findUnique({ where: { id: msg.conversationId } })
  if (!conv) return prepareMediaMessageRecord(msg.raw)

  const conn = await deps.prisma.whatsAppConnection.findUnique({ where: { userId: msg.userId } })
  if (!conn?.instanceName) return prepareMediaMessageRecord(msg.raw)

  const raw = await findCompleteRawInChat({
    instanceName: conn.instanceName,
    remoteJid: conv.remoteJid,
    messageId: msg.messageId,
  })
  if (raw) {
    const slim = sanitizeMessageRaw(raw)
    await deps.prisma.crmMessage.update({ where: { id: msg.id }, data: { raw: slim } }).catch(() => {})
    return prepareMediaMessageRecord(slim)
  }

  return prepareMediaMessageRecord(msg.raw)
}

/**
 * Mesmo fluxo para mensagens de grupo (`WhatsAppMessage`): usa o raw salvo e,
 * se estiver incompleto, rebusca no histórico do grupo e regrava.
 */
async function ensureGroupMessageRaw(deps, row, { instanceName, groupJid } = {}) {
  if (row?.raw && mediaRecordIsComplete(row.raw)) return prepareMediaMessageRecord(row.raw)

  const raw = await findCompleteRawInChat({
    instanceName,
    remoteJid: groupJid,
    messageId: row?.messageId,
  })
  if (raw) {
    const slim = sanitizeMessageRaw(raw)
    await deps.prisma.whatsAppMessage.update({ where: { id: row.id }, data: { raw: slim } }).catch(() => {})
    return prepareMediaMessageRecord(slim)
  }

  return prepareMediaMessageRecord(row?.raw)
}

module.exports = {
  unwrapBaileysMessage,
  prepareMediaMessageRecord,
  mediaRecordIsComplete,
  extractMediaBase64Payload,
  readStoredMessageMedia,
  buildOutboundMessageRaw,
  mergeInboundMessageRaw,
  ensureMessageRaw,
  ensureGroupMessageRaw,
  findCompleteRawInChat,
  stripMediaBase64,
  sanitizeMessageRaw,
}

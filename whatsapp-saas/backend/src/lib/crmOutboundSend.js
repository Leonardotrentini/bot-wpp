/**
 * Validação comum de envios CRM → Evolution (fluxos, IA, manual).
 * Híbrido: grava no CRM como pending → poll ACK → sent/delivered/failed.
 */

const { resolveEvolutionRecipient, resolvePhoneDigits, isLidJid } = require("./crmCore")
const { validateMediaContentSize } = require("./mediaLimits")

const ACK_OK = new Set(["SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED", "2", "3", "4", "5"])

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function extractProviderMessageId(resp) {
  if (!resp || typeof resp !== "object") return null
  return (
    resp?.key?.id ||
    resp?.message?.key?.id ||
    resp?.data?.key?.id ||
    resp?.response?.key?.id ||
    resp?.messageId ||
    resp?.id ||
    null
  )
}

function normalizeEvolutionNumber(raw) {
  const s = String(raw || "").trim()
  if (!s) return s
  if (/@s\.whatsapp\.net$/i.test(s) || /@lid$/i.test(s)) {
    const digits = s.split("@")[0].replace(/\D/g, "")
    if (digits.length >= 8 && digits.length <= 15) return digits
    return s
  }
  if (/^\d{8,15}$/.test(s.replace(/\s/g, ""))) return s.replace(/\D/g, "")
  return s
}

function buildRecipientLookupJids(conversation, normalizedNumber) {
  const out = new Set()
  const remote = String(conversation?.remoteJid || "").trim()
  if (remote) out.add(remote)
  const contact = conversation?.contact
  if (contact?.lidJid) out.add(String(contact.lidJid).trim())
  const phone = normalizedNumber || resolvePhoneDigits(contact)
  if (phone) {
    const digits = String(phone).replace(/\D/g, "")
    if (digits) {
      out.add(digits)
      out.add(`${digits}@s.whatsapp.net`)
      out.add(`${digits}@lid`)
    }
  }
  return [...out].filter(Boolean)
}

function extractMessageAckStatus(record) {
  if (!record) return null
  const updates = record.MessageUpdate || record.messageUpdate
  const fromUpdate = Array.isArray(updates) && updates.length ? updates[updates.length - 1]?.status : null
  return (
    record.status ??
    record.message?.status ??
    record.update?.status ??
    fromUpdate ??
    null
  )
}

function extractSendResponseAck(resp) {
  if (!resp || typeof resp !== "object") return null
  return resp.status ?? resp.message?.status ?? resp.key?.status ?? null
}

function isAckFailure(status) {
  const s = String(status ?? "").toUpperCase()
  return s.includes("ERROR") || s.includes("FAIL")
}

function isAckOk(status) {
  const s = String(status ?? "").toUpperCase()
  if (!s || s === "PENDING" || s === "ERROR" || s === "0") return false
  if (ACK_OK.has(s)) return true
  if (s.includes("ACK") || s.includes("READ") || s.includes("PLAY")) return true
  const n = Number(status)
  return Number.isFinite(n) && n >= 2
}

function isDeliveryAck(status) {
  const s = String(status ?? "").toUpperCase()
  if (s.includes("DELIVERY") || s === "3") return true
  if (s.includes("READ") || s === "4" || s === "5") return true
  return false
}

function mapAckToCrmStatus(ackStatus) {
  const s = String(ackStatus ?? "").toUpperCase()
  if (s.includes("READ") || s === "4" || s === "5") return "read"
  if (s.includes("DELIVERY") || s === "3") return "delivered"
  if (isAckOk(ackStatus)) return "sent"
  return "failed"
}

function mediaPartFromResponse(resp, mediaType) {
  const mt = String(mediaType || "").toLowerCase()
  const messages = [resp?.message, resp?.message?.message, resp?.data?.message].filter(Boolean)
  for (const msg of messages) {
    if (mt === "image") return msg.imageMessage || null
    if (mt === "video") return msg.videoMessage || null
    if (mt === "audio") return msg.audioMessage || msg.pttMessage || null
    if (mt === "document") return msg.documentMessage || null
  }
  return null
}

function assertMediaUploaded(resp, mediaType, context = "mídia") {
  const mt = String(mediaType || "").toLowerCase()
  if (!["image", "video", "document"].includes(mt)) return
  const part = mediaPartFromResponse(resp, mediaType)
  const messageId = extractProviderMessageId(resp)
  if (!part) {
    if (mt === "image" && messageId) {
      console.warn(`[crm-outbound] ${context}: imageMessage ausente — confiando no messageId ${messageId}`)
      return
    }
    throw new Error(`${context}: resposta sem payload de ${mt}.`)
  }
  if (!part.directPath && !part.url && !part.mediaKey) {
    if (mt === "image" && messageId) {
      console.warn(`[crm-outbound] ${context}: imagem sem CDN na resposta — confiando no messageId ${messageId}`)
      return
    }
    throw new Error(`${context}: mídia não subiu ao WhatsApp (sem CDN).`)
  }
}

async function findMessageInChats(fetchChatMessages, instanceName, jids, messageId) {
  for (const jid of jids) {
    try {
      const { records } = await fetchChatMessages(instanceName, jid, { page: 1, pageSize: 30 })
      const hit = (records || []).find((r) => r?.key?.id === messageId)
      if (hit) return hit
    } catch {
      /* tenta próximo jid */
    }
  }
  return null
}

async function findOutboundMessage(deps, instanceName, jids, messageId) {
  if (typeof deps?.findMessageById === "function") {
    try {
      const hit = await deps.findMessageById(instanceName, messageId, { jids })
      if (hit) return hit
    } catch {
      /* fallback por JID */
    }
  }
  if (typeof deps?.fetchChatMessages === "function") {
    return findMessageInChats(deps.fetchChatMessages, instanceName, jids, messageId)
  }
  return null
}

async function waitForOutboundAck(deps, instanceName, jids, messageId, options = {}) {
  const hasMedia = options.hasMedia === true
  const defaultTimeout = hasMedia ? 30000 : 20000
  const timeoutMs = Number(options.timeoutMs ?? process.env.CRM_DELIVERY_ACK_TIMEOUT_MS ?? defaultTimeout)
  const intervalMs = Number(options.intervalMs ?? process.env.CRM_DELIVERY_ACK_POLL_MS ?? 2500)
  const started = Date.now()
  let last = null
  let lastStatus = null

  while (Date.now() - started < timeoutMs) {
    last = await findOutboundMessage(deps, instanceName, jids, messageId)
    lastStatus = extractMessageAckStatus(last)
    if (last && isAckOk(lastStatus)) {
      return { record: last, status: lastStatus, delivered: isDeliveryAck(lastStatus) }
    }
    await wait(intervalMs)
  }

  return {
    record: last,
    status: last ? lastStatus || "PENDING" : "TIMEOUT",
    delivered: false,
  }
}

function assertEvolutionSendAccepted(resp, context = "envio") {
  const nestedMsg = Array.isArray(resp?.response?.message)
    ? resp.response.message.join("; ")
    : resp?.response?.message
  const errMsg = resp?.message || resp?.error || nestedMsg
  const status = String(resp?.status || resp?.state || "").toUpperCase()
  if (status.includes("ERROR") || status.includes("FAIL")) {
    throw new Error(typeof errMsg === "string" ? errMsg : `Evolution rejeitou o ${context}.`)
  }
  const id = extractProviderMessageId(resp)
  if (!id || String(id).length < 4) {
    throw new Error(
      typeof errMsg === "string" && errMsg.trim()
        ? errMsg
        : `Evolution não confirmou o ID da mensagem (${context}).`,
    )
  }
  return id
}

function validateOutboundSendResponse(resp, { context, mediaType }) {
  const messageId = assertEvolutionSendAccepted(resp, context)
  assertMediaUploaded(resp, mediaType, context)
  return messageId
}

async function pollOutboundDeliveryAck(deps, { instanceName, conversation, to, messageId, mediaType, sendResp, quick }) {
  const number = normalizeEvolutionNumber(to)
  const jids = buildRecipientLookupJids(conversation, number)
  const hasMedia = mediaType && mediaType !== "none"
  const useQuick = quick !== false && process.env.CRM_DELIVERY_ACK_FULL_POLL !== "1"

  const immediate = extractSendResponseAck(sendResp)
  if (isAckOk(immediate)) {
    return {
      crmStatus: mapAckToCrmStatus(immediate),
      ackOk: true,
      detail: String(immediate),
    }
  }

  if (useQuick) {
    return { crmStatus: "sent", ackOk: true, detail: "enviado" }
  }

  if (typeof deps?.fetchChatMessages !== "function" && typeof deps?.findMessageById !== "function") {
    return { crmStatus: "sent", ackOk: true, detail: "poll indisponível" }
  }

  const ack = await waitForOutboundAck(deps, instanceName, jids, messageId, { hasMedia })
  if (isAckFailure(ack.status)) {
    const detail = `status ${ack.status}`
    console.warn(`[crm-outbound] ACK falhou messageId=${messageId} dest=${number || to} → ${detail}`)
    return { crmStatus: "failed", ackOk: false, detail }
  }
  if (isAckOk(ack.status)) {
    return {
      crmStatus: mapAckToCrmStatus(ack.status),
      ackOk: true,
      detail: String(ack.status || "ok"),
    }
  }

  // Mensagem no histórico da instância = WhatsApp aceitou (ACK pode chegar depois via webhook).
  if (ack.record) {
    console.warn(
      `[crm-outbound] ACK pendente messageId=${messageId} dest=${number || to} — confirmada no histórico (${ack.status || "?"})`,
    )
    return { crmStatus: "sent", ackOk: true, detail: "confirmada no histórico" }
  }

  // Evolution devolveu messageId válido — envio aceito; poll não achou ACK a tempo.
  console.warn(
    `[crm-outbound] ACK pendente messageId=${messageId} dest=${number || to} — marcando sent (webhook atualiza)`,
  )
  return { crmStatus: "sent", ackOk: true, detail: "ack pendente" }
}

async function confirmEvolutionDelivery(deps, params) {
  const messageId = validateOutboundSendResponse(params.resp, {
    context: params.context,
    mediaType: params.mediaType,
  })
  const ack = await pollOutboundDeliveryAck(deps, {
    instanceName: params.instanceName,
    conversation: params.conversation,
    to: params.to,
    messageId,
    mediaType: params.mediaType,
    sendResp: params.resp,
  })
  return { messageId, crmStatus: ack.crmStatus, ackOk: ack.ackOk, detail: ack.detail }
}

function assertOutboundRecipient(conversation) {
  const to = resolveEvolutionRecipient(conversation)
  const raw = String(to || "").trim()
  if (!raw) throw new Error("Destino inválido — contato sem telefone ou JID.")
  if (/@lid$/i.test(raw)) return raw
  const normalized = normalizeEvolutionNumber(raw)
  if (normalized && /^\d{8,15}$/.test(normalized)) return normalized
  const lidFallback =
    (isLidJid(conversation?.remoteJid) && String(conversation.remoteJid).trim()) ||
    (isLidJid(conversation?.contact?.lidJid) && String(conversation.contact.lidJid).trim()) ||
    null
  if (lidFallback) return lidFallback
  throw new Error("Destino inválido — contato sem telefone ou JID.")
}

function validateOutboundMediaPayload({ body, mediaType, mediaBase64, mediaMime, mediaName }) {
  const mt = mediaType && mediaType !== "none" ? mediaType : "none"
  const err = validateMediaContentSize({
    body: body || "",
    mediaType: mt,
    mediaBase64,
    mediaMime,
    mediaName,
  })
  if (err) throw new Error(err)
}

module.exports = {
  extractProviderMessageId,
  assertEvolutionSendAccepted,
  validateOutboundSendResponse,
  pollOutboundDeliveryAck,
  confirmEvolutionDelivery,
  assertOutboundRecipient,
  validateOutboundMediaPayload,
  assertMediaUploaded,
  normalizeEvolutionNumber,
  buildRecipientLookupJids,
  waitForOutboundAck,
  isAckOk,
  mapAckToCrmStatus,
}

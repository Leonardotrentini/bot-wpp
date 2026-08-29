/**
 * Validação comum de envios CRM → Evolution (fluxos, IA, manual).
 * Grava no CRM com messageId da Evolution; ACK atualiza status depois (webhook/poll).
 */

const { resolveEvolutionRecipient, resolvePhoneDigits } = require("./crmCore")
const { validateMediaContentSize } = require("./mediaLimits")
const { stripMediaBase64 } = require("./crmMedia")

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

function isAckOk(status) {
  const s = String(status ?? "").toUpperCase()
  if (!s || s === "PENDING" || s === "ERROR" || s === "0") return false
  if (ACK_OK.has(s)) return true
  if (s.includes("ACK") || s.includes("READ") || s.includes("PLAY")) return true
  const n = Number(status)
  return Number.isFinite(n) && n >= 2
}

function mapAckToCrmStatus(ackStatus) {
  const s = String(ackStatus ?? "").toUpperCase()
  if (s.includes("READ") || s === "4") return "read"
  if (s.includes("DELIVERY") || s === "3") return "delivered"
  if (isAckOk(ackStatus)) return "sent"
  return "pending"
}

function mediaPartFromResponse(resp, mediaType) {
  const mt = String(mediaType || "").toLowerCase()
  const msg = resp?.message || {}
  if (mt === "image") return msg.imageMessage
  if (mt === "video") return msg.videoMessage
  if (mt === "audio") return msg.audioMessage
  if (mt === "document") return msg.documentMessage
  return null
}

/** Aviso se a Evolution devolveu messageId sem CDN — não bloqueia gravação no CRM. */
function warnIfMediaMissingCdn(resp, mediaType, context = "mídia") {
  const mt = String(mediaType || "").toLowerCase()
  if (!["image", "video", "document"].includes(mt)) return
  const part = mediaPartFromResponse(resp, mt)
  if (!part || part.directPath || part.url) return
  console.warn(`[crm-outbound] ${context}: messageId ok mas sem CDN imediato (${mt})`)
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
      const hit = await deps.findMessageById(instanceName, messageId)
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
  const timeoutMs = Number(options.timeoutMs ?? 8000)
  const intervalMs = Number(options.intervalMs ?? 2000)
  const started = Date.now()
  let last = null
  let lastStatus = null

  while (Date.now() - started < timeoutMs) {
    last = await findOutboundMessage(deps, instanceName, jids, messageId)
    lastStatus = last?.status ?? last?.message?.status ?? null
    if (last && isAckOk(lastStatus)) {
      return { record: last, status: lastStatus }
    }
    await wait(intervalMs)
  }

  return {
    record: last,
    status: last ? lastStatus || "PENDING" : "TIMEOUT",
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

/**
 * Confirma messageId na Evolution. ACK é opcional e não bloqueia gravação no CRM.
 * Retorna { messageId, crmStatus }.
 */
async function confirmEvolutionDelivery(deps, { instanceName, conversation, to, resp, context, mediaType }) {
  const messageId = assertEvolutionSendAccepted(resp, context)
  warnIfMediaMissingCdn(resp, mediaType, context)
  return { messageId, crmStatus: "sent" }
}

function assertOutboundRecipient(conversation) {
  const to = resolveEvolutionRecipient(conversation)
  const raw = String(to || "").trim()
  if (!raw) throw new Error("Destino inválido — contato sem telefone ou JID.")
  if (/@lid$/i.test(raw)) return raw
  const normalized = normalizeEvolutionNumber(raw)
  if (/@lid$/i.test(String(conversation?.remoteJid || "")) && !/^\d{8,15}$/.test(normalized)) {
    throw new Error("Contato só com @lid — salve o telefone no CRM antes de enviar.")
  }
  return normalized || raw
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
  confirmEvolutionDelivery,
  assertOutboundRecipient,
  validateOutboundMediaPayload,
  normalizeEvolutionNumber,
  buildRecipientLookupJids,
  waitForOutboundAck,
  isAckOk,
  mapAckToCrmStatus,
}

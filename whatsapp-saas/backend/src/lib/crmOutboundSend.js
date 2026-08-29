/**
 * Validação comum de envios CRM → Evolution (fluxos, IA, manual).
 * Só considera sucesso após messageId + ACK do WhatsApp (ou registro no chat).
 */

const { resolveEvolutionRecipient, resolvePhoneDigits } = require("./crmCore")
const { validateMediaContentSize } = require("./mediaLimits")
const { stripMediaBase64 } = require("./crmMedia")

const ACK_OK = new Set(["SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED", "2", "3", "4", "5"])

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function extractProviderMessageId(resp) {
  return resp?.key?.id || resp?.message?.key?.id || resp?.messageId || null
}

function normalizeEvolutionNumber(raw) {
  const s = String(raw || "").trim()
  if (!s) return s
  if (/@s\.whatsapp\.net$/i.test(s) || /@lid$/i.test(s)) {
    const digits = s.split("@")[0].replace(/\D/g, "")
    if (digits.length >= 8 && digits.length <= 15) return digits
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
    out.add(phone)
    out.add(`${phone}@s.whatsapp.net`)
    out.add(`${phone}@lid`)
  }
  return [...out].filter(Boolean)
}

function isAckOk(status) {
  if (status == null || status === "") return false
  return ACK_OK.has(String(status).toUpperCase())
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

async function waitForOutboundAck(fetchChatMessages, instanceName, jids, messageId, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? process.env.CRM_DELIVERY_ACK_TIMEOUT_MS ?? 25000)
  const intervalMs = Number(options.intervalMs ?? process.env.CRM_DELIVERY_ACK_POLL_MS ?? 2500)
  const started = Date.now()
  let last = null
  let lastStatus = null

  while (Date.now() - started < timeoutMs) {
    last = await findMessageInChats(fetchChatMessages, instanceName, jids, messageId)
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
 * Confirma messageId na Evolution e aguarda ACK do WhatsApp antes de gravar no CRM.
 */
async function confirmEvolutionDelivery(deps, { instanceName, conversation, to, resp, context }) {
  const messageId = assertEvolutionSendAccepted(resp, context)
  const number = normalizeEvolutionNumber(to)
  const jids = buildRecipientLookupJids(conversation, number)

  if (typeof deps?.fetchChatMessages !== "function") {
    console.warn("[crm-outbound] fetchChatMessages indisponível — usando só messageId")
    return messageId
  }

  const ack = await waitForOutboundAck(deps.fetchChatMessages, instanceName, jids, messageId)
  if (!isAckOk(ack.status)) {
    const detail =
      ack.status === "TIMEOUT"
        ? "WhatsApp não confirmou a entrega a tempo"
        : `status ${ack.status || "desconhecido"}`
    throw new Error(`${detail} (${context}, destino ${number || to}).`)
  }

  return messageId
}

function assertOutboundRecipient(conversation) {
  const to = resolveEvolutionRecipient(conversation)
  const raw = String(to || "").trim()
  if (!raw) throw new Error("Destino inválido — contato sem telefone ou JID.")
  const normalized = normalizeEvolutionNumber(raw)
  if (/@lid$/i.test(raw) && !/^\d{8,15}$/.test(normalized)) {
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
}

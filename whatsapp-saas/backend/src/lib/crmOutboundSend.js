/**
 * Validação comum de envios CRM → Evolution (fluxos, IA, manual).
 */

const { resolveEvolutionRecipient } = require("./crmCore")
const { validateMediaContentSize } = require("./mediaLimits")
const { stripMediaBase64 } = require("./crmMedia")

function extractProviderMessageId(resp) {
  return resp?.key?.id || resp?.message?.key?.id || resp?.messageId || null
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

function assertOutboundRecipient(conversation) {
  const to = resolveEvolutionRecipient(conversation)
  const raw = String(to || "").trim()
  if (!raw) throw new Error("Destino inválido — contato sem telefone ou JID.")
  if (/@lid$/i.test(raw)) {
    const digits = raw.split("@")[0].replace(/\D/g, "")
    if (digits.length < 8) {
      throw new Error("Contato só com @lid — salve o telefone no CRM antes de enviar.")
    }
  }
  return to
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
  assertOutboundRecipient,
  validateOutboundMediaPayload,
}

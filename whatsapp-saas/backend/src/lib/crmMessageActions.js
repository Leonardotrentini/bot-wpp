/**
 * Helpers de ações de mensagem no CRM (quote / editar / excluir / encaminhar).
 */

function digQuotedContext(raw) {
  if (!raw || typeof raw !== "object") return null
  const msg = raw.message || raw
  const parts = [
    msg?.extendedTextMessage?.contextInfo,
    msg?.imageMessage?.contextInfo,
    msg?.videoMessage?.contextInfo,
    msg?.audioMessage?.contextInfo,
    msg?.documentMessage?.contextInfo,
    msg?.conversation?.contextInfo,
    msg?.contextInfo,
    raw?.contextInfo,
    raw?._vesto?.quoted,
  ].filter(Boolean)
  return parts[0] || null
}

function previewFromQuotedMessage(quotedMessage) {
  if (!quotedMessage || typeof quotedMessage !== "object") return ""
  if (quotedMessage.conversation) return String(quotedMessage.conversation).slice(0, 200)
  if (quotedMessage.extendedTextMessage?.text) return String(quotedMessage.extendedTextMessage.text).slice(0, 200)
  if (quotedMessage.imageMessage) return "📷 Imagem"
  if (quotedMessage.videoMessage) return "🎬 Vídeo"
  if (quotedMessage.audioMessage || quotedMessage.pttMessage) return "🎤 Áudio"
  if (quotedMessage.documentMessage) return "📄 Documento"
  if (quotedMessage.stickerMessage) return "Figurinha"
  return "Mensagem"
}

function extractQuoteMeta(msg) {
  const raw = msg?.raw && typeof msg.raw === "object" ? msg.raw : null
  const vesto = raw?._vesto || null
  if (vesto?.deleted) {
    return { deleted: true, edited: Boolean(vesto.editedAt), quoted: null }
  }

  const ctx = digQuotedContext(raw)
  let quoted = null
  if (vesto?.quotedPreview || vesto?.quotedMessageId) {
    quoted = {
      messageId: vesto.quotedMessageId || ctx?.stanzaId || null,
      fromMe: vesto.quotedFromMe ?? null,
      body: vesto.quotedPreview || previewFromQuotedMessage(ctx?.quotedMessage) || "",
    }
  } else if (ctx?.stanzaId || ctx?.quotedMessage) {
    quoted = {
      messageId: ctx.stanzaId || null,
      fromMe: typeof ctx.participant === "string" ? null : null,
      body: previewFromQuotedMessage(ctx.quotedMessage) || "",
    }
  }

  return {
    deleted: Boolean(vesto?.deleted),
    edited: Boolean(vesto?.editedAt),
    quoted,
  }
}

function buildEvolutionQuotedPayload(quotedMsg, remoteJid) {
  if (!quotedMsg?.messageId) return null
  const preview = String(quotedMsg.body || "").slice(0, 500) || " "
  return {
    key: {
      remoteJid: remoteJid || quotedMsg.raw?.key?.remoteJid || undefined,
      fromMe: Boolean(quotedMsg.fromMe),
      id: quotedMsg.messageId,
    },
    message: {
      conversation: preview,
    },
  }
}

function mergeVestoRaw(raw, patch) {
  const base = raw && typeof raw === "object" ? { ...raw } : {}
  base._vesto = { ...(base._vesto || {}), ...patch }
  return base
}

module.exports = {
  digQuotedContext,
  previewFromQuotedMessage,
  extractQuoteMeta,
  buildEvolutionQuotedPayload,
  mergeVestoRaw,
}

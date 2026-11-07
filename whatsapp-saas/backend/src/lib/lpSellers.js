/**
 * Normalização de vendedores / WhatsApp para LP (Brasil).
 */

function normalizeBrazilPhone(input) {
  const digits = String(input || "").replace(/\D/g, "")
  if (!digits) return ""
  if (digits.length >= 12 && digits.startsWith("55")) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function isValidBrazilWhatsapp(digits) {
  if (!digits) return false
  if (!digits.startsWith("55")) return false
  const rest = digits.slice(2)
  return rest.length === 10 || rest.length === 11
}

function parseSellersInput(raw) {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item === "string") {
      const phone = normalizeBrazilPhone(item)
      if (phone) out.push({ label: "", phone })
      continue
    }
    if (item && typeof item === "object") {
      const label = String(item.label || item.name || "").trim()
      const phone = normalizeBrazilPhone(item.phone || item.whatsapp || "")
      if (phone) out.push({ label, phone })
    }
  }
  const seen = new Set()
  return out.filter((s) => {
    if (!isValidBrazilWhatsapp(s.phone) || seen.has(s.phone)) return false
    seen.add(s.phone)
    return true
  })
}

function formatSellersForApi(row) {
  const parsed = parseSellersInput(row?.lpSellers)
  if (parsed.length) return parsed
  const fallback = normalizeBrazilPhone(row?.lpWhatsapp || "")
  if (fallback && isValidBrazilWhatsapp(fallback)) {
    return [{ label: "", phone: fallback }]
  }
  return []
}

/** Mensagens das LPs: [{ label?, message }] — legado: só lpWhatsappMsg. */
function parseLpMessagesInput(raw, fallbackMsg = "") {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      value = null
    }
  }
  const out = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        const message = String(item).trim()
        if (message) out.push({ label: "", message })
        continue
      }
      if (item && typeof item === "object") {
        const message = String(item.message || item.text || "").trim()
        if (!message) continue
        const label = String(item.label || item.name || "").trim()
        out.push({ label, message: message.slice(0, 500) })
      }
    }
  }
  if (!out.length) {
    const legacy = String(fallbackMsg || "").trim()
    if (legacy) out.push({ label: "", message: legacy.slice(0, 500) })
  }
  return out
}

function formatLpMessagesForApi(row) {
  return parseLpMessagesInput(row?.lpMessages, row?.lpWhatsappMsg || "")
}

module.exports = {
  normalizeBrazilPhone,
  isValidBrazilWhatsapp,
  parseSellersInput,
  formatSellersForApi,
  parseLpMessagesInput,
  formatLpMessagesForApi,
}

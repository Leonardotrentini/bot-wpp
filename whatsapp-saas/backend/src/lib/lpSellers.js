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

module.exports = {
  normalizeBrazilPhone,
  isValidBrazilWhatsapp,
  parseSellersInput,
  formatSellersForApi,
}

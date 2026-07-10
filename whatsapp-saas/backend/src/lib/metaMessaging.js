/**
 * Utilitários Meta — WhatsApp business_messaging (page_id, ctwa_clid).
 */

function parseFacebookPageId(value) {
  const digits = String(value || "").replace(/\D/g, "")
  if (!digits) return null
  const num = Number(digits)
  if (!Number.isSafeInteger(num) || num <= 0) return null
  return num
}

function parseCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

function resolveCtwaClid(contact) {
  const custom = parseCustomFields(contact?.customFields)
  const clid = custom.meta?.ctwaClid || custom.ctwaClid
  return clid ? String(clid).trim() : null
}

/** Extrai ctwa_clid de webhooks Evolution/Baileys (anúncio Click-to-WhatsApp). */
function extractCtwaClidFromRecord(record) {
  if (!record || typeof record !== "object") return null

  const direct = [
    record?.referral?.ctwa_clid,
    record?.referral?.ctwaClid,
    record?.context?.referral?.ctwa_clid,
    record?.data?.referral?.ctwa_clid,
  ]
  for (const value of direct) {
    if (value) return String(value).trim()
  }

  const seen = new Set()
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12) return null
    if (seen.has(node)) return null
    seen.add(node)

    if (typeof node.ctwa_clid === "string" && node.ctwa_clid.trim()) return node.ctwa_clid.trim()
    if (typeof node.ctwaClid === "string" && node.ctwaClid.trim()) return node.ctwaClid.trim()

    for (const value of Object.values(node)) {
      const found = walk(value, depth + 1)
      if (found) return found
    }
    return null
  }

  return walk(record.message) || walk(record)
}

async function storeContactCtwaClid(prisma, contact, ctwaClid) {
  if (!contact?.id || !ctwaClid) return contact
  const custom = parseCustomFields(contact.customFields)
  if (custom.meta?.ctwaClid === ctwaClid) return contact

  custom.meta = { ...(custom.meta || {}), ctwaClid }
  return prisma.crmContact.update({
    where: { id: contact.id },
    data: { customFields: custom },
  })
}

module.exports = {
  parseFacebookPageId,
  parseCustomFields,
  resolveCtwaClid,
  extractCtwaClidFromRecord,
  storeContactCtwaClid,
}

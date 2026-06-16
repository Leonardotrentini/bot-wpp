/**
 * Filtra entradas fantasma que a Evolution/WhatsApp devolve (JID no lugar do nome).
 * Grupo plausível precisa de subject/nome legível — contagem de membros sozinha não basta.
 */

function parseRaw(raw) {
  if (!raw) return null
  if (typeof raw === "object") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function extractSubject(mapped) {
  const raw = parseRaw(mapped?.raw)
  const groupJid = mapped?.groupJid
  const fromRaw = raw?.subject || raw?.name
  if (fromRaw && String(fromRaw).trim() && !isJidLikeName(fromRaw, groupJid)) {
    return String(fromRaw).trim()
  }
  const name = String(mapped?.name || "").trim()
  if (name && !isJidLikeName(name, groupJid)) return name
  return ""
}

function isJidLikeName(name, groupJid) {
  const n = String(name || "").trim()
  const jid = String(groupJid || "").trim()
  if (!n) return true
  if (jid && n === jid) return true
  if (n.endsWith("@g.us")) return true
  const jidUser = jid.split("@")[0]
  if (jidUser && n === jidUser) return true
  // ID numérico longo (ex.: 120363317378211775) sem subject — cache fantasma comum
  if (/^\d{12,}$/.test(n)) return true
  return false
}

/** Grupo com metadados mínimos plausíveis (não é lixo de cache da Evolution). */
function isPlausibleWhatsAppGroup(mapped) {
  const groupJid = mapped?.groupJid
  if (!groupJid || !String(groupJid).endsWith("@g.us")) return false

  const subject = extractSubject(mapped)
  return Boolean(subject) && !isJidLikeName(subject, groupJid)
}

/** Marca como inativo grupos fantasma que ainda não estão sendo monitorados. */
async function cleanupGhostGroups(prisma, userId) {
  const rows = await prisma.whatsAppGroup.findMany({
    where: { userId, monitoringEnabled: false },
    select: { id: true, groupJid: true, name: true, memberCount: true, raw: true, status: true },
  })

  const ghostIds = rows.filter((r) => !isPlausibleWhatsAppGroup(r) && r.status !== "inativo").map((r) => r.id)
  if (!ghostIds.length) return 0

  await prisma.whatsAppGroup.updateMany({
    where: { id: { in: ghostIds } },
    data: { status: "inativo", monitoringEnabled: false },
  })
  return ghostIds.length
}

module.exports = {
  isPlausibleWhatsAppGroup,
  isJidLikeName,
  cleanupGhostGroups,
}

/**
 * Filtra entradas fantasma que a Evolution/WhatsApp devolve (JID sem nome, 1 membro).
 * Grupos reais têm subject ou mais de um participante.
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
  const fromRaw = raw?.subject || raw?.name
  if (fromRaw && String(fromRaw).trim()) return String(fromRaw).trim()
  const name = String(mapped?.name || "").trim()
  return name || ""
}

function isJidLikeName(name, groupJid) {
  const n = String(name || "").trim()
  const jid = String(groupJid || "").trim()
  if (!n) return true
  if (jid && n === jid) return true
  if (n.endsWith("@g.us")) return true
  return false
}

/** Grupo com metadados mínimos plausíveis (não é lixo de cache da Evolution). */
function isPlausibleWhatsAppGroup(mapped) {
  const groupJid = mapped?.groupJid
  if (!groupJid || !String(groupJid).endsWith("@g.us")) return false

  const subject = extractSubject(mapped)
  const memberCount = Number(mapped?.memberCount) || 0
  const hasRealName = !isJidLikeName(subject, groupJid)

  if (hasRealName) return true
  // Sem nome: só aceita se claramente tem vários membros
  return memberCount >= 2
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

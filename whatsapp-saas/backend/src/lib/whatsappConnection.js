/**
 * Garante status atualizado da conexão WhatsApp antes de operações que dependem da Evolution.
 * Também detecta o mesmo número ligado em outro membro da mesma empresa (vazamento operacional).
 */

const { getConnectionState, pickConnected, pickStatus, pickPhone } = require("./evolution")

function normalizeWaPhoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (!digits) return ""
  // Compara pelos últimos 10–11 dígitos (BR com/sem 55 / 9º dígito)
  if (digits.length > 11) return digits.slice(-11)
  return digits
}

/**
 * Se outro membro da mesma org já usa este telefone, retorna o conflito.
 * @returns {Promise<null|{ otherUserId: string, otherName: string|null, phone: string }>}
 */
async function findOrgPhoneConflict(prisma, userId, phone) {
  const normalized = normalizeWaPhoneDigits(phone)
  if (!normalized || normalized.length < 8) return null

  const member = await prisma.organizationMember.findUnique({
    where: { userId },
    select: { organizationId: true },
  })
  if (!member?.organizationId) return null

  const orgMembers = await prisma.organizationMember.findMany({
    where: { organizationId: member.organizationId, userId: { not: userId } },
    select: { userId: true, user: { select: { id: true, name: true } } },
  })
  if (!orgMembers.length) return null

  const otherIds = orgMembers.map((m) => m.userId)
  const others = await prisma.whatsAppConnection.findMany({
    where: {
      userId: { in: otherIds },
      phone: { not: null },
    },
    select: { userId: true, phone: true, connected: true },
  })

  for (const row of others) {
    if (normalizeWaPhoneDigits(row.phone) !== normalized) continue
    const meta = orgMembers.find((m) => m.userId === row.userId)
    return {
      otherUserId: row.userId,
      otherName: meta?.user?.name || null,
      phone: String(row.phone),
      otherConnected: Boolean(row.connected),
    }
  }
  return null
}

/**
 * Ao detectar telefone duplicado na org: desconecta ESTA conexão e registra aviso.
 * Evita que vendedor e dono usem o mesmo número e misturem inbox.
 */
async function enforceUniqueOrgPhone(prisma, conn, phone) {
  if (!conn?.userId || !phone) return { conn, conflict: null }
  const conflict = await findOrgPhoneConflict(prisma, conn.userId, phone)
  if (!conflict) return { conn, conflict: null }

  const message = `Este WhatsApp (${phone}) já está ligado à conta de ${
    conflict.otherName || "outro membro"
  } da empresa. Conecte o número do próprio vendedor.`

  console.warn(
    `[whatsapp] phone conflict org: user=${conn.userId} phone=${phone} other=${conflict.otherUserId}`,
  )

  const updated = await prisma.whatsAppConnection.update({
    where: { id: conn.id },
    data: {
      connected: false,
      status: "PHONE_CONFLICT",
      phone: String(phone),
      qrCode: null,
      lastSync: new Date(),
    },
  })

  return { conn: updated, conflict: { ...conflict, message } }
}

async function refreshWhatsAppConnection(prisma, userId) {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!existing?.instanceName) return existing

  try {
    const stateData = await getConnectionState(existing.instanceName)
    const connected = pickConnected(stateData)
    const status = pickStatus(stateData).toUpperCase()
    const phone = pickPhone(stateData)

    if (
      connected === existing.connected &&
      status === existing.status &&
      (phone ? String(phone) : null) === existing.phone
    ) {
      return existing
    }

    let updated = await prisma.whatsAppConnection.update({
      where: { userId },
      data: {
        connected,
        status,
        phone: phone ? String(phone) : existing.phone,
        qrCode: connected ? null : existing.qrCode,
        lastSync: new Date(),
      },
    })

    if (phone) {
      const enforced = await enforceUniqueOrgPhone(prisma, updated, phone)
      updated = enforced.conn
    }

    return updated
  } catch (err) {
    console.warn("[whatsapp] refresh connection failed:", err?.message || err)
    return existing
  }
}

async function ensureWhatsAppConnected(prisma, userId) {
  const conn = await refreshWhatsAppConnection(prisma, userId)
  if (!conn?.connected) return null
  return conn
}

module.exports = {
  refreshWhatsAppConnection,
  ensureWhatsAppConnected,
  findOrgPhoneConflict,
  enforceUniqueOrgPhone,
  normalizeWaPhoneDigits,
}

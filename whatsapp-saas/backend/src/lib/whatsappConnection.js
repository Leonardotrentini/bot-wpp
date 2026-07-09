/**
 * Garante status atualizado da conexão WhatsApp antes de operações que dependem da Evolution.
 */

const { getConnectionState, pickConnected, pickStatus, pickPhone } = require("./evolution")

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

    return prisma.whatsAppConnection.update({
      where: { userId },
      data: {
        connected,
        status,
        phone: phone ? String(phone) : existing.phone,
        qrCode: connected ? null : existing.qrCode,
        lastSync: new Date(),
      },
    })
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

module.exports = { refreshWhatsAppConnection, ensureWhatsAppConnected }

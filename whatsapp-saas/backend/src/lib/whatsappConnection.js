/**
 * Garante status atualizado da conexão WhatsApp antes de operações que dependem da Evolution.
 * Usa histerese: 1 timeout/connecting não derruba a sessão no CRM (evita flap em uso ativo).
 */

const {
  getConnectionStateForProbe,
  pickConnected,
  pickStatus,
  pickPhone,
  bindInstanceHost,
  isEvolutionUnreachableError,
} = require("./evolution")
const { connectionPhoneData, clearConnectionPhoneData } = require("./whatsappPhoneClaim")

const PROBE_FAIL_STREAK = Math.max(
  2,
  Math.min(6, Number(process.env.WHATSAPP_PROBE_FAIL_STREAK || 3)),
)

/** userId → { unreachable, notOpen, lastAt } */
const probeFailStreak = new Map()

function clearProbeFailStreak(userId) {
  if (userId) probeFailStreak.delete(userId)
}

function bumpProbeFailStreak(userId, kind) {
  const prev = probeFailStreak.get(userId) || { unreachable: 0, notOpen: 0, lastAt: 0 }
  if (kind === "unreachable") {
    prev.unreachable += 1
  } else {
    prev.notOpen += 1
    prev.unreachable = 0
  }
  prev.lastAt = Date.now()
  probeFailStreak.set(userId, prev)
  return prev
}

async function markWhatsAppUnreachable(prisma, userId, existing) {
  if (!existing) return null
  if (existing.status === "NUMBER_CONFLICT") {
    return prisma.whatsAppConnection.update({
      where: { userId },
      data: { lastSync: new Date() },
    })
  }
  return prisma.whatsAppConnection.update({
    where: { userId },
    data: {
      connected: false,
      status: "DISCONNECTED",
      // Mantém QR se houver (usuário pode escanear de novo sem clicar Reconectar).
      ...clearConnectionPhoneData(),
      lastSync: new Date(),
    },
  })
}

async function refreshWhatsAppConnection(prisma, userId) {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!existing?.instanceName) return existing

  bindInstanceHost(existing.instanceName, existing.evolutionHost || "primary")

  try {
    const stateData = await getConnectionStateForProbe(existing.instanceName)
    const connected = pickConnected(stateData)
    const status = pickStatus(stateData).toUpperCase()
    const phone = pickPhone(stateData)

    if (connected) {
      clearProbeFailStreak(userId)
    } else {
      // connecting/close transitório: não zera connected no 1º probe (send/mídia).
      const streak = bumpProbeFailStreak(userId, "notOpen")
      if (existing.connected && streak.notOpen < PROBE_FAIL_STREAK) {
        console.warn(
          `[whatsapp] probe not-open ${existing.instanceName} (${streak.notOpen}/${PROBE_FAIL_STREAK}) status=${status} — mantém connected`,
        )
        return prisma.whatsAppConnection.update({
          where: { userId },
          data: { lastSync: new Date() },
        })
      }
    }

    const nextPhoneRaw = connected ? (phone ? String(phone) : existing.phone) : null
    const nextPhoneData = connected
      ? phone
        ? connectionPhoneData(phone)
        : existing.phone
          ? connectionPhoneData(existing.phone)
          : clearConnectionPhoneData()
      : clearConnectionPhoneData()

    if (
      connected === existing.connected &&
      status === existing.status &&
      nextPhoneRaw === existing.phone &&
      (nextPhoneData.phoneDigits || null) === (existing.phoneDigits || null)
    ) {
      return existing
    }

    return prisma.whatsAppConnection.update({
      where: { userId },
      data: {
        connected,
        status,
        // Sem conexão: não conservar ownerJid stale (evita recontaminar outras contas).
        ...nextPhoneData,
        qrCode: connected ? null : existing.qrCode,
        lastSync: new Date(),
      },
    })
  } catch (err) {
    console.warn("[whatsapp] refresh connection failed:", err?.message || err)
    if (isEvolutionUnreachableError(err) && existing.connected) {
      const streak = bumpProbeFailStreak(userId, "unreachable")
      if (streak.unreachable < PROBE_FAIL_STREAK) {
        console.warn(
          `[whatsapp] probe unreachable ${existing.instanceName} (${streak.unreachable}/${PROBE_FAIL_STREAK}) — mantém connected`,
        )
        return prisma.whatsAppConnection.update({
          where: { userId },
          data: { lastSync: new Date() },
        })
      }
      clearProbeFailStreak(userId)
      return markWhatsAppUnreachable(prisma, userId, existing)
    }
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
  markWhatsAppUnreachable,
  clearProbeFailStreak,
  bumpProbeFailStreak,
  PROBE_FAIL_STREAK,
}

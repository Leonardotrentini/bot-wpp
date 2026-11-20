/**
 * Claim exclusivo de número WhatsApp (1 phoneDigits = 1 conta).
 * phoneDigits é normalizado; unique no DB impede race entre conexões.
 */

const { phoneDigitsFromValue } = require("./participantIdentity")

function connectionPhoneData(phone) {
  if (!phone) return { phone: null, phoneDigits: null }
  const raw = String(phone)
  const digits = phoneDigitsFromValue(raw)
  return {
    phone: raw,
    phoneDigits: digits || null,
  }
}

function clearConnectionPhoneData() {
  return { phone: null, phoneDigits: null }
}

/**
 * Backfill phoneDigits a partir de phone. Em colisão, mantém a conexão
 * connected mais recente e limpa as demais.
 */
async function backfillWhatsAppPhoneDigits(prisma) {
  const rows = await prisma.whatsAppConnection.findMany({
    where: { phone: { not: null }, phoneDigits: null },
    select: {
      userId: true,
      phone: true,
      connected: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  let filled = 0
  let cleared = 0
  const claimed = new Map()

  // Já claimados
  const existing = await prisma.whatsAppConnection.findMany({
    where: { phoneDigits: { not: null } },
    select: { userId: true, phoneDigits: true, connected: true, updatedAt: true },
  })
  for (const row of existing) {
    claimed.set(row.phoneDigits, row)
  }

  for (const row of rows) {
    const digits = phoneDigitsFromValue(row.phone)
    if (!digits) continue
    const holder = claimed.get(digits)
    if (!holder) {
      await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: { phoneDigits: digits },
      })
      claimed.set(digits, { ...row, phoneDigits: digits })
      filled += 1
      continue
    }
    // Colisão: preferir quem está connected; senão o mais recente já claimado
    const keepHolder =
      holder.connected && !row.connected
        ? true
        : !holder.connected && row.connected
          ? false
          : true
    if (keepHolder) {
      await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: { ...clearConnectionPhoneData(), connected: false, status: "DISCONNECTED" },
      })
      cleared += 1
    } else {
      await prisma.whatsAppConnection.update({
        where: { userId: holder.userId },
        data: { ...clearConnectionPhoneData(), connected: false, status: "DISCONNECTED" },
      })
      await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: { phoneDigits: digits },
      })
      claimed.set(digits, { ...row, phoneDigits: digits })
      filled += 1
      cleared += 1
    }
  }

  return { scanned: rows.length, filled, cleared }
}

module.exports = {
  connectionPhoneData,
  clearConnectionPhoneData,
  backfillWhatsAppPhoneDigits,
  phoneDigitsFromValue,
}

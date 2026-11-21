/**
 * Alerta externo quando soft-restarts esgotam / banner QR.
 * Desligado por padrão — WHATSAPP_ZOMBIE_ALERT_ENABLED=true.
 */

const ALERT_ENABLED =
  String(process.env.WHATSAPP_ZOMBIE_ALERT_ENABLED || "false").toLowerCase() === "true"
const ALERT_PHONE = String(process.env.WHATSAPP_ZOMBIE_ALERT_PHONE || "").replace(/\D/g, "")
const ALERT_INSTANCE = String(process.env.WHATSAPP_ZOMBIE_ALERT_INSTANCE || "").trim()
const ALERT_COOLDOWN_MS = Number(process.env.WHATSAPP_ZOMBIE_ALERT_COOLDOWN_MS || 60 * 60 * 1000)

/** instanceName → last alert ms */
const lastAlertAt = new Map()

function alertConfig() {
  return {
    enabled: ALERT_ENABLED,
    phoneConfigured: Boolean(ALERT_PHONE),
    instanceConfigured: Boolean(ALERT_INSTANCE),
    cooldownMs: ALERT_COOLDOWN_MS,
  }
}

async function findHealthySenderInstance(prisma, preferred) {
  if (preferred) {
    const row = await prisma.whatsAppConnection.findFirst({
      where: {
        instanceName: preferred,
        connected: true,
        status: { not: "NUMBER_CONFLICT" },
        syncHealth: { in: ["HEALTHY", "UNKNOWN"] },
      },
      select: { instanceName: true, evolutionHost: true, userId: true },
    })
    if (row) return row
  }
  return prisma.whatsAppConnection.findFirst({
    where: {
      connected: true,
      status: { not: "NUMBER_CONFLICT" },
      syncHealth: { in: ["HEALTHY", "UNKNOWN"] },
    },
    orderBy: { lastWebhookAt: "desc" },
    select: { instanceName: true, evolutionHost: true, userId: true },
  })
}

async function sendZombieExternalAlert(deps, payload = {}) {
  if (!ALERT_ENABLED) return { skipped: true, reason: "disabled" }
  if (!ALERT_PHONE) return { skipped: true, reason: "missing_phone" }

  const { prisma } = deps
  const instanceName = String(payload.instanceName || "").trim()
  if (!instanceName) return { skipped: true, reason: "missing_instance" }

  const now = Date.now()
  const prev = lastAlertAt.get(instanceName) || 0
  if (prev && now - prev < ALERT_COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown", cooldownMs: ALERT_COOLDOWN_MS }
  }

  const user = payload.userId
    ? await prisma.user
        .findUnique({ where: { id: payload.userId }, select: { name: true, email: true } })
        .catch(() => null)
    : null

  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  const text = [
    "⚠️ WhatsApp zumbi — precisa QR",
    `Cliente: ${user?.name || user?.email || payload.userId || "?"}`,
    `Instância: ${instanceName}`,
    `Host: ${payload.host || "?"}`,
    `Prova: ${payload.proofReason || "?"}`,
    `Soft-restarts: ${payload.softRestartsTried ?? "?"}`,
    `Horário: ${when}`,
  ].join("\n")

  const sender = await findHealthySenderInstance(prisma, ALERT_INSTANCE)
  if (!sender?.instanceName) return { skipped: true, reason: "no_healthy_sender" }

  try {
    const { bindInstanceHost, sendText } = require("./evolution")
    bindInstanceHost(sender.instanceName, sender.evolutionHost || "primary")
    await sendText(sender.instanceName, ALERT_PHONE, text)
    lastAlertAt.set(instanceName, now)
    console.warn(
      JSON.stringify({
        tag: "zombie-alert",
        action: "sent",
        to: ALERT_PHONE.slice(-4),
        via: sender.instanceName,
        target: instanceName,
      }),
    )
    return { ok: true, via: sender.instanceName }
  } catch (err) {
    console.warn("[zombie-alert] send failed:", err?.message || err)
    return { ok: false, error: err?.message || String(err) }
  }
}

module.exports = {
  alertConfig,
  sendZombieExternalAlert,
}

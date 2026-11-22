/**
 * Alerta externo quando soft-restarts esgotam / banner QR.
 * DESLIGADO por padrão — WHATSAPP_ZOMBIE_ALERT_ENABLED=true.
 *
 * Canal: Telegram apenas (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).
 * Removido: envio via instância WhatsApp de cliente (nunca mais).
 */

const { sendTelegramAlert, telegramAlertConfig } = require("./telegramAlerts")

const ALERT_ENABLED =
  String(process.env.WHATSAPP_ZOMBIE_ALERT_ENABLED || "false").toLowerCase() === "true"
const ALERT_COOLDOWN_MS = Number(process.env.WHATSAPP_ZOMBIE_ALERT_COOLDOWN_MS || 60 * 60 * 1000)

/** instanceName → last alert ms */
const lastAlertAt = new Map()

function alertConfig() {
  const tg = telegramAlertConfig()
  return {
    enabled: ALERT_ENABLED,
    channel: "telegram",
    telegram: tg,
    // legado (documentação) — não usa mais WhatsApp como remetente
    phoneConfigured: false,
    instanceConfigured: false,
    fallbackConfigured: false,
    cooldownMs: ALERT_COOLDOWN_MS,
    whatsappSenderRemoved: true,
  }
}

async function sendZombieExternalAlert(deps, payload = {}) {
  if (!ALERT_ENABLED) return { skipped: true, reason: "disabled" }

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

  const result = await sendTelegramAlert(text, { key: `zombie:${instanceName}` })
  if (result?.ok) {
    lastAlertAt.set(instanceName, now)
    console.warn(
      JSON.stringify({
        tag: "zombie-alert",
        action: "sent_telegram",
        target: instanceName,
        host: payload.host || "primary",
      }),
    )
    return { ok: true, via: "telegram", attempts: 1 }
  }
  return {
    ok: false,
    error: result?.reason || result?.error || "telegram_failed",
    attempts: 1,
    whatsappSenderRemoved: true,
  }
}

module.exports = {
  alertConfig,
  sendZombieExternalAlert,
  // stubs: testes antigos que importavam helpers de sender WA
  findHealthySenderInstance: async () => null,
  listHealthySenderCandidates: async () => [],
}

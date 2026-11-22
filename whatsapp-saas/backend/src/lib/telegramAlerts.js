/**
 * Canal de alerta via Telegram (independente do WhatsApp).
 * DESLIGADO por padrão — TELEGRAM_ALERT_ENABLED=true + TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
 *
 * Nunca usa instância WhatsApp de cliente como remetente.
 */

const ALERT_ENABLED =
  String(process.env.TELEGRAM_ALERT_ENABLED || "false").toLowerCase() === "true"
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim()
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim()
const COOLDOWN_MS = Number(process.env.TELEGRAM_ALERT_COOLDOWN_MS || 60 * 60 * 1000)

const lastAlertAt = new Map()

function telegramAlertConfig() {
  return {
    enabled: ALERT_ENABLED,
    tokenConfigured: Boolean(BOT_TOKEN),
    chatConfigured: Boolean(CHAT_ID),
    cooldownMs: COOLDOWN_MS,
  }
}

async function sendTelegramAlert(text, { key = "default" } = {}) {
  if (!ALERT_ENABLED) return { skipped: true, reason: "disabled" }
  if (!BOT_TOKEN || !CHAT_ID) return { skipped: true, reason: "missing_telegram_config" }

  const now = Date.now()
  const prev = lastAlertAt.get(key) || 0
  if (prev && now - prev < COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown" }
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: String(text || "").slice(0, 3500),
      disable_web_page_preview: true,
    }),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => "")
    return { ok: false, error: `telegram_http_${resp.status}`, body: body.slice(0, 200) }
  }
  lastAlertAt.set(key, now)
  return { ok: true }
}

module.exports = {
  telegramAlertConfig,
  sendTelegramAlert,
}

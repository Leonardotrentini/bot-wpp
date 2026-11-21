/**
 * Alerta externo quando soft-restarts esgotam / banner QR.
 * Desligado por padrão — WHATSAPP_ZOMBIE_ALERT_ENABLED=true.
 *
 * Destino (PHONE) deve ser número pessoal NÃO conectado no CRM.
 * Remetente (INSTANCE) deve ser outra conta saudável (de preferência Evo2).
 */

const ALERT_ENABLED =
  String(process.env.WHATSAPP_ZOMBIE_ALERT_ENABLED || "false").toLowerCase() === "true"
const ALERT_PHONE = String(process.env.WHATSAPP_ZOMBIE_ALERT_PHONE || "").replace(/\D/g, "")
const ALERT_INSTANCE = String(process.env.WHATSAPP_ZOMBIE_ALERT_INSTANCE || "").trim()
const ALERT_INSTANCE_FALLBACK = String(process.env.WHATSAPP_ZOMBIE_ALERT_INSTANCE_FALLBACK || "").trim()
const ALERT_COOLDOWN_MS = Number(process.env.WHATSAPP_ZOMBIE_ALERT_COOLDOWN_MS || 60 * 60 * 1000)

/** instanceName → last alert ms */
const lastAlertAt = new Map()

function alertConfig() {
  return {
    enabled: ALERT_ENABLED,
    phoneConfigured: Boolean(ALERT_PHONE),
    instanceConfigured: Boolean(ALERT_INSTANCE),
    fallbackConfigured: Boolean(ALERT_INSTANCE_FALLBACK),
    cooldownMs: ALERT_COOLDOWN_MS,
  }
}

function isHealthySenderRow(row) {
  if (!row?.connected) return false
  if (String(row.status || "").toUpperCase() === "NUMBER_CONFLICT") return false
  const health = String(row.syncHealth || "UNKNOWN").toUpperCase()
  return health === "HEALTHY" || health === "UNKNOWN"
}

/**
 * Lista candidatos de envio: preferred → fallback → outras secondary saudáveis → primary.
 * Exclui a instância alvo do alerta e números iguais ao telefone de destino.
 */
async function listHealthySenderCandidates(prisma, { excludeInstanceName = null } = {}) {
  const preferred = [ALERT_INSTANCE, ALERT_INSTANCE_FALLBACK].filter(Boolean)
  const rows = await prisma.whatsAppConnection.findMany({
    where: {
      connected: true,
      status: { not: "NUMBER_CONFLICT" },
      syncHealth: { in: ["HEALTHY", "UNKNOWN"] },
    },
    orderBy: [{ lastWebhookAt: "desc" }],
    select: {
      instanceName: true,
      evolutionHost: true,
      userId: true,
      phoneDigits: true,
      syncHealth: true,
      status: true,
      connected: true,
      lastWebhookAt: true,
    },
    take: 40,
  })

  const excludePhone = ALERT_PHONE
  const filtered = rows.filter((r) => {
    if (!isHealthySenderRow(r)) return false
    if (excludeInstanceName && r.instanceName === excludeInstanceName) return false
    if (excludePhone && r.phoneDigits && String(r.phoneDigits).replace(/\D/g, "") === excludePhone) {
      return false
    }
    return true
  })

  const byName = new Map(filtered.map((r) => [r.instanceName, r]))
  const ordered = []
  const seen = new Set()

  for (const name of preferred) {
    const hit = byName.get(name)
    if (hit && !seen.has(hit.instanceName)) {
      ordered.push(hit)
      seen.add(hit.instanceName)
    }
  }

  // Preferir Evo2 (secondary) com webhook recente
  const secondary = filtered
    .filter((r) => String(r.evolutionHost || "") === "secondary" && !seen.has(r.instanceName))
    .sort((a, b) => {
      const ta = a.lastWebhookAt ? new Date(a.lastWebhookAt).getTime() : 0
      const tb = b.lastWebhookAt ? new Date(b.lastWebhookAt).getTime() : 0
      return tb - ta
    })
  for (const r of secondary) {
    ordered.push(r)
    seen.add(r.instanceName)
  }

  for (const r of filtered) {
    if (seen.has(r.instanceName)) continue
    ordered.push(r)
    seen.add(r.instanceName)
  }

  return ordered
}

async function findHealthySenderInstance(prisma, preferred, { excludeInstanceName = null } = {}) {
  const list = await listHealthySenderCandidates(prisma, { excludeInstanceName })
  if (preferred) {
    const hit = list.find((r) => r.instanceName === preferred)
    if (hit) return hit
  }
  return list[0] || null
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

  const candidates = await listHealthySenderCandidates(prisma, { excludeInstanceName: instanceName })
  if (!candidates.length) return { skipped: true, reason: "no_healthy_sender" }

  const { bindInstanceHost, sendText } = require("./evolution")
  const errors = []

  for (const sender of candidates.slice(0, 5)) {
    try {
      bindInstanceHost(sender.instanceName, sender.evolutionHost || "primary")
      await sendText(sender.instanceName, ALERT_PHONE, text)
      lastAlertAt.set(instanceName, now)
      console.warn(
        JSON.stringify({
          tag: "zombie-alert",
          action: "sent",
          to: ALERT_PHONE.slice(-4),
          via: sender.instanceName,
          host: sender.evolutionHost || "primary",
          target: instanceName,
          tried: errors.length + 1,
        }),
      )
      return {
        ok: true,
        via: sender.instanceName,
        host: sender.evolutionHost || "primary",
        fallbackUsed: sender.instanceName !== ALERT_INSTANCE,
        attempts: errors.length + 1,
      }
    } catch (err) {
      const msg = err?.message || String(err)
      errors.push({ via: sender.instanceName, error: msg })
      console.warn(`[zombie-alert] send failed via ${sender.instanceName}:`, msg)
    }
  }

  return { ok: false, error: "all_senders_failed", attempts: errors }
}

module.exports = {
  alertConfig,
  findHealthySenderInstance,
  listHealthySenderCandidates,
  sendZombieExternalAlert,
}

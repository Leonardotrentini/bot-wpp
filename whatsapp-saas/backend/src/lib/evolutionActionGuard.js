/**
 * Guarda central de mutações Evolution (restart / logout / delete / connect).
 *
 * Regras:
 * - logout/delete automáticos PROIBIDOS (só manual=true)
 * - restart automático: máx 1 / 30min e 3 / dia por instância + boot grace
 * - connect automático: bloqueado (só fluxo manual de pareamento/QR)
 * - toda tentativa é auditada em WhatsAppEvolutionActionAudit (best-effort)
 */

const { inBootGrace, bootGraceRemainingMs } = require("./bootGrace")

const RESTART_MIN_INTERVAL_MS = Number(
  process.env.WHATSAPP_GUARD_RESTART_MIN_INTERVAL_MS || 30 * 60 * 1000,
)
const RESTART_MAX_PER_DAY = Math.max(
  1,
  Math.min(20, Number(process.env.WHATSAPP_GUARD_RESTART_MAX_PER_DAY || 3)),
)

/** instanceName → timestamps de restarts permitidos (memória; audit é fonte durável) */
const restartLog = new Map()

let prismaRef = null
function setGuardPrisma(prisma) {
  prismaRef = prisma || null
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

async function persistAudit(row) {
  const prisma = prismaRef
  if (!prisma?.whatsAppEvolutionActionAudit) return null
  try {
    return await prisma.whatsAppEvolutionActionAudit.create({
      data: {
        instanceName: row.instanceName,
        host: row.host || "primary",
        action: row.action,
        allowed: Boolean(row.allowed),
        manual: Boolean(row.manual),
        source: row.source || null,
        reason: row.reason || null,
        result: row.result || null,
        error: row.error ? String(row.error).slice(0, 500) : null,
        meta: row.meta || undefined,
      },
    })
  } catch (err) {
    console.warn("[evo-guard] audit persist:", err?.message || err)
    return null
  }
}

function countRestartsToday(instanceName, now = Date.now()) {
  const list = restartLog.get(instanceName) || []
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const startMs = dayStart.getTime()
  const recent = list.filter((t) => t >= startMs && t <= now)
  restartLog.set(instanceName, recent)
  return recent.length
}

function lastRestartAt(instanceName) {
  const list = restartLog.get(instanceName) || []
  return list.length ? list[list.length - 1] : 0
}

function rememberRestart(instanceName, at = Date.now()) {
  const list = restartLog.get(instanceName) || []
  list.push(at)
  restartLog.set(instanceName, list)
}

/**
 * @param {object} input
 * @param {'restart'|'logout'|'delete'|'connect'} input.action
 * @param {string} input.instanceName
 * @param {boolean} [input.manual] — true = admin/usuário explícito
 * @param {string} [input.source] — ex.: sync-health.keep-alive, admin.purge
 * @param {string} [input.reason]
 * @param {string} [input.host]
 */
async function assertEvolutionActionAllowed(input = {}) {
  const action = String(input.action || "").toLowerCase()
  const instanceName = String(input.instanceName || "").trim()
  const manual = input.manual === true
  const source = String(input.source || "unknown")
  const reason = String(input.reason || "")
  const host = input.host || "primary"
  const base = { action, instanceName, manual, source, reason, host }

  if (!instanceName) {
    const out = { allowed: false, code: "missing_instance", ...base }
    await persistAudit({ ...out, result: "blocked" })
    return out
  }

  if (!manual && inBootGrace()) {
    const out = {
      allowed: false,
      code: "boot_grace",
      detail: `boot_grace_${Math.round(bootGraceRemainingMs() / 1000)}s`,
      ...base,
    }
    await persistAudit({ ...out, result: "blocked", error: out.detail })
    console.warn(`[evo-guard] BLOCK ${action} ${instanceName} boot_grace source=${source}`)
    return out
  }

  if ((action === "logout" || action === "delete") && !manual) {
    const out = { allowed: false, code: "auto_logout_forbidden", ...base }
    await persistAudit({ ...out, result: "blocked" })
    console.warn(`[evo-guard] BLOCK ${action} ${instanceName} auto_forbidden source=${source}`)
    return out
  }

  if (action === "connect" && !manual) {
    const out = { allowed: false, code: "auto_connect_forbidden", ...base }
    await persistAudit({ ...out, result: "blocked" })
    console.warn(`[evo-guard] BLOCK connect ${instanceName} auto_forbidden source=${source}`)
    return out
  }

  if (action === "restart" && !manual) {
    const now = Date.now()
    const last = lastRestartAt(instanceName)
    if (last && now - last < RESTART_MIN_INTERVAL_MS) {
      const out = {
        allowed: false,
        code: "restart_cooldown",
        detail: `min_interval_${RESTART_MIN_INTERVAL_MS}ms`,
        ...base,
      }
      await persistAudit({ ...out, result: "blocked", error: out.detail })
      console.warn(`[evo-guard] BLOCK restart ${instanceName} cooldown source=${source}`)
      return out
    }
    const today = countRestartsToday(instanceName, now)
    if (today >= RESTART_MAX_PER_DAY) {
      const out = {
        allowed: false,
        code: "restart_daily_cap",
        detail: `max_${RESTART_MAX_PER_DAY}_per_day`,
        ...base,
      }
      await persistAudit({ ...out, result: "blocked", error: out.detail })
      console.warn(`[evo-guard] BLOCK restart ${instanceName} daily_cap source=${source}`)
      return out
    }
  }

  return { allowed: true, code: "ok", ...base }
}

async function runGuardedEvolutionAction(input, fn) {
  const gate = await assertEvolutionActionAllowed(input)
  if (!gate.allowed) {
    const err = new Error(`EVOLUTION_ACTION_BLOCKED:${gate.code}`)
    err.code = "EVOLUTION_ACTION_BLOCKED"
    err.gate = gate
    throw err
  }
  try {
    const result = await fn()
    if (input.action === "restart" && input.manual !== true) {
      rememberRestart(input.instanceName)
    } else if (input.action === "restart" && input.manual === true) {
      rememberRestart(input.instanceName)
    }
    await persistAudit({
      ...gate,
      allowed: true,
      result: "ok",
      meta: { day: dayKey() },
    })
    return result
  } catch (err) {
    if (err?.code === "EVOLUTION_ACTION_BLOCKED") throw err
    await persistAudit({
      ...gate,
      allowed: true,
      result: "error",
      error: err?.message || String(err),
    })
    throw err
  }
}

module.exports = {
  setGuardPrisma,
  assertEvolutionActionAllowed,
  runGuardedEvolutionAction,
  RESTART_MIN_INTERVAL_MS,
  RESTART_MAX_PER_DAY,
  persistAudit,
}

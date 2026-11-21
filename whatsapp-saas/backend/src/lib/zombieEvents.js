/**
 * Persistência de eventos de zumbi / disconnect / backfill para ops 7d/30d.
 * Falhas de write nunca derrubam o hot-path (webhook/watchdog).
 */

const { hostLabel, normalizeHostId } = require("./evolutionHosts")

function mapHostLabel(hostId) {
  const id = normalizeHostId(hostId)
  if (id === "primary") return "Evo1"
  if (id === "secondary") return "Evo2"
  if (String(hostId || "").toLowerCase().includes("canary")) return "canary"
  return hostLabel(id) || id
}

const KNOWN_DISCONNECT_CODES = new Set([401, 403, 408, 411, 428, 440, 500, 503, 515])

function extractDisconnectCode(body) {
  const payload = body?.data || body?.payload || body || {}
  const state = String(payload?.state || payload?.status || body?.state || body?.status || "")
    .toLowerCase()
    .trim()
  // CONNECTION_UPDATE open/connecting com HTTP 200 NÃO é queda.
  if (state === "open" || state === "connecting") return null

  const candidates = [
    payload?.statusReason,
    payload?.disconnectReason,
    payload?.error?.output?.statusCode,
    payload?.error?.statusCode,
    payload?.lastDisconnect?.error?.output?.statusCode,
    payload?.lastDisconnect?.error?.data?.statusCode,
    // statusCode genérico só conta se for código conhecido de queda
    payload?.statusCode,
    body?.statusReason,
    body?.statusCode,
  ]
  for (const raw of candidates) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) continue
    const code = Math.trunc(n)
    if (KNOWN_DISCONNECT_CODES.has(code)) return code
    // reason numérico Boom fora da lista, mas estado close/refused
    if (state === "close" || state === "refused" || state.includes("close")) return code
  }
  const msg = String(payload?.error?.message || payload?.message || body?.message || "")
  const m = msg.match(/\b(401|403|408|411|428|440|500|503|515)\b/)
  return m ? Number(m[1]) : null
}

async function recordZombieEvent(prisma, input = {}) {
  if (!prisma?.whatsAppZombieEvent) return null
  const instanceName = String(input.instanceName || "").trim()
  if (!instanceName) return null
  const eventType = String(input.eventType || "").trim() || "unknown"
  try {
    return await prisma.whatsAppZombieEvent.create({
      data: {
        instanceName,
        userId: input.userId || null,
        host: normalizeHostId(input.host || "primary"),
        eventType,
        proofReason: input.proofReason ? String(input.proofReason).slice(0, 120) : null,
        outcome: input.outcome ? String(input.outcome).slice(0, 80) : null,
        softRestartsTried: Math.max(0, Number(input.softRestartsTried) || 0),
        messagesRecovered:
          input.messagesRecovered == null ? null : Math.max(0, Number(input.messagesRecovered) || 0),
        disconnectCode:
          input.disconnectCode == null || !Number.isFinite(Number(input.disconnectCode))
            ? null
            : Math.trunc(Number(input.disconnectCode)),
        meta: input.meta && typeof input.meta === "object" ? input.meta : undefined,
      },
    })
  } catch (err) {
    console.warn("[zombie-event] write failed:", err?.message || err)
    return null
  }
}

async function queryZombieEvents(prisma, { days = 7, host = null, instanceName = null, limit = 200 } = {}) {
  if (!prisma?.whatsAppZombieEvent) {
    return { ok: false, error: "model_unavailable", events: [], byHost: {}, byProof: {} }
  }
  const since = new Date(Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000)
  const where = { createdAt: { gte: since } }
  if (host) where.host = normalizeHostId(host)
  if (instanceName) where.instanceName = String(instanceName).trim()

  const events = await prisma.whatsAppZombieEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(1000, Math.max(10, Number(limit) || 200)),
  })

  const byHost = {}
  const byProof = {}
  const byOutcome = {}
  const disconnectCodes = {}
  for (const ev of events) {
    const h = mapHostLabel(ev.host)
    byHost[h] = (byHost[h] || 0) + 1
    const proof = ev.proofReason || ev.eventType || "unknown"
    byProof[proof] = (byProof[proof] || 0) + 1
    if (ev.outcome) byOutcome[ev.outcome] = (byOutcome[ev.outcome] || 0) + 1
    if (ev.disconnectCode != null) {
      const k = String(ev.disconnectCode)
      disconnectCodes[k] = (disconnectCodes[k] || 0) + 1
    }
  }

  return {
    ok: true,
    days: Number(days) || 7,
    since: since.toISOString(),
    total: events.length,
    byHost,
    byProof,
    byOutcome,
    disconnectCodes,
    events,
  }
}

/**
 * Relatório agregado 3–30d: por instância/host, provas, soft-restart vs QR, disconnect, backfill.
 */
async function summarizeZombieReport(prisma, { days = 5, host = null } = {}) {
  const base = await queryZombieEvents(prisma, {
    days,
    host,
    limit: 1000,
  })
  if (!base.ok) return base

  const byInstance = {}
  let messagesRecoveredTotal = 0
  let softRestartOk = 0
  let softRestartFailed = 0
  let bannerQr = 0
  let cured = 0

  for (const ev of base.events) {
    const key = `${ev.host || "primary"}::${ev.instanceName}`
    if (!byInstance[key]) {
      byInstance[key] = {
        host: mapHostLabel(ev.host),
        hostId: ev.host,
        instanceName: ev.instanceName,
        userId: ev.userId || null,
        total: 0,
        byEventType: {},
        byProof: {},
        byOutcome: {},
        softRestartsTriedMax: 0,
        messagesRecovered: 0,
        disconnectCodes: {},
        bannerQr: 0,
        softRestartOk: 0,
        softRestartFailed: 0,
        lastAt: null,
      }
    }
    const row = byInstance[key]
    row.total += 1
    row.byEventType[ev.eventType] = (row.byEventType[ev.eventType] || 0) + 1
    const proof = ev.proofReason || ev.eventType || "unknown"
    row.byProof[proof] = (row.byProof[proof] || 0) + 1
    if (ev.outcome) row.byOutcome[ev.outcome] = (row.byOutcome[ev.outcome] || 0) + 1
    row.softRestartsTriedMax = Math.max(row.softRestartsTriedMax, Number(ev.softRestartsTried) || 0)
    if (ev.messagesRecovered != null) {
      row.messagesRecovered += Number(ev.messagesRecovered) || 0
      messagesRecoveredTotal += Number(ev.messagesRecovered) || 0
    }
    if (ev.disconnectCode != null) {
      const c = String(ev.disconnectCode)
      row.disconnectCodes[c] = (row.disconnectCodes[c] || 0) + 1
    }
    if (ev.eventType === "banner_qr" || ev.outcome === "banner_qr") {
      row.bannerQr += 1
      bannerQr += 1
    }
    if (ev.outcome === "soft_restart_ok") {
      row.softRestartOk += 1
      softRestartOk += 1
    }
    if (ev.outcome === "soft_restart_failed") {
      row.softRestartFailed += 1
      softRestartFailed += 1
    }
    if (ev.outcome === "cured" || ev.outcome === "recovered") cured += 1
    const ts = ev.createdAt ? new Date(ev.createdAt).toISOString() : null
    if (ts && (!row.lastAt || ts > row.lastAt)) row.lastAt = ts
  }

  const instances = Object.values(byInstance).sort((a, b) => b.total - a.total)

  return {
    ok: true,
    days: base.days,
    since: base.since,
    totalEvents: base.total,
    totals: {
      byHost: base.byHost,
      byProof: base.byProof,
      byOutcome: base.byOutcome,
      disconnectCodes: base.disconnectCodes,
      messagesRecovered: messagesRecoveredTotal,
      softRestartOk,
      softRestartFailed,
      bannerQr,
      cured,
    },
    instances,
  }
}

module.exports = {
  mapHostLabel,
  extractDisconnectCode,
  recordZombieEvent,
  queryZombieEvents,
  summarizeZombieReport,
}

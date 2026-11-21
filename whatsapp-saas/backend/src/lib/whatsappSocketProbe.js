/**
 * Sonda ativa Evo1 vs Evo2 — SOMENTE leitura (sem envio de mensagem).
 *
 * POST /chat/whatsappNumbers/{instance} no PRÓPRIO número da instância
 * (passa pelo socket Baileys; não usa findChats/findMessages do banco local).
 *
 * Flag futura (desligada): WHATSAPP_PROBE_AS_HARD_PROOF=true
 * → 3 falhas seguidas com state open = prova dura pro watchdog.
 */

const {
  bindInstanceHost,
  checkWhatsappNumbers,
  getConnectionStateForProbe,
  pickStatus,
  pickConnected,
} = require("./evolution")
const { normalizeHostId } = require("./evolutionHosts")

const PROBE_ENABLED =
  String(process.env.WHATSAPP_SOCKET_PROBE_ENABLED || "true").toLowerCase() !== "false"
const PROBE_INTERVAL_MS = Number(process.env.WHATSAPP_SOCKET_PROBE_INTERVAL_MS || 5 * 60 * 1000)
const PROBE_TIMEOUT_MS = Number(process.env.WHATSAPP_SOCKET_PROBE_TIMEOUT_MS || 10_000)
const PROBE_GAP_MS = Number(process.env.WHATSAPP_SOCKET_PROBE_GAP_MS || 2500)
/** Falhas seguidas (open + probe fail) para eventual prova dura — flag off. */
const PROBE_HARD_PROOF_STREAK = Math.max(
  2,
  Math.min(10, Number(process.env.WHATSAPP_PROBE_HARD_PROOF_STREAK || 3)),
)
const PROBE_AS_HARD_PROOF =
  String(process.env.WHATSAPP_PROBE_AS_HARD_PROOF || "false").toLowerCase() === "true"

/** instanceName → falhas seguidas com open */
const probeFailStreak = new Map()

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function ownDigits(conn) {
  return String(conn?.phoneDigits || conn?.phone || "")
    .replace(/\D/g, "")
    .trim()
}

/**
 * Uma sonda: whatsappNumbers no próprio número, timeout curto.
 * Nunca envia mensagem.
 */
async function probeOneInstance(prisma, conn) {
  const instanceName = conn.instanceName
  const host = normalizeHostId(conn.evolutionHost || "primary")
  bindInstanceHost(instanceName, host)

  let connectionState = null
  try {
    const stateData = await getConnectionStateForProbe(instanceName)
    connectionState = pickStatus(stateData) || (pickConnected(stateData) ? "open" : "close")
  } catch (err) {
    connectionState = `error:${String(err?.message || err).slice(0, 80)}`
  }

  const digits = ownDigits(conn)
  const started = Date.now()
  let probeOk = false
  let error = null
  let latencyMs = null
  let meta = { method: "whatsappNumbers", selfDigitsSuffix: digits ? digits.slice(-4) : null }

  if (!digits) {
    error = "missing_own_phone"
  } else {
    try {
      // Promise.race com timeout 10s — a checkWhatsappNumbers pode usar até 15s; forçamos 10s.
      const result = await Promise.race([
        checkWhatsappNumbers(instanceName, [digits], { timeoutMs: PROBE_TIMEOUT_MS }).then((rows) => ({
          ok: true,
          rows,
        })),
        wait(PROBE_TIMEOUT_MS + 200).then(() => {
          const err = new Error(`probe_timeout_${PROBE_TIMEOUT_MS}ms`)
          err.code = "PROBE_TIMEOUT"
          throw err
        }),
      ])
      latencyMs = Date.now() - started
      probeOk = true
      meta.exists = Boolean(result.rows?.[0]?.exists ?? result.rows?.length)
      meta.jid = result.rows?.[0]?.jid || null
    } catch (err) {
      latencyMs = Date.now() - started
      probeOk = false
      error = err?.code === "PROBE_TIMEOUT" ? "timeout" : String(err?.message || err).slice(0, 300)
      meta.code = err?.code || null
    }
  }

  const stateOpen = /^open$/i.test(String(connectionState || ""))
  // Sem telefone próprio não dá pra sondar o socket — não é zumbi.
  const zombieSuspect = Boolean(stateOpen && !probeOk && error !== "missing_own_phone")

  if (zombieSuspect) {
    probeFailStreak.set(instanceName, (probeFailStreak.get(instanceName) || 0) + 1)
  } else if (probeOk) {
    probeFailStreak.delete(instanceName)
  }

  const streak = probeFailStreak.get(instanceName) || 0
  meta.failStreak = streak
  meta.hardProofReady = PROBE_AS_HARD_PROOF && streak >= PROBE_HARD_PROOF_STREAK

  const row = {
    instanceName,
    host,
    probeOk,
    latencyMs,
    error,
    connectionState: connectionState ? String(connectionState).slice(0, 80) : null,
    lastFromMeAt: conn.lastFromMeAt || null,
    lastInboundAt: conn.lastInboundAt || null,
    zombieSuspect,
    meta,
  }

  if (prisma?.whatsAppProbeResult) {
    try {
      await prisma.whatsAppProbeResult.create({ data: row })
    } catch (err) {
      console.warn("[socket-probe] persist failed:", err?.message || err)
    }
  }

  if (zombieSuspect) {
    console.warn(
      JSON.stringify({
        tag: "socket-probe",
        action: "zombie_suspect",
        instance: instanceName,
        host,
        error,
        latencyMs,
        streak,
      }),
    )
  }

  return row
}

/**
 * Inventário sem sonda: instâncias close/connecting/disconnected de clientes CRM.
 * Não chama Evolution — só registra o estado conhecido para o relatório.
 */
async function recordStateInventory(prisma, conn) {
  const host = normalizeHostId(conn.evolutionHost || "primary")
  const status = String(conn.status || "UNKNOWN").toUpperCase()
  const row = {
    instanceName: conn.instanceName,
    host,
    probeOk: false,
    latencyMs: null,
    error: "skipped_not_open",
    connectionState: status.toLowerCase(),
    lastFromMeAt: conn.lastFromMeAt || null,
    lastInboundAt: conn.lastInboundAt || null,
    zombieSuspect: false,
    meta: {
      skipped: true,
      reason: "state_inventory",
      crmConnected: Boolean(conn.connected),
      crmStatus: status,
    },
  }
  if (prisma?.whatsAppProbeResult) {
    try {
      await prisma.whatsAppProbeResult.create({ data: row })
    } catch (err) {
      console.warn("[socket-probe] inventory persist failed:", err?.message || err)
    }
  }
  return row
}

/**
 * Ciclo completo:
 * 1) Sonda ativa só em open/connected (whatsappNumbers).
 * 2) Inventário passivo das demais (close/connecting) — sem chamada Evolution.
 */
async function runWhatsappSocketProbeTick(prisma) {
  if (!PROBE_ENABLED) return { skipped: true, reason: "disabled" }
  if (!prisma?.whatsAppConnection) return { skipped: true, reason: "no_prisma" }

  const connections = await prisma.whatsAppConnection.findMany({
    where: {
      status: { not: "NUMBER_CONFLICT" },
    },
    select: {
      instanceName: true,
      evolutionHost: true,
      phone: true,
      phoneDigits: true,
      status: true,
      connected: true,
      lastFromMeAt: true,
      lastInboundAt: true,
      lastWebhookAt: true,
    },
    orderBy: [{ evolutionHost: "asc" }, { instanceName: "asc" }],
  })

  const targets = []
  const inventory = []
  for (const c of connections) {
    const st = String(c.status || "").toUpperCase()
    // Sonda só open/connected; close/connecting/disconnected → inventário (sem Evolution).
    if (c.connected && (st === "OPEN" || st === "CONNECTED")) {
      targets.push(c)
    } else {
      inventory.push(c)
    }
  }

  const results = []
  for (let i = 0; i < targets.length; i += 1) {
    const conn = targets[i]
    try {
      results.push(await probeOneInstance(prisma, conn))
    } catch (err) {
      console.warn(`[socket-probe] ${conn.instanceName}:`, err?.message || err)
      results.push({
        instanceName: conn.instanceName,
        host: conn.evolutionHost || "primary",
        probeOk: false,
        error: String(err?.message || err).slice(0, 300),
        zombieSuspect: false,
      })
    }
    if (i < targets.length - 1) await wait(PROBE_GAP_MS)
  }

  const inventoryRows = []
  for (const conn of inventory) {
    inventoryRows.push(await recordStateInventory(prisma, conn))
  }

  const ok = results.filter((r) => r.probeOk).length
  const suspects = results.filter((r) => r.zombieSuspect).length
  console.log(
    JSON.stringify({
      tag: "socket-probe",
      action: "tick",
      total: results.length,
      ok,
      suspects,
      inventory: inventoryRows.length,
      gapMs: PROBE_GAP_MS,
    }),
  )
  return {
    total: results.length,
    ok,
    suspects,
    inventory: inventoryRows.length,
    results,
    inventoryRows,
  }
}

/**
 * Atualiza lastFromMeAt / lastInboundAt a partir de records de webhook (sem envio).
 */
async function touchMessageDirection(prisma, instanceName, records = []) {
  if (!prisma || !instanceName || !Array.isArray(records) || !records.length) return null
  let hasFromMe = false
  let hasInbound = false
  for (const r of records) {
    if (r?.key?.fromMe === true) hasFromMe = true
    else if (r?.key?.fromMe === false) hasInbound = true
  }
  if (!hasFromMe && !hasInbound) return null
  const data = {}
  const now = new Date()
  if (hasFromMe) data.lastFromMeAt = now
  if (hasInbound) data.lastInboundAt = now
  try {
    return await prisma.whatsAppConnection.update({
      where: { instanceName },
      data,
    })
  } catch (err) {
    // Colunas ainda não migradas
    if (String(err?.message || "").includes("lastFromMeAt") || err?.code === "P2022") return null
    console.warn("[socket-probe] touch direction:", err?.message || err)
    return null
  }
}

/**
 * Relatório 72h (ou N hours) Evo1 vs Evo2.
 */
async function buildProbeReport(prisma, { hours = 72 } = {}) {
  if (!prisma?.whatsAppProbeResult) {
    return { ok: false, error: "model_unavailable" }
  }
  const since = new Date(Date.now() - Math.max(1, Number(hours) || 72) * 3600 * 1000)
  const rows = await prisma.whatsAppProbeResult.findMany({
    where: { probedAt: { gte: since } },
    orderBy: { probedAt: "asc" },
  })

  const byInstance = new Map()
  for (const r of rows) {
    const isInventory = r.error === "skipped_not_open"
    const key = `${r.host}::${r.instanceName}`
    if (!byInstance.has(key)) {
      byInstance.set(key, {
        host: r.host,
        instanceName: r.instanceName,
        total: 0,
        ok: 0,
        fail: 0,
        inventoryTicks: 0,
        lastInventoryState: null,
        zombieSuspects: 0,
        latencies: [],
        failHours: {},
        zombiePeriods: [],
        _openFailRun: null,
      })
    }
    const agg = byInstance.get(key)
    if (isInventory) {
      agg.inventoryTicks += 1
      agg.lastInventoryState = r.connectionState || agg.lastInventoryState
      continue
    }
    agg.total += 1
    if (r.probeOk) agg.ok += 1
    else agg.fail += 1
    if (r.latencyMs != null) agg.latencies.push(r.latencyMs)
    if (r.zombieSuspect) {
      agg.zombieSuspects += 1
      const hour = new Date(r.probedAt).toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hour12: false,
      })
      agg.failHours[hour] = (agg.failHours[hour] || 0) + 1
      if (!agg._openFailRun) {
        agg._openFailRun = { start: r.probedAt, end: r.probedAt, count: 1 }
      } else {
        agg._openFailRun.end = r.probedAt
        agg._openFailRun.count += 1
      }
    } else if (agg._openFailRun) {
      const startMs = new Date(agg._openFailRun.start).getTime()
      const endMs = new Date(agg._openFailRun.end).getTime()
      agg.zombiePeriods.push({
        start: agg._openFailRun.start,
        end: agg._openFailRun.end,
        durationMin: Math.round((endMs - startMs) / 60000),
        probes: agg._openFailRun.count,
      })
      agg._openFailRun = null
    }
  }

  // fecha runs abertos
  for (const agg of byInstance.values()) {
    if (agg._openFailRun) {
      const startMs = new Date(agg._openFailRun.start).getTime()
      const endMs = new Date(agg._openFailRun.end).getTime()
      agg.zombiePeriods.push({
        start: agg._openFailRun.start,
        end: agg._openFailRun.end,
        durationMin: Math.round((endMs - startMs) / 60000),
        probes: agg._openFailRun.count,
      })
      agg._openFailRun = null
    }
    agg.okPct = agg.total ? Math.round((1000 * agg.ok) / agg.total) / 10 : null
    agg.avgLatencyMs = agg.latencies.length
      ? Math.round(agg.latencies.reduce((a, b) => a + b, 0) / agg.latencies.length)
      : null
    delete agg.latencies
  }

  const instances = [...byInstance.values()].sort((a, b) => String(a.host).localeCompare(b.host) || a.instanceName.localeCompare(b.instanceName))

  // Separar sondas ativas vs inventário (skipped_not_open)
  const activeProbeRows = rows.filter((r) => r.error !== "skipped_not_open")
  const inventoryLatest = new Map()
  for (const r of rows) {
    if (r.error !== "skipped_not_open") continue
    const prev = inventoryLatest.get(r.instanceName)
    if (!prev || new Date(r.probedAt) > new Date(prev.probedAt)) {
      inventoryLatest.set(r.instanceName, r)
    }
  }

  const byHost = {}
  for (const inst of instances) {
    const h = inst.host === "primary" ? "Evo1" : inst.host === "secondary" ? "Evo2" : inst.host
    if (!byHost[h]) {
      byHost[h] = {
        host: h,
        total: 0,
        ok: 0,
        fail: 0,
        zombieSuspects: 0,
        instances: 0,
        inventoryInstances: 0,
      }
    }
    if (inst.total === 0 && inst.inventoryTicks > 0) {
      byHost[h].inventoryInstances += 1
      continue
    }
    byHost[h].total += inst.total
    byHost[h].ok += inst.ok
    byHost[h].fail += inst.fail
    byHost[h].zombieSuspects += inst.zombieSuspects
    byHost[h].instances += 1
  }
  for (const h of Object.values(byHost)) {
    h.okPct = h.total ? Math.round((1000 * h.ok) / h.total) / 10 : null
  }

  // Snapshot atual do CRM (todas as conexões) — evita invisíveis mesmo sem tick recente
  let crmSnapshot = []
  if (prisma.whatsAppConnection) {
    const crmRows = await prisma.whatsAppConnection.findMany({
      where: { status: { not: "NUMBER_CONFLICT" } },
      select: {
        instanceName: true,
        evolutionHost: true,
        status: true,
        connected: true,
        lastWebhookAt: true,
        lastFromMeAt: true,
        lastInboundAt: true,
        syncHealth: true,
      },
      orderBy: [{ evolutionHost: "asc" }, { instanceName: "asc" }],
    })
    crmSnapshot = crmRows.map((c) => ({
      instanceName: c.instanceName,
      host: normalizeHostId(c.evolutionHost || "primary"),
      status: c.status,
      connected: c.connected,
      syncHealth: c.syncHealth,
      lastWebhookAt: c.lastWebhookAt,
      lastFromMeAt: c.lastFromMeAt,
      lastInboundAt: c.lastInboundAt,
      probed: activeProbeRows.some((r) => r.instanceName === c.instanceName),
      inventoryState: inventoryLatest.get(c.instanceName)?.connectionState || null,
    }))
  }

  // Cruzamento com WhatsAppZombieEvent
  let zombieEvents = []
  if (prisma.whatsAppZombieEvent) {
    zombieEvents = await prisma.whatsAppZombieEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
  }
  const cross = instances.map((inst) => {
    const related = zombieEvents.filter((z) => z.instanceName === inst.instanceName)
    const inventoryOnly = inst.total === 0 && inst.inventoryTicks > 0
    return {
      ...inst,
      inventoryOnly,
      watchdogEvents: related.length,
      watchdogTypes: related.reduce((acc, z) => {
        acc[z.eventType] = (acc[z.eventType] || 0) + 1
        return acc
      }, {}),
      watchdogDetectedWhileProbeSuspect: related.length > 0 && inst.zombieSuspects > 0,
    }
  })

  return {
    ok: true,
    hours: Number(hours) || 72,
    since: since.toISOString(),
    probeAsHardProof: PROBE_AS_HARD_PROOF,
    hardProofStreak: PROBE_HARD_PROOF_STREAK,
    byHost: Object.values(byHost),
    comparison: {
      evo1: byHost.Evo1 || null,
      evo2: byHost.Evo2 || null,
    },
    instances: cross,
    crmSnapshot,
    inventoryCount: inventoryLatest.size,
  }
}

/** Para o watchdog (flag off): retorna prova se streak atingido. */
function getProbeHardProof(instanceName) {
  if (!PROBE_AS_HARD_PROOF) return null
  const streak = probeFailStreak.get(instanceName) || 0
  if (streak < PROBE_HARD_PROOF_STREAK) return null
  return {
    proven: true,
    reason: "socket_probe_fail",
    streak,
  }
}

module.exports = {
  PROBE_ENABLED,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  PROBE_GAP_MS,
  PROBE_AS_HARD_PROOF,
  PROBE_HARD_PROOF_STREAK,
  probeOneInstance,
  recordStateInventory,
  runWhatsappSocketProbeTick,
  touchMessageDirection,
  buildProbeReport,
  getProbeHardProof,
  probeFailStreak,
}

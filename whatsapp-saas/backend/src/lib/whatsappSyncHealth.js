/**
 * Health real da sync WhatsApp além do state "open" da Evolution.
 *
 * Problema: sessão Baileys zombie reporta open, mas para de emitir MESSAGES_UPSERT.
 *
 * Padrão (híbrido / always-on):
 * - Silêncio quieto (sem baseline de tráfego) → NÃO é bug (limpa STALE falso)
 * - Prova DURA (Evo>CRM | empty_store | mutual_freeze) → soft-restart SEM logout + webhook reassert + backfill
 * - Conta quente + no_gap → NÃO limpa pra HEALTHY (anti falso-positivo Outlet)
 * - Soft-restarts esgotados COM prova dura → banner UI pedindo Reconectar
 * - RECOVERING não gera banner de erro (só chip discreto)
 * - HEALTHY só via webhook de mensagem realtime (não via CONNECTION_UPDATE open)
 *
 * Opt-in agressivo: WHATSAPP_STALE_AUTO_RECOVER=true → soft-restart + logout (legado).
 */

const {
  bindInstanceHost,
  getConnectionStateForProbe,
  restartInstance,
  logoutInstance,
  pickConnected,
  pickStatus,
  findChats,
  fetchChatMessages,
  reassertInstanceWebhook,
} = require("./evolution")

/** Lazy require: evita circular dep whatsappSyncHealth ↔ crmSync (syncSingleChat virava undefined). */
function crmSyncApi() {
  return require("./crmSync")
}

/**
 * Silêncio sem mensagem *nova* antes de marcar STALE.
 * 45 min (antes 20): horário parado / almoço não deve reiniciar sessão saudável.
 */
const WEBHOOK_SILENCE_MS = Number(process.env.WHATSAPP_WEBHOOK_SILENCE_MS || 45 * 60 * 1000)
/**
 * Detecção mais rápida em horário comercial — DESLIGADA por padrão.
 * WHATSAPP_STALE_BUSINESS_HOURS_ENABLED=true
 */
const BUSINESS_HOURS_ENABLED =
  String(process.env.WHATSAPP_STALE_BUSINESS_HOURS_ENABLED || "false").toLowerCase() === "true"
const WEBHOOK_SILENCE_BUSINESS_MS = Number(
  process.env.WHATSAPP_WEBHOOK_SILENCE_BUSINESS_MS || 15 * 60 * 1000,
)
const BUSINESS_HOURS_TZ = String(process.env.WHATSAPP_STALE_BUSINESS_TZ || "America/Sao_Paulo")
const BUSINESS_HOUR_START = Math.max(0, Math.min(23, Number(process.env.WHATSAPP_STALE_BUSINESS_HOUR_START || 8)))
const BUSINESS_HOUR_END = Math.max(1, Math.min(24, Number(process.env.WHATSAPP_STALE_BUSINESS_HOUR_END || 20)))
/** Conta “interessante” pro watchdog (teve msg no CRM recentemente). */
const ACTIVE_RECENT_MS = Number(process.env.WHATSAPP_STALE_ACTIVE_RECENT_MS || 6 * 60 * 60 * 1000)
/**
 * Só soft-restart/logout se houve tráfego recente o bastante pra esperar webhook.
 * Evita derrubar conta quieta (última msg há 3–5h) só porque o silêncio passou do limiar.
 */
const TRAFFIC_EXPECT_MS = Number(process.env.WHATSAPP_STALE_TRAFFIC_EXPECT_MS || 2 * 60 * 60 * 1000)
const NEW_CONNECTION_GRACE_MS = Number(process.env.WHATSAPP_STALE_NEW_GRACE_MS || 30 * 60 * 1000)
/** Cooldown entre soft-restarts no híbrido. */
const RECOVERY_COOLDOWN_MS = Number(process.env.WHATSAPP_STALE_RECOVERY_COOLDOWN_MS || 20 * 60 * 1000)
const MAX_SOFT_RECOVERIES = Math.max(1, Math.min(5, Number(process.env.WHATSAPP_STALE_MAX_RECOVERIES || 2)))
/**
 * true: modo agressivo legado (soft-restart → logout).
 * false (padrão): híbrido — soft-restart só com prova de zombie, nunca logout automático.
 */
const AUTO_RECOVER =
  String(process.env.WHATSAPP_STALE_AUTO_RECOVER || "false").toLowerCase() === "true"
/** Tentativa de voltar sessão após CLOSE real (sem logout/QR). */
const KEEP_ALIVE_ENABLED =
  String(process.env.WHATSAPP_KEEP_ALIVE_ENABLED || "true").toLowerCase() !== "false"
/** Antes 3min: keep-alive em rajada flapa UI. 8min reduz restart em loop. */
const KEEP_ALIVE_COOLDOWN_MS = Number(process.env.WHATSAPP_KEEP_ALIVE_COOLDOWN_MS || 8 * 60 * 1000)
/** Evo precisa estar pelo menos isto à frente do CRM para contar como gap de zombie. */
const ZOMBIE_GAP_MS = Number(process.env.WHATSAPP_ZOMBIE_GAP_MS || 2 * 60 * 1000)
const ZOMBIE_PROBE_CHATS = Math.max(2, Math.min(10, Number(process.env.WHATSAPP_ZOMBIE_PROBE_CHATS || 5)))
const WATCHDOG_BATCH = Math.max(5, Math.min(40, Number(process.env.WHATSAPP_STALE_WATCHDOG_BATCH || 25)))
const keepAliveLastAt = new Map()
/** instanceName → falhas seguidas de “ainda fechado” (anti-loop). */
const keepAliveFailStreak = new Map()
/** Backfill pós-recovery: curto de propósito (não dispara sync full de milhares de chats). */
const BACKFILL_CHAT_LIMIT = Math.max(5, Math.min(80, Number(process.env.WHATSAPP_STALE_BACKFILL_CHATS || 50)))
const BACKFILL_LOOKBACK_MS = Number(process.env.WHATSAPP_STALE_BACKFILL_LOOKBACK_MS || 48 * 60 * 60 * 1000)
const BACKFILL_CHAT_DELAY_MS = Number(process.env.WHATSAPP_STALE_BACKFILL_DELAY_MS || 1200)
/**
 * Motivos que autorizam soft-restart / banner de “bug real”.
 * empty_store_zombie: Evolution open + findChats vazio + CRM com volume — caso Baseset/Luis.
 * mutual_freeze_zombie: Evo e CRM congelados juntos após conta quente — caso Outlet.
 */
const HARD_ZOMBIE_PROOF_REASONS = new Set([
  "chat_activity",
  "findMessages",
  "empty_store_zombie",
  "mutual_freeze_zombie",
])
/** Motivos em que soft-restart quase nunca cura → 1 tentativa → banner QR. */
const ONE_SHOT_RECOVERY_REASONS = new Set(["empty_store_zombie", "mutual_freeze_zombie"])
/**
 * Quais hosts persistem chats no DB da Evolution (findChats confiável).
 * Evo1 produção: DATABASE_SAVE_DATA_CHATS=false → findChats=0 mesmo open/saudável.
 * Formato: primary:false,secondary:true,canary:true
 */
const HOST_PERSIST_CHATS = (() => {
  const raw = String(process.env.WHATSAPP_HOST_PERSIST_CHATS || "primary:false,secondary:true")
  const map = new Map()
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":").map((s) => String(s || "").trim().toLowerCase())
    if (!k) continue
    map.set(k, v === "1" || v === "true" || v === "yes")
  }
  return map
})()
function hostPersistsChats(evolutionHost) {
  const id = String(evolutionHost || "primary").trim().toLowerCase() || "primary"
  if (HOST_PERSIST_CHATS.has(id)) return HOST_PERSIST_CHATS.get(id)
  if (id === "primary" || id === "evo1" || id === "1") return false
  // secondary / evoN / canary: assume persistido (como Evo2)
  return true
}
/** Mínimo de contatos no CRM para store vazio / freeze contar como zombie (não conta nova). */
const EMPTY_STORE_CONTACT_MIN = Math.max(
  10,
  Math.min(200, Number(process.env.WHATSAPP_EMPTY_STORE_CONTACT_MIN || 30)),
)
/**
 * Silêncio mínimo (Evo+CRM) pra mutual_freeze. Default 60min — acima do WEBHOOK_SILENCE
 * pra não confundir almoço curto com zombie.
 */
const MUTUAL_FREEZE_SILENCE_MS = Number(
  process.env.WHATSAPP_MUTUAL_FREEZE_SILENCE_MS || 60 * 60 * 1000,
)
/** Janela ANTES do silêncio pra medir se a conta era “quente”. */
const MUTUAL_FREEZE_BASELINE_MS = Number(
  process.env.WHATSAPP_MUTUAL_FREEZE_BASELINE_MS || 12 * 60 * 60 * 1000,
)
/** Mínimo de msgs na baseline pra mutual_freeze (anti falso-positivo noturno). */
const MUTUAL_FREEZE_MIN_MSGS = Math.max(
  5,
  Math.min(500, Number(process.env.WHATSAPP_MUTUAL_FREEZE_MIN_MSGS || 25)),
)
/** Evo e CRM “juntos” se a diferença de newest for menor que isto. */
const MUTUAL_FREEZE_ALIGN_MS = Number(
  process.env.WHATSAPP_MUTUAL_FREEZE_ALIGN_MS || 30 * 60 * 1000,
)
/**
 * Msg com timestamp mais velho que isto = replay/histórico, NÃO prova sessão viva.
 * (Home Lisas recebia webhook de msgs de ontem e o health ficava falso-positivo.)
 */
const REALTIME_MAX_AGE_MS = Number(process.env.WHATSAPP_REALTIME_MAX_AGE_MS || 2 * 60 * 60 * 1000)

const SYNC_HEALTH = {
  UNKNOWN: "UNKNOWN",
  HEALTHY: "HEALTHY",
  STALE: "STALE",
  RECOVERING: "RECOVERING",
}

const NUMBER_CONFLICT_STATUS = "NUMBER_CONFLICT"

const activeBackfills = new Set()
const pendingBackfill = new Set()

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function needsManualReconnect(conn) {
  const health = String(conn?.syncHealth || "").toUpperCase()
  if (health !== SYNC_HEALTH.STALE) return false
  // Banner só depois de soft-restarts esgotados (cada um exige prova dura Evo>CRM).
  return Number(conn?.staleRecoveryCount || 0) >= MAX_SOFT_RECOVERIES
}

function isRecoveringSync(conn) {
  return String(conn?.syncHealth || "").toUpperCase() === SYNC_HEALTH.RECOVERING
}

function isHardZombieProof(proof) {
  return Boolean(proof?.proven && HARD_ZOMBIE_PROOF_REASONS.has(String(proof.reason || "")))
}

/**
 * Alerta amarelo na UI (= bug real). RECOVERING e STALE(observe) NÃO alertam.
 * Modo agressivo: qualquer STALE ainda alerta.
 */
function isStaleSync(conn) {
  const health = String(conn?.syncHealth || "").toUpperCase()
  if (health === SYNC_HEALTH.STALE) {
    if (AUTO_RECOVER) return true
    return needsManualReconnect(conn)
  }
  return false
}

function isHealthySync(conn) {
  if (!conn?.connected) return false
  if (conn.status === NUMBER_CONFLICT_STATUS) return false
  // RECOVERING continua “saudável” na UI (chip discreto, sem banner de erro).
  return !isStaleSync(conn)
}

function syncHealthLabel(conn) {
  if (!conn?.connected) return "Desconectado"
  if (conn.status === NUMBER_CONFLICT_STATUS) return "Conflito de número"
  const health = String(conn.syncHealth || SYNC_HEALTH.UNKNOWN).toUpperCase()
  if (health === SYNC_HEALTH.RECOVERING) return "CRM atrasado — recuperando"
  if (health === SYNC_HEALTH.STALE) {
    if (AUTO_RECOVER || needsManualReconnect(conn)) return "Sem sincronizar"
    return "Conectado"
  }
  return "Conectado"
}

function syncHealthDescription(conn) {
  if (!conn?.connected) return null
  const health = String(conn.syncHealth || SYNC_HEALTH.UNKNOWN).toUpperCase()
  if (health === SYNC_HEALTH.RECOVERING) {
    return "CRM atrasado — recuperando sessão em segundo plano (sem pedir QR)."
  }
  if (health === SYNC_HEALTH.STALE) {
    if (AUTO_RECOVER || needsManualReconnect(conn)) {
      return "Confirmamos atraso entre WhatsApp e CRM. Use Reconectar e escaneie o QR."
    }
    return null
  }
  return null
}

function appendSyncHealthPayload(conn, payload = {}) {
  const health = String(conn?.syncHealth || SYNC_HEALTH.UNKNOWN).toUpperCase()
  const recovering = isRecoveringSync(conn)
  const stale = isStaleSync(conn)
  return {
    ...payload,
    syncHealth: health,
    syncHealthy: isHealthySync(conn),
    recovering,
    stale,
    lastWebhookAt: conn?.lastWebhookAt?.toISOString?.() || conn?.lastWebhookAt || null,
    staleDetectedAt: conn?.staleDetectedAt?.toISOString?.() || conn?.staleDetectedAt || null,
    syncHealthLabel: syncHealthLabel(conn),
    syncHealthMessage: syncHealthDescription(conn),
  }
}

function extractNewestMessageMs(records = []) {
  const { toIsoFromEvolutionTimestamp } = require("./evolutionMessages")
  let newest = 0
  for (const record of records) {
    const iso = toIsoFromEvolutionTimestamp(
      record?.messageTimestamp ??
        record?.messageTimestampMs ??
        record?.key?.messageTimestamp ??
        record?.timestamp ??
        null,
    )
    if (!iso) continue
    const ms = new Date(iso).getTime()
    if (Number.isFinite(ms) && ms > newest) newest = ms
  }
  return newest || null
}

function isRealtimeMessageMs(ms, now = Date.now()) {
  if (!ms) return false
  const age = now - ms
  // Futuro pequeno (skew) ok; muito antigo = replay.
  if (age < -5 * 60 * 1000) return false
  return age <= REALTIME_MAX_AGE_MS
}

/**
 * Touch no webhook de mensagem.
 * Só atualiza lastWebhookAt / HEALTHY se houver msg com timestamp recente (não replay).
 */
async function touchLastWebhookAt(prisma, instanceName, { at = new Date(), records = null, body = null } = {}) {
  if (!instanceName) return null
  const existing = await prisma.whatsAppConnection.findUnique({
    where: { instanceName },
    select: {
      userId: true,
      instanceName: true,
      connected: true,
      status: true,
      syncHealth: true,
      staleDetectedAt: true,
      phone: true,
      lastSync: true,
      lastWebhookAt: true,
      qrCode: true,
      groupSyncStatus: true,
      groupSyncProgress: true,
      groupSyncMessage: true,
      groupSyncError: true,
      msgImportStatus: true,
      msgImportTotal: true,
      msgImportDone: true,
      msgImportMessage: true,
      msgImportError: true,
      msgImportRetryAfter: true,
    },
  })
  if (!existing) return null

  let list = records
  if (!list && body) {
    const { collectWebhookMessageRecords } = require("./evolutionMessages")
    list = collectWebhookMessageRecords(body)
  }
  const newestMsgMs = extractNewestMessageMs(Array.isArray(list) ? list : [])
  const realtime = isRealtimeMessageMs(newestMsgMs, at.getTime())

  // Replay/histórico: não prova vida — só refresca lastSync leve.
  if (!realtime) {
    const conn = await prisma.whatsAppConnection.update({
      where: { instanceName },
      data: { lastSync: at },
    })
    return { conn, recoveredFromStale: false, skippedReplay: true, newestMsgMs }
  }

  const prevHealth = String(existing.syncHealth || "").toUpperCase()
  const wasUnhealthy =
    isStaleSync(existing) ||
    prevHealth === SYNC_HEALTH.RECOVERING ||
    prevHealth === SYNC_HEALTH.STALE ||
    prevHealth === SYNC_HEALTH.UNKNOWN
  const data = {
    lastWebhookAt: at,
    lastSync: at,
  }
  if (wasUnhealthy) {
    data.syncHealth = SYNC_HEALTH.HEALTHY
    data.staleDetectedAt = null
    data.staleRecoveryCount = 0
    data.staleLastRecoveryAt = null
  }

  const conn = await prisma.whatsAppConnection.update({
    where: { instanceName },
    data,
  })

  return { conn, recoveredFromStale: wasUnhealthy, skippedReplay: false, newestMsgMs }
}

async function markSyncHealthy(prisma, { userId, instanceName }) {
  const where = instanceName ? { instanceName } : { userId }
  return prisma.whatsAppConnection.update({
    where,
    data: {
      syncHealth: SYNC_HEALTH.HEALTHY,
      staleDetectedAt: null,
      staleRecoveryCount: 0,
      staleLastRecoveryAt: null,
    },
  })
}

async function resetSyncHealthOnDisconnect(prisma, userId) {
  return prisma.whatsAppConnection.update({
    where: { userId },
    data: {
      syncHealth: SYNC_HEALTH.UNKNOWN,
      staleDetectedAt: null,
      staleRecoveryCount: 0,
      staleLastRecoveryAt: null,
    },
  }).catch(() => null)
}

async function accountLooksActive(prisma, userId, { sinceMs = ACTIVE_RECENT_MS } = {}) {
  const since = new Date(Date.now() - sinceMs)
  const recent = await prisma.crmMessage.findFirst({
    where: { userId, timestamp: { gte: since } },
    select: { id: true },
  })
  return Boolean(recent)
}

/** Tráfego recente o bastante para esperar webhook contínuo (zombie vs só quieto). */
async function accountHasExpectedTraffic(prisma, userId, { sinceMs = TRAFFIC_EXPECT_MS } = {}) {
  return accountLooksActive(prisma, userId, { sinceMs })
}

/**
 * Conta msgs na janela ANTES do silêncio começar.
 * Usado pra distinguir conta quente congelada vs loja fechada à noite.
 */
async function countBaselineMessagesBeforeSilence(prisma, userId, silenceRefMs, {
  windowMs = MUTUAL_FREEZE_BASELINE_MS,
} = {}) {
  if (!userId || !silenceRefMs) return 0
  const end = new Date(silenceRefMs)
  const start = new Date(silenceRefMs - windowMs)
  const row = await prisma.crmMessage
    .count({
      where: {
        userId,
        timestamp: { gte: start, lt: end },
      },
    })
    .catch(() => 0)
  return Number(row) || 0
}

async function accountHadBaselineTraffic(prisma, userId, silenceRefMs, {
  windowMs = MUTUAL_FREEZE_BASELINE_MS,
  minMsgs = MUTUAL_FREEZE_MIN_MSGS,
} = {}) {
  const n = await countBaselineMessagesBeforeSilence(prisma, userId, silenceRefMs, { windowMs })
  return { hot: n >= minMsgs, count: n, minMsgs, windowMs }
}

/**
 * Confirma se a Evolution ainda reporta sessão open (candidato a zombie).
 * Se já fechou, o reconcile normal cuida — não reiniciar/logout à toa.
 */
async function probeEvolutionStillOpen(instanceName, evolutionHost) {
  if (!instanceName) return { open: false, probed: false, reason: "missing_instance" }
  try {
    bindInstanceHost(instanceName, evolutionHost || "primary")
    const state = await getConnectionStateForProbe(instanceName)
    const open = Boolean(pickConnected(state))
    return { open, probed: true, status: pickStatus(state) || null }
  } catch (err) {
    return { open: false, probed: false, reason: err?.message || String(err) }
  }
}

/** Newest activity em findChats bruto (1:1 + grupos) — freeze Outlet congela em @g.us. */
function newestActivityMsFromRawChats(raw) {
  const { toIsoFromEvolutionTimestamp } = require("./evolutionMessages")
  const list = Array.isArray(raw) ? raw : raw?.chats || raw?.data || raw?.records || []
  let newest = null
  for (const chat of list) {
    const lm = chat?.lastMessage || {}
    const iso = toIsoFromEvolutionTimestamp(
      lm.messageTimestamp ||
        lm.msgTimestamp ||
        chat?.updatedAt ||
        chat?.lastMsgTimestamp ||
        chat?.lastMessageTimestamp ||
        chat?.conversationTimestamp ||
        null,
    )
    if (!iso) continue
    const ms = new Date(iso).getTime()
    if (Number.isFinite(ms) && (newest == null || ms > newest)) newest = ms
  }
  return newest
}

/**
 * Prova de zombie: Evolution tem atividade/msg mais nova que o CRM (gap >= ZOMBIE_GAP_MS).
 * Silêncio sozinho NÃO prova — evita soft-restart em horário parado.
 */
async function proveEvolutionAheadOfCrm(prisma, row) {
  const crmNewestMs = row.newestMsgAt
    ? new Date(row.newestMsgAt).getTime()
    : silenceReferenceMs(row) || 0
  if (!crmNewestMs) return { proven: false, reason: "no_crm_baseline" }

  bindInstanceHost(row.instanceName, row.evolutionHost || "primary")
  const { extractIndividualChats } = crmSyncApi()

  // 1) findChats: lastActivityAt à frente do CRM — ou store vazio com CRM cheio (sessão morta).
  let evoNewestFromChats = null
  let contactCountCache = null
  try {
    const raw = await findChats(row.instanceName, { limit: 80 })
    evoNewestFromChats = newestActivityMsFromRawChats(raw)
    const chats = extractIndividualChats(raw, { limit: 80 })
    if (!chats.length && evoNewestFromChats == null) {
      contactCountCache = await prisma.crmContact.count({ where: { userId: row.userId } })
      // Evo1 (SAVE_DATA_CHATS=false): findChats=0 é NORMAL mesmo com sessão viva.
      // Usar isso como empty_store_zombie causa soft-restart/QR falso.
      if (!hostPersistsChats(row.evolutionHost)) {
        console.warn(
          JSON.stringify({
            tag: "sync-health",
            action: "skip_empty_store_proof",
            instance: row.instanceName,
            host: row.evolutionHost || "primary",
            contactCount: contactCountCache,
            message: "findChats vazio ignorado — host sem persistência de chats",
          }),
        )
        // segue para probes findMessages / no_gap (sem marcar empty_store)
      } else if (contactCountCache >= EMPTY_STORE_CONTACT_MIN) {
        // Store vazio + CRM maduro + silêncio já filtrado = zombie (só hosts que persistem).
        return {
          proven: true,
          reason: "empty_store_zombie",
          sampleJid: null,
          evoNewestMs: null,
          crmNewestMs,
          gapMs: Date.now() - crmNewestMs,
          contactCount: contactCountCache,
        }
      } else {
        return {
          proven: false,
          reason: "empty_findChats_store",
          sampleJid: null,
          evoNewestMs: null,
          crmNewestMs,
          gapMs: Date.now() - crmNewestMs,
          contactCount: contactCountCache,
        }
      }
    }
    for (const chat of chats) {
      const evoMs = chat.lastActivityAt ? new Date(chat.lastActivityAt).getTime() : 0
      if (evoMs && evoMs > (evoNewestFromChats || 0)) evoNewestFromChats = evoMs
    }
    for (const chat of chats.slice(0, ZOMBIE_PROBE_CHATS)) {
      const evoMs = chat.lastActivityAt ? new Date(chat.lastActivityAt).getTime() : 0
      if (evoMs && evoMs > crmNewestMs + ZOMBIE_GAP_MS) {
        return {
          proven: true,
          reason: "chat_activity",
          sampleJid: chat.remoteJid,
          evoNewestMs: evoMs,
          crmNewestMs,
          gapMs: evoMs - crmNewestMs,
        }
      }
    }

    // Mutual freeze: Evo e CRM parados juntos após conta quente (Outlet).
    const nowMs = Date.now()
    const crmSilenceMs = nowMs - crmNewestMs
    const evoSilenceMs = evoNewestFromChats ? nowMs - evoNewestFromChats : null
    const aligned =
      evoNewestFromChats != null &&
      Math.abs(evoNewestFromChats - crmNewestMs) <= Math.max(ZOMBIE_GAP_MS, MUTUAL_FREEZE_ALIGN_MS)
    if (
      crmSilenceMs >= MUTUAL_FREEZE_SILENCE_MS &&
      evoSilenceMs != null &&
      evoSilenceMs >= MUTUAL_FREEZE_SILENCE_MS &&
      aligned
    ) {
      if (contactCountCache == null) {
        contactCountCache = await prisma.crmContact.count({ where: { userId: row.userId } })
      }
      const baseline = await accountHadBaselineTraffic(prisma, row.userId, crmNewestMs)
      if (contactCountCache >= EMPTY_STORE_CONTACT_MIN && baseline.hot) {
        return {
          proven: true,
          reason: "mutual_freeze_zombie",
          sampleJid: null,
          evoNewestMs: evoNewestFromChats,
          crmNewestMs,
          gapMs: 0,
          contactCount: contactCountCache,
          baselineMsgs: baseline.count,
          crmSilenceMs,
          evoSilenceMs,
        }
      }
    }
  } catch (err) {
    console.warn(`[sync-health] zombie findChats ${row.instanceName}:`, err?.message || err)
  }

  // 2) Fallback: últimas conversas do CRM × findMessages na Evo
  const convos = await prisma.crmConversation.findMany({
    where: {
      userId: row.userId,
      lastMessageAt: { gte: new Date(Date.now() - ACTIVE_RECENT_MS) },
    },
    orderBy: { lastMessageAt: "desc" },
    take: ZOMBIE_PROBE_CHATS,
    select: {
      remoteJid: true,
      lastMessageAt: true,
      contact: { select: { remoteJid: true, lidJid: true, phone: true } },
    },
  })

  for (const c of convos) {
    const remoteJid = c.contact?.remoteJid || c.remoteJid
    if (!remoteJid || String(remoteJid).endsWith("@g.us")) continue
    const alternateJids = [
      c.contact?.lidJid,
      c.contact?.phone ? `${String(c.contact.phone).replace(/\D/g, "")}@s.whatsapp.net` : null,
    ].filter(Boolean)
    try {
      const fetched = await fetchChatMessages(row.instanceName, remoteJid, {
        page: 1,
        pageSize: 15,
        alternateJids,
      })
      const records = Array.isArray(fetched?.records)
        ? fetched.records
        : (() => {
            const { normalizeEvolutionMessages } = require("./evolutionMessages")
            return normalizeEvolutionMessages(fetched?.payload || fetched)
          })()
      const evoMs = extractNewestMessageMs(records)
      const baseline = Math.max(
        crmNewestMs,
        c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0,
      )
      if (evoMs && evoMs > baseline + ZOMBIE_GAP_MS) {
        return {
          proven: true,
          reason: "findMessages",
          sampleJid: remoteJid,
          evoNewestMs: evoMs,
          crmNewestMs: baseline,
          gapMs: evoMs - baseline,
        }
      }
    } catch (err) {
      console.warn(`[sync-health] zombie probe msg ${remoteJid}:`, err?.message || err)
    }
  }

  return { proven: false, reason: "no_gap", crmNewestMs }
}

async function newestCrmMessageTimestamp(prisma, userId) {
  const row = await prisma.crmMessage.findFirst({
    where: { userId },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  return row?.timestamp || null
}

/**
 * Referência de silêncio: usa o MENOR entre lastWebhookAt "vivo" e a msg mais nova no CRM.
 * Assim replay antigo que atualiza createdAt não esconde zombie.
 */
function silenceReferenceMs(conn) {
  const webhookMs = conn.lastWebhookAt ? new Date(conn.lastWebhookAt).getTime() : 0
  const newestMsgMs = conn.newestMsgAt ? new Date(conn.newestMsgAt).getTime() : 0
  const createdMs = conn.createdAt ? new Date(conn.createdAt).getTime() : 0

  // Se temos timestamp de msg no CRM, ele manda (é o que a UI mostra).
  if (newestMsgMs) {
    // lastWebhookAt só conta se for mais antigo que a msg (sinal adicional de silêncio de evento).
    // Se webhook está "fresco" mas msg está velha → replay → usa newestMsgMs.
    if (webhookMs && webhookMs > newestMsgMs + 5 * 60 * 1000) {
      return newestMsgMs
    }
    return Math.min(webhookMs || newestMsgMs, newestMsgMs)
  }
  return webhookMs || createdMs || 0
}

/** Hora local (0–23) em America/Sao_Paulo (ou TZ configurado). */
function localHourInBusinessTz(now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_HOURS_TZ,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(now))
    const hour = Number(parts.find((p) => p.type === "hour")?.value)
    return Number.isFinite(hour) ? hour % 24 : new Date(now).getHours()
  } catch {
    return new Date(now).getHours()
  }
}

function isBusinessHours(now = Date.now()) {
  if (!BUSINESS_HOURS_ENABLED) return false
  const hour = localHourInBusinessTz(now)
  return hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END
}

/** Limiar de silêncio efetivo (comercial mais curto só com flag ligada). */
function effectiveWebhookSilenceMs(now = Date.now()) {
  if (isBusinessHours(now)) {
    return Math.min(WEBHOOK_SILENCE_MS, Math.max(5 * 60 * 1000, WEBHOOK_SILENCE_BUSINESS_MS))
  }
  return WEBHOOK_SILENCE_MS
}

function shouldEvaluateStale(conn, now = Date.now()) {
  if (!conn?.connected || !conn.instanceName) return false
  if (conn.status === NUMBER_CONFLICT_STATUS) return false
  const status = String(conn.status || "").toUpperCase()
  if (status === "CONNECTING" || status === "QRCODE") return false
  if (String(conn.syncHealth || "").toUpperCase() === SYNC_HEALTH.RECOVERING) {
    const last = conn.staleLastRecoveryAt ? new Date(conn.staleLastRecoveryAt).getTime() : 0
    if (last && now - last < RECOVERY_COOLDOWN_MS) return false
  }
  const ref = silenceReferenceMs(conn)
  if (!ref) return false
  const age = now - ref
  if (!conn.lastWebhookAt && !conn.newestMsgAt && age < NEW_CONNECTION_GRACE_MS) return false
  return age >= effectiveWebhookSilenceMs(now)
}

async function backfillRecentCrmAfterRecovery(deps, { userId, instanceName, sinceMs }) {
  if (!userId || !instanceName) return { skipped: true, reason: "missing" }
  if (activeBackfills.has(userId)) {
    pendingBackfill.add(userId)
    return { skipped: true, reason: "busy" }
  }

  const { prisma, io } = deps
  activeBackfills.add(userId)
  const cutoffMs = Date.now() - (sinceMs || BACKFILL_LOOKBACK_MS)
  let importedTotal = 0
  let chatsTried = 0
  let evolutionHost = deps?.evolutionHost || "primary"

  try {
    const conn = await prisma.whatsAppConnection.findUnique({ where: { userId } })
    if (!conn?.connected) return { skipped: true, reason: "disconnected" }
    evolutionHost = conn.evolutionHost || evolutionHost
    bindInstanceHost(instanceName, evolutionHost)

    // Preferir conversas recentes do CRM (Evo muitas vezes não persiste findChats).
    // Evitar `{ not: null }` no Prisma 6 — filtrar remoteJid em JS.
    const recentConvos = await prisma.crmConversation.findMany({
      where: {
        userId,
        lastMessageAt: { gte: new Date(cutoffMs - 7 * 24 * 3600e3) },
      },
      orderBy: { lastMessageAt: "desc" },
      take: BACKFILL_CHAT_LIMIT * 2,
      select: {
        remoteJid: true,
        contact: { select: { remoteJid: true, lidJid: true, phone: true } },
      },
    })

    let targets = recentConvos
      .map((c) => ({
        remoteJid: c.contact?.remoteJid || c.remoteJid,
        alternateJids: [c.contact?.lidJid, c.contact?.phone ? `${String(c.contact.phone).replace(/\D/g, "")}@s.whatsapp.net` : null].filter(
          Boolean,
        ),
      }))
      .filter((t) => t.remoteJid && !String(t.remoteJid).endsWith("@g.us"))
      .slice(0, BACKFILL_CHAT_LIMIT)

    let api = crmSyncApi()
    let syncSingleChat = api?.syncSingleChat
    let extractIndividualChats = api?.extractIndividualChats
    // Fallback: re-require se circular dep ainda deixar export incompleto.
    if (typeof syncSingleChat !== "function") {
      try {
        delete require.cache[require.resolve("./crmSync")]
        api = require("./crmSync")
        syncSingleChat = api?.syncSingleChat
        extractIndividualChats = api?.extractIndividualChats
      } catch (err) {
        console.warn(`[sync-health] crmSync re-require failed:`, err?.message || err)
      }
    }
    if (typeof syncSingleChat !== "function") {
      console.error(`[sync-health] backfill aborted ${instanceName}: syncSingleChat unavailable`)
      const { recordZombieEvent } = require("./zombieEvents")
      await recordZombieEvent(prisma, {
        instanceName,
        userId,
        host: evolutionHost,
        eventType: "backfill",
        proofReason: "syncSingleChat_unavailable",
        outcome: "failed",
        messagesRecovered: 0,
      })
      return { ok: false, error: "syncSingleChat_unavailable", chatsTried: 0, importedTotal: 0 }
    }

    if (!targets.length && typeof extractIndividualChats === "function") {
      try {
        const raw = await findChats(instanceName, { limit: 500 })
        targets = extractIndividualChats(raw)
          .slice(0, BACKFILL_CHAT_LIMIT)
          .map((c) => ({
            remoteJid: c.remoteJid,
            alternateJids: c.remoteJidAlt ? [c.remoteJidAlt] : [],
          }))
      } catch (err) {
        console.warn(`[sync-health] findChats backfill ${instanceName}:`, err?.message || err)
      }
    }

    const syncDeps = {
      prisma,
      io,
      fetchChatMessages,
      findChats,
      findContacts: deps?.findContacts,
      findChatsPaginated: deps?.findChatsPaginated,
    }

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i]
      chatsTried += 1
      try {
        const result = await syncSingleChat(syncDeps, {
          userId,
          instanceName,
          remoteJid: t.remoteJid,
          cutoffMs,
          alternateJids: t.alternateJids || [],
        })
        importedTotal += Number(result?.imported) || 0
      } catch (err) {
        console.warn(`[sync-health] backfill chat ${t.remoteJid}:`, err?.message || err)
      }
      if (i < targets.length - 1) await wait(BACKFILL_CHAT_DELAY_MS)
    }

    console.log(
      JSON.stringify({
        tag: "sync-health",
        action: "backfill",
        instance: instanceName,
        chatsTried,
        messagesRecovered: importedTotal,
      }),
    )
    try {
      const { recordZombieEvent } = require("./zombieEvents")
      await recordZombieEvent(prisma, {
        instanceName,
        userId,
        host: evolutionHost,
        eventType: "backfill",
        proofReason: "post_recovery",
        outcome: importedTotal > 0 ? "recovered" : "empty",
        messagesRecovered: importedTotal,
        meta: { chatsTried },
      })
    } catch {
      /* ignore */
    }
    return { ok: true, chatsTried, importedTotal, messagesRecovered: importedTotal }
  } catch (err) {
    console.error(`[sync-health] backfill failed ${instanceName}:`, err?.message || err)
    return { ok: false, error: err?.message || String(err) }
  } finally {
    activeBackfills.delete(userId)
    if (pendingBackfill.has(userId)) {
      pendingBackfill.delete(userId)
      setTimeout(() => {
        void backfillRecentCrmAfterRecovery(deps, { userId, instanceName, sinceMs }).catch(() => {})
      }, 5000)
    }
  }
}

/**
 * @param {object} ctx
 * @param {import('@prisma/client').PrismaClient} ctx.prisma
 * @param {(userId: string, event: string, payload: any) => void} ctx.emitWhatsAppToUser
 * @param {(conn: any, groupsCount?: number) => object} ctx.formatConnectionPayload
 * @param {(userId: string, existing: any, opts?: object) => Promise<any>} ctx.markConnectionDisconnected
 */
async function seedLastWebhookAtFromCrm(prisma, row) {
  if (row.lastWebhookAt) return row
  // Seed pelo timestamp da msg (não createdAt) — evita baseline "agora" via replay.
  const newest = await prisma.crmMessage.findFirst({
    where: { userId: row.userId },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  const seedAt = newest?.timestamp || row.lastSync || null
  if (!seedAt) return row
  const updated = await prisma.whatsAppConnection.update({
    where: { userId: row.userId },
    data: {
      lastWebhookAt: seedAt,
      syncHealth:
        String(row.syncHealth || "").toUpperCase() === SYNC_HEALTH.UNKNOWN
          ? SYNC_HEALTH.HEALTHY
          : row.syncHealth,
    },
  })
  return { ...row, ...updated, newestMsgAt: newest?.timestamp || null }
}

async function runWhatsappSyncHealthWatchdog(ctx) {
  const { prisma, emitWhatsAppToUser, formatConnectionPayload, markConnectionDisconnected } = ctx
  const now = Date.now()

  const connections = await prisma.whatsAppConnection.findMany({
    where: {
      connected: true,
      // instanceName é obrigatório no schema — não usar `{ not: null }` (quebra no Prisma 6).
      status: { not: NUMBER_CONFLICT_STATUS },
    },
    select: {
      userId: true,
      instanceName: true,
      evolutionHost: true,
      status: true,
      connected: true,
      phone: true,
      qrCode: true,
      lastSync: true,
      lastWebhookAt: true,
      syncHealth: true,
      staleDetectedAt: true,
      staleRecoveryCount: true,
      staleLastRecoveryAt: true,
      createdAt: true,
      groupSyncStatus: true,
      groupSyncProgress: true,
      groupSyncMessage: true,
      groupSyncError: true,
      msgImportStatus: true,
      msgImportTotal: true,
      msgImportDone: true,
      msgImportMessage: true,
      msgImportError: true,
      msgImportRetryAfter: true,
    },
    take: WATCHDOG_BATCH,
    orderBy: [{ lastWebhookAt: "asc" }, { updatedAt: "asc" }],
  })

  let checked = 0
  let markedStale = 0
  let recovering = 0
  let forcedDisconnect = 0
  let seeded = 0

  for (const raw of connections) {
    checked += 1
    let row = raw
    if (!row.lastWebhookAt) {
      row = await seedLastWebhookAtFromCrm(prisma, row)
      if (row.lastWebhookAt) seeded += 1
      // Após seed, só avalia no próximo tick (evita storm de restart no deploy).
      continue
    }

    const newestMsgAt = await newestCrmMessageTimestamp(prisma, row.userId)
    row = { ...row, newestMsgAt }

    const health = String(row.syncHealth || SYNC_HEALTH.UNKNOWN).toUpperCase()
    const unhealthy = health === SYNC_HEALTH.STALE || health === SYNC_HEALTH.RECOVERING
    // Contas já STALE/RECOVERING entram mesmo sem silêncio longo (ex.: outbound manual
    // refresca newestMsgAt e esconderia o clear de falso positivo).
    if (!shouldEvaluateStale(row, now) && !unhealthy) continue

    const active = await accountLooksActive(prisma, row.userId)
    const contactCount = await prisma.crmContact
      .count({ where: { userId: row.userId } })
      .catch(() => 0)
    // Conta madura (muitos contatos) + silêncio longo: CRM quieto PODE ser o próprio zombie.
    // Antes pulávamos por "sem tráfego esperado" e o Luis ficava 3–4h congelado.
    const matureAccount = contactCount >= EMPTY_STORE_CONTACT_MIN
    if (!active && !unhealthy && !matureAccount) continue

    const probe = await probeEvolutionStillOpen(row.instanceName, row.evolutionHost)
    const recoveryCount = Number(row.staleRecoveryCount || 0)
    const scheduleBackfill = typeof ctx.scheduleBackfill === "function" ? ctx.scheduleBackfill : null

    // --- Híbrido (padrão): só soft-restart com prova DURA (Evo > CRM | empty_store) ---
    if (!AUTO_RECOVER) {
      if (!probe.open) {
        console.warn(
          `[sync-health] hybrid evo-not-open ${row.instanceName} status=${probe.status || probe.reason || "n/a"} (keep-alive/reconcile)`,
        )
        continue
      }

      // Cooldown entre soft-restarts
      if (health === SYNC_HEALTH.RECOVERING) {
        const last = row.staleLastRecoveryAt ? new Date(row.staleLastRecoveryAt).getTime() : 0
        if (last && now - last < RECOVERY_COOLDOWN_MS) continue
      }

      const proof = await proveEvolutionAheadOfCrm(prisma, row)
      const hard = isHardZombieProof(proof)

      if (!hard) {
        const silenceRef =
          silenceReferenceMs(row) ||
          (row.newestMsgAt ? new Date(row.newestMsgAt).getTime() : 0) ||
          now
        const expectedTraffic = await accountHasExpectedTraffic(prisma, row.userId)
        const baseline = await accountHadBaselineTraffic(prisma, row.userId, silenceRef)
        const hotAccount =
          expectedTraffic ||
          baseline.hot ||
          (matureAccount && baseline.count >= Math.ceil(MUTUAL_FREEZE_MIN_MSGS / 2))

        // Conta quieta de verdade → pode limpar falso STALE.
        if (!hotAccount) {
          if (unhealthy) {
            const cleared = await prisma.whatsAppConnection.update({
              where: { userId: row.userId },
              data: {
                syncHealth: SYNC_HEALTH.HEALTHY,
                staleDetectedAt: null,
                staleRecoveryCount: 0,
                staleLastRecoveryAt: null,
              },
            })
            emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(cleared))
            console.warn(`[sync-health] cleared quiet ${row.instanceName} (sem baseline quente — tira falso STALE)`)
          } else {
            console.warn(
              `[sync-health] skip quiet ${row.instanceName} silenceMs=${now - silenceRef} baseline=${baseline.count}`,
            )
          }
          continue
        }

        // Conta quente + open + silêncio + sem prova dura ainda:
        // NÃO limpar pra HEALTHY (falso positivo Outlet). Mantém observação.
        console.warn(
          JSON.stringify({
            tag: "sync-health",
            action: "hold_hot_silence",
            instance: row.instanceName,
            proof: proof?.reason || "no_gap",
            silenceMs: now - silenceRef,
            baselineMsgs: baseline.count,
            unhealthy,
            message: "não limpa HEALTHY — aguarda mutual_freeze/gap ou mensagem realtime",
          }),
        )
        continue
      }

      console.warn(
        JSON.stringify({
          tag: "sync-health",
          action: "zombie_proven",
          instance: row.instanceName,
          proof: proof.reason,
          gapMs: proof.gapMs || null,
          jid: proof.sampleJid || null,
          contactCount: proof.contactCount || null,
          baselineMsgs: proof.baselineMsgs || null,
          silenceMs: now - silenceReferenceMs(row),
        }),
      )

      try {
        const { recordZombieEvent } = require("./zombieEvents")
        await recordZombieEvent(prisma, {
          instanceName: row.instanceName,
          userId: row.userId,
          host: row.evolutionHost || "primary",
          eventType: String(proof.reason || "zombie"),
          proofReason: proof.reason,
          outcome: "proven",
          softRestartsTried: recoveryCount,
          meta: {
            gapMs: proof.gapMs || null,
            sampleJid: proof.sampleJid || null,
            contactCount: proof.contactCount || null,
            baselineMsgs: proof.baselineMsgs || null,
          },
        })
      } catch {
        /* ignore */
      }

      // empty_store / mutual_freeze: soft-restart quase nunca basta → 1 tentativa → banner QR.
      const maxRecoveries = ONE_SHOT_RECOVERY_REASONS.has(proof.reason) ? 1 : MAX_SOFT_RECOVERIES

      if (recoveryCount < maxRecoveries) {
        recovering += 1
        const recoveringConn = await prisma.whatsAppConnection.update({
          where: { userId: row.userId },
          data: {
            syncHealth: SYNC_HEALTH.RECOVERING,
            staleDetectedAt: row.staleDetectedAt || new Date(),
            staleRecoveryCount: recoveryCount + 1,
            staleLastRecoveryAt: new Date(),
          },
        })
        emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(recoveringConn))

        bindInstanceHost(row.instanceName, row.evolutionHost || "primary")
        let restartOk = false
        try {
          await restartInstance(row.instanceName)
          restartOk = true
          console.warn(
            JSON.stringify({
              tag: "sync-health",
              action: "restart",
              mode: "hybrid",
              instance: row.instanceName,
              proof: proof.reason,
              attempt: recoveryCount + 1,
              max: maxRecoveries,
            }),
          )
        } catch (err) {
          console.warn(`[sync-health] restart failed ${row.instanceName}:`, err?.message || err)
        }

        await wait(2500)
        const hook = await reassertInstanceWebhook(row.instanceName)
        if (!hook.ok && !hook.skipped) {
          console.warn(`[sync-health] webhook reassert failed ${row.instanceName}:`, hook.error)
        }
        const post = await probeEvolutionStillOpen(row.instanceName, row.evolutionHost)
        if (post.open && scheduleBackfill) {
          scheduleBackfill(row.userId, row.instanceName, `zombie-soft-restart:${proof.reason}`)
        } else if (!post.open) {
          console.warn(
            `[sync-health] pós-restart não-open ${row.instanceName} — mantém connected=false via keep-alive/reconcile (sem logout)`,
          )
        }
        try {
          const { recordZombieEvent } = require("./zombieEvents")
          await recordZombieEvent(prisma, {
            instanceName: row.instanceName,
            userId: row.userId,
            host: row.evolutionHost || "primary",
            eventType: "soft_restart",
            proofReason: proof.reason,
            outcome: restartOk && post.open ? "soft_restart_ok" : "soft_restart_failed",
            softRestartsTried: recoveryCount + 1,
            meta: { postOpen: Boolean(post.open), maxRecoveries },
          })
        } catch {
          /* ignore */
        }
        continue
      }

      // Soft-restarts esgotados COM prova dura: aí sim alerta UI (sem logout).
      markedStale += 1
      const conn = await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: {
          syncHealth: SYNC_HEALTH.STALE,
          staleDetectedAt: row.staleDetectedAt || new Date(),
          // needsManualReconnect exige >= MAX_SOFT_RECOVERIES (mesmo se empty_store usou max=1)
          staleRecoveryCount: Math.max(recoveryCount, MAX_SOFT_RECOVERIES),
        },
      })
      console.error(
        JSON.stringify({
          tag: "sync-health",
          action: "stale",
          instance: row.instanceName,
          proof: proof.reason,
          recoveries: recoveryCount,
          message: "alert UI reconnect — soft-restart esgotado",
        }),
      )
      emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(conn))
      try {
        const { recordZombieEvent } = require("./zombieEvents")
        await recordZombieEvent(prisma, {
          instanceName: row.instanceName,
          userId: row.userId,
          host: row.evolutionHost || "primary",
          eventType: "banner_qr",
          proofReason: proof.reason,
          outcome: "banner_qr",
          softRestartsTried: Math.max(recoveryCount, MAX_SOFT_RECOVERIES),
        })
      } catch {
        /* ignore */
      }
      try {
        const { sendZombieExternalAlert } = require("./zombieAlerts")
        await sendZombieExternalAlert(
          { prisma },
          {
            userId: row.userId,
            instanceName: row.instanceName,
            host: row.evolutionHost || "primary",
            proofReason: proof.reason,
            softRestartsTried: Math.max(recoveryCount, MAX_SOFT_RECOVERIES),
          },
        )
      } catch (err) {
        console.warn("[sync-health] external alert:", err?.message || err)
      }
      continue
    }

    // --- Modo agressivo (WHATSAPP_STALE_AUTO_RECOVER=true) ---
    if (!probe.open) {
      forcedDisconnect += 1
      console.warn(
        `[sync-health] evo-not-open ${row.instanceName} probed=${probe.probed} status=${probe.status || probe.reason || "n/a"} → disconnect`,
      )
      const disconnected = await markConnectionDisconnected(row.userId, row, { clearQr: true })
      await prisma.whatsAppConnection
        .update({
          where: { userId: row.userId },
          data: {
            syncHealth: SYNC_HEALTH.UNKNOWN,
            staleDetectedAt: row.staleDetectedAt || new Date(),
          },
        })
        .catch(() => {})
      emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(disconnected))
      continue
    }

    if (health !== SYNC_HEALTH.STALE && health !== SYNC_HEALTH.RECOVERING) {
      const conn = await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: {
          syncHealth: SYNC_HEALTH.STALE,
          staleDetectedAt: row.staleDetectedAt || new Date(),
        },
      })
      markedStale += 1
      console.warn(
        `[sync-health] STALE ${row.instanceName} silenceMs=${now - silenceReferenceMs(row)} lastWebhook=${row.lastWebhookAt?.toISOString?.() || "never"} newestMsg=${newestMsgAt?.toISOString?.() || "never"}`,
      )
      emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(conn))
      row.syncHealth = SYNC_HEALTH.STALE
      row.staleDetectedAt = conn.staleDetectedAt
    }

    if (recoveryCount < MAX_SOFT_RECOVERIES) {
      recovering += 1
      const recoveringConn = await prisma.whatsAppConnection.update({
        where: { userId: row.userId },
        data: {
          syncHealth: SYNC_HEALTH.RECOVERING,
          staleDetectedAt: row.staleDetectedAt || new Date(),
          staleRecoveryCount: recoveryCount + 1,
          staleLastRecoveryAt: new Date(),
        },
      })
      emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(recoveringConn))

      bindInstanceHost(row.instanceName, row.evolutionHost || "primary")
      try {
        await restartInstance(row.instanceName)
        console.warn(
          JSON.stringify({
            tag: "sync-health",
            action: "restart",
            mode: "aggressive",
            instance: row.instanceName,
            attempt: recoveryCount + 1,
            max: MAX_SOFT_RECOVERIES,
          }),
        )
      } catch (err) {
        console.warn(`[sync-health] restart failed ${row.instanceName}:`, err?.message || err)
      }

      await wait(2500)
      const hookAgg = await reassertInstanceWebhook(row.instanceName)
      if (!hookAgg.ok && !hookAgg.skipped) {
        console.warn(`[sync-health] webhook reassert failed ${row.instanceName}:`, hookAgg.error)
      }
      const post = await probeEvolutionStillOpen(row.instanceName, row.evolutionHost)
      if (!post.open) {
        console.warn(`[sync-health] pós-restart não-open ${row.instanceName} → disconnect`)
        forcedDisconnect += 1
        const disconnected = await markConnectionDisconnected(row.userId, row, { clearQr: true })
        await prisma.whatsAppConnection
          .update({
            where: { userId: row.userId },
            data: { syncHealth: SYNC_HEALTH.UNKNOWN },
          })
          .catch(() => {})
        emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(disconnected))
      } else if (scheduleBackfill) {
        scheduleBackfill(row.userId, row.instanceName, "aggressive-soft-restart")
      }
      continue
    }

    const stillOpen = await probeEvolutionStillOpen(row.instanceName, row.evolutionHost)
    if (!stillOpen.open) {
      forcedDisconnect += 1
      console.warn(
        `[sync-health] recoveries esgotadas mas evo já fechou ${row.instanceName} → disconnect sem logout`,
      )
      const disconnected = await markConnectionDisconnected(row.userId, row, { clearQr: true })
      await prisma.whatsAppConnection
        .update({
          where: { userId: row.userId },
          data: { syncHealth: SYNC_HEALTH.UNKNOWN, staleDetectedAt: row.staleDetectedAt || new Date() },
        })
        .catch(() => {})
      emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(disconnected))
      continue
    }

    forcedDisconnect += 1
    console.error(
      `[sync-health] forcing disconnect ${row.instanceName} after ${recoveryCount} recoveries (zombie open)`,
    )
    bindInstanceHost(row.instanceName, row.evolutionHost || "primary")
    await logoutInstance(row.instanceName).catch((err) => {
      console.warn(`[sync-health] logout ${row.instanceName}:`, err?.message || err)
    })
    const disconnected = await markConnectionDisconnected(row.userId, row, { clearQr: true })
    await prisma.whatsAppConnection
      .update({
        where: { userId: row.userId },
        data: {
          syncHealth: SYNC_HEALTH.UNKNOWN,
          staleDetectedAt: row.staleDetectedAt || new Date(),
        },
      })
      .catch(() => {})
    emitWhatsAppToUser(row.userId, "whatsapp:status", formatConnectionPayload(disconnected))
  }

  if (markedStale || recovering || forcedDisconnect || seeded) {
    console.warn(
      `[sync-health] watchdog checked=${checked} seeded=${seeded} stale=${markedStale} recovering=${recovering} disconnected=${forcedDisconnect}`,
    )
  }

  return { checked, seeded, markedStale, recovering, forcedDisconnect }
}

/**
 * Após CLOSE real: tenta restart da instância (sem logout) para voltar online sem QR.
 * Cooldown por instância para não loopar.
 */
async function tryKeepAliveAfterClose(deps, { userId, instanceName, evolutionHost }) {
  if (!KEEP_ALIVE_ENABLED || !instanceName || !userId) {
    return { attempted: false, reason: "disabled_or_missing" }
  }
  const failStreak = keepAliveFailStreak.get(instanceName) || 0
  const cooldown = KEEP_ALIVE_COOLDOWN_MS * Math.min(4, 1 + failStreak)
  const last = keepAliveLastAt.get(instanceName) || 0
  const now = Date.now()
  if (now - last < cooldown) {
    return { attempted: false, reason: "cooldown" }
  }
  keepAliveLastAt.set(instanceName, now)

  const { prisma, emitWhatsAppToUser, formatConnectionPayload } = deps

  await prisma.whatsAppConnection
    .update({
      where: { userId },
      data: {
        syncHealth: SYNC_HEALTH.RECOVERING,
        staleLastRecoveryAt: new Date(),
      },
    })
    .catch(() => {})

  bindInstanceHost(instanceName, evolutionHost || "primary")
  console.warn(`[sync-health] keep-alive restart ${instanceName}`)
  try {
    await restartInstance(instanceName)
  } catch (err) {
    console.warn(`[sync-health] keep-alive restart failed ${instanceName}:`, err?.message || err)
    return { attempted: true, ok: false, error: err?.message || String(err) }
  }

  await wait(2500)
  const probe = await probeEvolutionStillOpen(instanceName, evolutionHost)
  if (probe.open) {
    keepAliveFailStreak.delete(instanceName)
    const conn = await prisma.whatsAppConnection.update({
      where: { userId },
      data: {
        connected: true,
        status: "OPEN",
        qrCode: null,
        // Não marca HEALTHY aqui — só webhook realtime prova sync viva (anti falso-positivo).
        syncHealth: SYNC_HEALTH.RECOVERING,
        staleLastRecoveryAt: new Date(),
        lastSync: new Date(),
      },
    })
    if (emitWhatsAppToUser && formatConnectionPayload) {
      emitWhatsAppToUser(userId, "whatsapp:status", formatConnectionPayload(conn))
    }
    console.warn(`[sync-health] keep-alive ok ${instanceName}`)
    return { attempted: true, ok: true, conn }
  }

  keepAliveFailStreak.set(instanceName, failStreak + 1)
  await prisma.whatsAppConnection
    .update({
      where: { userId },
      data: { syncHealth: SYNC_HEALTH.UNKNOWN },
    })
    .catch(() => {})
  console.warn(
    `[sync-health] keep-alive ainda fechado ${instanceName} — precisa QR (failStreak=${failStreak + 1})`,
  )
  return { attempted: true, ok: false, reason: "still_closed" }
}

/**
 * Contas connected com silêncio de webhook acima do limiar (alerta admin / ops).
 * Não reinicia sessão — só inventário para /admin/crm-sync-health.
 */
async function getWebhookSilenceAlerts(prisma, { limit = 25, now = Date.now() } = {}) {
  const rows = await prisma.whatsAppConnection.findMany({
    where: {
      connected: true,
      status: { not: NUMBER_CONFLICT_STATUS },
    },
    select: {
      userId: true,
      instanceName: true,
      phone: true,
      status: true,
      connected: true,
      lastWebhookAt: true,
      syncHealth: true,
      staleDetectedAt: true,
      staleRecoveryCount: true,
      staleLastRecoveryAt: true,
      createdAt: true,
    },
    orderBy: [{ lastWebhookAt: "asc" }, { updatedAt: "asc" }],
    take: Math.max(limit * 4, 40),
  })

  const alerts = []
  for (const raw of rows) {
    const newestMsgAt = await newestCrmMessageTimestamp(prisma, raw.userId)
    const conn = { ...raw, newestMsgAt }
    const health = String(conn.syncHealth || SYNC_HEALTH.UNKNOWN).toUpperCase()
    const unhealthy = health === SYNC_HEALTH.STALE || health === SYNC_HEALTH.RECOVERING
    if (!shouldEvaluateStale(conn, now) && !unhealthy) continue

    const expectedTraffic = await accountHasExpectedTraffic(prisma, raw.userId).catch(() => false)
    // Conta quieta sem tráfego esperado: não é alerta (silêncio legítimo).
    if (!expectedTraffic && !unhealthy) continue

    const ref = silenceReferenceMs(conn)
    const silenceAgeMs = ref ? Math.max(0, now - ref) : null
    const user = await prisma.user.findUnique({
      where: { id: raw.userId },
      select: { email: true, name: true },
    })
    alerts.push({
      userId: raw.userId,
      email: user?.email || null,
      name: user?.name || null,
      instanceName: raw.instanceName,
      phone: raw.phone || null,
      status: raw.status,
      syncHealth: health,
      staleRecoveryCount: Number(raw.staleRecoveryCount || 0),
      needsManualReconnect: needsManualReconnect(conn),
      lastWebhookAt: raw.lastWebhookAt,
      newestMsgAt,
      silenceAgeMs,
      silenceAgeMin: silenceAgeMs != null ? Math.round(silenceAgeMs / 60000) : null,
      expectedTraffic: Boolean(expectedTraffic),
      alert:
        unhealthy || needsManualReconnect(conn)
          ? "zombie_or_stale"
          : "webhook_silence",
    })
    if (alerts.length >= limit) break
  }

  alerts.sort((a, b) => (b.silenceAgeMs || 0) - (a.silenceAgeMs || 0))
  return {
    thresholdMs: WEBHOOK_SILENCE_MS,
    thresholdMin: Math.round(WEBHOOK_SILENCE_MS / 60000),
    silentAccounts: alerts.length,
    alerts,
  }
}

module.exports = {
  SYNC_HEALTH,
  WEBHOOK_SILENCE_MS,
  WEBHOOK_SILENCE_BUSINESS_MS,
  BUSINESS_HOURS_ENABLED,
  BUSINESS_HOUR_START,
  BUSINESS_HOUR_END,
  TRAFFIC_EXPECT_MS,
  RECOVERY_COOLDOWN_MS,
  REALTIME_MAX_AGE_MS,
  ZOMBIE_GAP_MS,
  EMPTY_STORE_CONTACT_MIN,
  hostPersistsChats,
  MUTUAL_FREEZE_SILENCE_MS,
  MUTUAL_FREEZE_BASELINE_MS,
  MUTUAL_FREEZE_MIN_MSGS,
  MUTUAL_FREEZE_ALIGN_MS,
  ONE_SHOT_RECOVERY_REASONS,
  AUTO_RECOVER,
  KEEP_ALIVE_ENABLED,
  MAX_SOFT_RECOVERIES,
  touchLastWebhookAt,
  markSyncHealthy,
  resetSyncHealthOnDisconnect,
  appendSyncHealthPayload,
  isHealthySync,
  isStaleSync,
  isRecoveringSync,
  isHardZombieProof,
  needsManualReconnect,
  syncHealthLabel,
  runWhatsappSyncHealthWatchdog,
  backfillRecentCrmAfterRecovery,
  tryKeepAliveAfterClose,
  proveEvolutionAheadOfCrm,
  accountLooksActive,
  accountHasExpectedTraffic,
  accountHadBaselineTraffic,
  countBaselineMessagesBeforeSilence,
  newestActivityMsFromRawChats,
  shouldEvaluateStale,
  silenceReferenceMs,
  effectiveWebhookSilenceMs,
  isBusinessHours,
  isRealtimeMessageMs,
  extractNewestMessageMs,
  getWebhookSilenceAlerts,
}

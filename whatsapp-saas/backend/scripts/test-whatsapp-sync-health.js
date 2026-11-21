/**
 * Testes unitários leves do watchdog de sync (sem DB/rede).
 * Uso: node scripts/test-whatsapp-sync-health.js
 */
const assert = require("assert")
const {
  shouldEvaluateStale,
  isHealthySync,
  isStaleSync,
  isRecoveringSync,
  isHardZombieProof,
  appendSyncHealthPayload,
  isRealtimeMessageMs,
  newestActivityMsFromRawChats,
  effectiveWebhookSilenceMs,
  isBusinessHours,
  SYNC_HEALTH,
  WEBHOOK_SILENCE_MS,
  WEBHOOK_SILENCE_BUSINESS_MS,
  BUSINESS_HOURS_ENABLED,
  REALTIME_MAX_AGE_MS,
  AUTO_RECOVER,
  MAX_SOFT_RECOVERIES,
  TRAFFIC_EXPECT_MS,
  RECOVERY_COOLDOWN_MS,
  MUTUAL_FREEZE_SILENCE_MS,
  MUTUAL_FREEZE_MIN_MSGS,
  ONE_SHOT_RECOVERY_REASONS,
  hostPersistsChats,
} = require("../src/lib/whatsappSyncHealth")
const { extractDisconnectCode } = require("../src/lib/zombieEvents")
const { alertConfig } = require("../src/lib/zombieAlerts")

function testShouldEvaluate() {
  const now = Date.now()
  assert.strictEqual(
    shouldEvaluateStale(
      {
        connected: true,
        instanceName: "x",
        status: "OPEN",
        syncHealth: "HEALTHY",
        lastWebhookAt: new Date(now - WEBHOOK_SILENCE_MS - 1000),
        newestMsgAt: new Date(now - WEBHOOK_SILENCE_MS - 1000),
        createdAt: new Date(now - 86400000),
      },
      now,
    ),
    true,
    "conta ativa com silêncio longo deve avaliar",
  )

  assert.strictEqual(
    shouldEvaluateStale(
      {
        connected: true,
        instanceName: "x",
        status: "OPEN",
        syncHealth: "HEALTHY",
        lastWebhookAt: new Date(now - 60_000),
        newestMsgAt: new Date(now - 60_000),
        createdAt: new Date(now - 86400000),
      },
      now,
    ),
    false,
    "silêncio curto não avalia",
  )

  // Replay: webhook "fresco" mas msg antiga → ainda STALE
  assert.strictEqual(
    shouldEvaluateStale(
      {
        connected: true,
        instanceName: "x",
        status: "OPEN",
        syncHealth: "HEALTHY",
        lastWebhookAt: new Date(now - 30_000),
        newestMsgAt: new Date(now - WEBHOOK_SILENCE_MS - 60_000),
        createdAt: new Date(now - 86400000),
      },
      now,
    ),
    true,
    "replay fresco com msg antiga deve avaliar stale",
  )

  assert.strictEqual(
    shouldEvaluateStale(
      {
        connected: true,
        instanceName: "x",
        status: "OPEN",
        syncHealth: "HEALTHY",
        lastWebhookAt: null,
        createdAt: new Date(now - 60_000),
      },
      now,
    ),
    false,
    "conexão nova sem webhook tem grace",
  )

  assert.strictEqual(
    shouldEvaluateStale(
      {
        connected: true,
        instanceName: "x",
        status: "NUMBER_CONFLICT",
        syncHealth: "HEALTHY",
        lastWebhookAt: new Date(now - WEBHOOK_SILENCE_MS * 3),
        createdAt: new Date(now - 86400000),
      },
      now,
    ),
    false,
    "conflito de número não avalia",
  )
}

function testRealtime() {
  const now = Date.now()
  assert.strictEqual(isRealtimeMessageMs(now - 60_000, now), true)
  assert.strictEqual(isRealtimeMessageMs(now - REALTIME_MAX_AGE_MS - 1000, now), false)
  assert.strictEqual(isRealtimeMessageMs(null, now), false)
}

function testHardProof() {
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "chat_activity" }), true)
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "findMessages" }), true)
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "empty_store_zombie" }), true)
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "mutual_freeze_zombie" }), true)
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "silence_open_traffic" }), false)
  assert.strictEqual(isHardZombieProof({ proven: true, reason: "empty_findChats_store" }), false)
  assert.strictEqual(isHardZombieProof({ proven: false, reason: "no_gap" }), false)
  assert.ok(ONE_SHOT_RECOVERY_REASONS.has("empty_store_zombie"))
  assert.ok(ONE_SHOT_RECOVERY_REASONS.has("mutual_freeze_zombie"))
  assert.ok(!ONE_SHOT_RECOVERY_REASONS.has("chat_activity"))
}

function testNewestFromRawChats() {
  const ts = Math.floor(Date.now() / 1000) - 3600
  const newest = newestActivityMsFromRawChats([
    {
      remoteJid: "120363@g.us",
      lastMessage: { messageTimestamp: ts },
    },
    {
      remoteJid: "5511999999999@s.whatsapp.net",
      updatedAt: new Date(Date.now() - 7200e3).toISOString(),
    },
  ])
  assert.ok(newest, "deve ler timestamp de grupo via lastMessage")
  assert.ok(Math.abs(newest - ts * 1000) < 2000)
}

function testLazyCrmSync() {
  // Garante que o require lazy resolve syncSingleChat (bug de produção).
  const crm = require("../src/lib/crmSync")
  assert.strictEqual(typeof crm.syncSingleChat, "function")
  assert.strictEqual(typeof crm.extractIndividualChats, "function")
  assert.strictEqual(typeof crm.cancelStuckCrmSyncJobs, "function")
  // Simula o caminho do backfill (lazy + typeof).
  const api = require("../src/lib/whatsappSyncHealth")
  assert.strictEqual(typeof api.backfillRecentCrmAfterRecovery, "function")
}

function testDisconnectExtract() {
  assert.strictEqual(extractDisconnectCode({ data: { statusReason: 440 } }), 440)
  assert.strictEqual(extractDisconnectCode({ data: { statusCode: 401 } }), 401)
  assert.strictEqual(
    extractDisconnectCode({ data: { error: { output: { statusCode: 515 } } } }),
    515,
  )
  assert.strictEqual(extractDisconnectCode({ message: "Timed Out 408" }), 408)
  assert.strictEqual(extractDisconnectCode({ data: { state: "open" } }), null)
}

function testBusinessHoursFlagDefaultOff() {
  assert.strictEqual(BUSINESS_HOURS_ENABLED, false, "business hours deve nascer desligado")
  assert.ok(WEBHOOK_SILENCE_BUSINESS_MS >= 10 * 60 * 1000)
  assert.ok(effectiveWebhookSilenceMs() >= WEBHOOK_SILENCE_MS - 1000 || isBusinessHours())
}

function testHostPersistChatsDefaults() {
  assert.strictEqual(hostPersistsChats("primary"), false, "Evo1/primary não persiste chats")
  assert.strictEqual(hostPersistsChats("secondary"), true, "Evo2/secondary persiste chats")
  assert.strictEqual(hostPersistsChats("canary"), true)
}

function testPayloadFlags() {
  const healthy = appendSyncHealthPayload({
    connected: true,
    status: "OPEN",
    syncHealth: SYNC_HEALTH.HEALTHY,
    lastWebhookAt: new Date(),
  })
  assert.strictEqual(healthy.syncHealthy, true)
  assert.strictEqual(healthy.stale, false)
  assert.strictEqual(healthy.recovering, false)

  const recovering = appendSyncHealthPayload({
    connected: true,
    status: "OPEN",
    syncHealth: SYNC_HEALTH.RECOVERING,
    lastWebhookAt: new Date(Date.now() - 3600e3),
  })
  // RECOVERING: não é banner de erro; UI usa recovering=true
  assert.strictEqual(isRecoveringSync(recovering), true)
  assert.strictEqual(recovering.recovering, true)
  assert.strictEqual(recovering.stale, false)
  assert.strictEqual(recovering.syncHealthy, true)
  assert.strictEqual(isStaleSync({ syncHealth: "RECOVERING" }), false)
  assert.strictEqual(isHealthySync({ connected: true, syncHealth: "RECOVERING" }), true)

  assert.strictEqual(isHealthySync({ connected: true, syncHealth: "UNKNOWN" }), true)

  if (!AUTO_RECOVER) {
    const staleObserve = appendSyncHealthPayload({
      connected: true,
      status: "OPEN",
      syncHealth: SYNC_HEALTH.STALE,
      staleRecoveryCount: 0,
      lastWebhookAt: new Date(Date.now() - 3600e3),
    })
    assert.strictEqual(staleObserve.syncHealthy, true)
    assert.strictEqual(staleObserve.stale, false)

    const staleFailed = appendSyncHealthPayload({
      connected: true,
      status: "OPEN",
      syncHealth: SYNC_HEALTH.STALE,
      staleRecoveryCount: MAX_SOFT_RECOVERIES,
      lastWebhookAt: new Date(Date.now() - 3600e3),
    })
    assert.strictEqual(staleFailed.syncHealthy, false)
    assert.strictEqual(staleFailed.stale, true)
  }
}

testShouldEvaluate()
testRealtime()
testHardProof()
testNewestFromRawChats()
testLazyCrmSync()
testDisconnectExtract()
testBusinessHoursFlagDefaultOff()
testHostPersistChatsDefaults()
testPayloadFlags()
assert.ok(WEBHOOK_SILENCE_MS >= 40 * 60 * 1000, "silêncio default deve ser >= 40min")
assert.ok(TRAFFIC_EXPECT_MS >= 60 * 60 * 1000, "tráfego esperado default >= 1h")
assert.ok(RECOVERY_COOLDOWN_MS >= 15 * 60 * 1000, "cooldown default >= 15min")
assert.ok(MUTUAL_FREEZE_SILENCE_MS >= 45 * 60 * 1000, "mutual freeze silence >= 45min")
assert.ok(MUTUAL_FREEZE_MIN_MSGS >= 10, "mutual freeze min msgs >= 10")
console.log(
  JSON.stringify(
    {
      ok: true,
      silenceMs: WEBHOOK_SILENCE_MS,
      silenceBusinessMs: WEBHOOK_SILENCE_BUSINESS_MS,
      businessHoursEnabled: BUSINESS_HOURS_ENABLED,
      trafficExpectMs: TRAFFIC_EXPECT_MS,
      recoveryCooldownMs: RECOVERY_COOLDOWN_MS,
      realtimeMaxAgeMs: REALTIME_MAX_AGE_MS,
      mutualFreezeSilenceMs: MUTUAL_FREEZE_SILENCE_MS,
      mutualFreezeMinMsgs: MUTUAL_FREEZE_MIN_MSGS,
      zombieAlertEnabled: alertConfig().enabled,
    },
    null,
    2,
  ),
)

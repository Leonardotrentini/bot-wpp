/**
 * Testes unitários do motor X1 (sem banco/Evolution).
 * Uso: node scripts/test-x1-automation.js
 */
const assert = require("assert")
const {
  normalizeX1Config,
  renderX1Template,
  parseParticipantsUpdatePayload,
  mapParticipantAction,
  isInQuietHours,
  computeScheduledAt,
  DEFAULT_X1_CONFIG,
} = require("../src/lib/groupX1Automation")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

console.log("\n[groupX1Automation] testes unitários\n")

test("normalizeX1Config aceita delay zero", () => {
  const cfg = normalizeX1Config({ minDelaySec: 0, maxDelaySec: 0 })
  assert.strictEqual(cfg.minDelaySec, 0)
  assert.strictEqual(cfg.maxDelaySec, 0)
})

test("normalizeX1Config aplica defaults", () => {
  const cfg = normalizeX1Config({ enabled: true, minDelaySec: 5, maxDelaySec: 2 })
  assert.strictEqual(cfg.minDelaySec, 5)
  assert.strictEqual(cfg.maxDelaySec, 5)
  assert.strictEqual(cfg.maxX1PerUser24h, DEFAULT_X1_CONFIG.maxX1PerUser24h)
})

test("renderX1Template substitui {{nome}}", () => {
  const out = renderX1Template("Oi {{nome}}, tudo bem?", { nome: "Maria" })
  assert.strictEqual(out, "Oi Maria, tudo bem?")
})

test("mapParticipantAction reconhece add/remove", () => {
  assert.strictEqual(mapParticipantAction("add"), "join")
  assert.strictEqual(mapParticipantAction("remove"), "leave")
  assert.strictEqual(mapParticipantAction("promote"), null)
})

test("parseParticipantsUpdatePayload extrai grupo e participantes", () => {
  const parsed = parseParticipantsUpdatePayload({
    data: {
      id: "120363@g.us",
      action: "add",
      participants: ["5511999999999@s.whatsapp.net"],
    },
  })
  assert.strictEqual(parsed.groupJid, "120363@g.us")
  assert.strictEqual(parsed.action, "join")
  assert.strictEqual(parsed.participants.length, 1)
  assert.strictEqual(parsed.participants[0].participantJid, "5511999999999@s.whatsapp.net")
})

test("isInQuietHours detecta janela noturna", () => {
  const cfg = normalizeX1Config({
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
  })
  const lateNight = new Date("2026-06-02T02:30:00-03:00")
  const afternoon = new Date("2026-06-02T15:00:00-03:00")
  assert.strictEqual(isInQuietHours(lateNight, cfg), true)
  assert.strictEqual(isInQuietHours(afternoon, cfg), false)
})

test("computeScheduledAt respeita delay mínimo", () => {
  const cfg = normalizeX1Config({
    quietHoursEnabled: false,
    minDelaySec: 10,
    maxDelaySec: 10,
  })
  const now = new Date("2026-06-02T12:00:00Z")
  const scheduled = computeScheduledAt(cfg, { now, skipDelay: false })
  assert.strictEqual(scheduled.getTime(), now.getTime() + 10_000)
})

console.log(`\nResultado: ${passed} ok, ${failed} falha(s)\n`)
process.exit(failed ? 1 : 0)

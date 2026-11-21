/**
 * Testes leves da sonda (sem rede/DB).
 * Uso: node scripts/test-whatsapp-socket-probe.js
 */
const assert = require("assert")
const {
  PROBE_ENABLED,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  PROBE_GAP_MS,
  PROBE_AS_HARD_PROOF,
  PROBE_HARD_PROOF_STREAK,
  getProbeHardProof,
  probeFailStreak,
  buildProbeReport,
} = require("../src/lib/whatsappSocketProbe")

assert.strictEqual(typeof PROBE_ENABLED, "boolean")
assert.ok(PROBE_INTERVAL_MS >= 60_000)
assert.ok(PROBE_TIMEOUT_MS <= 15_000)
assert.ok(PROBE_GAP_MS >= 500)
assert.strictEqual(PROBE_AS_HARD_PROOF, false, "hard proof deve nascer desligado")
assert.ok(PROBE_HARD_PROOF_STREAK >= 2)
assert.strictEqual(getProbeHardProof("x"), null)
probeFailStreak.set("x", PROBE_HARD_PROOF_STREAK)
assert.strictEqual(getProbeHardProof("x"), null, "ainda null com flag off")
probeFailStreak.delete("x")
assert.strictEqual(typeof buildProbeReport, "function")

console.log(
  JSON.stringify(
    {
      ok: true,
      intervalSec: PROBE_INTERVAL_MS / 1000,
      timeoutMs: PROBE_TIMEOUT_MS,
      gapMs: PROBE_GAP_MS,
      hardProof: PROBE_AS_HARD_PROOF,
    },
    null,
    2,
  ),
)

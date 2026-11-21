/**
 * Testes leves de zombieEvents / canary helpers (sem DB).
 * Uso: node scripts/test-zombie-events.js
 */
const assert = require("assert")
const { extractDisconnectCode, mapHostLabel } = require("../src/lib/zombieEvents")
const { alertConfig } = require("../src/lib/zombieAlerts")
const { CANARY_WINDOW_MS, CANARY_IDLE_GAP_MS } = require("../src/lib/canarySyncHealth")

assert.strictEqual(extractDisconnectCode({ data: { statusReason: 428 } }), 428)
assert.strictEqual(extractDisconnectCode({ data: { statusCode: 503 } }), 503)
assert.strictEqual(mapHostLabel("primary"), "Evo1")
assert.strictEqual(mapHostLabel("secondary"), "Evo2")
assert.ok(CANARY_WINDOW_MS >= 48 * 60 * 60 * 1000)
assert.ok(CANARY_IDLE_GAP_MS >= 15 * 60 * 1000)
assert.strictEqual(alertConfig().enabled, false)

console.log(JSON.stringify({ ok: true, canaryWindowH: CANARY_WINDOW_MS / 3600000 }, null, 2))

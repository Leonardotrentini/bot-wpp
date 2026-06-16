/**
 * Testes unitários — filtro de grupos plausíveis (fantasmas Evolution).
 * Uso: node scripts/test-group-discovery.js
 */
const assert = require("assert")
const { isPlausibleWhatsAppGroup, isJidLikeName } = require("../src/lib/groupDiscovery")

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

console.log("\ngroupDiscovery — testes unitários\n")

const ghostJid = "120363317378211775@g.us"

test("JID completo não é nome real", () => {
  assert.strictEqual(isJidLikeName(ghostJid, ghostJid), true)
})

test("ID numérico longo não é nome real", () => {
  assert.strictEqual(isJidLikeName("120363317378211775", ghostJid), true)
})

test("nome legível passa", () => {
  assert.strictEqual(isJidLikeName("GERAL - VESTO co.", ghostJid), false)
})

test("grupo fantasma (JID + 994 membros) é rejeitado", () => {
  assert.strictEqual(
    isPlausibleWhatsAppGroup({
      groupJid: ghostJid,
      name: ghostJid,
      memberCount: 994,
      raw: { id: ghostJid, size: 994 },
    }),
    false,
  )
})

test("grupo com subject real é aceito", () => {
  assert.strictEqual(
    isPlausibleWhatsAppGroup({
      groupJid: "120363@g.us",
      name: "Comunidade VIP",
      memberCount: 120,
      raw: { id: "120363@g.us", subject: "Comunidade VIP", size: 120 },
    }),
    true,
  )
})

test("grupo sem subject e 1 membro é rejeitado", () => {
  assert.strictEqual(
    isPlausibleWhatsAppGroup({
      groupJid: "999999999999@g.us",
      name: "999999999999@g.us",
      memberCount: 1,
    }),
    false,
  )
})

console.log(`\n${passed} passou, ${failed} falhou\n`)
process.exit(failed > 0 ? 1 : 0)

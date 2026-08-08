/**
 * Teste isolado da proteção contra número duplicado dentro da empresa.
 * Não toca no banco: valida a extração do número (ownerJid) e o casamento de dígitos.
 *
 * node scripts/test-number-conflict.js
 */
const assert = require("assert")
const { pickPhone } = require("../src/lib/evolution")
const { phoneDigitsFromValue, formatPhoneBr } = require("../src/lib/participantIdentity")

let ok = 0
function check(label, fn) {
  fn()
  ok += 1
  console.log(`  ok  ${label}`)
}

console.log("\npickPhone — formatos que a Evolution devolve:")

check("fetchInstances v2 (ownerJid na raiz)", () => {
  const info = { name: "vesto-x", ownerJid: "554792047214@s.whatsapp.net", profileName: "George" }
  assert.strictEqual(pickPhone(info), "554792047214@s.whatsapp.net")
})

check("fetchInstances v1 (instance.owner)", () => {
  const info = { instance: { instanceName: "vesto-x", owner: "554792843436@s.whatsapp.net" } }
  assert.strictEqual(pickPhone(info), "554792843436@s.whatsapp.net")
})

check("connectionState puro não traz número", () => {
  const state = { instance: { instanceName: "vesto-x", state: "open" } }
  assert.strictEqual(pickPhone(state), null)
})

check("webhook CONNECTION_UPDATE com ownerJid aninhado", () => {
  const payload = { instance: { ownerJid: "5547999999999@s.whatsapp.net", state: "open" } }
  assert.strictEqual(pickPhone(payload), "5547999999999@s.whatsapp.net")
})

console.log("\nphoneDigitsFromValue — normalização para comparação:")

check("jid e número cru batem", () => {
  assert.strictEqual(
    phoneDigitsFromValue("554792047214@s.whatsapp.net"),
    phoneDigitsFromValue("+55 (47) 9204-7214".replace(/\D/g, "")),
  )
})

check("números distintos não colidem", () => {
  assert.notStrictEqual(
    phoneDigitsFromValue("554792047214@s.whatsapp.net"),
    phoneDigitsFromValue("554792843436@s.whatsapp.net"),
  )
})

check("jid @lid não vira telefone", () => {
  assert.strictEqual(phoneDigitsFromValue("25500009373935@lid"), null)
})

check("formatação amigável para a mensagem de erro", () => {
  assert.strictEqual(formatPhoneBr(phoneDigitsFromValue("554792047214@s.whatsapp.net")), "+55 (47) 9204-7214")
})

console.log("\nCenário real (Baseset):")
const alessandra = pickPhone({ ownerJid: "554792843436@s.whatsapp.net" })
const georgeCerto = pickPhone({ ownerJid: "554792047214@s.whatsapp.net" })
const georgeErrado = pickPhone({ ownerJid: "554792843436@s.whatsapp.net" })

check("número próprio do George não dispara conflito", () => {
  assert.notStrictEqual(phoneDigitsFromValue(georgeCerto), phoneDigitsFromValue(alessandra))
})

check("QR lido com o celular da Alessandra dispara conflito", () => {
  assert.strictEqual(phoneDigitsFromValue(georgeErrado), phoneDigitsFromValue(alessandra))
})

console.log(`\n${ok} verificações passaram.\n`)

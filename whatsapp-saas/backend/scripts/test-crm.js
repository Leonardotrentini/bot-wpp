/**
 * Testes unitários — módulo CRM (helpers puros, sem banco).
 * Uso: node scripts/test-crm.js
 */
const assert = require("assert")
const { isIndividualJid, isLidJid, phoneFromJid, previewFromBody } = require("../src/lib/crmCore")
const {
  normalizeTrigger,
  keywordMatches,
  isWithinQuietHours,
  normalizeQuietHours,
  deliveryDelayMs,
} = require("../src/lib/crmFlows")
const { extractIndividualChats } = require("../src/lib/crmSync")
const { containsHandoffKeyword } = require("../src/lib/crmAiAgent")

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

console.log("\ncrm — testes unitários\n")

// ---------------- crmCore

test("isIndividualJid aceita @s.whatsapp.net e @lid, rejeita grupos", () => {
  assert.strictEqual(isIndividualJid("5511999999999@s.whatsapp.net"), true)
  assert.strictEqual(isIndividualJid("123456789@lid"), true)
  assert.strictEqual(isIndividualJid("120363317378211775@g.us"), false)
  assert.strictEqual(isIndividualJid(""), false)
  assert.strictEqual(isIndividualJid(null), false)
})

test("isLidJid identifica JIDs @lid", () => {
  assert.strictEqual(isLidJid("123@lid"), true)
  assert.strictEqual(isLidJid("5511999999999@s.whatsapp.net"), false)
})

test("phoneFromJid extrai telefone válido", () => {
  assert.strictEqual(phoneFromJid("5511999999999@s.whatsapp.net"), "5511999999999")
  assert.strictEqual(phoneFromJid("123@lid"), null) // lid não é telefone
  assert.strictEqual(phoneFromJid("12@s.whatsapp.net"), null) // curto demais
})

test("previewFromBody usa texto quando existe e rótulo de mídia quando não", () => {
  assert.strictEqual(previewFromBody("Olá, tudo bem?", "text"), "Olá, tudo bem?")
  assert.strictEqual(previewFromBody("", "imageMessage"), "📷 Imagem")
  assert.strictEqual(previewFromBody("", "audioMessage"), "🎤 Áudio")
  assert.strictEqual(previewFromBody(null, "videoMessage"), "🎬 Vídeo")
})

test("previewFromBody trunca textos longos em 160 chars", () => {
  const long = "x".repeat(500)
  assert.strictEqual(previewFromBody(long, "text").length, 160)
})

// ---------------- crmFlows

test("normalizeTrigger valida tipos e exige keywords", () => {
  assert.strictEqual(normalizeTrigger(null), null)
  assert.strictEqual(normalizeTrigger({ type: "invalido" }), null)
  assert.strictEqual(normalizeTrigger({ type: "keyword", keywords: [] }), null)
  assert.deepStrictEqual(normalizeTrigger({ type: "new_conversation" }), { type: "new_conversation" })
  const kw = normalizeTrigger({ type: "keyword", keywords: [" Preço ", "ORÇAMENTO"] })
  assert.deepStrictEqual(kw.keywords, ["preço", "orçamento"])
  assert.strictEqual(kw.matchMode, "contains")
})

test("normalizeTrigger no_reply limita horas entre 1 e 720", () => {
  assert.strictEqual(normalizeTrigger({ type: "no_reply", hours: 0 }).hours, 24) // 0 é inválido → default
  assert.strictEqual(normalizeTrigger({ type: "no_reply", hours: 9999 }).hours, 720)
  assert.strictEqual(normalizeTrigger({ type: "no_reply" }).hours, 24)
})

test("keywordMatches contains e exact", () => {
  const contains = normalizeTrigger({ type: "keyword", keywords: ["preço"] })
  assert.strictEqual(keywordMatches(contains, "Qual o PREÇO do produto?"), true)
  assert.strictEqual(keywordMatches(contains, "Olá!"), false)
  const exact = normalizeTrigger({ type: "keyword", keywords: ["oi"], matchMode: "exact" })
  assert.strictEqual(keywordMatches(exact, "Oi"), true)
  assert.strictEqual(keywordMatches(exact, "Oi, tudo bem?"), false)
})

test("normalizeQuietHours só ativa com enabled true e horários válidos", () => {
  assert.strictEqual(normalizeQuietHours(null), null)
  assert.strictEqual(normalizeQuietHours({ enabled: false, start: "22:00", end: "08:00" }), null)
  const qh = normalizeQuietHours({ enabled: true, start: "22:00", end: "08:00" })
  assert.deepStrictEqual(qh, { enabled: true, start: "22:00", end: "08:00" })
  const invalid = normalizeQuietHours({ enabled: true, start: "99:99", end: "08:00" })
  assert.strictEqual(invalid.start, "22:00") // fallback
})

test("isWithinQuietHours respeita intervalo que atravessa a meia-noite", () => {
  const qh = { enabled: true, start: "22:00", end: "08:00" }
  // 23h em São Paulo (UTC-3) = 02:00 UTC
  const night = new Date("2026-07-08T02:00:00Z")
  assert.strictEqual(isWithinQuietHours(qh, night), true)
  // 12h em São Paulo = 15:00 UTC
  const noon = new Date("2026-07-07T15:00:00Z")
  assert.strictEqual(isWithinQuietHours(qh, noon), false)
  assert.strictEqual(isWithinQuietHours(null, night), false)
})

test("deliveryDelayMs sempre com delay mínimo", () => {
  for (let i = 0; i < 20; i += 1) {
    const d = deliveryDelayMs()
    assert.ok(d >= 3000, `delay ${d} < 3000`)
  }
})

// ---------------- crmSync

test("extractIndividualChats filtra grupos e deduplica", () => {
  const chats = extractIndividualChats([
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria" },
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria dupe" },
    { remoteJid: "120363317378211775@g.us", pushName: "Grupo" },
    { id: "123456@lid", name: "Contato LID" },
    { remoteJid: null },
  ])
  assert.strictEqual(chats.length, 2)
  assert.ok(chats.some((c) => c.remoteJid === "5511999999999@s.whatsapp.net"))
  assert.ok(chats.some((c) => c.remoteJid === "123456@lid"))
})

test("extractIndividualChats ordena por atividade recente", () => {
  const now = Math.floor(Date.now() / 1000)
  const chats = extractIndividualChats([
    { remoteJid: "1111111111@s.whatsapp.net", conversationTimestamp: now - 86400 },
    { remoteJid: "2222222222@s.whatsapp.net", conversationTimestamp: now },
  ])
  assert.strictEqual(chats[0].remoteJid, "2222222222@s.whatsapp.net")
})

test("extractIndividualChats aceita formatos records/chats", () => {
  const fromRecords = extractIndividualChats({ records: [{ remoteJid: "5511888888888@s.whatsapp.net" }] })
  assert.strictEqual(fromRecords.length, 1)
  const fromChats = extractIndividualChats({ chats: [{ remoteJid: "5511777777777@s.whatsapp.net" }] })
  assert.strictEqual(fromChats.length, 1)
})

// ---------------- crmAiAgent

test("containsHandoffKeyword detecta palavra em qualquer posição", () => {
  const agent = { handoffKeywords: ["humano", "atendente"] }
  assert.strictEqual(containsHandoffKeyword(agent, "Quero falar com um HUMANO agora"), true)
  assert.strictEqual(containsHandoffKeyword(agent, "Qual o preço?"), false)
  assert.strictEqual(containsHandoffKeyword(agent, ""), false)
  assert.strictEqual(containsHandoffKeyword({ handoffKeywords: [] }, "humano"), false)
})

console.log(`\n${passed} passou, ${failed} falhou\n`)
process.exit(failed > 0 ? 1 : 0)

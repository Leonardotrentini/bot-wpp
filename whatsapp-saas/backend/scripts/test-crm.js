/**
 * Testes unitários — módulo CRM (helpers puros, sem banco).
 * Uso: node scripts/test-crm.js
 */
const assert = require("assert")
const { isIndividualJid, isLidJid, phoneFromJid, previewFromBody, formatContactRow } = require("../src/lib/crmCore")
const {
  normalizeTrigger,
  keywordMatches,
  isWithinQuietHours,
  normalizeQuietHours,
  deliveryDelayMs,
} = require("../src/lib/crmFlows")
const { extractIndividualChats } = require("../src/lib/crmSync")
const { buildContactDirectory, mergeChatsIntoDirectory, pickProfileFields, contactNeedsProfile, lookupDirectoryInfo } = require("../src/lib/crmProfile")
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

test("extractIndividualChats preserva foto de perfil quando vem no chat", () => {
  const chats = extractIndividualChats([
    { remoteJid: "5511999999999@s.whatsapp.net", profilePicUrl: "https://pps.whatsapp.net/foto.jpg" },
  ])
  assert.strictEqual(chats[0].avatarUrl, "https://pps.whatsapp.net/foto.jpg")
})

// ---------------- crmProfile

test("buildContactDirectory normaliza formatos e ignora entradas vazias", () => {
  const dir = buildContactDirectory([
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria", profilePicUrl: "https://pps.whatsapp.net/m.jpg" },
    { id: "123456@lid", name: "Contato LID" },
    { remoteJid: "5511888888888@s.whatsapp.net" }, // sem nome nem foto → fora
    { remoteJid: null, pushName: "Fantasma" },
  ])
  assert.strictEqual(dir.size, 3)
  assert.deepStrictEqual(dir.get("5511999999999@s.whatsapp.net"), {
    pushName: "Maria",
    avatarUrl: "https://pps.whatsapp.net/m.jpg",
  })
  assert.strictEqual(dir.get("123456@lid").pushName, "Contato LID")
})

test("buildContactDirectory aceita payload embrulhado (records/data)", () => {
  const dir = buildContactDirectory({ records: [{ remoteJid: "5511777777777@s.whatsapp.net", pushName: "João" }] })
  assert.strictEqual(dir.get("5511777777777@s.whatsapp.net").pushName, "João")
})

test("buildContactDirectory rejeita url de foto inválida", () => {
  const dir = buildContactDirectory([
    { remoteJid: "5511999999999@s.whatsapp.net", profilePicUrl: "changed" },
  ])
  assert.strictEqual(dir.size, 0)
})

test("mergeChatsIntoDirectory complementa sem sobrescrever o findContacts", () => {
  const dir = buildContactDirectory([
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria (agenda)" },
  ])
  mergeChatsIntoDirectory(dir, [
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria (chat)", avatarUrl: "https://pps.whatsapp.net/m.jpg" },
    { remoteJid: "5511666666666@s.whatsapp.net", pushName: "Novo do chat" },
  ])
  const maria = dir.get("5511999999999@s.whatsapp.net")
  assert.strictEqual(maria.pushName, "Maria (agenda)") // findContacts tem prioridade
  assert.strictEqual(maria.avatarUrl, "https://pps.whatsapp.net/m.jpg") // foto complementada
  assert.strictEqual(dir.get("5511666666666@s.whatsapp.net").pushName, "Novo do chat")
})

test("pickProfileFields lê variações do fetchProfile", () => {
  assert.deepStrictEqual(pickProfileFields({ name: "Ana", picture: "https://pps.whatsapp.net/a.jpg" }), {
    pushName: "Ana",
    avatarUrl: "https://pps.whatsapp.net/a.jpg",
  })
  assert.deepStrictEqual(pickProfileFields({ data: { pushName: "Bia", profilePictureUrl: "https://pps.whatsapp.net/b.jpg" } }), {
    pushName: "Bia",
    avatarUrl: "https://pps.whatsapp.net/b.jpg",
  })
  assert.deepStrictEqual(pickProfileFields(null), { pushName: null, avatarUrl: null })
})

test("contactNeedsProfile detecta contato sem nome ou sem foto", () => {
  assert.strictEqual(contactNeedsProfile({ pushName: null, name: null, avatarUrl: null }), true)
  assert.strictEqual(contactNeedsProfile({ pushName: "Maria", avatarUrl: null }), true)
  assert.strictEqual(contactNeedsProfile({ pushName: "Maria", avatarUrl: "https://pps.whatsapp.net/m.jpg" }), false)
  assert.strictEqual(contactNeedsProfile(null), false)
})

test("lookupDirectoryInfo encontra perfil pelo telefone quando JID difere", () => {
  const dir = buildContactDirectory([
    { remoteJid: "5511999999999@s.whatsapp.net", pushName: "Maria", profilePicUrl: "https://pps.whatsapp.net/m.jpg" },
  ])
  const info = lookupDirectoryInfo(dir, { remoteJid: "123456@lid", phone: "5511999999999" })
  assert.strictEqual(info.pushName, "Maria")
  assert.strictEqual(info.avatarUrl, "https://pps.whatsapp.net/m.jpg")
})

test("formatContactRow formata telefone BR quando não há nome salvo", () => {
  const row = formatContactRow({
    id: "c1",
    remoteJid: "553299377780@s.whatsapp.net",
    phone: "553299377780",
    pushName: null,
    avatarUrl: null,
    isLid: false,
    notes: "",
    tags: [],
  })
  assert.match(row.name, /\+55/)
  assert.notStrictEqual(row.name, "553299377780")
})

test("formatContactRow usa pushName do WhatsApp quando disponível", () => {
  const row = formatContactRow({
    id: "c2",
    remoteJid: "5511999999999@s.whatsapp.net",
    phone: "5511999999999",
    pushName: "Leonardo",
    avatarUrl: "https://pps.whatsapp.net/l.jpg",
    isLid: false,
    notes: "",
    tags: [],
  })
  assert.strictEqual(row.name, "Leonardo")
  assert.strictEqual(row.avatarUrl, "https://pps.whatsapp.net/l.jpg")
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

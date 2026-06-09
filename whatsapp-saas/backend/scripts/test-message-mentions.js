/**
 * Testes unitários para menções WhatsApp (LID vs telefone real, @todos).
 * Uso: node scripts/test-message-mentions.js
 */
const assert = require("assert")
const {
  mergeMentionsFromBody,
  formatWhatsAppMentionBody,
  formatWhatsAppMentionAllBody,
  appendMassMentionPhonesToBody,
  buildEvolutionSendOptions,
  resolveMentionPhoneDigits,
  isParticipantMentionable,
  normalizeMentionsInput,
  resolveMentionsForGroup,
  extractMentionTargetsFromEvolutionPayload,
} = require("../src/lib/messageMentions")

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    return true
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    return false
  }
}

const lidParticipant = {
  participantJid: "20742526832803@lid",
  name: "Contato (número oculto no grupo)",
  phone: "—",
  raw: { id: "20742526832803@lid", admin: null },
}

const brParticipant = {
  participantJid: "5511999887766@s.whatsapp.net",
  name: "Maria Silva",
  phone: "+55 (11) 99988-7766",
  raw: { id: "5511999887766@s.whatsapp.net" },
}

const participants = [lidParticipant, brParticipant]
const participantByJid = new Map(participants.map((p) => [p.participantJid, p]))

let passed = 0
let failed = 0

function run(name, fn) {
  if (test(name, fn)) passed++
  else failed++
}

console.log("\nmessageMentions — testes unitários\n")

run("LID não gera telefone para menção", () => {
  assert.strictEqual(resolveMentionPhoneDigits(lidParticipant), null)
  assert.strictEqual(isParticipantMentionable(lidParticipant), false)
})

run("JID BR válido gera telefone", () => {
  assert.strictEqual(resolveMentionPhoneDigits(brParticipant), "5511999887766")
  assert.strictEqual(isParticipantMentionable(brParticipant), true)
})

run("@all no body move token para linha inicial", () => {
  assert.strictEqual(formatWhatsAppMentionAllBody("teste @all menção", true), "@all\n\nteste menção")
})

run("appendMassMentionPhonesToBody adiciona @telefones", () => {
  const out = appendMassMentionPhonesToBody("Olá pessoal", ["5511999887766", "5511888776655"])
  assert.ok(out.includes("@5511999887766"))
  assert.ok(out.includes("@5511888776655"))
})

run("@all com participantes → mentioned[] no payload", () => {
  const sendOpts = buildEvolutionSendOptions({
    mentioned: ["5511999887766", "5511888776655"],
    mentionsEveryOne: false,
    mentionAll: true,
  })
  assert.strictEqual(sendOpts.mentionsEveryOne, undefined)
  assert.deepStrictEqual(sendOpts.mentioned, ["5511999887766", "5511888776655"])
})

run("menção individual substitui @nome por @telefone no body", () => {
  const mentionsJson = normalizeMentionsInput({
    mentionAll: false,
    mentions: [{ type: "user", label: "Maria", participantJid: brParticipant.participantJid }],
  })
  const body = formatWhatsAppMentionBody("Oi @Maria tudo bem?", mentionsJson, participants, participantByJid)
  assert.strictEqual(body, "Oi @5511999887766 tudo bem?")
})

async function runAsyncTests() {
  const mockPrisma = {
    whatsAppGroup: {
      findUnique: async () => ({
        participants: [
          {
            participantJid: "20742526832803@lid",
            name: "Oculto",
            phone: "—",
            status: "ativo",
            raw: { id: "20742526832803@lid" },
          },
          {
            participantJid: "5511999887766@s.whatsapp.net",
            name: "Maria Silva",
            phone: "+55 (11) 99988-7766",
            status: "ativo",
            raw: { id: "5511999887766@s.whatsapp.net" },
          },
        ],
      }),
    },
  }

  const mockFetch = async () => ({
    participants: [
      { id: "5511999887766@s.whatsapp.net" },
      { id: "5511888776655@s.whatsapp.net" },
    ],
  })

  await testAsync("@all → mentioned[] + @telefones no texto (notifica todos)", async () => {
    const r = await resolveMentionsForGroup(
      mockPrisma,
      "user1",
      "120363@g.us",
      { body: "teste @all menção", mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "all" }] } },
      { instanceName: "inst", fetchGroupParticipants: mockFetch },
    )
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.ok(r.mentioned.length >= 2)
    assert.strictEqual(r.mentionDebug.mentionStrategy, "mentioned+phonesInText")
    assert.ok(r.whatsappBody.includes("@5511999887766"))
    assert.ok(r.whatsappBody.includes("@5511888776655"))
    assert.strictEqual(r.whatsappBody.startsWith("@all"), true)
  })

  await testAsync("@all + @Maria → mentioned[] completo + texto individual", async () => {
    const r = await resolveMentionsForGroup(
      mockPrisma,
      "user1",
      "120363@g.us",
      {
        body: "teste @Maria @all",
        mentionsJson: {
          mentionAll: true,
          mentions: [
            { type: "all", label: "all" },
            { type: "user", label: "Maria", participantJid: "5511999887766@s.whatsapp.net" },
          ],
        },
      },
      { instanceName: "inst", fetchGroupParticipants: mockFetch },
    )
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.ok(r.mentioned.length >= 2)
    assert.ok(r.whatsappBody.includes("@5511999887766"))
    assert.ok(r.whatsappBody.includes("@all"))
  })

  await testAsync("menção Maria sem @all", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Oi @Maria",
      mentionsJson: {
        mentionAll: false,
        mentions: [{ type: "user", label: "Maria", participantJid: "5511999887766@s.whatsapp.net" }],
      },
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.deepStrictEqual(r.mentioned, ["5511999887766"])
  })
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed++
  }
}

;(async () => {
  await runAsyncTests()
  console.log(`\n${passed} passou, ${failed} falhou\n`)
  process.exit(failed > 0 ? 1 : 0)
})()

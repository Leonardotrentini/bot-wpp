/**
 * Testes unitários para menções WhatsApp (LID vs telefone real, @todos).
 * Uso: node scripts/test-message-mentions.js
 */
const assert = require("assert")
const {
  mergeMentionsFromBody,
  formatWhatsAppMentionBody,
  buildEvolutionSendOptions,
  resolveMentionPhoneDigits,
  isParticipantMentionable,
  normalizeMentionsInput,
  resolveMentionsForGroup,
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

run("@todos no texto ativa mentionAll", () => {
  const r = mergeMentionsFromBody("Olá @todos!", null)
  assert.strictEqual(r.mentionAll, true)
})

run("@todos → mentionsEveryOne sem lista manual de telefones", () => {
  const mentionsJson = mergeMentionsFromBody("Aviso @todos", { mentionAll: true, mentions: [{ type: "all", label: "todos" }] })
  const mentioned = []
  const mentionsEveryOne = mentionsJson.mentionAll === true
  const sendOpts = buildEvolutionSendOptions({ mentioned, mentionsEveryOne, linkPreview: true })
  assert.strictEqual(sendOpts.mentionsEveryOne, true)
  assert.deepStrictEqual(sendOpts.mentioned, undefined)
})

run("menção individual substitui @nome por @telefone no body", () => {
  const mentionsJson = normalizeMentionsInput({
    mentionAll: false,
    mentions: [{ type: "user", label: "Maria", participantJid: brParticipant.participantJid }],
  })
  const body = formatWhatsAppMentionBody("Oi @Maria tudo bem?", mentionsJson, participants, participantByJid)
  assert.strictEqual(body, "Oi @5511999887766 tudo bem?")
})

run("menção LID não substitui @nome por número inválido", () => {
  const mentionsJson = normalizeMentionsInput({
    mentionAll: false,
    mentions: [{ type: "user", label: "Contato", participantJid: lidParticipant.participantJid }],
  })
  const body = formatWhatsAppMentionBody("Oi @Contato", mentionsJson, participants, participantByJid)
  assert.strictEqual(body, "Oi @Contato")
})

run("buildEvolutionSendOptions inclui mentioned só com telefones", () => {
  const opts = buildEvolutionSendOptions({
    mentioned: ["5511999887766"],
    mentionsEveryOne: false,
    linkPreview: true,
  })
  assert.deepStrictEqual(opts.mentioned, ["5511999887766"])
  assert.strictEqual(opts.linkPreview, true)
  assert.strictEqual(opts.mentionsEveryOne, undefined)
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

  await testAsync("@todos via resolveMentionsForGroup → mentionsEveryOne, sem LID em mentioned", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Aviso @todos",
      mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "todos" }] },
    })
    assert.strictEqual(r.mentionsEveryOne, true)
    assert.deepStrictEqual(r.mentioned, [])
    assert.strictEqual(r.whatsappBody, "Aviso @todos")
  })

  await testAsync("menção Maria via resolveMentionsForGroup", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Oi @Maria",
      mentionsJson: {
        mentionAll: false,
        mentions: [{ type: "user", label: "Maria", participantJid: "5511999887766@s.whatsapp.net" }],
      },
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.deepStrictEqual(r.mentioned, ["5511999887766"])
    assert.strictEqual(r.whatsappBody, "Oi @5511999887766")
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

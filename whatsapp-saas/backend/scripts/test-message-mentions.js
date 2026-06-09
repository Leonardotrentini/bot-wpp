/**
 * Testes unitários para menções WhatsApp (LID vs telefone real, limite de 2).
 * Uso: node scripts/test-message-mentions.js
 */
const assert = require("assert")
const {
  MAX_MENTIONS,
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

const brParticipant2 = {
  participantJid: "5511888776655@s.whatsapp.net",
  name: "João Santos",
  phone: "+55 (11) 88877-6655",
  raw: { id: "5511888776655@s.whatsapp.net" },
}

const participants = [lidParticipant, brParticipant, brParticipant2]
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

run("normalize ignora mentionAll e tipo all", () => {
  const out = normalizeMentionsInput({
    mentionAll: true,
    mentions: [
      { type: "all", label: "all" },
      { type: "user", label: "Maria", participantJid: brParticipant.participantJid },
    ],
  })
  assert.strictEqual(out.mentionAll, false)
  assert.strictEqual(out.mentions.length, 1)
  assert.strictEqual(out.mentions[0].label, "Maria")
})

run("normalize limita a MAX_MENTIONS", () => {
  const out = normalizeMentionsInput({
    mentions: [
      { type: "user", label: "Maria", participantJid: brParticipant.participantJid },
      { type: "user", label: "João", participantJid: brParticipant2.participantJid },
      { type: "user", label: "Extra", participantJid: "5511777666555@s.whatsapp.net" },
    ],
  })
  assert.strictEqual(out.mentions.length, MAX_MENTIONS)
})

run("menção individual substitui @nome por @telefone no body", () => {
  const mentionsJson = normalizeMentionsInput({
    mentions: [{ type: "user", label: "Maria", participantJid: brParticipant.participantJid }],
  })
  const body = formatWhatsAppMentionBody("Oi @Maria tudo bem?", mentionsJson, participants, participantByJid)
  assert.strictEqual(body, "Oi @5511999887766 tudo bem?")
})

run("buildEvolutionSendOptions envia mentioned[] até o limite", () => {
  const sendOpts = buildEvolutionSendOptions({
    mentioned: ["5511999887766", "5511888776655", "5511777666555"],
  })
  assert.deepStrictEqual(sendOpts.mentioned, ["5511999887766", "5511888776655"])
})

async function runAsyncTests() {
  const mockPrisma = {
    whatsAppGroup: {
      findUnique: async () => ({
        participants: participants.map((p) => ({ ...p, status: "ativo" })),
      }),
    },
  }

  await testAsync("menção Maria individual", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Oi @Maria",
      mentionsJson: {
        mentions: [{ type: "user", label: "Maria", participantJid: brParticipant.participantJid }],
      },
    })
    assert.deepStrictEqual(r.mentioned, ["5511999887766"])
    assert.strictEqual(r.mentionDebug.mentionStrategy, "individual")
  })

  await testAsync("duas menções no máximo", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Oi @Maria e @João",
      mentionsJson: {
        mentions: [
          { type: "user", label: "Maria", participantJid: brParticipant.participantJid },
          { type: "user", label: "João", participantJid: brParticipant2.participantJid },
          { type: "user", label: "Extra", participantJid: "5511777666555@s.whatsapp.net" },
        ],
      },
    })
    assert.strictEqual(r.mentioned.length, MAX_MENTIONS)
  })

  await testAsync("mergeMentionsFromBody ignora @all no texto", async () => {
    const merged = mergeMentionsFromBody("teste @all @todos", { mentionAll: true, mentions: [] })
    assert.strictEqual(merged.mentionAll, false)
    assert.strictEqual(merged.mentions.length, 0)
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

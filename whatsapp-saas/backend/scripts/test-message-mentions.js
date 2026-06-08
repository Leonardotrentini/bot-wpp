/**
 * Testes unitários para menções WhatsApp (LID vs telefone real, @todos).
 * Uso: node scripts/test-message-mentions.js
 */
const assert = require("assert")
const {
  mergeMentionsFromBody,
  formatWhatsAppMentionBody,
  formatWhatsAppMentionAllBody,
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

run("@todos / @all no texto ativa mentionAll", () => {
  assert.strictEqual(mergeMentionsFromBody("Olá @todos!", null).mentionAll, true)
  assert.strictEqual(mergeMentionsFromBody("Olá @all!", null).mentionAll, true)
})

run("@todos legado vira @all no body enviado ao WhatsApp", () => {
  assert.strictEqual(formatWhatsAppMentionAllBody("Aviso @todos", true), "Aviso @all")
  assert.strictEqual(formatWhatsAppMentionAllBody("Aviso @all", true), "Aviso @all")
})

run("@all → mentioned com JIDs locais (sem mentionsEveryOne)", () => {
  const mentionsJson = mergeMentionsFromBody("Aviso @all", { mentionAll: true, mentions: [{ type: "all", label: "all" }] })
  const participantJids = ["20742526832803@lid", "5511999887766@s.whatsapp.net"]
  const mentioned = [...participantJids]
  const mentionsEveryOne = false
  const sendOpts = buildEvolutionSendOptions({ mentioned, mentionsEveryOne, linkPreview: true })
  assert.strictEqual(sendOpts.mentionsEveryOne, undefined)
  assert.deepStrictEqual(sendOpts.mentioned, participantJids)
})

run("@all sem participantes sync → fallback mentionsEveryOne", () => {
  const sendOpts = buildEvolutionSendOptions({ mentioned: [], mentionsEveryOne: true, linkPreview: true })
  assert.strictEqual(sendOpts.mentionsEveryOne, true)
  assert.strictEqual(sendOpts.mentioned, undefined)
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

  await testAsync("@all via resolveMentionsForGroup → mentioned com JIDs do grupo", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Aviso @all",
      mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "all" }] },
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.strictEqual(r.mentioned.length, 2)
    assert.ok(r.mentioned.includes("5511999887766@s.whatsapp.net"))
    assert.ok(r.mentioned.includes("20742526832803@lid"))
    assert.strictEqual(r.whatsappBody, "Aviso @all")
  })

  await testAsync("@all só no texto (sem mentionsJson) detecta e monta JIDs", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "teste @all menção",
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.strictEqual(r.mentioned.length, 2)
    assert.strictEqual(r.whatsappBody, "teste @all menção")
  })

  await testAsync("@todos legado vira @all no resolveMentionsForGroup", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Aviso @todos",
      mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "todos" }] },
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.strictEqual(r.mentioned.length, 2)
    assert.strictEqual(r.whatsappBody, "Aviso @all")
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

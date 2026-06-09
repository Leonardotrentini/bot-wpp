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

run("@todos / @all no texto ativa mentionAll", () => {
  assert.strictEqual(mergeMentionsFromBody("Olá @todos!", null).mentionAll, true)
  assert.strictEqual(mergeMentionsFromBody("Olá @all!", null).mentionAll, true)
})

run("@all no body move token para linha inicial", () => {
  assert.strictEqual(formatWhatsAppMentionAllBody("teste @all menção", true), "@all\n\nteste menção")
  assert.strictEqual(formatWhatsAppMentionAllBody("Aviso @todos", true), "@all\n\nAviso")
  assert.strictEqual(formatWhatsAppMentionAllBody("@all", true), "@all")
})

run("extractMentionTargetsFromEvolutionPayload", () => {
  const targets = extractMentionTargetsFromEvolutionPayload({
    participants: [{ id: "5511999887766@s.whatsapp.net" }, { id: "20742526832803@lid" }],
  })
  assert.ok(targets.includes("5511999887766"))
  assert.ok(targets.includes("20742526832803@lid"))
})

run("@all → mentioned com JIDs + mentionAll no payload", () => {
  const participantJids = ["20742526832803@lid", "5511999887766"]
  const sendOpts = buildEvolutionSendOptions({
    mentioned: participantJids,
    mentionAll: true,
    linkPreview: true,
  })
  assert.strictEqual(sendOpts.mentionAll, true)
  assert.deepStrictEqual(sendOpts.mentioned, participantJids)
})

run("@all sem participantes sync → fallback mentionsEveryOne", () => {
  const sendOpts = buildEvolutionSendOptions({ mentioned: [], mentionsEveryOne: true, mentionAll: true })
  assert.strictEqual(sendOpts.mentionsEveryOne, true)
  assert.strictEqual(sendOpts.mentionAll, true)
})

run("menção individual substitui @nome por @telefone no body", () => {
  const mentionsJson = normalizeMentionsInput({
    mentionAll: false,
    mentions: [{ type: "user", label: "Maria", participantJid: brParticipant.participantJid }],
  })
  const body = formatWhatsAppMentionBody("Oi @Maria tudo bem?", mentionsJson, participants, participantByJid)
  assert.strictEqual(body, "Oi @5511999887766 tudo bem?")
})

run("buildEvolutionSendOptions inclui mentioned só com telefones", () => {
  const opts = buildEvolutionSendOptions({
    mentioned: ["5511999887766"],
    mentionsEveryOne: false,
    linkPreview: true,
  })
  assert.deepStrictEqual(opts.mentioned, ["5511999887766"])
  assert.strictEqual(opts.linkPreview, true)
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
    participants: [{ id: "5511888776655@s.whatsapp.net" }],
  })

  await testAsync("@all via resolveMentionsForGroup → mentioned com JIDs do grupo", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "Aviso @all",
      mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "all" }] },
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.strictEqual(r.mentionAll, true)
    assert.strictEqual(r.mentioned.length, 2)
    assert.ok(r.mentioned.includes("5511999887766"))
    assert.ok(r.mentioned.includes("20742526832803@lid"))
    assert.strictEqual(r.whatsappBody, "@all\n\nAviso")
  })

  await testAsync("@all só no texto detecta e formata body", async () => {
    const r = await resolveMentionsForGroup(mockPrisma, "user1", "120363@g.us", {
      body: "teste @all menção",
    })
    assert.strictEqual(r.mentionsEveryOne, false)
    assert.strictEqual(r.mentioned.length, 2)
    assert.strictEqual(r.whatsappBody, "@all\n\nteste menção")
  })

  await testAsync("fetch Evolution ao vivo complementa mentioned[]", async () => {
    const r = await resolveMentionsForGroup(
      mockPrisma,
      "user1",
      "120363@g.us",
      { body: "@all", mentionsJson: { mentionAll: true, mentions: [{ type: "all", label: "all" }] } },
      { instanceName: "inst", fetchGroupParticipants: mockFetch },
    )
    assert.ok(r.mentioned.includes("5511888776655"))
    assert.strictEqual(r.mentionDebug.liveFetchCount, 1)
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

/**
 * Testes do import de pack CRM (sem banco).
 * Uso: node scripts/test-crm-pack-import.js
 */
const assert = require("assert")
const { previewCrmPack, validatePackShape, importCrmPack } = require("../src/lib/crmPackImport")
const sample = require("../../examples/crm-pack-exemplo-fup.json")
const atacado = require("../../examples/crm-pack-atacado-vestuario.json")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === "function") {
      return r
        .then(() => {
          passed += 1
          console.log(`  ✓ ${name}`)
        })
        .catch((err) => {
          failed += 1
          console.error(`  ✗ ${name}`)
          console.error(`    ${err.message}`)
        })
    }
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

function makePrisma(store) {
  return {
    crmTag: {
      findMany: async () => store.tags,
      create: async ({ data }) => {
        const row = { id: `t${store.tags.length + 1}`, ...data }
        store.tags.push(row)
        return row
      },
    },
    crmKanbanStage: {
      findMany: async () => store.stages,
      updateMany: async () => ({ count: 0 }),
      update: async ({ where, data }) => {
        const row = store.stages.find((s) => s.id === where.id)
        Object.assign(row, data)
        return row
      },
      create: async ({ data }) => {
        const row = { id: `s${store.stages.length + 1}`, ...data }
        store.stages.push(row)
        return row
      },
    },
    crmFlow: {
      findMany: async () => store.flows,
      create: async ({ data }) => {
        const row = { id: `f${store.flows.length + 1}`, ...data }
        store.flows.push(row)
        return row
      },
    },
    crmQuickReply: {
      findMany: async () => store.quickReplies || [],
      create: async ({ data }) => {
        if (!store.quickReplies) store.quickReplies = []
        const row = { id: `q${store.quickReplies.length + 1}`, ...data }
        store.quickReplies.push(row)
        return row
      },
      update: async ({ where, data }) => {
        const row = store.quickReplies.find((q) => q.id === where.id)
        Object.assign(row, data)
        return row
      },
    },
  }
}

async function main() {
  console.log("\ncrmPackImport — testes\n")

  await test("validatePackShape aceita sample v1", () => {
    assert.strictEqual(validatePackShape(sample), null)
  })

  await test("validatePackShape aceita pack atacado v2", () => {
    assert.strictEqual(validatePackShape(atacado), null)
  })

  await test("previewCrmPack conta entidades do exemplo FUP", () => {
    const p = previewCrmPack(sample)
    assert.strictEqual(p.tags, 3)
    assert.strictEqual(p.stages, 3)
    assert.strictEqual(p.flows, 2)
    assert.strictEqual(p.quickReplies, 0)
  })

  await test("previewCrmPack conta entidades do atacado", () => {
    const p = previewCrmPack(atacado)
    assert.strictEqual(p.tags, 8)
    assert.strictEqual(p.stages, 6)
    assert.strictEqual(p.flows, 3)
    assert.strictEqual(p.quickReplies, 5)
    assert.ok(p.quickReplyShortcuts.includes("pix"))
  })

  await test("importCrmPack resolve keys e cria entidades", async () => {
    const store = { tags: [], stages: [], flows: [], quickReplies: [] }
    const result = await importCrmPack(makePrisma(store), "u1", sample)
    assert.strictEqual(result.summary.tagsCreated, 3)
    assert.strictEqual(result.summary.stagesCreated, 3)
    assert.strictEqual(result.summary.flowsCreated, 2)

    const replyFlow = result.flows.find((f) => f.name.includes("Respondeu"))
    assert.ok(replyFlow)
    assert.strictEqual(replyFlow.trigger.type, "contact_reply")
    assert.ok(Array.isArray(replyFlow.trigger.tagIds))
    assert.strictEqual(replyFlow.trigger.tagIds.length, 2)
    assert.ok(replyFlow.actions.some((a) => a.type === "move_stage" && a.stageId))
    assert.ok(replyFlow.actions.some((a) => a.type === "remove_tag"))
  })

  await test("importCrmPack atacado cria 6 estágios, 3 fluxos e 5 atalhos", async () => {
    const store = { tags: [], stages: [], flows: [], quickReplies: [] }
    const result = await importCrmPack(makePrisma(store), "u1", atacado)
    assert.strictEqual(result.summary.stagesCreated, 6)
    assert.strictEqual(result.summary.flowsCreated, 3)
    assert.strictEqual(result.summary.quickRepliesCreated, 5)
    assert.strictEqual(result.quickReplies.length, 5)
    assert.ok(result.flows.every((f) => f.enabled === true))
    assert.ok(result.stages.some((s) => s.name === "Qualificando"))
    assert.ok(result.quickReplies.some((q) => q.shortcut === "catalogo"))
  })

  await test("importCrmPack reutiliza tag/estágio pelo nome", async () => {
    const store = {
      tags: [{ id: "tex", userId: "u1", name: "Sem resposta", color: "#000000" }],
      stages: [{ id: "sex", userId: "u1", name: "Negociando", color: "#111111", sortOrder: 0, isDefault: false }],
      flows: [],
      quickReplies: [],
    }
    const result = await importCrmPack(makePrisma(store), "u1", sample)
    assert.strictEqual(result.summary.tagsReused, 1)
    assert.strictEqual(result.summary.stagesReused, 1)
    assert.ok(result.tags.some((t) => t.name === "Sem resposta" && t.reused && t.id === "tex"))
  })

  await test("importCrmPack não recria fluxo com mesmo nome", async () => {
    const store = {
      tags: [],
      stages: [],
      flows: [{ id: "f1", userId: "u1", name: "FUP 24h", enabled: false, trigger: {}, actions: [] }],
      quickReplies: [],
    }
    const result = await importCrmPack(makePrisma(store), "u1", atacado)
    assert.strictEqual(result.summary.flowsReused, 1)
    assert.strictEqual(result.summary.flowsCreated, 2)
    assert.strictEqual(store.flows.length, 3)
    assert.strictEqual(result.flows.find((f) => f.name === "FUP 24h").id, "f1")
  })

  await test("importCrmPack faz upsert de atalho por shortcut", async () => {
    const store = {
      tags: [],
      stages: [],
      flows: [],
      quickReplies: [{ id: "q1", userId: "u1", shortcut: "pix", title: "Antigo", body: "Corpo antigo", mediaType: "none" }],
    }
    const result = await importCrmPack(makePrisma(store), "u1", atacado)
    assert.strictEqual(result.summary.quickRepliesReused, 1)
    assert.strictEqual(result.summary.quickRepliesCreated, 4)
    assert.strictEqual(store.quickReplies.length, 5)
    const pix = store.quickReplies.find((q) => q.shortcut === "pix")
    assert.ok(pix.body.includes("PIX"))
    assert.notStrictEqual(pix.body, "Corpo antigo")
  })

  console.log(`\n${passed} passou, ${failed} falhou\n`)
  process.exit(failed ? 1 : 0)
}

main()

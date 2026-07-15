/**
 * Testes do import de pack CRM (sem banco).
 * Uso: node scripts/test-crm-pack-import.js
 */
const assert = require("assert")
const { previewCrmPack, validatePackShape, importCrmPack } = require("../src/lib/crmPackImport")
const sample = require("../../examples/crm-pack-exemplo-fup.json")

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

async function main() {
  console.log("\ncrmPackImport — testes\n")

  await test("validatePackShape aceita sample", () => {
    assert.strictEqual(validatePackShape(sample), null)
  })

  await test("previewCrmPack conta entidades", () => {
    const p = previewCrmPack(sample)
    assert.strictEqual(p.tags, 3)
    assert.strictEqual(p.stages, 3)
    assert.strictEqual(p.flows, 2)
  })

  await test("importCrmPack resolve keys e cria entidades", async () => {
    const store = {
      tags: [],
      stages: [],
      flows: [],
      tagCreate: [],
      stageCreate: [],
      flowCreate: [],
    }
    const prisma = {
      crmTag: {
        findMany: async () => store.tags,
        create: async ({ data }) => {
          const row = { id: `t${store.tags.length + 1}`, ...data }
          store.tags.push(row)
          store.tagCreate.push(row)
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
          store.stageCreate.push(row)
          return row
        },
      },
      crmFlow: {
        create: async ({ data }) => {
          const row = { id: `f${store.flows.length + 1}`, ...data }
          store.flows.push(row)
          store.flowCreate.push(row)
          return row
        },
      },
    }

    const result = await importCrmPack(prisma, "u1", sample)
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

  await test("importCrmPack reutiliza tag/estágio pelo nome", async () => {
    const store = {
      tags: [{ id: "tex", userId: "u1", name: "Sem resposta", color: "#000000" }],
      stages: [{ id: "sex", userId: "u1", name: "Negociando", color: "#111111", sortOrder: 0, isDefault: false }],
      flows: [],
    }
    const prisma = {
      crmTag: {
        findMany: async () => store.tags,
        create: async ({ data }) => {
          const row = { id: `t${Date.now()}`, ...data }
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
          const row = { id: `s${Date.now()}`, ...data }
          store.stages.push(row)
          return row
        },
      },
      crmFlow: {
        create: async ({ data }) => {
          const row = { id: `f${Date.now()}`, ...data }
          store.flows.push(row)
          return row
        },
      },
    }
    const result = await importCrmPack(prisma, "u1", sample)
    assert.strictEqual(result.summary.tagsReused, 1)
    assert.strictEqual(result.summary.stagesReused, 1)
    assert.ok(result.tags.some((t) => t.name === "Sem resposta" && t.reused && t.id === "tex"))
  })

  console.log(`\n${passed} passou, ${failed} falhou\n`)
  process.exit(failed ? 1 : 0)
}

main()

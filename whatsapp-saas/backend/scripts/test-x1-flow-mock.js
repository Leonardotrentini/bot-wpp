/**
 * Fluxo completo X1 com Prisma mockado (sem PostgreSQL).
 * Uso: node scripts/test-x1-flow-mock.js
 */
const assert = require("assert")
const {
  enqueueX1ForParticipant,
  processPendingX1Deliveries,
  handleGroupParticipantsX1Webhook,
} = require("../src/lib/groupX1Automation")

const store = new Map()
let idSeq = 0
const nextId = () => `x1-${++idSeq}`

function createMockPrisma() {
  return {
    groupX1Delivery: {
      count: async ({ where }) => {
        let n = 0
        for (const row of store.values()) {
          if (where.userId && row.userId !== where.userId) continue
          if (where.groupId && row.groupId !== where.groupId) continue
          if (where.participantJid && row.participantJid !== where.participantJid) continue
          if (where.status?.in && !where.status.in.includes(row.status)) continue
          if (where.createdAt?.gte && row.createdAt < where.createdAt.gte) continue
          n += 1
        }
        return n
      },
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...data }
        store.set(row.id, row)
        return row
      },
      findFirst: async ({ where, orderBy }) => {
        let rows = [...store.values()]
        if (where.userId) rows = rows.filter((r) => r.userId === where.userId)
        if (where.groupId) rows = rows.filter((r) => r.groupId === where.groupId)
        if (where.participantJid) rows = rows.filter((r) => r.participantJid === where.participantJid)
        if (where.kind) rows = rows.filter((r) => r.kind === where.kind)
        if (where.status?.in) rows = rows.filter((r) => where.status.in.includes(r.status))
        if (where.createdAt?.gte) rows = rows.filter((r) => r.createdAt >= where.createdAt.gte)
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt - a.createdAt)
        return rows[0] || null
      },
      findMany: async ({ where, take, orderBy }) => {
        let rows = [...store.values()]
        if (where.status) rows = rows.filter((r) => r.status === where.status)
        if (where.scheduledAt?.lte) rows = rows.filter((r) => r.scheduledAt <= where.scheduledAt.lte)
        if (orderBy?.scheduledAt === "asc") rows.sort((a, b) => a.scheduledAt - b.scheduledAt)
        return rows.slice(0, take || rows.length).map((r) => ({ id: r.id }))
      },
      updateMany: async ({ where, data }) => {
        const row = store.get(where.id)
        if (!row || row.status !== where.status) return { count: 0 }
        if (where.scheduledAt?.lte && row.scheduledAt > where.scheduledAt.lte) return { count: 0 }
        Object.assign(row, data, { updatedAt: new Date() })
        return { count: 1 }
      },
      findUnique: async ({ where }) => store.get(where.id) || null,
      update: async ({ where, data }) => {
        const row = store.get(where.id)
        if (!row) throw new Error("not found")
        Object.assign(row, data, { updatedAt: new Date() })
        return row
      },
    },
    whatsAppGroup: {
      findUnique: async ({ where }) => {
        if (where.id === "g1") {
          return {
            id: "g1",
            userId: "u1",
            groupJid: "120363@g.us",
            monitoringEnabled: true,
            groupX1Automation: { enabled: true, sendX1OnJoin: true, quietHoursEnabled: false, minDelaySec: 0, maxDelaySec: 0 },
            instanceName: "vesto-u1",
          }
        }
        if (where.userId_groupJid?.groupJid === "120363@g.us") {
          return {
            id: "g1",
            userId: "u1",
            groupJid: "120363@g.us",
            monitoringEnabled: true,
            groupX1Automation: { enabled: true, sendX1OnJoin: true, quietHoursEnabled: false, minDelaySec: 0, maxDelaySec: 0 },
            instanceName: "vesto-u1",
          }
        }
        return null
      },
    },
    whatsAppConnection: {
      findUnique: async ({ where }) => {
        if (where.instanceName === "vesto-u1" || where.userId === "u1") {
          return { userId: "u1", instanceName: "vesto-u1", connected: true }
        }
        return null
      },
    },
    whatsAppGroupParticipant: {
      findUnique: async () => ({
        participantJid: "5511999887766@s.whatsapp.net",
        name: "João Teste",
        phone: "+55 (11) 99988-7766",
        raw: null,
      }),
    },
  }
}

async function run() {
  console.log("\n[x1-flow-mock] fluxo enqueue → process → sent\n")
  const prisma = createMockPrisma()
  const sent = []
  const deps = {
    prisma,
    sendText: async (_inst, number, text) => {
      sent.push({ number, text })
      return { key: { id: "mock-msg-1" } }
    },
  }

  const groupRow = await prisma.whatsAppGroup.findUnique({ where: { id: "g1" } })

  const enq = await enqueueX1ForParticipant(deps, {
    userId: "u1",
    groupRow,
    participantJid: "5511999887766@s.whatsapp.net",
    participantName: "João Teste",
    phoneDigits: "5511999887766",
    isLid: false,
    kind: "join",
    source: "test",
    skipDelay: true,
    force: true,
  })

  assert.strictEqual(enq.ok, true, "enqueue deve ok")
  assert.strictEqual(enq.delivery.status, "pending")

  const n = await processPendingX1Deliveries(deps)
  assert.strictEqual(n, 1)
  assert.strictEqual(sent.length, 1)
  assert.ok(sent[0].text.includes("João Teste"))

  const final = await prisma.groupX1Delivery.findUnique({ where: { id: enq.delivery.id } })
  assert.strictEqual(final.status, "sent")
  console.log("  ✓ enqueue + process + sendText mock")

  store.clear()
  idSeq = 0
  sent.length = 0

  const webhookN = await handleGroupParticipantsX1Webhook(deps, "vesto-u1", {
    data: { id: "120363@g.us", action: "add", participants: ["5511999887766@s.whatsapp.net"] },
  })
  assert.strictEqual(webhookN, 1)
  await processPendingX1Deliveries(deps)
  assert.strictEqual(sent.length, 1)
  console.log("  ✓ webhook GROUP_PARTICIPANTS_UPDATE → DM")

  console.log("\n✓ Fluxo mock completo OK\n")
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

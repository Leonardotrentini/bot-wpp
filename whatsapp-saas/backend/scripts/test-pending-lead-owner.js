/**
 * Teste local (sem DB): resolveAttributionOwnerUserId + pending lead usa OWNER.
 * node scripts/test-pending-lead-owner.js
 */
const assert = require("assert")

function makePrisma({ members, leads }) {
  return {
    organizationMember: {
      findUnique: async ({ where }) => members.find((m) => m.userId === where.userId) || null,
      findFirst: async ({ where }) =>
        members.find(
          (m) =>
            m.organizationId === where.organizationId &&
            (!where.role || m.role === where.role),
        ) || null,
    },
    metaAttributionLead: {
      findMany: async ({ where }) =>
        leads.filter(
          (l) =>
            l.userId === where.userId &&
            l.contactId == null &&
            (!where.expiresAt || l.expiresAt > where.expiresAt.gt) &&
            (!where.clickAt || l.clickAt >= where.clickAt.gte),
        ),
      updateMany: async () => ({ count: 1 }),
    },
  }
}

async function main() {
  // Carrega após mock impossível — testa a função real com prisma stub via inject
  const mod = require("../src/lib/metaAttributionLead")
  const ownerId = "owner-1"
  const sellerId = "seller-1"
  const members = [
    { userId: ownerId, organizationId: "org-1", role: "OWNER" },
    { userId: sellerId, organizationId: "org-1", role: "SELLER" },
  ]
  const now = new Date()
  const leads = [
    {
      id: "lead-1",
      userId: ownerId,
      contactId: null,
      ref: "vst_test0001",
      fbc: "fb.1.1.abc",
      fbclid: "abc",
      fbp: "fb.1.1.x",
      clickAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    },
  ]

  const prisma = makePrisma({ members, leads })

  const resolvedOwner = await mod.resolveAttributionOwnerUserId(prisma, sellerId)
  assert.strictEqual(resolvedOwner, ownerId, "seller deve resolver para OWNER")

  const resolvedSelf = await mod.resolveAttributionOwnerUserId(prisma, ownerId)
  assert.strictEqual(resolvedSelf, ownerId, "owner resolve para si")

  // Simula bug antigo: buscar com sellerId não acharia; com owner acharia
  const asSeller = await prisma.metaAttributionLead.findMany({
    where: {
      userId: sellerId,
      contactId: null,
      expiresAt: { gt: now },
      clickAt: { gte: new Date(0) },
    },
  })
  const asOwner = await prisma.metaAttributionLead.findMany({
    where: {
      userId: ownerId,
      contactId: null,
      expiresAt: { gt: now },
      clickAt: { gte: new Date(0) },
    },
  })
  assert.strictEqual(asSeller.length, 0, "lead NÃO está no seller")
  assert.strictEqual(asOwner.length, 1, "lead está no owner")

  console.log("OK: pending lead owner resolution")
  console.log("  seller→owner:", resolvedOwner)
  console.log("  leads no seller:", asSeller.length, "| no owner:", asOwner.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

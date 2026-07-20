/**
 * Auditoria somente leitura: lead Baseset ...4418 / compra R$ 777.
 * node scripts/audit-lead-4418.js
 */
require("dotenv").config()
// Preferir URL pública (proxy Railway) quando o .env local aponta para internal/localhost.
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

async function main() {
  const contacts = await prisma.crmContact.findMany({
    where: {
      OR: [
        { phone: { contains: "981474418" } },
        { remoteJid: { contains: "981474418" } },
        { phone: { contains: "15981474418" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })

  const out = { contacts: [] }

  for (const c of contacts) {
    const meta = c.customFields?.meta && typeof c.customFields.meta === "object" ? c.customFields.meta : {}
    const activities = await prisma.crmContactActivity.findMany({
      where: { contactId: c.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    })
    const integration = await prisma.metaIntegration.findUnique({
      where: { userId: c.userId },
      select: {
        enabled: true,
        sendQuotes: true,
        sendPurchases: true,
        pixelId: true,
        lastEventAt: true,
        lastEventName: true,
        lastError: true,
        testEventCode: true,
      },
    })

    // owner integration if seller
    const member = await prisma.organizationMember.findUnique({
      where: { userId: c.userId },
      select: { organizationId: true, role: true },
    })
    let ownerIntegration = null
    if (member) {
      const owner = await prisma.organizationMember.findFirst({
        where: { organizationId: member.organizationId, role: "OWNER" },
        select: { userId: true },
      })
      if (owner && owner.userId !== c.userId) {
        ownerIntegration = await prisma.metaIntegration.findUnique({
          where: { userId: owner.userId },
          select: {
            userId: true,
            enabled: true,
            sendQuotes: true,
            sendPurchases: true,
            pixelId: true,
            lastEventAt: true,
            lastEventName: true,
            lastError: true,
            testEventCode: true,
          },
        })
      }
    }

    out.contacts.push({
      id: c.id,
      userId: c.userId,
      phone: c.phone,
      name: c.name || c.pushName,
      createdAt: c.createdAt,
      flags: {
        conversationStartedEventSentAt: c.conversationStartedEventSentAt,
        qualifiedEventSentAt: c.qualifiedEventSentAt,
        quoteEventSentAt: c.quoteEventSentAt,
        purchaseEventSentAt: c.purchaseEventSentAt,
        contactEventSentAt: c.contactEventSentAt,
      },
      attribution: {
        hasFbclid: Boolean(meta.fbclid),
        hasFbc: Boolean(meta.fbc),
        hasFbp: Boolean(meta.fbp),
        pageUrl: meta.pageUrl || null,
        attributionRef: meta.attributionRef || null,
        clickAt: meta.clickAt || null,
      },
      activities: activities.map((a) => ({
        id: a.id,
        type: a.type,
        createdAt: a.createdAt,
        amount: a.payload?.amount ?? null,
        ticket: a.payload?.ticket ?? null,
        metaPurchaseSentAt: a.payload?.metaPurchaseSentAt ?? null,
        metaEventId: a.payload?.metaEventId ?? null,
        metaHasAdsAttribution: a.payload?.metaHasAdsAttribution ?? null,
      })),
      integrationSelf: integration,
      integrationOwner: ownerIntegration,
    })
  }

  console.log(JSON.stringify(out, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

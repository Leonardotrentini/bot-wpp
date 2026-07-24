/**
 * Auditoria ConversationStarted — Baseset.
 * node scripts/audit-conversation-started.js
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "basesetatacado@gmail.com" },
    select: { id: true, name: true, email: true },
  })
  if (!user) throw new Error("Baseset user not found")

  const member = await prisma.organizationMember.findUnique({
    where: { userId: user.id },
    select: { organizationId: true, role: true },
  })
  let userIds = [user.id]
  if (member?.organizationId) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: member.organizationId },
      select: { userId: true, role: true },
    })
    userIds = [...new Set(members.map((m) => m.userId))]
  }

  const integration = await prisma.metaIntegration.findUnique({
    where: { userId: user.id },
    select: {
      enabled: true,
      pixelId: true,
      accessToken: true,
      testEventCode: true,
      lastEventAt: true,
      lastEventName: true,
      lastError: true,
      sendQuotes: true,
      sendPurchases: true,
    },
  })

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const contactsRecent = await prisma.crmContact.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      userId: true,
      phone: true,
      createdAt: true,
      conversationStartedEventSentAt: true,
      contactEventSentAt: true,
      qualifiedEventSentAt: true,
      customFields: true,
    },
  })

  const withCs = contactsRecent.filter((c) => c.conversationStartedEventSentAt)
  const withoutCs = contactsRecent.filter((c) => !c.conversationStartedEventSentAt)
  const withLp = contactsRecent.filter((c) => {
    const m = c.customFields?.meta
    return m && (m.fbc || m.fbp || m.fbclid)
  })

  let deliveries = []
  if (prisma.metaEventDelivery) {
    deliveries = await prisma.metaEventDelivery.findMany({
      where: {
        userId: user.id,
        eventName: "ConversationStarted",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    })
  }

  const lastCsSent = withCs[0]?.conversationStartedEventSentAt || null
  const lastCsDelivery = deliveries[0]?.createdAt || null

  // Novas conversas (por createdAt da conversation) nos últimos 14d
  const convos = await prisma.crmConversation.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      userId: true,
      createdAt: true,
      contactId: true,
      contact: {
        select: {
          phone: true,
          conversationStartedEventSentAt: true,
          createdAt: true,
        },
      },
    },
  })

  const convosMissingCs = convos.filter((c) => !c.contact?.conversationStartedEventSentAt)

  console.log(
    JSON.stringify(
      {
        user,
        userIds,
        org: member,
        integration: integration
          ? {
              ...integration,
              accessToken: integration.accessToken ? `len:${integration.accessToken.length}` : null,
            }
          : null,
        last14d: {
          contacts: contactsRecent.length,
          withConversationStarted: withCs.length,
          withoutConversationStarted: withoutCs.length,
          withLpAttribution: withLp.length,
          lastCsOnContact: lastCsSent,
          newConversations: convos.length,
          newConversationsMissingCs: convosMissingCs.length,
        },
        sampleMissingCs: withoutCs.slice(0, 10).map((c) => ({
          id: c.id,
          phone: c.phone,
          createdAt: c.createdAt,
          userId: c.userId,
          hasLp: Boolean(c.customFields?.meta?.fbc || c.customFields?.meta?.fbp || c.customFields?.meta?.fbclid),
        })),
        sampleConvosMissingCs: convosMissingCs.slice(0, 10).map((c) => ({
          convoId: c.id,
          contactId: c.contactId,
          phone: c.contact?.phone,
          convoCreatedAt: c.createdAt,
          contactCreatedAt: c.contact?.createdAt,
          userId: c.userId,
        })),
        deliveries: {
          count: deliveries.length,
          lastAt: lastCsDelivery,
          recent: deliveries.slice(0, 8).map((d) => ({
            createdAt: d.createdAt,
            eventsReceived: d.eventsReceived,
            httpOk: d.httpOk,
            error: d.error,
            contactId: d.contactId,
            testMode: d.testMode,
          })),
        },
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

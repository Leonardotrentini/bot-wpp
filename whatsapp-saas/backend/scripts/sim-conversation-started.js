/**
 * Dispara ConversationStarted live (TEST) para um contato Baseset sem flag.
 * node scripts/sim-conversation-started.js
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")
const { trackConversationStartedEvent } = require("../src/lib/metaConversions")

const prisma = new PrismaClient()

async function main() {
  const contactId = process.argv[2] || "cmrysr3as01e5n60pis5m257m" // LP lead sem CS
  const contact = await prisma.crmContact.findUnique({ where: { id: contactId } })
  if (!contact) throw new Error("contact not found")

  console.log("before", {
    id: contact.id,
    phone: contact.phone,
    userId: contact.userId,
    conversationStartedEventSentAt: contact.conversationStartedEventSentAt,
    hasMeta: Boolean(contact.customFields?.meta?.fbc || contact.customFields?.meta?.fbclid),
  })

  const result = await trackConversationStartedEvent(prisma, {
    userId: contact.userId,
    contact,
  })

  const after = await prisma.crmContact.findUnique({
    where: { id: contactId },
    select: { conversationStartedEventSentAt: true },
  })

  let delivery = null
  if (prisma.metaEventDelivery) {
    delivery = await prisma.metaEventDelivery.findFirst({
      where: { contactId, eventName: "ConversationStarted" },
      orderBy: { createdAt: "desc" },
    })
  }

  console.log(JSON.stringify({ result, after, delivery }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const ids = [
    "cmrz892fl05qen60plzqomr4z",
    "cmrysr3as01e5n60pis5m257m",
    "cmrz0m9zm04azn60ptbnrcjx1",
    "cmrywy4h702zen60paywtlx1y",
  ]
  for (const id of ids) {
    const msgs = await prisma.crmMessage.findMany({
      where: { conversation: { contactId: id } },
      orderBy: { timestamp: "asc" },
      take: 3,
      select: { fromMe: true, body: true, timestamp: true, source: true, createdAt: true },
    })
    const c = await prisma.crmContact.findUnique({
      where: { id },
      select: { phone: true, conversationStartedEventSentAt: true, createdAt: true },
    })
    console.log(JSON.stringify({ contact: c, firstMsgs: msgs }, null, 2))
  }

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: "cmriedmuh0002ka0p3amkrj2y" },
    select: { userId: true },
  })
  const uids = members.map((m) => m.userId)
  const ever = await prisma.crmContact.count({
    where: { userId: { in: uids }, conversationStartedEventSentAt: { not: null } },
  })
  const everRecent = await prisma.crmContact.findMany({
    where: { userId: { in: uids }, conversationStartedEventSentAt: { not: null } },
    orderBy: { conversationStartedEventSentAt: "desc" },
    take: 8,
    select: { phone: true, conversationStartedEventSentAt: true, createdAt: true, userId: true },
  })

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const convos = await prisma.crmConversation.findMany({
    where: { userId: { in: uids }, createdAt: { gte: since } },
    take: 50,
    orderBy: { createdAt: "desc" },
    select: { id: true, contactId: true },
  })
  let inboundFirst = 0
  let outboundFirst = 0
  let noMsg = 0
  for (const c of convos) {
    const first = await prisma.crmMessage.findFirst({
      where: { conversationId: c.id },
      orderBy: { timestamp: "asc" },
      select: { fromMe: true },
    })
    if (!first) noMsg += 1
    else if (first.fromMe) outboundFirst += 1
    else inboundFirst += 1
  }

  console.log(
    JSON.stringify(
      { everWithCs: ever, lastCsContacts: everRecent, sample50: { inboundFirst, outboundFirst, noMsg } },
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

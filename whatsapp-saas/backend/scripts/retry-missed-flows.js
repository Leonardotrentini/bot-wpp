/**
 * Re-dispara fluxos para conversas com inbound recente sem CrmFlowRun.
 * Uso: node scripts/retry-missed-flows.js [--hours=4] [--userId=cuid]
 */
require("dotenv").config()
const { prisma } = require("../src/lib/prisma")
const { dispatchCrmMessageFlows } = require("../src/lib/crmFlows")
const { sendText, sendMedia, sendWhatsAppAudio, sendPresence } = require("../src/lib/evolution")
const { CONVERSATION_INCLUDE } = require("../src/lib/crmCore")

async function main() {
  const hours = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] || 4)
  const userIdArg = process.argv.find((a) => a.startsWith("--userId="))?.split("=")[1]
  const since = new Date(Date.now() - hours * 3600 * 1000)

  const deps = { prisma, io: null, sendText, sendMedia, sendWhatsAppAudio, sendPresence }

  const messages = await prisma.crmMessage.findMany({
    where: {
      fromMe: false,
      source: { notIn: ["flow", "ai"] },
      timestamp: { gte: since },
      ...(userIdArg ? { userId: userIdArg } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: 200,
    include: { conversation: { include: CONVERSATION_INCLUDE } },
  })

  let retried = 0
  for (const message of messages) {
    const conv = message.conversation
    if (!conv) continue

    const runs = await prisma.crmFlowRun.count({
      where: { conversationId: conv.id, createdAt: { gte: message.timestamp } },
    })
    if (runs > 0) continue

    const priorInbound = await prisma.crmMessage.count({
      where: {
        conversationId: conv.id,
        fromMe: false,
        id: { not: message.id },
        source: { notIn: ["flow", "ai"] },
        timestamp: { lt: message.timestamp },
      },
    })

    const label = conv.contact?.pushName || conv.contact?.phone || conv.remoteJid
    console.log(`→ ${label}: "${String(message.body || "").slice(0, 50)}"`)

    await dispatchCrmMessageFlows(
      deps,
      {
        message,
        conversation: conv,
        isNewConversation: priorInbound === 0,
        dispatchNewConversation: priorInbound === 0,
        shouldDispatchFlows: true,
      },
      { includeAi: false },
    )
    retried += 1
  }

  console.log(`\nConcluído: ${retried} conversa(s) reprocessada(s) (${messages.length} mensagens analisadas).`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

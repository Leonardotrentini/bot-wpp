/**
 * Teste de integração do fluxo X1 com banco (mock sendText).
 * Uso: node scripts/test-x1-integration.js
 */
require("dotenv").config()

const { prisma } = require("../src/lib/prisma")
const {
  enqueueX1ForParticipant,
  processPendingX1Deliveries,
  handleGroupParticipantsX1Webhook,
  formatDeliveryRow,
} = require("../src/lib/groupX1Automation")

async function main() {
  console.log("\n[x1-integration] início\n")

  let group
  try {
    group = await prisma.whatsAppGroup.findFirst({
      where: { monitoringEnabled: true },
      include: { participants: { where: { status: "ativo" }, take: 1 } },
    })
  } catch (err) {
    if (String(err?.message || "").includes("Can't reach database")) {
      console.log("⚠ PostgreSQL indisponível — rode `npm run prisma:push` com o banco ativo.\n")
      process.exit(0)
    }
    throw err
  }

  if (!group) {
    console.log("⚠ Nenhum grupo monitorado no banco — pulando teste de integração DB.")
    console.log("  Crie/ative um grupo no dashboard e rode novamente.\n")
    process.exit(0)
  }

  const sent = []
  const mockSendText = async (instanceName, number, text) => {
    sent.push({ instanceName, number, text })
    console.log(`[mock sendText] ${number}: ${text.slice(0, 60)}…`)
    return { key: { id: `mock-${Date.now()}` } }
  }
  const deps = { prisma, sendText: mockSendText }

  const participant = group.participants[0]
  if (!participant) {
    console.log("⚠ Grupo sem participantes — pulando.\n")
    process.exit(0)
  }

  const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: group.userId } })
  if (!conn) {
    console.log("⚠ Sem conexão WhatsApp — pulando.\n")
    process.exit(0)
  }

  await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: {
      groupX1Automation: {
        enabled: true,
        sendX1OnJoin: true,
        sendX1OnLeave: true,
        joinTemplate: "Teste X1 {{nome}}",
        leaveTemplate: "Saída {{nome}}",
        minDelaySec: 0,
        maxDelaySec: 0,
        maxX1PerUser24h: 10,
        quietHoursEnabled: false,
      },
    },
  })

  const freshGroup = await prisma.whatsAppGroup.findUnique({ where: { id: group.id } })

  console.log(`Grupo: ${freshGroup.name} (${freshGroup.groupJid})`)
  console.log(`Participante: ${participant.participantJid}\n`)

  const result = await enqueueX1ForParticipant(deps, {
    userId: group.userId,
    groupRow: freshGroup,
    participantJid: participant.participantJid,
    participantName: participant.name || "Teste",
    phoneDigits: participant.participantJid.split("@")[0],
    isLid: participant.participantJid.endsWith("@lid"),
    kind: "join",
    source: "test",
    skipDelay: true,
    force: true,
  })

  if (!result.ok) {
    console.error("Falha ao enfileirar:", result.reason, result.delivery ? formatDeliveryRow(result.delivery) : "")
    process.exit(1)
  }

  const processed = await processPendingX1Deliveries(deps)
  console.log(`Processados: ${processed}, enviados mock: ${sent.length}`)

  const delivery = await prisma.groupX1Delivery.findUnique({ where: { id: result.delivery.id } })
  console.log("Status final:", delivery?.status, delivery?.error || "")

  if (delivery?.status !== "sent" || sent.length !== 1) {
    console.error("\n✗ Integração falhou — esperado status=sent e 1 envio mock\n")
    process.exit(1)
  }

  console.log("\n✓ Integração X1 ok (enqueue → process → sent)\n")

  const webhookCount = await handleGroupParticipantsX1Webhook(deps, conn.instanceName, {
    data: {
      id: freshGroup.groupJid,
      action: "add",
      participants: [participant.participantJid],
    },
  })
  console.log(`Webhook simulado enfileirou: ${webhookCount}`)

  await prisma.$disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  prisma.$disconnect().finally(() => process.exit(1))
})

/**
 * Prova real — 4 eventos no dataset contável (SEM test_event_code).
 *
 * Uso controlado (polui o pixel de produção):
 *   npm run test:meta:live:real -- --confirmo-poluir-dataset
 *
 * Credenciais: META_PIXEL_ID + META_ACCESS_TOKEN ou integração no DB (baseset).
 * NUNCA define test_event_code neste script.
 */

require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const {
  CONVERSATION_STARTED_EVENT,
  LEAD_QUALIFIED_EVENT,
  QUOTE_EVENT,
  PURCHASE_EVENT,
  buildConversationStartedEvent,
  buildLeadQualifiedEvent,
  buildQuoteEvent,
  buildPurchaseEvent,
  sendMetaEvent,
} = require("../src/lib/metaConversions")

const CONFIRM_FLAG = "--confirmo-poluir-dataset"
const CTWA = "ARAkTestCtwaClid12345678901234567890123456789012"

function hasConfirmFlag() {
  return process.argv.includes(CONFIRM_FLAG)
}

async function loadIntegration() {
  if (process.env.META_ACCESS_TOKEN && process.env.META_PIXEL_ID) {
    return {
      pixelId: process.env.META_PIXEL_ID,
      accessToken: process.env.META_ACCESS_TOKEN,
      facebookPageId: process.env.META_WABA_ID || "",
    }
  }

  const prisma = new PrismaClient()
  try {
    const email = process.env.META_LIVE_USER_EMAIL || "basesetatacado@gmail.com"
    const user = await prisma.user.findFirst({ where: { email } })
    if (!user) throw new Error(`Usuário não encontrado: ${email}`)
    const row = await prisma.metaIntegration.findUnique({ where: { userId: user.id } })
    if (!row?.accessToken || !row?.pixelId) {
      throw new Error(`Integração Meta incompleta para ${email}`)
    }
    return {
      pixelId: row.pixelId,
      accessToken: row.accessToken,
      facebookPageId: row.facebookPageId || "",
      userId: user.id,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  if (!hasConfirmFlag()) {
    console.error(
      `Recusado: este script envia ao dataset REAL sem test_event_code.\n` +
        `Repita com: npm run test:meta:live:real -- ${CONFIRM_FLAG}`,
    )
    process.exit(1)
  }

  if (process.env.META_TEST_EVENT_CODE) {
    console.error("Remova META_TEST_EVENT_CODE do ambiente antes de rodar test:meta:live:real.")
    process.exit(1)
  }

  const integration = await loadIntegration()
  const userId = integration.userId || "live-real-proof"
  const contactId = `live-real-${Date.now()}`
  const contact = {
    id: contactId,
    phone: "553484468975",
    pushName: "BaseSet Live Real Proof",
    customFields: { meta: { ctwaClid: CTWA } },
  }
  const mode = { mode: "ctwa", ctwaClid: CTWA }
  const suffix = Date.now()

  const stages = [
    {
      name: CONVERSATION_STARTED_EVENT,
      payload: buildConversationStartedEvent({
        contact,
        eventId: `vesto-conversation-started-${contactId}`,
        userId,
        integration,
        mode,
      }),
    },
    {
      name: LEAD_QUALIFIED_EVENT,
      payload: buildLeadQualifiedEvent({
        contact,
        eventId: `vesto-lead-qualified-${contactId}`,
        userId,
        integration,
        mode,
      }),
    },
    {
      name: QUOTE_EVENT,
      payload: buildQuoteEvent({
        contact,
        amount: 1500,
        eventId: `vesto-quote-${contactId}`,
        userId,
        integration,
        mode,
      }),
    },
    {
      name: PURCHASE_EVENT,
      payload: buildPurchaseEvent({
        contact,
        amount: 1500,
        ticket: `REAL-PROOF-${suffix}`,
        eventId: `vesto-purchase-${contactId}-REAL-PROOF-${suffix}`,
        userId,
        integration,
        mode,
      }),
    },
  ]

  console.log(`Pixel: ${integration.pixelId}`)
  console.log(`test_event_code: (nenhum — dataset contável)\n`)

  const summaries = []

  for (const stage of stages) {
    const p = stage.payload
    const result = await sendMetaEvent(integration, p, {
      useTestCode: false,
      eventTargetId: integration.pixelId,
    })
    const row = {
      event_name: p.event_name,
      content_category: p.custom_data?.content_category,
      event_id: p.event_id,
      event_time: p.event_time,
      events_received: result.events_received,
      fbtrace_id: result.fbtrace_id,
    }
    summaries.push(row)
    console.log(
      `${stage.name}: content_category=${row.content_category} event_id=${row.event_id} event_time=${row.event_time} events_received=${row.events_received} fbtrace_id=${row.fbtrace_id}`,
    )
  }

  console.log("\n--- JSON (use event_id + event_time no Events Manager) ---")
  console.log(JSON.stringify(summaries, null, 2))
}

main().catch((err) => {
  console.error("LIVE REAL FAILED:", err.message || err)
  process.exit(1)
})

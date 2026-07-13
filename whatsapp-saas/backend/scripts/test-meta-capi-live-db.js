/**
 * Envio live usando credenciais salvas no banco (MetaIntegration).
 * Uso em produção/staging: railway run --service backend node scripts/test-meta-capi-live-db.js
 *
 * Opcional: META_TEST_EVENT_CODE sobrescreve o código salvo na integração.
 * Opcional: META_LIVE_USER_EMAIL (default basesetatacado@gmail.com)
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
  resolveTestEventCode,
} = require("../src/lib/metaConversions")

const PIXEL_ID = process.env.META_PIXEL_ID || "1566611764859334"
const CTWA_CLID =
  process.env.META_SAMPLE_CTWA_CLID ||
  "ARAkTestCtwaClid12345678901234567890123456789012"

async function main() {
  const prisma = new PrismaClient()
  try {
    const email = process.env.META_LIVE_USER_EMAIL || "basesetatacado@gmail.com"
    const user = await prisma.user.findFirst({ where: { email } })
    if (!user) throw new Error(`Usuário não encontrado: ${email}`)

    const row = await prisma.metaIntegration.findUnique({ where: { userId: user.id } })
    if (!row?.accessToken || !row?.pixelId) {
      throw new Error(`Integração Meta incompleta para ${email}`)
    }

    const integration = {
      pixelId: row.pixelId,
      accessToken: row.accessToken,
      facebookPageId: row.facebookPageId || "",
      testEventCode: row.testEventCode || "",
    }

    const envTestCode = String(process.env.META_TEST_EVENT_CODE || "").trim()
    if (envTestCode) integration.testEventCode = envTestCode

    const testCode = resolveTestEventCode(integration, { useTestCode: true })
    if (!testCode) {
      throw new Error("Defina META_TEST_EVENT_CODE ou testEventCode na integração.")
    }

    const mockContact = {
      id: `live-db-test-${Date.now()}`,
      phone: "553484468975",
      pushName: "BaseSet Live DB Test",
      customFields: { meta: { ctwaClid: CTWA_CLID } },
    }
    const ctwaMode = { mode: "ctwa", ctwaClid: CTWA_CLID }
    const userId = user.id
    const suffix = Date.now()

    const stages = [
      {
        name: CONVERSATION_STARTED_EVENT,
        payload: buildConversationStartedEvent({
          contact: mockContact,
          eventId: `vesto-conversation-started-${mockContact.id}`,
          userId,
          integration,
          mode: ctwaMode,
        }),
      },
      {
        name: LEAD_QUALIFIED_EVENT,
        payload: buildLeadQualifiedEvent({
          contact: mockContact,
          eventId: `vesto-lead-qualified-${mockContact.id}`,
          userId,
          integration,
          mode: ctwaMode,
        }),
      },
      {
        name: QUOTE_EVENT,
        payload: buildQuoteEvent({
          contact: mockContact,
          amount: 1500,
          eventId: `vesto-quote-${mockContact.id}`,
          userId,
          integration,
          mode: ctwaMode,
        }),
      },
      {
        name: PURCHASE_EVENT,
        payload: buildPurchaseEvent({
          contact: mockContact,
          amount: 1500,
          ticket: `TEST-${suffix}`,
          eventId: `vesto-purchase-${mockContact.id}-TEST-${suffix}`,
          userId,
          integration,
          mode: ctwaMode,
        }),
      },
    ]

    console.log(`Pixel alvo: ${PIXEL_ID} (integração: ${integration.pixelId})`)
    console.log(`Usuário: ${email}`)
    console.log(`test_event_code: ${testCode}`)
    console.log(`ctwa_clid exemplo: ${CTWA_CLID}\n`)

    let received = 0
    const summaries = []

    for (const stage of stages) {
      const p = stage.payload
      console.log(`→ ${stage.name}`)
      console.log(`  event_name: ${p.event_name}`)
      console.log(`  content_category: ${p.custom_data?.content_category}`)
      console.log(`  action_source: ${p.action_source}`)
      console.log(`  ctwa_clid: ${p.user_data?.ctwa_clid || "—"}`)
      console.log(`  meta_target: ${integration.pixelId}`)

      const result = await sendMetaEvent(integration, p, {
        useTestCode: true,
        eventTargetId: integration.pixelId,
      })
      received += Number(result.events_received || 0)
      summaries.push({
        name: stage.name,
        events_received: result.events_received,
        fbtrace_id: result.fbtrace_id,
        content_category: p.custom_data?.content_category,
        ctwa_clid: p.user_data?.ctwa_clid,
      })
      console.log(`  ✓ events_received: ${result.events_received} fbtrace_id: ${result.fbtrace_id || "—"}\n`)
    }

    console.log("--- Resumo ---")
    console.log(JSON.stringify(summaries, null, 2))
    console.log(`\nTotal events_received: ${received}/4`)
    if (received < 4) process.exit(1)
    console.log("\nConfira Events Manager → teste crm → Eventos de teste (content_category + ctwa_clid).")
    console.log("Eventos de teste NÃO alimentam campanha — contagem real leva 24–72h após tag QUALIFICADO + orçamento.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("LIVE DB TEST FAILED:", err.message || err)
  process.exit(1)
})

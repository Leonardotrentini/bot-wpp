/**
 * Envio real de teste — 4 eventos do funil para o Pixel/Dataset da Meta.
 *
 * Uso:
 *   META_PIXEL_ID=1566611764859334 \
 *   META_ACCESS_TOKEN=EAA... \
 *   META_TEST_EVENT_CODE=TEST12345 \
 *   node scripts/test-meta-capi-live.js
 */

require("dotenv").config()

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

const pixelId = process.env.META_PIXEL_ID || "1566611764859334"
const accessToken = process.env.META_ACCESS_TOKEN || ""
const testEventCode = process.env.META_TEST_EVENT_CODE || ""

const mockContact = {
  id: `live-test-${Date.now()}`,
  phone: "553484468975",
  pushName: "BaseSet Live Test",
  customFields: {
    meta: {
      ctwaClid: "ARAkTestCtwaClid12345678901234567890123456789012",
    },
  },
}

const integration = {
  pixelId,
  accessToken,
  facebookPageId: process.env.META_WABA_ID || "538521692670287",
  testEventCode,
}

const ctwaMode = { mode: "ctwa", ctwaClid: mockContact.customFields.meta.ctwaClid }
const userId = "baseset-live-test"

async function sendStage(name, payload) {
  const testCode = resolveTestEventCode(integration, { useTestCode: true })
  console.log(`\n→ ${name}`)
  console.log(`  event_name: ${payload.event_name}`)
  console.log(`  event_id: ${payload.event_id}`)
  console.log(`  content_category: ${payload.custom_data?.content_category}`)
  console.log(`  test_event_code: ${testCode || "(ausente — produção)"}`)

  const result = await sendMetaEvent(integration, payload, {
    useTestCode: Boolean(testCode),
    eventTargetId: pixelId,
  })

  console.log(`  ✓ events_received: ${result.events_received}`)
  if (result.fbtrace_id) console.log(`  fbtrace_id: ${result.fbtrace_id}`)
  return result
}

async function main() {
  if (!accessToken) {
    console.error("Defina META_ACCESS_TOKEN para envio real.")
    process.exit(1)
  }
  if (!testEventCode) {
    console.error("Defina META_TEST_EVENT_CODE (Events Manager → Eventos de teste).")
    process.exit(1)
  }

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

  const results = []
  for (const stage of stages) {
    try {
      const result = await sendStage(stage.name, stage.payload)
      results.push({ name: stage.name, ok: true, result })
    } catch (err) {
      console.error(`  ✗ erro: ${err.message}`)
      if (err.metaResponse) console.error(JSON.stringify(err.metaResponse, null, 2))
      results.push({ name: stage.name, ok: false, error: err.message, metaResponse: err.metaResponse })
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log("\n--- Resumo ---")
  for (const r of results) {
    console.log(r.ok ? `✓ ${r.name}` : `✗ ${r.name}: ${r.error}`)
  }

  if (failed.length) process.exit(1)
  console.log("\n4/4 eventos aceitos pela Meta (modo teste).")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

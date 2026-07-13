/**
 * Testa payloads e (opcionalmente) envio real à Meta.
 * Uso: node scripts/test-meta-events.js
 * Env: META_PIXEL_ID, META_ACCESS_TOKEN, META_TEST_CODE (opcional)
 */

const {
  CONVERSATION_STARTED_EVENT,
  LEAD_QUALIFIED_EVENT,
  QUOTE_EVENT,
  PURCHASE_EVENT,
  CONTENT_CATEGORY,
  VESTO_EVENT_SOURCE_URL,
  resolveTrackingMode,
  buildConversationStartedEvent,
  buildLeadQualifiedEvent,
  buildQuoteEvent,
  buildPurchaseEvent,
} = require("../src/lib/metaConversions")

const mockContactCrm = {
  id: "contact-crm-1",
  phone: "554796747378",
  pushName: "Lead LP",
  customFields: { meta: { fbclid: "IwARtestFbclid123" } },
}

const mockContactCtwa = {
  id: "contact-ctwa-1",
  phone: "554796747378",
  pushName: "Lead CTWA",
  customFields: { meta: { ctwaClid: "ARAkTestCtwaClid12345678901234567890123456789012" } },
}

const mockIntegration = {
  pixelId: process.env.META_PIXEL_ID || "000000000000000",
  accessToken: process.env.META_ACCESS_TOKEN || "",
  facebookPageId: process.env.META_PAGE_ID || "61586091841500",
  testEventCode: process.env.META_TEST_CODE || "",
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function testPayloads() {
  const crmMode = resolveTrackingMode(mockContactCrm)
  assert(crmMode.mode === "crm", "CRM contact should use crm mode")

  const conversationStarted = buildConversationStartedEvent({
    contact: mockContactCrm,
    eventId: "test-conversation-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(conversationStarted.event_name === CONVERSATION_STARTED_EVENT, "ConversationStarted event_name")
  assert(conversationStarted.action_source === "system_generated", "ConversationStarted CRM action_source")
  assert(
    conversationStarted.custom_data.content_category === CONTENT_CATEGORY.CONVERSATION_STARTED,
    "conversation_started category",
  )
  assert(conversationStarted.event_source_url === VESTO_EVENT_SOURCE_URL, "ConversationStarted event_source_url")
  assert(conversationStarted.user_data.fbc, "CRM should include fbc when fbclid stored")

  const leadQualified = buildLeadQualifiedEvent({
    contact: mockContactCrm,
    eventId: "test-qualified-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(leadQualified.event_name === LEAD_QUALIFIED_EVENT, "LeadQualified event_name")
  assert(leadQualified.custom_data.content_category === CONTENT_CATEGORY.QUALIFIED_LEAD, "qualified_lead category")
  assert(leadQualified.event_source_url === VESTO_EVENT_SOURCE_URL, "LeadQualified event_source_url")

  const quote = buildQuoteEvent({
    contact: mockContactCrm,
    amount: 500,
    eventId: "test-quote-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(quote.event_name === QUOTE_EVENT, "Quote event_name")
  assert(quote.action_source === "system_generated", "Quote CRM action_source")
  assert(quote.custom_data.event_source === "crm", "Quote CRM event_source")
  assert(quote.custom_data.content_category === CONTENT_CATEGORY.QUOTE, "Quote content_category")
  assert(quote.custom_data.lead_event_source === "Vesto", "Quote lead_event_source")
  assert(quote.event_source_url === VESTO_EVENT_SOURCE_URL, "Quote event_source_url")
  assert(!quote.messaging_channel, "CRM should not have messaging_channel")

  const ctwaMode = resolveTrackingMode(mockContactCtwa)
  assert(ctwaMode.mode === "ctwa", "CTWA contact should use ctwa mode")

  const ctwaQuote = buildQuoteEvent({
    contact: mockContactCtwa,
    amount: 500,
    eventId: "test-quote-ctwa-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: ctwaMode,
  })
  assert(ctwaQuote.event_name === QUOTE_EVENT, "CTWA Quote keeps contract name by default")
  assert(ctwaQuote.action_source === "system_generated", "CTWA no pixel usa system_generated")
  assert(ctwaQuote.user_data.whatsapp_business_account_id === 61586091841500, "CTWA WABA id")
  assert(!ctwaQuote.user_data.page_id, "CTWA must not send page_id")
  assert(ctwaQuote.user_data.ctwa_clid, "CTWA ctwa_clid")
  assert(ctwaQuote.custom_data.event_source === "ctwa", "CTWA event_source")
  assert(ctwaQuote.custom_data.content_category === CONTENT_CATEGORY.QUOTE, "CTWA Quote content_category")
  assert(ctwaQuote.event_source_url, "CTWA no pixel envia event_source_url")

  const ctwaQualified = buildLeadQualifiedEvent({
    contact: mockContactCtwa,
    eventId: "test-qualified-ctwa-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: ctwaMode,
  })
  assert(ctwaQualified.event_name === LEAD_QUALIFIED_EVENT, "CTWA LeadQualified keeps contract name by default")
  assert(ctwaQualified.action_source === "system_generated", "CTWA no pixel usa system_generated")
  assert(ctwaQualified.event_source_url, "CTWA no pixel envia event_source_url")
  assert(ctwaQualified.custom_data.content_category === CONTENT_CATEGORY.QUALIFIED_LEAD, "CTWA qualified category")

  const ctwaConversation = buildConversationStartedEvent({
    contact: mockContactCtwa,
    eventId: "test-conversation-ctwa-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: ctwaMode,
  })
  assert(ctwaConversation.event_name === CONVERSATION_STARTED_EVENT, "CTWA ConversationStarted keeps contract name by default")

  const crmPurchase = buildPurchaseEvent({
    contact: mockContactCrm,
    amount: 800,
    ticket: "PED-99",
    eventId: "test-purchase-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(crmPurchase.event_name === PURCHASE_EVENT, "CRM purchase event")
  assert(crmPurchase.action_source === "system_generated", "CRM purchase action_source")
  assert(crmPurchase.custom_data.content_category === CONTENT_CATEGORY.PURCHASE, "Purchase content_category")
  assert(crmPurchase.event_source_url === VESTO_EVENT_SOURCE_URL, "Purchase event_source_url")

  console.log("✓ Payload tests passed (CRM + CTWA custom funnel)")
}

async function testLiveApi() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PIXEL_ID) {
    console.log("⊘ Live API skipped (set META_PIXEL_ID + META_ACCESS_TOKEN)")
    return
  }

  const testEventCode = String(process.env.META_TEST_EVENT_CODE || process.env.META_TEST_CODE || "").trim()
  if (!testEventCode) {
    console.log("⊘ Live API skipped (defina META_TEST_EVENT_CODE — scripts não enviam ao dataset real sem test code)")
    return
  }

  const integration = {
    ...mockIntegration,
    pixelId: process.env.META_PIXEL_ID,
    accessToken: process.env.META_ACCESS_TOKEN,
    testEventCode,
  }

  const payload = buildQuoteEvent({
    contact: mockContactCrm,
    amount: 1,
    eventId: `vesto-script-test-${Date.now()}`,
    userId: "script-test",
    integration,
    mode: { mode: "crm" },
  })

  const url = `https://graph.facebook.com/v22.0/${integration.pixelId}/events?access_token=${encodeURIComponent(integration.accessToken)}`
  const body = { data: [payload], test_event_code: testEventCode }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(JSON.stringify(json))
  }
  console.log(`✓ Live API Quote (CRM) accepted — events_received: ${json.events_received}`)
}

async function main() {
  testPayloads()
  await testLiveApi()
  console.log("All meta event tests OK")
}

main().catch((err) => {
  console.error("Meta event tests FAILED:", err.message || err)
  process.exit(1)
})

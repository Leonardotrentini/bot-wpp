/**
 * Testa payloads e (opcionalmente) envio real à Meta.
 * Uso: node scripts/test-meta-events.js
 * Env: META_PIXEL_ID, META_ACCESS_TOKEN, META_TEST_CODE (opcional)
 */

const {
  resolveTrackingMode,
  buildQuoteEvent,
  buildPurchaseEvent,
} = require("../src/lib/metaConversions")

const mockContactCrm = {
  id: "contact-crm-1",
  phone: "554796747378",
  pushName: "Lead LP",
  customFields: {},
}

const mockContactCtwa = {
  id: "contact-ctwa-1",
  phone: "554796747378",
  pushName: "Lead CTWA",
  customFields: { meta: { ctwaClid: "ARAkTestCtwaClid123456789" } },
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

  const crmLead = buildQuoteEvent({
    contact: mockContactCrm,
    amount: 500,
    eventId: "test-lead-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(crmLead.event_name === "Lead", "CRM lead event_name")
  assert(crmLead.action_source === "system_generated", "CRM action_source")
  assert(!crmLead.messaging_channel, "CRM should not have messaging_channel")
  assert(crmLead.custom_data.event_source === "crm", "CRM custom_data.event_source")
  assert(crmLead.custom_data.lead_event_source === "Vesto", "CRM lead_event_source")
  assert(!crmLead.user_data.page_id, "CRM should not require page_id")

  const ctwaMode = resolveTrackingMode(mockContactCtwa)
  assert(ctwaMode.mode === "ctwa", "CTWA contact should use ctwa mode")

  const ctwaLead = buildQuoteEvent({
    contact: mockContactCtwa,
    amount: 500,
    eventId: "test-lead-ctwa-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: ctwaMode,
  })
  assert(ctwaLead.event_name === "LeadSubmitted", "CTWA lead event_name")
  assert(ctwaLead.action_source === "business_messaging", "CTWA action_source")
  assert(ctwaLead.messaging_channel === "whatsapp", "CTWA messaging_channel")
  assert(ctwaLead.user_data.page_id === 61586091841500, "CTWA page_id")
  assert(ctwaLead.user_data.ctwa_clid, "CTWA ctwa_clid")

  const crmPurchase = buildPurchaseEvent({
    contact: mockContactCrm,
    amount: 800,
    ticket: "PED-99",
    eventId: "test-purchase-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(crmPurchase.event_name === "Purchase", "CRM purchase event")
  assert(crmPurchase.action_source === "system_generated", "CRM purchase action_source")

  console.log("✓ Payload tests passed (CRM + CTWA)")
}

async function testLiveApi() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PIXEL_ID) {
    console.log("⊘ Live API skipped (set META_PIXEL_ID + META_ACCESS_TOKEN)")
    return
  }

  const integration = {
    ...mockIntegration,
    pixelId: process.env.META_PIXEL_ID,
    accessToken: process.env.META_ACCESS_TOKEN,
    testEventCode: process.env.META_TEST_CODE || "",
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
  const body = { data: [payload] }
  if (integration.testEventCode) body.test_event_code = integration.testEventCode

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(JSON.stringify(json))
  }
  console.log(`✓ Live API Lead (CRM) accepted — events_received: ${json.events_received}`)
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

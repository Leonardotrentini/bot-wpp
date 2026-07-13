/**
 * Contrato CAPI Meta — content_category, event_id, test_event_code.
 * Uso: node scripts/test-meta-capi-contract.js
 */

const {
  CONVERSATION_STARTED_EVENT,
  LEAD_QUALIFIED_EVENT,
  QUOTE_EVENT,
  PURCHASE_EVENT,
  CONTENT_CATEGORY,
  FUNNEL_STAGES,
  resolveTrackingMode,
  buildConversationStartedEvent,
  buildLeadQualifiedEvent,
  buildQuoteEvent,
  buildPurchaseEvent,
  buildOccurrenceEventId,
  resolveTestEventCode,
  resolveMetaPayloadEventName,
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
  pixelId: "1566611764859334",
  accessToken: "test-token",
  facebookPageId: "538521692670287",
  testEventCode: "TEST_FROM_DB",
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertFunnelPayload(payload, { eventName, contentCategory }) {
  assert(payload.event_name === eventName, `event_name esperado ${eventName}, recebeu ${payload.event_name}`)
  assert(payload.event_id, "event_id ausente")
  assert(payload.custom_data, "custom_data ausente")
  assert(
    payload.custom_data.content_category === contentCategory,
    `content_category esperado ${contentCategory}, recebeu ${payload.custom_data.content_category}`,
  )
  assert(payload.custom_data.lead_event_source === "Vesto", "lead_event_source deve ser Vesto")
}

function testFunnelStageMap() {
  assert(FUNNEL_STAGES[CONVERSATION_STARTED_EVENT].contentCategory === "conversation_started")
  assert(FUNNEL_STAGES[LEAD_QUALIFIED_EVENT].contentCategory === "qualified_lead")
  assert(FUNNEL_STAGES[QUOTE_EVENT].contentCategory === "quote")
  assert(FUNNEL_STAGES[PURCHASE_EVENT].contentCategory === "purchase")
  assert(CONTENT_CATEGORY.QUALIFIED_LEAD === "qualified_lead")
  console.log("✓ FUNNEL_STAGES map")
}

function testStableEventIds() {
  const stable = buildOccurrenceEventId({
    eventIdPrefix: "vesto-lead-qualified",
    contactId: "abc",
    stable: true,
  })
  assert(stable === "vesto-lead-qualified-abc", "event_id estável por contato")

  const purchase = buildOccurrenceEventId({
    eventIdPrefix: "vesto-purchase",
    contactId: "abc",
    ticket: "PED-1",
    stable: false,
  })
  assert(purchase === "vesto-purchase-abc-PED-1", "event_id com ticket")
  console.log("✓ event_id estável / por ocorrência")
}

function testTestEventCodeEnv() {
  const prevEnv = process.env.META_TEST_EVENT_CODE
  const prevDb = mockIntegration.testEventCode
  try {
    delete process.env.META_TEST_EVENT_CODE
    assert(resolveTestEventCode(mockIntegration, { useTestCode: false }) === null, "sem useTestCode")
    assert(resolveTestEventCode(mockIntegration, { useTestCode: true }) === "TEST_FROM_DB", "fallback DB")

    process.env.META_TEST_EVENT_CODE = "TEST_ENV_ONLY"
    assert(resolveTestEventCode(mockIntegration, { useTestCode: true }) === "TEST_ENV_ONLY", "env tem prioridade")
  } finally {
    if (prevEnv == null) delete process.env.META_TEST_EVENT_CODE
    else process.env.META_TEST_EVENT_CODE = prevEnv
    mockIntegration.testEventCode = prevDb
  }
  console.log("✓ test_event_code só com useTestCode + env/DB")
}

function testCrmPayloads() {
  const crmMode = resolveTrackingMode(mockContactCrm)
  const integration = mockIntegration
  const userId = "user-1"

  const stages = [
    {
      build: () =>
        buildConversationStartedEvent({
          contact: mockContactCrm,
          eventId: "vesto-conversation-started-contact-crm-1",
          userId,
          integration,
          mode: crmMode,
        }),
      eventName: CONVERSATION_STARTED_EVENT,
      contentCategory: "conversation_started",
    },
    {
      build: () =>
        buildLeadQualifiedEvent({
          contact: mockContactCrm,
          eventId: "vesto-lead-qualified-contact-crm-1",
          userId,
          integration,
          mode: crmMode,
        }),
      eventName: LEAD_QUALIFIED_EVENT,
      contentCategory: "qualified_lead",
    },
    {
      build: () =>
        buildQuoteEvent({
          contact: mockContactCrm,
          amount: 500,
          eventId: "vesto-quote-contact-crm-1",
          userId,
          integration,
          mode: crmMode,
        }),
      eventName: QUOTE_EVENT,
      contentCategory: "quote",
    },
    {
      build: () =>
        buildPurchaseEvent({
          contact: mockContactCrm,
          amount: 800,
          ticket: "PED-99",
          eventId: "vesto-purchase-contact-crm-1-PED-99",
          userId,
          integration,
          mode: crmMode,
        }),
      eventName: PURCHASE_EVENT,
      contentCategory: "purchase",
    },
  ]

  for (const stage of stages) {
    const payload = stage.build()
    assertFunnelPayload(payload, stage)
  }
  console.log("✓ payloads CRM com content_category")
}

function testCtwaPayloadsDefaultNames() {
  const prev = process.env.META_USE_CTWA_EVENT_ALIASES
  delete process.env.META_USE_CTWA_EVENT_ALIASES
  try {
    const ctwaMode = resolveTrackingMode(mockContactCtwa)
    assert(ctwaMode.mode === "ctwa", "modo ctwa")

    const conversation = buildConversationStartedEvent({
      contact: mockContactCtwa,
      eventId: "vesto-conversation-started-contact-ctwa-1",
      userId: "user-1",
      integration: mockIntegration,
      mode: ctwaMode,
    })
    assert(
      resolveMetaPayloadEventName(CONVERSATION_STARTED_EVENT, ctwaMode) === CONVERSATION_STARTED_EVENT,
      "sem alias CTWA por padrão",
    )
    assertFunnelPayload(conversation, {
      eventName: CONVERSATION_STARTED_EVENT,
      contentCategory: "conversation_started",
    })
    assert(conversation.action_source === "business_messaging", "CTWA action_source")
    assert(conversation.custom_data.content_category === "conversation_started", "CTWA content_category")

    const qualified = buildLeadQualifiedEvent({
      contact: mockContactCtwa,
      eventId: "vesto-lead-qualified-contact-ctwa-1",
      userId: "user-1",
      integration: mockIntegration,
      mode: ctwaMode,
    })
    assertFunnelPayload(qualified, {
      eventName: LEAD_QUALIFIED_EVENT,
      contentCategory: "qualified_lead",
    })
  } finally {
    if (prev == null) delete process.env.META_USE_CTWA_EVENT_ALIASES
    else process.env.META_USE_CTWA_EVENT_ALIASES = prev
  }
  console.log("✓ payloads CTWA com nomes do contrato + content_category")
}

function main() {
  testFunnelStageMap()
  testStableEventIds()
  testTestEventCodeEnv()
  testCrmPayloads()
  testCtwaPayloadsDefaultNames()
  console.log("\nAll meta CAPI contract tests OK")
}

main()

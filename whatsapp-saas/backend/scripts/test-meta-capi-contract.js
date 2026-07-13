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

    const stages = [
      () =>
        buildConversationStartedEvent({
          contact: mockContactCtwa,
          eventId: "vesto-conversation-started-contact-ctwa-1",
          userId: "user-1",
          integration: mockIntegration,
          mode: ctwaMode,
        }),
      () =>
        buildLeadQualifiedEvent({
          contact: mockContactCtwa,
          eventId: "vesto-lead-qualified-contact-ctwa-1",
          userId: "user-1",
          integration: mockIntegration,
          mode: ctwaMode,
        }),
      () =>
        buildQuoteEvent({
          contact: mockContactCtwa,
          amount: 500,
          eventId: "vesto-quote-contact-ctwa-1",
          userId: "user-1",
          integration: mockIntegration,
          mode: ctwaMode,
        }),
      () =>
        buildPurchaseEvent({
          contact: mockContactCtwa,
          amount: 800,
          ticket: "PED-CTWA",
          eventId: "vesto-purchase-contact-ctwa-1-PED-CTWA",
          userId: "user-1",
          integration: mockIntegration,
          mode: ctwaMode,
        }),
    ]

    for (const build of stages) {
      const payload = build()
      assert(payload.action_source === "system_generated", "CTWA no pixel usa system_generated")
      assert(payload.event_source_url, "CTWA no pixel inclui event_source_url")
      assert(!payload.messaging_channel, "CTWA no pixel sem messaging_channel")
      assert(payload.user_data?.ctwa_clid, "CTWA user_data.ctwa_clid")
      assert(payload.custom_data?.content_category, "CTWA content_category")
      assert(
        resolveMetaPayloadEventName(payload.event_name, ctwaMode) === payload.event_name,
        "nomes do contrato sem alias",
      )
    }

    const integrationNoWaba = { ...mockIntegration, facebookPageId: "" }
    const quoteNoWaba = buildQuoteEvent({
      contact: mockContactCtwa,
      amount: 100,
      eventId: "vesto-quote-no-waba",
      userId: "user-1",
      integration: integrationNoWaba,
      mode: ctwaMode,
    })
    assert(quoteNoWaba.user_data.ctwa_clid, "CTWA sem WABA configurado ainda envia ctwa_clid")
    assert(!quoteNoWaba.user_data.whatsapp_business_account_id, "sem WABA id quando não configurado")
  } finally {
    if (prev == null) delete process.env.META_USE_CTWA_EVENT_ALIASES
    else process.env.META_USE_CTWA_EVENT_ALIASES = prev
  }
  console.log("✓ payloads CTWA com nomes do contrato + ctwa_clid + content_category")
}

function testCrmLpAttributionPayloads() {
  const contactLp = {
    id: "contact-lp-1",
    phone: "554796747378",
    customFields: {
      meta: {
        fbclid: "IwARtestFbclid123",
        fbc: "fb.1.1700000000.IwARtestFbclid123",
        fbp: "fb.1.1700000000.1234567890",
      },
    },
  }
  const crmMode = resolveTrackingMode(contactLp)
  assert(crmMode.mode === "crm", "LP sem ctwa = crm")

  const qualified = buildLeadQualifiedEvent({
    contact: contactLp,
    eventId: "vesto-lead-qualified-contact-lp-1",
    userId: "user-1",
    integration: mockIntegration,
    mode: crmMode,
  })
  assert(qualified.action_source === "system_generated", "LP action_source")
  assert(qualified.user_data.fbc, "LP user_data.fbc")
  assert(qualified.user_data.fbp, "LP user_data.fbp")
  assert(qualified.custom_data.content_category === "qualified_lead", "LP content_category")
  console.log("✓ payloads LP com fbc/fbp + content_category")
}

function main() {
  testFunnelStageMap()
  testStableEventIds()
  testTestEventCodeEnv()
  testCrmPayloads()
  testCtwaPayloadsDefaultNames()
  testCrmLpAttributionPayloads()
  console.log("\nAll meta CAPI contract tests OK")
}

main()

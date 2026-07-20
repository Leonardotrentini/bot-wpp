/**
 * Persistência de tentativas CAPI — fonte da verdade do que a Meta aceitou.
 */

async function recordMetaEventDelivery(prisma, row) {
  if (!prisma?.metaEventDelivery?.create) return null
  try {
    return await prisma.metaEventDelivery.create({
      data: {
        userId: row.userId,
        contactId: row.contactId || null,
        activityId: row.activityId || null,
        eventName: String(row.eventName || "").slice(0, 80),
        eventId: row.eventId ? String(row.eventId).slice(0, 180) : null,
        pixelId: row.pixelId ? String(row.pixelId).slice(0, 64) : null,
        actionSource: row.actionSource ? String(row.actionSource).slice(0, 64) : null,
        eventTime: row.eventTime != null ? Number(row.eventTime) : null,
        value: row.value != null && Number.isFinite(Number(row.value)) ? Number(row.value) : null,
        hasFbc: Boolean(row.hasFbc),
        hasFbp: Boolean(row.hasFbp),
        hasAdsAttribution: Boolean(row.hasAdsAttribution),
        httpOk: Boolean(row.httpOk),
        eventsReceived: Math.max(0, Number(row.eventsReceived) || 0),
        fbtraceId: row.fbtraceId ? String(row.fbtraceId).slice(0, 120) : null,
        error: row.error ? String(row.error).slice(0, 500) : null,
        metaMessages: row.metaMessages ?? undefined,
        testMode: Boolean(row.testMode),
      },
    })
  } catch (err) {
    console.error("[metaEventDelivery]", err?.message || err)
    return null
  }
}

function isMetaDeliveryAccepted(metaResponse) {
  return Number(metaResponse?.events_received) >= 1
}

module.exports = {
  recordMetaEventDelivery,
  isMetaDeliveryAccepted,
}

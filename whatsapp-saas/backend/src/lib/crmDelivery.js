/**
 * Fila de envio do CRM (fluxos e IA).
 * Processada pelo tick do scheduler — envia 1 por vez com pequenas pausas.
 */

const { emitCrmEvent, formatMessageRow, formatConversationRow, previewFromBody, CONVERSATION_INCLUDE } = require("./crmCore")
const { buildOutboundMessageRaw, stripMediaBase64 } = require("./crmMedia")
const { ensureWhatsAppConnected } = require("./whatsappConnection")
const { resolveRecordingDelayMs } = require("./flowRecordingDelay")
const { probeMediaDurationSeconds } = require("./whatsappAudio")
const {
  validateOutboundSendResponse,
  pollOutboundDeliveryAck,
  assertOutboundRecipient,
  validateOutboundMediaPayload,
} = require("./crmOutboundSend")

const CRM_DELIVERY_BATCH = Number(process.env.CRM_DELIVERY_BATCH || 5)
const CRM_DELIVERY_GAP_MS = Number(process.env.CRM_DELIVERY_GAP_MS || 2000)
const CRM_DELIVERY_STALE_MS = Number(process.env.CRM_DELIVERY_STALE_MS || 5 * 60 * 1000)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let busy = false

/** WhatsApp só mantém “gravando…” ~3s por pacote — renovar a cada pulso. */
const PRESENCE_PULSE_MS = Number(process.env.CRM_PRESENCE_PULSE_MS || 2500)

async function playRecordingPresence(deps, instanceName, to, totalMs) {
  if (!totalMs || totalMs <= 0) return
  if (typeof deps.sendPresence !== "function") {
    console.warn("[crm-delivery] sendPresence indisponível — aguardando localmente", totalMs, "ms")
    await wait(totalMs)
    return
  }

  const started = Date.now()
  while (Date.now() - started < totalMs) {
    const elapsed = Date.now() - started
    const remaining = totalMs - elapsed
    const pulse = Math.max(500, Math.min(remaining, PRESENCE_PULSE_MS))
    try {
      await deps.sendPresence(instanceName, to, { presence: "recording", delayMs: pulse })
    } catch (err) {
      console.warn(`[crm-delivery] presence recording falhou (${pulse}ms → ${to}):`, err?.message || err)
    }
    await wait(pulse)
  }
}

async function resolveAudioPresenceMs(delivery, mediaBase64, mediaMime) {
  const configured = Number(delivery.presenceDelayMs) || 0
  let audioSec = null
  try {
    audioSec = await probeMediaDurationSeconds({ media: mediaBase64, mimetype: mediaMime })
  } catch {
    /* segue com configured */
  }
  const fromAction = resolveRecordingDelayMs(
    {
      mediaType: "audio",
      recordingDelayValue: configured > 0 ? Math.round(configured / 1000) : 0,
    },
    { audioDurationSec: audioSec },
  )
  return fromAction > 0 ? fromAction : configured
}

async function activateNextDelivery(prisma, completedRow) {
  const next = await prisma.crmDelivery.findFirst({
    where: {
      conversationId: completedRow.conversationId,
      status: "pending",
      createdAt: { gt: completedRow.createdAt },
    },
    orderBy: { createdAt: "asc" },
  })
  if (!next) return
  const delayMs = Number(next.delayAfterPreviousMs) || 0
  await prisma.crmDelivery.update({
    where: { id: next.id },
    data: { scheduledAt: new Date(Date.now() + delayMs) },
  })
}

async function recoverStaleSendingDeliveries(prisma) {
  const cutoff = new Date(Date.now() - CRM_DELIVERY_STALE_MS)
  const { count } = await prisma.crmDelivery.updateMany({
    where: { status: "sending", updatedAt: { lt: cutoff } },
    data: { status: "pending", error: null },
  })
  if (count > 0) console.warn(`[crm-delivery] ${count} envio(s) preso(s) em "sending" — reenfileirados.`)
}

async function processOneDelivery(deps, delivery) {
  const { prisma, sendText, sendMedia, sendWhatsAppAudio, sendPresence, io } = deps

  const conversation = await prisma.crmConversation.findUnique({
    where: { id: delivery.conversationId },
    include: CONVERSATION_INCLUDE,
  })
  if (!conversation) {
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "cancelled", error: "Conversa não existe mais." },
    })
    return
  }

  const conn = await ensureWhatsAppConnected(prisma, delivery.userId)
  if (!conn) {
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", error: "WhatsApp desconectado." },
    })
    return
  }

  await prisma.crmDelivery.update({ where: { id: delivery.id }, data: { status: "sending" } })

  try {
    const to = assertOutboundRecipient(conversation)
    const mediaType = delivery.mediaType && delivery.mediaType !== "none" ? delivery.mediaType : "none"
    const hasMedia = ["image", "video", "audio", "document"].includes(mediaType)
    const sendContext = hasMedia ? `mídia (${mediaType})` : "texto"

    validateOutboundMediaPayload({
      body: delivery.body,
      mediaType,
      mediaBase64: delivery.mediaBase64,
      mediaMime: delivery.mediaMime,
      mediaName: delivery.mediaName,
    })

    let resp
    if (hasMedia) {
      const media = stripMediaBase64(delivery.mediaBase64)
      if (mediaType === "audio") {
        const presenceMs = await resolveAudioPresenceMs(delivery, media, delivery.mediaMime)
        if (presenceMs > 0) {
          await playRecordingPresence(deps, conn.instanceName, to, presenceMs)
        }
      }
      if (mediaType === "audio" && typeof sendWhatsAppAudio === "function") {
        const mimetype = delivery.mediaMime || "audio/ogg; codecs=opus"
        resp = await sendWhatsAppAudio(conn.instanceName, to, {
          audio: media,
          mimetype,
          encoding: true,
        })
      } else {
        resp = await sendMedia(conn.instanceName, to, {
          mediatype: mediaType,
          media,
          mimetype: delivery.mediaMime || undefined,
          caption: delivery.body || undefined,
          fileName: delivery.mediaName || undefined,
        })
      }
    } else {
      resp = await sendText(conn.instanceName, to, delivery.body || "")
    }

    const providerMessageId = validateOutboundSendResponse(resp, {
      context: sendContext,
      mediaType: hasMedia ? mediaType : "none",
    })

    const now = new Date()
    const msgType = hasMedia ? mediaType : "text"
    const mediaB64 = hasMedia ? stripMediaBase64(delivery.mediaBase64) : null
    const storedMime = hasMedia
      ? mediaType === "audio"
        ? resp?._vestoAudio?.mimetype || delivery.mediaMime || "audio/ogg; codecs=opus"
        : delivery.mediaMime || null
      : null
    const messageRaw = hasMedia
      ? buildOutboundMessageRaw({
          providerMessageId,
          remoteJid: delivery.remoteJid,
          evolutionResp: resp,
          mediaBase64: mediaB64,
          mediaMime: storedMime,
          mediaName: delivery.mediaName,
        })
      : null

    let message = await prisma.crmMessage.upsert({
      where: {
        conversationId_messageId: {
          conversationId: conversation.id,
          messageId: providerMessageId,
        },
      },
      create: {
        userId: delivery.userId,
        conversationId: conversation.id,
        messageId: providerMessageId,
        fromMe: true,
        type: msgType,
        body: delivery.body || "",
        mediaMime: storedMime,
        status: "pending",
        source: delivery.kind,
        timestamp: now,
        raw: messageRaw,
      },
      update: {
        body: delivery.body || "",
        type: msgType,
        mediaMime: storedMime,
        status: "pending",
        source: delivery.kind,
        raw: messageRaw ?? undefined,
      },
    })

    let updatedConversation = await prisma.crmConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastMessagePreview: previewFromBody(delivery.body, msgType),
        lastMessageFromMe: true,
      },
      include: CONVERSATION_INCLUDE,
    })

    emitCrmEvent(io, delivery.userId, "crm:message", {
      conversationId: conversation.id,
      message: formatMessageRow(message),
      conversation: formatConversationRow(updatedConversation),
    })

    const ack = await pollOutboundDeliveryAck(deps, {
      instanceName: conn.instanceName,
      conversation,
      to,
      messageId: providerMessageId,
      mediaType: hasMedia ? mediaType : "none",
      sendResp: resp,
    })

    message = await prisma.crmMessage.update({
      where: { id: message.id },
      data: { status: ack.crmStatus },
    })

    if (ack.ackOk) {
      await prisma.crmDelivery.update({
        where: { id: delivery.id },
        data: { status: "sent", sentAt: now, providerMessageId, error: null },
      })
    } else {
      await prisma.crmDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          providerMessageId,
          error: String(ack.detail || "WhatsApp não confirmou entrega.").slice(0, 500),
        },
      })
      emitCrmEvent(io, delivery.userId, "crm:delivery_failed", {
        conversationId: delivery.conversationId,
        deliveryId: delivery.id,
        kind: delivery.kind,
        error: ack.detail || "WhatsApp não confirmou a entrega.",
      })
    }

    emitCrmEvent(io, delivery.userId, "crm:message_status", {
      conversationId: conversation.id,
      messageId: providerMessageId,
      status: ack.crmStatus,
      message: formatMessageRow(message),
    })

    await activateNextDelivery(prisma, delivery)
  } catch (err) {
    const errMsg = String(err?.message || "Falha no envio.")
    console.error(`[crm-delivery] envio falhou (${delivery.id}):`, errMsg)
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", error: errMsg.slice(0, 500) },
    })
    emitCrmEvent(io, delivery.userId, "crm:delivery_failed", {
      conversationId: delivery.conversationId,
      deliveryId: delivery.id,
      kind: delivery.kind,
      error: errMsg,
    })
    await activateNextDelivery(prisma, delivery)
  }
}

async function pickEligibleDeliveries(prisma, limit) {
  const now = new Date()
  const candidates = await prisma.crmDelivery.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
    orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
    take: Math.max(limit * 4, limit),
  })
  if (!candidates.length) return []

  const sendingRows = await prisma.crmDelivery.findMany({
    where: { status: "sending" },
    select: { conversationId: true },
  })
  const blocked = new Set(sendingRows.map((r) => r.conversationId))
  const picked = []
  const pickedConversations = new Set()

  for (const row of candidates) {
    if (blocked.has(row.conversationId)) continue
    if (pickedConversations.has(row.conversationId)) continue
    const olderPending = await prisma.crmDelivery.findFirst({
      where: {
        conversationId: row.conversationId,
        status: "pending",
        createdAt: { lt: row.createdAt },
      },
      select: { id: true },
    })
    if (olderPending) continue
    picked.push(row)
    pickedConversations.add(row.conversationId)
    if (picked.length >= limit) break
  }
  return picked
}

async function processPendingCrmDeliveries(deps) {
  if (busy) return 0
  busy = true
  try {
    await recoverStaleSendingDeliveries(deps.prisma)
    const pending = await pickEligibleDeliveries(deps.prisma, CRM_DELIVERY_BATCH)
    for (let i = 0; i < pending.length; i += 1) {
      await processOneDelivery(deps, pending[i])
      if (i < pending.length - 1) await wait(CRM_DELIVERY_GAP_MS)
    }
    return pending.length
  } finally {
    busy = false
  }
}

module.exports = { processPendingCrmDeliveries, playRecordingPresence }

/**
 * Fila de envio do CRM (fluxos e IA).
 * Processada pelo tick do scheduler — envia 1 por vez com pequenas pausas.
 */

const { emitCrmEvent, formatMessageRow, formatConversationRow, previewFromBody, CONVERSATION_INCLUDE } = require("./crmCore")
const { buildOutboundMessageRaw, stripMediaBase64 } = require("./crmMedia")
const { ensureWhatsAppConnected } = require("./whatsappConnection")
const {
  confirmEvolutionDelivery,
  assertOutboundRecipient,
  validateOutboundMediaPayload,
} = require("./crmOutboundSend")

const CRM_DELIVERY_BATCH = Number(process.env.CRM_DELIVERY_BATCH || 5)
const CRM_DELIVERY_GAP_MS = Number(process.env.CRM_DELIVERY_GAP_MS || 2000)
const CRM_DELIVERY_STALE_MS = Number(process.env.CRM_DELIVERY_STALE_MS || 5 * 60 * 1000)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let busy = false

/** WhatsApp renova presença a cada ~20s; chunks menores para renovar antes de expirar. */
const PRESENCE_CHUNK_MS = 18000
const PRESENCE_CHUNK_GAP_MS = 400

async function playRecordingPresence(deps, instanceName, to, totalMs) {
  if (!totalMs || totalMs <= 0) return
  if (typeof deps.sendPresence !== "function") {
    console.warn("[crm-delivery] sendPresence indisponível — aguardando localmente", totalMs, "ms")
    await wait(totalMs)
    return
  }

  let remaining = totalMs
  while (remaining > 0) {
    const chunk = Math.min(remaining, PRESENCE_CHUNK_MS)
    try {
      await deps.sendPresence(instanceName, to, { presence: "recording", delayMs: chunk })
    } catch (err) {
      console.warn(
        `[crm-delivery] presence recording falhou (${chunk}ms → ${to}):`,
        err?.message || err,
      )
      await wait(chunk)
      remaining -= chunk
      continue
    }

    await wait(chunk)
    remaining -= chunk
    if (remaining > 0) await wait(PRESENCE_CHUNK_GAP_MS)
  }
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
        const presenceMs = Number(delivery.presenceDelayMs) || 0
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

    const { messageId: providerMessageId, crmStatus } = await confirmEvolutionDelivery(deps, {
      instanceName: conn.instanceName,
      conversation,
      to,
      resp,
      context: hasMedia ? `mídia (${mediaType})` : "texto",
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

    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "sent", sentAt: now, providerMessageId },
    })

    const message = await prisma.crmMessage.create({
      data: {
        userId: delivery.userId,
        conversationId: conversation.id,
        messageId: providerMessageId,
        fromMe: true,
        type: msgType,
        body: delivery.body || "",
        mediaMime: storedMime,
        status: crmStatus || "sent",
        source: delivery.kind,
        timestamp: now,
        raw: hasMedia
          ? buildOutboundMessageRaw({
              providerMessageId,
              remoteJid: delivery.remoteJid,
              evolutionResp: resp,
              mediaBase64: mediaB64,
              mediaMime: storedMime,
              mediaName: delivery.mediaName,
            })
          : null,
      },
    })

    const updatedConversation = await prisma.crmConversation.update({
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

module.exports = { processPendingCrmDeliveries }

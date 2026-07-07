/**
 * Fila de envio do CRM (fluxos e IA).
 * Processada pelo tick do scheduler — envia 1 por vez com pequenas pausas.
 */

const { emitCrmEvent, formatMessageRow, formatConversationRow, previewFromBody, CONVERSATION_INCLUDE } = require("./crmCore")

const CRM_DELIVERY_BATCH = Number(process.env.CRM_DELIVERY_BATCH || 5)
const CRM_DELIVERY_GAP_MS = Number(process.env.CRM_DELIVERY_GAP_MS || 2000)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let busy = false

function extractProviderMessageId(resp) {
  return resp?.key?.id || resp?.messageId || resp?.id || null
}

async function processOneDelivery(deps, delivery) {
  const { prisma, sendText, sendMedia, io } = deps

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

  const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: delivery.userId } })
  if (!conn || !conn.connected) {
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", error: "WhatsApp desconectado." },
    })
    return
  }

  await prisma.crmDelivery.update({ where: { id: delivery.id }, data: { status: "sending" } })

  try {
    const mediaType = delivery.mediaType && delivery.mediaType !== "none" ? delivery.mediaType : "none"
    const hasMedia = ["image", "video", "audio"].includes(mediaType)
    let resp
    if (hasMedia) {
      const media = String(delivery.mediaBase64 || "").replace(/^data:[^;]+;base64,/, "")
      resp = await sendMedia(conn.instanceName, delivery.remoteJid, {
        mediatype: mediaType,
        media,
        mimetype: delivery.mediaMime || undefined,
        caption: delivery.body || undefined,
        fileName: delivery.mediaName || undefined,
      })
    } else {
      resp = await sendText(conn.instanceName, delivery.remoteJid, delivery.body || "")
    }
    const providerMessageId = extractProviderMessageId(resp)
    const now = new Date()
    const msgType = hasMedia ? mediaType : "text"

    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "sent", sentAt: now, providerMessageId },
    })

    const message = await prisma.crmMessage.create({
      data: {
        userId: delivery.userId,
        conversationId: conversation.id,
        messageId: providerMessageId || `crm-${delivery.id}`,
        fromMe: true,
        type: msgType,
        body: delivery.body || "",
        mediaMime: hasMedia ? delivery.mediaMime || null : null,
        status: "sent",
        source: delivery.kind, // flow | ai
        timestamp: now,
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
    console.error(`[crm-delivery] envio falhou (${delivery.id}):`, err?.message || err)
    await prisma.crmDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", error: String(err?.message || "Falha no envio.") },
    })
  }
}

async function processPendingCrmDeliveries(deps) {
  if (busy) return 0
  busy = true
  try {
    const pending = await deps.prisma.crmDelivery.findMany({
      where: { status: "pending", scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      take: CRM_DELIVERY_BATCH,
    })
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

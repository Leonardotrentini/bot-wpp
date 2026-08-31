/**
 * Pausa todas as automações de fluxo para um contato (ação STOP).
 */

const { logContactActivity } = require("./crmContactActivity")

function isFlowsStopped(contact) {
  return Boolean(contact?.flowsStoppedAt)
}

async function isFlowsStoppedForContact(prisma, contactId, contact = null) {
  if (isFlowsStopped(contact)) return true
  if (!contactId || !prisma) return false
  const row = await prisma.crmContact.findUnique({
    where: { id: contactId },
    select: { flowsStoppedAt: true },
  })
  return Boolean(row?.flowsStoppedAt)
}

/**
 * Marca contato como STOP e cancela entregas pendentes da conversa.
 * Não cancela envios já em "sending" para evitar duplicata no WhatsApp.
 */
async function stopFlowsForContact(prisma, { contactId, conversationId, userId, reason }) {
  if (!contactId || !prisma) return null
  const now = new Date()

  await prisma.crmContact.update({
    where: { id: contactId },
    data: { flowsStoppedAt: now },
  })

  if (conversationId) {
    await prisma.crmDelivery.updateMany({
      where: { conversationId, status: "pending" },
      data: { status: "cancelled", error: "Automações interrompidas (STOP)." },
    })
  }

  if (userId) {
    await logContactActivity(prisma, {
      userId,
      contactId,
      type: "flows_stopped",
      payload: { reason: reason || "stop_flows", conversationId: conversationId || null },
    }).catch(() => {})
  }

  return now
}

module.exports = {
  isFlowsStopped,
  isFlowsStoppedForContact,
  stopFlowsForContact,
}

/**
 * Exclusão de contatos CRM (lead + conversa + mensagens em cascade).
 * CrmDelivery e CrmFlowRun referenciam conversationId sem FK — limpar antes do delete.
 */

async function deleteContactGraph(tx, contactId, conversationId) {
  if (conversationId) {
    await tx.crmDelivery.deleteMany({ where: { conversationId } })
    await tx.crmFlowRun.deleteMany({ where: { conversationId } })
  }
  await tx.crmContact.delete({ where: { id: contactId } })
}

async function deleteScopedContact(prisma, contactId) {
  const contact = await prisma.crmContact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      userId: true,
      conversation: { select: { id: true } },
    },
  })
  if (!contact) return { error: "NOT_FOUND" }

  const conversationId = contact.conversation?.id || null

  await prisma.$transaction(async (tx) => {
    await deleteContactGraph(tx, contact.id, conversationId)
  })

  return {
    contactId: contact.id,
    conversationId,
    userId: contact.userId,
  }
}

async function deleteScopedContacts(prisma, contactIds) {
  const uniqueIds = [...new Set(contactIds.map((id) => String(id || "").trim()).filter(Boolean))]
  const deleted = []
  const notFound = []

  for (const contactId of uniqueIds) {
    const result = await deleteScopedContact(prisma, contactId)
    if (result.error === "NOT_FOUND") {
      notFound.push(contactId)
    } else {
      deleted.push(result)
    }
  }

  return { deleted, notFound }
}

function emitContactDeleted(io, emitCrmEvent, { userId, conversationId, contactId }) {
  if (!io || !userId) return
  emitCrmEvent(io, userId, "crm:conversation_removed", {
    conversationId,
    contactId,
    reason: "deleted",
  })
}

module.exports = {
  deleteScopedContact,
  deleteScopedContacts,
  emitContactDeleted,
}

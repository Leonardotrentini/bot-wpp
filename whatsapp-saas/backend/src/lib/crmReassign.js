/**
 * Reatribui um lead (contato + conversa) de um vendedor para outro da mesma empresa.
 * Usado para corrigir sobreposição quando o WhatsApp foi conectado na conta errada.
 */

const { mergeCrmContacts, MERGE_INCLUDE } = require("./crmContactMerge")

async function resolveTagForSeller(tx, { userId, name, color }) {
  const existing = await tx.crmTag.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
  })
  if (existing) return existing
  return tx.crmTag.create({
    data: { userId, name, color: color || "#22c55e" },
  })
}

async function remapContactTags(tx, { contactId, tagLinks, toUserId }) {
  if (!tagLinks?.length) return
  await tx.crmContactTag.deleteMany({ where: { contactId } })
  const seen = new Set()
  for (const link of tagLinks) {
    const tagName = link.tag?.name
    if (!tagName) continue
    const key = String(tagName).trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const tag = await resolveTagForSeller(tx, {
      userId: toUserId,
      name: tagName,
      color: link.tag?.color,
    })
    await tx.crmContactTag.create({
      data: { contactId, tagId: tag.id },
    })
  }
}

async function moveSideTables(tx, { contactId, conversationId, toUserId }) {
  if (conversationId) {
    await tx.crmMessage.updateMany({
      where: { conversationId },
      data: { userId: toUserId },
    })
  }
  await tx.crmContactActivity.updateMany({
    where: { contactId },
    data: { userId: toUserId },
  })
  await tx.crmContactReminder.updateMany({
    where: { contactId },
    data: { userId: toUserId },
  })
  await tx.metaEventDelivery
    .updateMany({
      where: { contactId },
      data: { userId: toUserId },
    })
    .catch(() => {})
}

/** Quando o destino já tem o mesmo remoteJid: mescla e remove a origem. */
async function mergeIntoExisting(tx, { source, target, toUserId }) {
  return mergeCrmContacts(tx, { source, target, toUserId })
}

/**
 * @returns {{ error?, message?, merged?, contactId?, conversationId?, fromUserId?, toUserId? }}
 */
async function reassignContactToSeller(prisma, { contactId, toUserId }) {
  const source = await prisma.crmContact.findUnique({
    where: { id: contactId },
    include: MERGE_INCLUDE,
  })
  if (!source) return { error: "NOT_FOUND", message: "Contato não encontrado." }

  const fromUserId = source.userId
  if (fromUserId === toUserId) {
    return { error: "SAME_SELLER", message: "Este lead já está com esse vendedor." }
  }

  const target = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId: toUserId, remoteJid: source.remoteJid } },
    include: MERGE_INCLUDE,
  })

  const result = await prisma.$transaction(async (tx) => {
    if (target && target.id !== source.id) {
      return mergeIntoExisting(tx, { source, target, toUserId })
    }

    await remapContactTags(tx, {
      contactId: source.id,
      tagLinks: source.tags,
      toUserId,
    })

    await tx.crmContact.update({
      where: { id: source.id },
      data: { userId: toUserId },
    })

    let conversationId = source.conversation?.id || null
    if (source.conversation) {
      await tx.crmConversation.update({
        where: { id: source.conversation.id },
        data: {
          userId: toUserId,
          kanbanStageId: null,
          aiAgentId: null,
          aiEnabled: false,
          assignedTo: "human",
        },
      })
    }

    await moveSideTables(tx, {
      contactId: source.id,
      conversationId,
      toUserId,
    })

    return { merged: false, contactId: source.id, conversationId }
  })

  return {
    ...result,
    fromUserId,
    toUserId,
  }
}

module.exports = {
  reassignContactToSeller,
}

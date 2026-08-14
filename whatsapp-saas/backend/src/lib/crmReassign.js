/**
 * Reatribui um lead (contato + conversa) de um vendedor para outro da mesma empresa.
 * Usado para corrigir sobreposição quando o WhatsApp foi conectado na conta errada.
 */

const { isGenericSavedName } = require("./crmCore")

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

/**
 * Quando o destino já tem o mesmo remoteJid: mescla mensagens/histórico no destino e remove a origem.
 */
async function mergeIntoExisting(tx, { source, target, toUserId }) {
  const sourceConvo = source.conversation
  const targetConvo = target.conversation

  if (sourceConvo && targetConvo) {
    await tx.crmMessage.updateMany({
      where: { conversationId: sourceConvo.id },
      data: { conversationId: targetConvo.id, userId: toUserId },
    })
  } else if (sourceConvo && !targetConvo) {
    await tx.crmConversation.update({
      where: { id: sourceConvo.id },
      data: {
        userId: toUserId,
        contactId: target.id,
        kanbanStageId: null,
        aiAgentId: null,
        aiEnabled: false,
        assignedTo: "human",
      },
    })
  }

  await tx.crmContactActivity.updateMany({
    where: { contactId: source.id },
    data: { contactId: target.id, userId: toUserId },
  })
  await tx.crmContactReminder.updateMany({
    where: { contactId: source.id },
    data: { contactId: target.id, userId: toUserId },
  })
  await tx.metaAttributionLead
    .updateMany({
      where: { contactId: source.id },
      data: { contactId: target.id },
    })
    .catch(() => {})
  await tx.metaEventDelivery
    .updateMany({
      where: { contactId: source.id },
      data: { contactId: target.id, userId: toUserId },
    })
    .catch(() => {})

  // Tags: remapeia as da origem para o destino (sem duplicar por nome).
  const sourceTags = source.tags || []
  const targetTagNames = new Set(
    (target.tags || []).map((l) => String(l.tag?.name || "").trim().toLowerCase()).filter(Boolean),
  )
  for (const link of sourceTags) {
    const tagName = link.tag?.name
    if (!tagName) continue
    const key = String(tagName).trim().toLowerCase()
    if (targetTagNames.has(key)) continue
    const tag = await resolveTagForSeller(tx, {
      userId: toUserId,
      name: tagName,
      color: link.tag?.color,
    })
    await tx.crmContactTag
      .create({ data: { contactId: target.id, tagId: tag.id } })
      .catch(() => {})
    targetTagNames.add(key)
  }

  const contactPatch = {}
  if (isGenericSavedName(target.name) && !isGenericSavedName(source.name)) {
    contactPatch.name = source.name
  }
  if (!target.notes && source.notes) contactPatch.notes = source.notes
  if (!target.phone && source.phone) contactPatch.phone = source.phone
  if (!target.avatarUrl && source.avatarUrl) contactPatch.avatarUrl = source.avatarUrl
  if (!target.pushName && source.pushName) contactPatch.pushName = source.pushName
  if (Object.keys(contactPatch).length) {
    await tx.crmContact.update({ where: { id: target.id }, data: contactPatch })
  }

  if (sourceConvo && targetConvo) {
    const lastAt = sourceConvo.lastMessageAt
    const targetLast = targetConvo.lastMessageAt
    const patch = {}
    if (lastAt && (!targetLast || lastAt > targetLast)) {
      patch.lastMessageAt = lastAt
      patch.lastMessagePreview = sourceConvo.lastMessagePreview
      patch.lastMessageFromMe = sourceConvo.lastMessageFromMe
    }
    patch.unreadCount = (targetConvo.unreadCount || 0) + (sourceConvo.unreadCount || 0)
    if (Object.keys(patch).length) {
      await tx.crmConversation.update({ where: { id: targetConvo.id }, data: patch })
    }
    await tx.crmConversation.delete({ where: { id: sourceConvo.id } })
  } else if (sourceConvo && targetConvo === null) {
    // já remapeado acima
  }

  await tx.crmContactTag.deleteMany({ where: { contactId: source.id } })
  await tx.crmContact.delete({ where: { id: source.id } })

  return { merged: true, contactId: target.id, conversationId: targetConvo?.id || sourceConvo?.id || null }
}

/**
 * @returns {{ error?, message?, merged?, contactId?, conversationId?, fromUserId?, toUserId? }}
 */
async function reassignContactToSeller(prisma, { contactId, toUserId }) {
  const source = await prisma.crmContact.findUnique({
    where: { id: contactId },
    include: {
      conversation: true,
      tags: { include: { tag: true } },
    },
  })
  if (!source) return { error: "NOT_FOUND", message: "Contato não encontrado." }

  const fromUserId = source.userId
  if (fromUserId === toUserId) {
    return { error: "SAME_SELLER", message: "Este lead já está com esse vendedor." }
  }

  const target = await prisma.crmContact.findUnique({
    where: { userId_remoteJid: { userId: toUserId, remoteJid: source.remoteJid } },
    include: {
      conversation: true,
      tags: { include: { tag: true } },
    },
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

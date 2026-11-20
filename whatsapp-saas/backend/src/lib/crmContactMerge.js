/**
 * Une contatos duplicados da mesma pessoa: JID @lid (número oculto) vs @s.whatsapp.net.
 * Também reutilizado ao reatribuir lead entre vendedores da mesma empresa.
 */

const { phoneLookupVariants, isLikelyPhoneDigits, digitsOnly } = require("./participantIdentity")

function isLidJid(jid) {
  return /@lid$/i.test(String(jid || "").trim())
}

/** Contato com “telefone” falso (ex.: 8 dígitos de LID gravados como @s.whatsapp.net). */
function isMasqueradingLidContact(contact) {
  if (!contact) return false
  if (contact.isLid || isLidJid(contact.remoteJid)) return true
  const digits = digitsOnly(contact.phone || phoneFromPnJid(contact.remoteJid) || "")
  if (!digits) return false
  return !isLikelyPhoneDigits(digits)
}

function isGenericSavedName(name) {
  const n = String(name || "").trim()
  return !n || n.toLowerCase() === "contato" || n.startsWith("Contato #")
}

function phoneFromPnJid(jid) {
  if (isLidJid(jid)) return null
  const digits = String(jid || "").split("@")[0].replace(/\D/g, "")
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

function isDistinctPreview(preview) {
  const p = String(preview || "").trim()
  if (p.length < 16) return false
  if (/^[📷🎬🎤📄💟👤📍]/.test(p) && p.length < 28) return false
  return true
}

/** Chave estável da foto WA (ignora query string / CDN host). */
function avatarFingerprint(url) {
  const raw = String(url || "").trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    const base = u.pathname.split("/").filter(Boolean).pop() || ""
    const cleaned = base.replace(/\.(jpg|jpeg|png|webp)$/i, "")
    return cleaned.length >= 12 ? cleaned.toLowerCase() : null
  } catch {
    const noQuery = raw.split("?")[0]
    const base = noQuery.split("/").filter(Boolean).pop() || ""
    const cleaned = base.replace(/\.(jpg|jpeg|png|webp)$/i, "")
    return cleaned.length >= 12 ? cleaned.toLowerCase() : null
  }
}

function contactMergeScore(contact) {
  let score = 0
  const digits = digitsOnly(contact?.phone || phoneFromPnJid(contact?.remoteJid) || "")
  if (isMasqueradingLidContact(contact)) score -= 20
  if (!isLidJid(contact?.remoteJid)) score += 10
  if (isLikelyPhoneDigits(digits)) score += 12
  else if (digits) score += 1
  if (!isGenericSavedName(contact?.name)) score += 5
  if (contact?.tags?.length) score += 2 * contact.tags.length
  if (contact?.avatarUrl) score += 1
  if (contact?.notes) score += 1
  return score
}

function pickCanonicalPair(a, b) {
  if (contactMergeScore(a) >= contactMergeScore(b)) return { target: a, source: b }
  return { target: b, source: a }
}

/**
 * Entre candidatos com a mesma lastMessagePreview, escolhe o gêmeo do @lid órfão.
 * Só retorna se o match for único (avatar igual, ou um único candidato).
 */
function pickOrphanLidTwin(lidContact, preview, candidates) {
  const expected = String(preview || "").trim()
  if (!isDistinctPreview(expected) || !Array.isArray(candidates)) return null
  const samePreview = candidates.filter((row) => String(row?.lastMessagePreview || "").trim() === expected)
  if (!samePreview.length) return null
  const avatar = lidContact?.avatarUrl
  if (avatar) {
    const sameAvatar = samePreview.filter((row) => row?.contact?.avatarUrl === avatar)
    if (sameAvatar.length === 1) return sameAvatar[0]
    if (sameAvatar.length > 1) return null
  }
  if (samePreview.length === 1) return samePreview[0]
  return null
}

const MERGE_INCLUDE = {
  conversation: true,
  tags: { include: { tag: true } },
}

async function resolveTagForSeller(tx, { userId, name, color }) {
  const existing = await tx.crmTag.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
  })
  if (existing) return existing
  return tx.crmTag.create({
    data: { userId, name, color: color || "#22c55e" },
  })
}

async function loadMergeContact(client, id) {
  if (!id) return null
  return client.crmContact.findUnique({
    where: { id },
    include: MERGE_INCLUDE,
  })
}

async function findContactByPhone(client, { userId, phone, excludeId }) {
  const variants = phoneLookupVariants(phone)
  if (!variants.length) return null
  const jids = variants.map((v) => `${v}@s.whatsapp.net`)
  return client.crmContact.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ phone: { in: variants } }, { remoteJid: { in: jids } }],
    },
    orderBy: [{ isLid: "asc" }, { updatedAt: "desc" }],
  })
}

async function findContactByLidJid(client, { userId, lidJid, excludeId }) {
  const jid = String(lidJid || "").trim()
  if (!jid || !isLidJid(jid)) return null
  return client.crmContact.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ lidJid: jid }, { remoteJid: jid }],
    },
  })
}

async function findContactByAvatarFingerprint(client, { userId, avatarUrl, excludeId, lidOnly = false }) {
  const fp = avatarFingerprint(avatarUrl)
  if (!fp) return null

  const rows = await client.crmContact.findMany({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      avatarUrl: { contains: fp, mode: "insensitive" },
      ...(lidOnly
        ? {
            OR: [
              { isLid: true },
              { remoteJid: { endsWith: "@lid" } },
              // Telefone falso curto (LID mascarado) também conta como órfão.
              { AND: [{ isLid: false }, { phone: { not: null } }] },
            ],
          }
        : {
            isLid: false,
            OR: [{ phone: { not: null } }, { remoteJid: { endsWith: "@s.whatsapp.net" } }],
          }),
    },
    select: {
      id: true,
      remoteJid: true,
      lidJid: true,
      phone: true,
      avatarUrl: true,
      name: true,
      pushName: true,
      isLid: true,
      userId: true,
    },
    take: 12,
  })
  let matches = rows.filter((row) => avatarFingerprint(row.avatarUrl) === fp)
  if (lidOnly) {
    matches = matches.filter((row) => isMasqueradingLidContact(row))
  } else {
    // Par canônico: telefone real (não mascarado).
    matches = matches.filter((row) => !isMasqueradingLidContact(row) && isLikelyPhoneDigits(digitsOnly(row.phone || phoneFromPnJid(row.remoteJid) || "")))
  }
  if (matches.length !== 1) return null
  return matches[0]
}

async function findOrphanLidTwin(client, { userId, contact }) {
  if (!contact || !isMasqueradingLidContact(contact)) return null
  // Se já tem telefone real, não é órfão.
  if (isLikelyPhoneDigits(digitsOnly(contact.phone || phoneFromPnJid(contact.remoteJid) || ""))) return null

  if (contact.avatarUrl) {
    const byAvatar = await findContactByAvatarFingerprint(client, {
      userId,
      avatarUrl: contact.avatarUrl,
      excludeId: contact.id,
      lidOnly: false,
    })
    if (byAvatar) return byAvatar
  }

  // Mesmo pushName + avatar (quando fingerprint bate em 1 telefone real).
  const push = String(contact.pushName || contact.name || "").trim()
  if (push && push.length >= 3 && contact.avatarUrl) {
    const byName = await client.crmContact.findMany({
      where: {
        userId,
        id: { not: contact.id },
        isLid: false,
        OR: [
          { pushName: { equals: push, mode: "insensitive" } },
          { name: { equals: push, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        remoteJid: true,
        lidJid: true,
        phone: true,
        avatarUrl: true,
        name: true,
        pushName: true,
        isLid: true,
        userId: true,
      },
      take: 8,
    })
    const fp = avatarFingerprint(contact.avatarUrl)
    const real = byName.filter(
      (row) =>
        !isMasqueradingLidContact(row) &&
        isLikelyPhoneDigits(digitsOnly(row.phone || phoneFromPnJid(row.remoteJid) || "")) &&
        (!fp || avatarFingerprint(row.avatarUrl) === fp),
    )
    if (real.length === 1) return real[0]
  }

  const convo =
    contact.conversation ||
    (await client.crmConversation.findUnique({
      where: { contactId: contact.id },
      select: { lastMessagePreview: true },
    }))
  const preview = String(convo?.lastMessagePreview || "").trim()
  if (!isDistinctPreview(preview)) return null

  const candidates = await client.crmConversation.findMany({
    where: {
      userId,
      lastMessagePreview: preview,
      contactId: { not: contact.id },
      contact: { isLid: false },
    },
    include: { contact: true },
    take: 6,
  })
  const plausible = candidates.filter((row) => row.contact && !isMasqueradingLidContact(row.contact))
  const twin = pickOrphanLidTwin(contact, preview, plausible)
  return twin?.contact || null
}

async function moveMessagesAvoidingDupes(tx, { sourceConversationId, targetConversationId, toUserId }) {
  const existing = await tx.crmMessage.findMany({
    where: { conversationId: targetConversationId },
    select: { messageId: true },
  })
  const seen = new Set(existing.map((m) => m.messageId))
  const sourceMsgs = await tx.crmMessage.findMany({
    where: { conversationId: sourceConversationId },
    select: { id: true, messageId: true },
  })
  const dupIds = sourceMsgs.filter((m) => seen.has(m.messageId)).map((m) => m.id)
  const moveIds = sourceMsgs.filter((m) => !seen.has(m.messageId)).map((m) => m.id)
  if (dupIds.length) {
    await tx.crmMessage.deleteMany({ where: { id: { in: dupIds } } })
  }
  if (moveIds.length) {
    await tx.crmMessage.updateMany({
      where: { id: { in: moveIds } },
      data: { conversationId: targetConversationId, userId: toUserId },
    })
  }
}

function lidJidFromContact(contact) {
  if (isLidJid(contact?.remoteJid)) return contact.remoteJid
  return contact?.lidJid || null
}

/**
 * Mescla source no target e apaga source.
 * @returns {{ merged: true, contactId, conversationId, removedConversationId, removedContactId }}
 */
async function mergeCrmContacts(tx, { source, target, toUserId }) {
  const sourceConvo = source.conversation
  const targetConvo = target.conversation

  if (sourceConvo && targetConvo) {
    await moveMessagesAvoidingDupes(tx, {
      sourceConversationId: sourceConvo.id,
      targetConversationId: targetConvo.id,
      toUserId,
    })
    await tx.crmDelivery.updateMany({
      where: { conversationId: sourceConvo.id },
      data: { conversationId: targetConvo.id, userId: toUserId },
    })
    await tx.crmFlowRun.updateMany({
      where: { conversationId: sourceConvo.id },
      data: { conversationId: targetConvo.id, userId: toUserId },
    })
  } else if (sourceConvo && !targetConvo) {
    await tx.crmConversation.update({
      where: { id: sourceConvo.id },
      data: {
        userId: toUserId,
        contactId: target.id,
        kanbanStageId: toUserId === source.userId ? sourceConvo.kanbanStageId : null,
        aiAgentId: toUserId === source.userId ? sourceConvo.aiAgentId : null,
        aiEnabled: toUserId === source.userId ? sourceConvo.aiEnabled : false,
        assignedTo: toUserId === source.userId ? sourceConvo.assignedTo : "human",
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
  if (toUserId !== target.userId) contactPatch.userId = toUserId

  const sourceLid = lidJidFromContact(source)
  if (sourceLid && !target.lidJid && !isLidJid(target.remoteJid)) {
    await tx.crmContact.update({ where: { id: source.id }, data: { lidJid: null } }).catch(() => {})
    contactPatch.lidJid = sourceLid
  }

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
  }

  await tx.crmContactTag.deleteMany({ where: { contactId: source.id } })
  await tx.crmContact.delete({ where: { id: source.id } })

  return {
    merged: true,
    contactId: target.id,
    conversationId: targetConvo?.id || sourceConvo?.id || null,
    removedConversationId: sourceConvo && targetConvo ? sourceConvo.id : null,
    removedContactId: source.id,
  }
}

async function unifyContactSiblings(prisma, { userId, contactId }) {
  const contact = await loadMergeContact(prisma, contactId)
  if (!contact || contact.userId !== userId) return { merged: false, contact }

  const masquerading = isMasqueradingLidContact(contact)
  const phone = contact.phone || phoneFromPnJid(contact.remoteJid)
  let sibling = null
  if (phone && !masquerading && isLikelyPhoneDigits(digitsOnly(phone))) {
    sibling = await findContactByPhone(prisma, { userId, phone, excludeId: contact.id })
  }
  if (!sibling && masquerading) {
    sibling = await findOrphanLidTwin(prisma, { userId, contact })
  }
  if (!sibling && !masquerading && contact.avatarUrl) {
    sibling = await findContactByAvatarFingerprint(prisma, {
      userId,
      avatarUrl: contact.avatarUrl,
      excludeId: contact.id,
      lidOnly: true,
    })
  }
  if (!sibling || sibling.id === contact.id) return { merged: false, contact }

  const a = contact
  const b = await loadMergeContact(prisma, sibling.id)
  if (!b) return { merged: false, contact }

  const pair = pickCanonicalPair(a, b)
  const result = await prisma.$transaction(
    async (tx) => mergeCrmContacts(tx, { source: pair.source, target: pair.target, toUserId: userId }),
    { timeout: 60000, maxWait: 15000 },
  )
  const kept = await loadMergeContact(prisma, result.contactId)
  return {
    merged: true,
    contact: kept,
    removedConversationId: result.removedConversationId,
    removedContactId: result.removedContactId,
    conversationId: result.conversationId,
  }
}

/**
 * Varre @lid da inbox e mescla no contato de telefone quando der para identificar.
 */
async function unifyLidPhoneDuplicates(prisma, { userId, userIds, limit = 40 } = {}) {
  const ids = (userId ? [userId] : userIds || []).filter(Boolean)
  if (!ids.length || !prisma) return { merged: 0, results: [] }

  const lids = await prisma.crmContact.findMany({
    where: {
      userId: ids.length === 1 ? ids[0] : { in: ids },
      OR: [{ isLid: true }, { remoteJid: { endsWith: "@lid" } }],
    },
    select: { id: true, userId: true },
    take: Math.max(1, Math.min(200, limit)),
    orderBy: { updatedAt: "desc" },
  })

  // Também varre “telefones” curtos/impossíveis (LID mascarado como @s.whatsapp.net).
  const shortPhones = await prisma.crmContact.findMany({
    where: {
      userId: ids.length === 1 ? ids[0] : { in: ids },
      isLid: false,
      remoteJid: { endsWith: "@s.whatsapp.net" },
      phone: { not: null },
    },
    select: { id: true, userId: true, phone: true, remoteJid: true },
    take: Math.max(1, Math.min(200, limit)),
    orderBy: { updatedAt: "desc" },
  })
  const fakePhoneRows = shortPhones.filter((row) => isMasqueradingLidContact(row))

  const seen = new Set()
  const queue = []
  for (const row of [...lids, ...fakePhoneRows]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    queue.push(row)
  }

  const results = []
  for (const row of queue.slice(0, Math.max(1, Math.min(200, limit)))) {
    const out = await unifyContactSiblings(prisma, { userId: row.userId, contactId: row.id }).catch((err) => {
      console.warn("[crm-merge] unifyContactSiblings:", err?.message || err)
      return null
    })
    if (out?.merged) results.push(out)
  }
  return { merged: results.length, results }
}

function emitUnificationEvents(emitCrmEvent, io, userId, unification) {
  if (!io || !unification?.merged) return
  if (unification.removedConversationId) {
    emitCrmEvent(io, userId, "crm:conversation_removed", {
      conversationId: unification.removedConversationId,
      contactId: unification.removedContactId,
    })
  }
}

module.exports = {
  isDistinctPreview,
  avatarFingerprint,
  pickCanonicalPair,
  pickOrphanLidTwin,
  contactMergeScore,
  isMasqueradingLidContact,
  MERGE_INCLUDE,
  findContactByPhone,
  findContactByLidJid,
  findContactByAvatarFingerprint,
  findOrphanLidTwin,
  mergeCrmContacts,
  unifyContactSiblings,
  unifyLidPhoneDuplicates,
  emitUnificationEvents,
  phoneFromPnJid,
}

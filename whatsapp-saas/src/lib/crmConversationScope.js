/**
 * Filtra eventos socket de conversa CRM para o escopo do usuário logado.
 * SELLER: só inbox do próprio userId.
 * OWNER: próprio + membros da empresa (orgUserIds) — nunca aceita inbox de outra org.
 * Com filterSellerUserId: dono restringe a um membro específico.
 */

export function isConversationInScope(conversation, { userId, isOrgOwner, filterSellerUserId, orgUserIds } = {}) {
  if (!conversation?.id) return false
  if (!userId) return true
  const ownerId = conversation.userId || conversation.contact?.userId || null
  // Payload legado sem userId: aceita (API REST já filtrou a carga inicial).
  if (!ownerId) return !filterSellerUserId
  if (filterSellerUserId) return ownerId === filterSellerUserId
  if (ownerId === userId) return true
  // Dono da empresa: só membros da própria org (nunca "aceitar qualquer coisa").
  if (isOrgOwner) {
    if (Array.isArray(orgUserIds) && orgUserIds.length) {
      return orgUserIds.includes(ownerId)
    }
    return false
  }
  return false
}

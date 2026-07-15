/**
 * Filtra eventos socket de conversa CRM para o escopo do usuário logado.
 * SELLER: só inbox do próprio userId.
 * OWNER: próprio + membros da empresa (quando o payload traz userId).
 * Com filterSellerUserId: dono restringe a um membro específico.
 */

export function isConversationInScope(conversation, { userId, isOrgOwner, filterSellerUserId } = {}) {
  if (!conversation?.id) return false
  if (!userId) return true
  const ownerId = conversation.userId || conversation.contact?.userId || null
  // Sem userId no payload: SELLER rejeita (evita respingo via socket). OWNER sem filtro aceita legado.
  if (!ownerId) {
    if (filterSellerUserId) return false
    return Boolean(isOrgOwner)
  }
  if (filterSellerUserId) return ownerId === filterSellerUserId
  if (ownerId === userId) return true
  // Dono da empresa pode receber atualizações da equipe via sala org.
  if (isOrgOwner) return true
  return false
}

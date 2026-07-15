/**
 * Filtra eventos socket de conversa CRM para o escopo do usuário logado.
 * SELLER: só inbox do próprio userId.
 * OWNER: próprio + membros da empresa (quando o payload traz userId).
 */

export function isConversationInScope(conversation, { userId, isOrgOwner } = {}) {
  if (!conversation?.id) return false
  if (!userId) return true
  const ownerId = conversation.userId || conversation.contact?.userId || null
  // Payload legado sem userId: aceita (API REST já filtrou a carga inicial).
  if (!ownerId) return true
  if (ownerId === userId) return true
  // Dono da empresa pode receber atualizações da equipe via sala org.
  if (isOrgOwner) return true
  return false
}

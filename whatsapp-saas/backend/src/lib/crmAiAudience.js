/**
 * Alcance do agente: número (WhatsApp) e quadro (kanban) são filtros independentes.
 * Cada conversa pertence a um membro. "Todos" cobre qualquer membro da empresa.
 */

function normalizeAudience(raw = {}) {
  const numberScope = raw.numberScope === "member" ? "member" : "all"
  const boardScope = raw.boardScope === "member" ? "member" : "all"
  return {
    numberScope,
    numberUserId: numberScope === "member" ? String(raw.numberUserId || "").trim() || null : null,
    boardScope,
    boardUserId: boardScope === "member" ? String(raw.boardUserId || "").trim() || null : null,
  }
}

function audienceError(audience, userIds) {
  const ids = Array.isArray(userIds) ? userIds : []
  if (audience.numberScope === "member" && !ids.includes(audience.numberUserId)) {
    return "Selecione o vendedor do número em que o agente vai atuar."
  }
  if (audience.boardScope === "member" && !ids.includes(audience.boardUserId)) {
    return "Selecione o vendedor do quadro em que o agente vai atuar."
  }
  return null
}

function agentCoversMember(agent, userId) {
  if (!agent || !userId) return false
  if ((agent.numberScope || "all") === "member" && agent.numberUserId !== userId) return false
  if ((agent.boardScope || "all") === "member" && agent.boardUserId !== userId) return false
  return true
}

function agentInOrganization(agent, { orgId, userIds }) {
  if (agent.organizationId) return agent.organizationId === orgId
  return (userIds || []).includes(agent.userId)
}

module.exports = {
  normalizeAudience,
  audienceError,
  agentCoversMember,
  agentInOrganization,
}

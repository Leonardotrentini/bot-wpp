/**
 * Estágios do Kanban são por userId. Dono da org vê leads da equipe com
 * colunas do próprio board — precisa mapear estágio por nome entre usuários.
 */

function stageNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
}

/**
 * Resolve o estágio a gravar na conversa (targetUserId) a partir do id
 * enviado pelo cliente (geralmente coluna do board do ator/dono).
 */
async function resolveStageForConversationUser(prisma, { stageId, targetUserId, dataScope }) {
  if (stageId == null || stageId === "") {
    return { ok: true, stageId: null, stage: null }
  }

  const id = String(stageId)
  const direct = await prisma.crmKanbanStage.findFirst({
    where: { id, userId: targetUserId },
  })
  if (direct) return { ok: true, stageId: direct.id, stage: direct }

  const source = await prisma.crmKanbanStage.findFirst({ where: { id } })
  if (!source) return { ok: false, error: "STAGE_NOT_FOUND", message: "Estágio inválido." }

  // Só aceita mapear estágio de alguém do mesmo escopo da empresa.
  const allowed =
    source.userId === targetUserId ||
    (Array.isArray(dataScope?.userIds) && dataScope.userIds.includes(source.userId))
  if (!allowed) {
    return { ok: false, error: "STAGE_NOT_FOUND", message: "Estágio inválido." }
  }

  const byName = await prisma.crmKanbanStage.findFirst({
    where: {
      userId: targetUserId,
      name: { equals: source.name, mode: "insensitive" },
    },
  })
  if (byName) return { ok: true, stageId: byName.id, stage: byName, mappedFrom: source.id }

  const max = await prisma.crmKanbanStage.aggregate({
    where: { userId: targetUserId },
    _max: { sortOrder: true },
  })
  const created = await prisma.crmKanbanStage.create({
    data: {
      userId: targetUserId,
      name: source.name,
      color: source.color || "#64748b",
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      isDefault: Boolean(source.isDefault),
    },
  })
  return { ok: true, stageId: created.id, stage: created, mappedFrom: source.id, created: true }
}

/**
 * Mapa foreignStageId → viewerStageId (mesmo nome), para o board do dono
 * mostrar cards da equipe nas colunas certas.
 */
async function buildViewerStageRemap(prisma, { viewerUserId, stageIds }) {
  const ids = [...new Set((stageIds || []).filter(Boolean).map(String))]
  if (!ids.length) return new Map()

  const viewerStages = await prisma.crmKanbanStage.findMany({
    where: { userId: viewerUserId },
    select: { id: true, name: true },
  })
  const viewerByName = new Map(viewerStages.map((s) => [stageNameKey(s.name), s.id]))
  const viewerIdSet = new Set(viewerStages.map((s) => s.id))

  const foreignIds = ids.filter((id) => !viewerIdSet.has(id))
  if (!foreignIds.length) return new Map()

  const foreignStages = await prisma.crmKanbanStage.findMany({
    where: { id: { in: foreignIds } },
    select: { id: true, name: true },
  })

  const remap = new Map()
  for (const fs of foreignStages) {
    const target = viewerByName.get(stageNameKey(fs.name))
    if (target) remap.set(fs.id, target)
  }
  return remap
}

function applyViewerStageRemap(conversationRow, remap) {
  if (!conversationRow || !remap?.size) return conversationRow
  const current = conversationRow.kanbanStageId
  if (!current || !remap.has(current)) return conversationRow
  return { ...conversationRow, kanbanStageId: remap.get(current) }
}

module.exports = {
  stageNameKey,
  resolveStageForConversationUser,
  buildViewerStageRemap,
  applyViewerStageRemap,
}

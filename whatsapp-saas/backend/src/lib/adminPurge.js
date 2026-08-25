/**
 * Exclusão administrativa de usuário/empresa: CRM, grupos, Meta e instância Evolution.
 */

const { prisma } = require("./prisma")
const { logoutInstance, deleteInstance } = require("./evolution")

function httpError(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

async function releaseEvolutionInstance(userId) {
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { userId },
    select: { instanceName: true },
  })
  if (!conn?.instanceName) return
  await logoutInstance(conn.instanceName).catch(() => {})
  await deleteInstance(conn.instanceName).catch(() => {})
}

async function deleteUserOwnedRows(tx, userId) {
  await tx.crmDelivery.deleteMany({ where: { userId } })
  await tx.crmMessage.deleteMany({ where: { userId } })
  await tx.crmFlowRun.deleteMany({ where: { userId } })
  await tx.crmFlow.deleteMany({ where: { userId } })
  await tx.crmContactActivity.deleteMany({ where: { userId } })
  await tx.crmContactReminder.deleteMany({ where: { userId } })
  await tx.crmConversation.deleteMany({ where: { userId } })
  await tx.crmContact.deleteMany({ where: { userId } })
  await tx.crmTag.deleteMany({ where: { userId } })
  await tx.crmKanbanStage.deleteMany({ where: { userId } })
  await tx.crmQuickReply.deleteMany({ where: { userId } })
  await tx.crmAiAgent.deleteMany({ where: { userId } })
  await tx.crmSyncJob.deleteMany({ where: { userId } })
  await tx.groupX1Delivery.deleteMany({ where: { userId } })
  await tx.messageEngagement.deleteMany({ where: { userId } })
  await tx.whatsAppMessage.deleteMany({ where: { userId } })
  await tx.outboundMessage.deleteMany({ where: { userId } })
  await tx.sendJob.deleteMany({ where: { userId } })
  await tx.automation.deleteMany({ where: { userId } })
  await tx.cadence.deleteMany({ where: { userId } })
  await tx.messageTemplate.deleteMany({ where: { userId } })
  await tx.metaEventDelivery.deleteMany({ where: { userId } })
}

async function purgeUserById(userId, { actorId } = {}) {
  if (!userId) throw httpError(400, "VALIDATION_ERROR", "Usuário inválido.")
  if (actorId && userId === actorId) {
    throw httpError(403, "FORBIDDEN", "Você não pode excluir a própria conta.")
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, email: true },
  })
  if (!existing) throw httpError(404, "NOT_FOUND", "Utilizador não encontrado.")

  await releaseEvolutionInstance(userId)

  await prisma.$transaction(
    async (tx) => {
      await deleteUserOwnedRows(tx, userId)
      await tx.user.delete({ where: { id: userId } })
    },
    { timeout: 180000, maxWait: 20000 },
  )

  return { id: existing.id, name: existing.name, email: existing.email }
}

async function purgeOrganizationById(organizationId, { actorId } = {}) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      },
    },
  })
  if (!org) throw httpError(404, "NOT_FOUND", "Empresa não encontrada.")

  if (actorId && org.members.some((m) => m.userId === actorId)) {
    throw httpError(403, "FORBIDDEN", "Você não pode excluir a empresa da própria conta.")
  }

  const userIds = org.members.map((m) => m.userId)
  for (const userId of userIds) {
    await releaseEvolutionInstance(userId)
  }

  await prisma.$transaction(
    async (tx) => {
      for (const userId of userIds) {
        await deleteUserOwnedRows(tx, userId)
      }
      if (userIds.length) {
        await tx.user.deleteMany({ where: { id: { in: userIds } } })
      }
      await tx.organization.delete({ where: { id: organizationId } })
    },
    { timeout: 180000, maxWait: 20000 },
  )

  return {
    id: org.id,
    name: org.name,
    deletedUsers: org.members.length,
  }
}

module.exports = {
  purgeUserById,
  purgeOrganizationById,
}

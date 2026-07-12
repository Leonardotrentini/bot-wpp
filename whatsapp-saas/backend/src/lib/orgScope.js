/**
 * Escopo de dados por empresa — OWNER vê todos os membros; SELLER só o próprio userId.
 */

const { prisma } = require("./prisma")

async function ensureUserOrganization(userId) {
  let member = await prisma.organizationMember.findUnique({
    where: { userId },
    include: { organization: true },
  })
  if (member) return member

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const org = await prisma.organization.create({
    data: { name: user.name || "Minha empresa" },
  })
  member = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId,
      role: "OWNER",
      joinedAt: new Date(),
    },
    include: { organization: true },
  })
  return member
}

/** Cada usuário USER sem empresa vira dono da própria organização (nome = nome do usuário). */
async function backfillAllUserOrganizations() {
  const users = await prisma.user.findMany({
    where: {
      role: "USER",
      organizationMember: { is: null },
    },
    select: { id: true, name: true },
  })

  let created = 0
  for (const user of users) {
    await ensureUserOrganization(user.id)
    created += 1
  }

  return { scanned: users.length, created }
}

async function getOrgMemberIds(organizationId) {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: { userId: true },
  })
  return rows.map((r) => r.userId)
}

async function resolveDataScope(userId) {
  const member = await ensureUserOrganization(userId)
  if (!member) {
    return {
      userIds: [userId],
      orgId: null,
      orgRole: null,
      isOwner: false,
      actorId: userId,
      organization: null,
    }
  }

  let userIds = [userId]
  if (member.role === "OWNER") {
    userIds = await getOrgMemberIds(member.organizationId)
  }

  return {
    userIds,
    orgId: member.organizationId,
    orgRole: member.role,
    isOwner: member.role === "OWNER",
    actorId: userId,
    organization: member.organization,
  }
}

function readUserFilter(dataScope) {
  const ids = dataScope?.userIds || []
  if (!ids.length) return { userId: "__none__" }
  if (ids.length === 1) return { userId: ids[0] }
  return { userId: { in: ids } }
}

function actorUserId(req) {
  return req.user?.sub || req.dataScope?.actorId
}

async function attachDataScope(req, res, next) {
  try {
    req.dataScope = await resolveDataScope(req.user.sub)
    return next()
  } catch (err) {
    console.error("[orgScope] attachDataScope:", err)
    return res.status(500).json({ error: "SCOPE_FAILED", message: "Falha ao resolver escopo da empresa." })
  }
}

function requireOrgOwner(req, res, next) {
  if (!req.dataScope?.isOwner) {
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Apenas o dono da empresa pode realizar esta ação.",
    })
  }
  return next()
}

function assertUserInScope(dataScope, targetUserId) {
  return dataScope?.userIds?.includes(targetUserId)
}

async function loadAuthContext(userId) {
  const member = await ensureUserOrganization(userId)
  if (!member) return { orgId: null, orgRole: null, orgName: null }

  return {
    orgId: member.organizationId,
    orgRole: member.role,
    orgName: member.organization?.name || null,
  }
}

module.exports = {
  ensureUserOrganization,
  backfillAllUserOrganizations,
  getOrgMemberIds,
  resolveDataScope,
  readUserFilter,
  actorUserId,
  attachDataScope,
  requireOrgOwner,
  assertUserInScope,
  loadAuthContext,
}

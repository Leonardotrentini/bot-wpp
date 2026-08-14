/**
 * Tags e defaults do CRM criados automaticamente por conta.
 */

const { prisma } = require("./prisma")

const QUALIFIED_TAG_NAME = "QUALIFICADO"
const QUALIFIED_TAG_COLOR = "#3b82f6"

function isQualifiedTagName(name) {
  return String(name || "").trim().toUpperCase() === QUALIFIED_TAG_NAME
}

async function ensureDefaultTags(userId) {
  const existing = await prisma.crmTag.findFirst({
    where: { userId, name: { equals: QUALIFIED_TAG_NAME, mode: "insensitive" } },
  })
  if (existing) return existing

  return prisma.crmTag.create({
    data: { userId, name: QUALIFIED_TAG_NAME, color: QUALIFIED_TAG_COLOR },
  })
}

function tagNameKey(name) {
  return String(name || "").trim().toLowerCase()
}

/**
 * Dono da empresa vê um único chip "QUALIFICADO" (id de qualquer vendedor).
 * O contato só aceita tag do próprio userId — resolve pelo nome na inbox certa.
 */
async function resolveTagForContactUser(db, { tagId, contactUserId, orgUserIds }) {
  const id = String(tagId || "").trim()
  if (!id || !contactUserId) return null

  const ids = Array.isArray(orgUserIds) && orgUserIds.length ? orgUserIds : [contactUserId]
  const requested = await db.crmTag.findFirst({
    where: { id, userId: ids.length === 1 ? ids[0] : { in: ids } },
  })
  if (!requested) return null
  if (requested.userId === contactUserId) return requested

  const owned = await db.crmTag.findFirst({
    where: { userId: contactUserId, name: { equals: requested.name, mode: "insensitive" } },
  })
  if (owned) return owned

  try {
    return await db.crmTag.create({
      data: { userId: contactUserId, name: requested.name, color: requested.color },
    })
  } catch (err) {
    if (err?.code !== "P2002") throw err
    return db.crmTag.findFirst({
      where: { userId: contactUserId, name: { equals: requested.name, mode: "insensitive" } },
    })
  }
}

module.exports = {
  QUALIFIED_TAG_NAME,
  QUALIFIED_TAG_COLOR,
  isQualifiedTagName,
  ensureDefaultTags,
  tagNameKey,
  resolveTagForContactUser,
}

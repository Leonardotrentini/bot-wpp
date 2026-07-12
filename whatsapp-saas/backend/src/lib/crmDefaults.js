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

module.exports = {
  QUALIFIED_TAG_NAME,
  QUALIFIED_TAG_COLOR,
  isQualifiedTagName,
  ensureDefaultTags,
}

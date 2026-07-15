/**
 * Tags e defaults do CRM criados automaticamente por conta.
 */

const path = require("path")
const { prisma } = require("./prisma")
const { importCrmPack } = require("./crmPackImport")

const QUALIFIED_TAG_NAME = "QUALIFICADO"
const QUALIFIED_TAG_COLOR = "#3b82f6"

const GENERIC_STAGE_NAMES = ["novo", "em atendimento", "negociando", "fechado"]

const ATACADO_PACK = require(path.join(__dirname, "../../examples/crm-pack-atacado-vestuario.json"))

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

function isGenericDefaultSetup(stages, flowCount) {
  if (flowCount > 0) return false
  if (stages.length === 0) return true
  if (stages.length !== 4) return false
  const names = stages.map((s) => String(s.name || "").trim().toLowerCase())
  return GENERIC_STAGE_NAMES.every((n) => names.includes(n)) && names.length === 4
}

async function shouldApplyAtacadoPack(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPackAtacadoAppliedAt: true },
  })
  if (user?.crmPackAtacadoAppliedAt) return false

  const [stages, flowCount] = await Promise.all([
    prisma.crmKanbanStage.findMany({ where: { userId }, select: { name: true } }),
    prisma.crmFlow.count({ where: { userId } }),
  ])

  return isGenericDefaultSetup(stages, flowCount)
}

/**
 * Provisiona o pack "Atacado pronto" na 1ª visita ao CRM (idempotente via flag no User).
 */
async function ensureAtacadoPack(userId) {
  if (!(await shouldApplyAtacadoPack(userId))) return null

  const result = await importCrmPack(prisma, userId, ATACADO_PACK)
  await prisma.user.update({
    where: { id: userId },
    data: { crmPackAtacadoAppliedAt: new Date() },
  })
  return result
}

module.exports = {
  QUALIFIED_TAG_NAME,
  QUALIFIED_TAG_COLOR,
  isQualifiedTagName,
  ensureDefaultTags,
  ensureAtacadoPack,
  isGenericDefaultSetup,
}

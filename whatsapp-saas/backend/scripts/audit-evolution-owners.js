/**
 * Auditoria somente leitura: qual número de WhatsApp está logado em cada instância Evolution
 * dos membros de uma empresa.
 *
 * node scripts/audit-evolution-owners.js <email-de-um-membro>
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const seedEmail = process.argv[2] || "basesetatacado@gmail.com"
const BASE = (process.env.EVOLUTION_BASE_URL || "").replace(/\/+$/, "")
const KEY = process.env.EVOLUTION_API_KEY || ""

async function fetchInstances() {
  const res = await fetch(`${BASE}/instance/fetchInstances`, {
    headers: { apikey: KEY },
  })
  if (!res.ok) throw new Error(`Evolution ${res.status}: ${await res.text()}`)
  return res.json()
}

function pickOwner(inst) {
  const node = inst?.instance || inst
  return (
    node?.ownerJid ||
    node?.owner ||
    node?.number ||
    node?.profileName ||
    null
  )
}

function pickName(inst) {
  const node = inst?.instance || inst
  return node?.instanceName || node?.name || null
}

async function main() {
  if (!BASE || !KEY) throw new Error("EVOLUTION_BASE_URL/EVOLUTION_API_KEY ausentes no ambiente")

  const seedUser = await prisma.user.findFirst({
    where: { email: { contains: seedEmail.split("@")[0], mode: "insensitive" } },
    select: { id: true },
  })
  const seedMember = await prisma.organizationMember.findUnique({ where: { userId: seedUser.id } })
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: seedMember.organizationId },
    include: { user: { select: { id: true, name: true } } },
  })
  const conns = await prisma.whatsAppConnection.findMany({
    where: { userId: { in: members.map((m) => m.userId) } },
    select: { userId: true, instanceName: true },
  })
  const nameByInstance = {}
  for (const c of conns) {
    nameByInstance[c.instanceName] = members.find((m) => m.userId === c.userId)?.user.name || c.userId
  }

  const payload = await fetchInstances()
  const list = Array.isArray(payload) ? payload : payload?.instances || []

  const rows = []
  for (const inst of list) {
    const instanceName = pickName(inst)
    if (!instanceName || !nameByInstance[instanceName]) continue
    const node = inst?.instance || inst
    rows.push({
      membro: nameByInstance[instanceName],
      instancia: instanceName,
      numeroLogado: pickOwner(inst),
      perfil: node?.profileName || null,
      estado: node?.connectionStatus || node?.state || node?.status || null,
    })
  }

  console.log(`\n=== Instâncias Evolution dos membros ===`)
  console.table(rows)

  const byNumber = {}
  for (const r of rows) {
    if (!r.numeroLogado) continue
    byNumber[r.numeroLogado] = byNumber[r.numeroLogado] || []
    byNumber[r.numeroLogado].push(r.membro)
  }
  const shared = Object.entries(byNumber).filter(([, names]) => names.length > 1)
  console.log("\n--- Mesmo número em mais de uma conta? ---")
  if (shared.length) {
    for (const [num, names] of shared) console.log(`  SIM: ${num} => ${names.join(", ")}`)
  } else {
    console.log("  Não (pelos dados retornados pela Evolution).")
  }
}

main()
  .catch((err) => {
    console.error("ERRO:", err?.message || err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

/**
 * Auditoria somente leitura: por que um vendedor enxerga conversas de outro.
 * Compara papéis, conexões WhatsApp e sobreposição de conversas/mensagens.
 *
 * node scripts/audit-org-inbox-overlap.js <email-de-um-membro>
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const seedEmail = process.argv[2] || "basesetatacado@gmail.com"

function maskPhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, "")
  if (digits.length < 6) return digits
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`
}

async function main() {
  const seedUser = await prisma.user.findFirst({
    where: { email: { contains: seedEmail.split("@")[0], mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  })
  if (!seedUser) throw new Error(`Usuário não encontrado para ${seedEmail}`)

  const seedMember = await prisma.organizationMember.findUnique({
    where: { userId: seedUser.id },
    include: { organization: true },
  })
  if (!seedMember) throw new Error("Usuário sem organização")

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: seedMember.organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { role: "asc" },
  })

  console.log(`\n=== Empresa: ${seedMember.organization?.name} (${seedMember.organizationId}) ===`)

  const summary = []
  for (const m of members) {
    const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: m.userId } })
    const convCount = await prisma.crmConversation.count({ where: { userId: m.userId } })
    const msgCount = await prisma.crmMessage.count({ where: { userId: m.userId } })
    summary.push({
      nome: m.user.name,
      email: m.user.email,
      userId: m.userId,
      papel: m.role,
      instancia: conn?.instanceName || null,
      telefoneConectado: maskPhone(conn?.phone),
      telefoneBruto: conn?.phone || null,
      conectado: conn?.connected || false,
      status: conn?.status || null,
      ultimoSync: conn?.lastSync?.toISOString() || null,
      conversas: convCount,
      mensagens: msgCount,
    })
  }

  console.log("\n--- Membros / conexões ---")
  console.table(
    summary.map((s) => ({
      nome: s.nome,
      papel: s.papel,
      telefone: s.telefoneConectado,
      conectado: s.conectado,
      status: s.status,
      conversas: s.conversas,
      mensagens: s.mensagens,
    })),
  )

  const phoneGroups = {}
  for (const s of summary) {
    if (!s.telefoneBruto) continue
    const digits = String(s.telefoneBruto).replace(/\D/g, "")
    phoneGroups[digits] = phoneGroups[digits] || []
    phoneGroups[digits].push(s.nome)
  }
  const shared = Object.entries(phoneGroups).filter(([, names]) => names.length > 1)
  console.log("\n--- Número de WhatsApp compartilhado entre contas? ---")
  if (shared.length) {
    for (const [digits, names] of shared) {
      console.log(`  ATENÇÃO: ${maskPhone(digits)} está conectado em: ${names.join(", ")}`)
    }
  } else {
    console.log("  Não. Cada conta tem um número distinto (ou sem número registrado).")
  }

  console.log("\n--- Sobreposição de conversas (mesmo remoteJid em contas diferentes) ---")
  for (let i = 0; i < summary.length; i += 1) {
    for (let j = i + 1; j < summary.length; j += 1) {
      const a = summary[i]
      const b = summary[j]
      const aJids = await prisma.crmConversation.findMany({
        where: { userId: a.userId },
        select: { remoteJid: true },
      })
      const bJids = await prisma.crmConversation.findMany({
        where: { userId: b.userId },
        select: { remoteJid: true },
      })
      const setB = new Set(bJids.map((r) => r.remoteJid))
      const overlap = aJids.map((r) => r.remoteJid).filter((jid) => setB.has(jid))
      const pct = aJids.length ? Math.round((overlap.length / Math.min(aJids.length, bJids.length || 1)) * 100) : 0
      console.log(
        `  ${a.nome} (${aJids.length}) x ${b.nome} (${bJids.length}) => ${overlap.length} em comum (${pct}% do menor)`,
      )
      if (overlap.length) {
        console.log(`    exemplos: ${overlap.slice(0, 5).join(", ")}`)
      }
    }
  }

  console.log("\n--- Mesma mensagem do WhatsApp gravada em contas diferentes? ---")
  const dupes = await prisma.$queryRawUnsafe(`
    select m."messageId", count(distinct m."userId")::int as contas,
           string_agg(distinct u.name, ' | ') as nomes
    from "CrmMessage" m
    join "User" u on u.id = m."userId"
    where m."userId" = any($1::text[])
    group by m."messageId"
    having count(distinct m."userId") > 1
    limit 10
  `, summary.map((s) => s.userId))
  if (dupes.length) {
    console.log("  SIM — mesmo messageId em contas diferentes (instâncias recebendo os mesmos eventos):")
    console.table(dupes)
  } else {
    console.log("  Não encontrado.")
  }

  console.log("\n--- Últimas conversas por membro ---")
  for (const s of summary) {
    const last = await prisma.crmConversation.findMany({
      where: { userId: s.userId },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: { remoteJid: true, lastMessageAt: true, lastMessagePreview: true, lastMessageFromMe: true },
    })
    console.log(`\n  ${s.nome} (${s.papel}):`)
    for (const c of last) {
      console.log(
        `    ${c.remoteJid} | ${c.lastMessageAt?.toISOString() || "-"} | fromMe=${c.lastMessageFromMe} | ${String(
          c.lastMessagePreview || "",
        ).slice(0, 60)}`,
      )
    }
  }
}

main()
  .catch((err) => {
    console.error("ERRO:", err?.message || err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

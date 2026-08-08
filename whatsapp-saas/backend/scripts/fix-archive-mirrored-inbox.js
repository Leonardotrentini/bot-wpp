/**
 * Arquiva, na conta afetada, as conversas que são resíduo de espelhamento de inbox
 * (mensagens gravadas em duas contas porque a instância estava logada no WhatsApp alheio).
 *
 * Só arquiva conversas SEM nenhuma mensagem após o fim do espelhamento — quem o vendedor
 * atendeu de verdade depois do corte fica intocado.
 *
 * Dry-run:  node scripts/fix-archive-mirrored-inbox.js <email-origem> <email-afetado>
 * Aplicar:  node scripts/fix-archive-mirrored-inbox.js <email-origem> <email-afetado> --apply
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const emailOrigem = process.argv[2]
const emailAfetado = process.argv[3]
const apply = process.argv.includes("--apply")

async function main() {
  if (!emailOrigem || !emailAfetado) {
    throw new Error("Uso: node scripts/fix-archive-mirrored-inbox.js <email-origem> <email-afetado> [--apply]")
  }

  const origem = await prisma.user.findUnique({ where: { email: emailOrigem }, select: { id: true, name: true } })
  const afetado = await prisma.user.findUnique({ where: { email: emailAfetado }, select: { id: true, name: true } })
  if (!origem || !afetado) throw new Error("Usuários não encontrados")

  const membros = await prisma.organizationMember.findMany({
    where: { userId: { in: [origem.id, afetado.id] } },
    select: { userId: true, organizationId: true },
  })
  const orgs = new Set(membros.map((m) => m.organizationId))
  if (membros.length !== 2 || orgs.size !== 1) {
    throw new Error("As duas contas precisam estar na mesma empresa")
  }

  const [corte] = await prisma.$queryRawUnsafe(
    `select max(m."createdAt") as fim
     from "CrmMessage" m
     where m."userId" = $1
       and exists (select 1 from "CrmMessage" m2 where m2."userId" = $2 and m2."messageId" = m."messageId")`,
    afetado.id,
    origem.id,
  )
  if (!corte.fim) {
    console.log("Nenhum espelhamento encontrado entre as duas contas. Nada a fazer.")
    return
  }

  const alvos = await prisma.$queryRawUnsafe(
    `select c.id, c."remoteJid"
     from "CrmConversation" c
     where c."userId" = $1
       and c.status <> 'archived'
       and exists (
         select 1 from "CrmMessage" m
         join "CrmMessage" m2 on m2."messageId" = m."messageId" and m2."userId" = $2
         where m."conversationId" = c.id
       )
       and not exists (
         select 1 from "CrmMessage" m3
         where m3."conversationId" = c.id and m3."createdAt" > $3
       )`,
    afetado.id,
    origem.id,
    corte.fim,
  )

  console.log(`\nEspelhamento ${origem.name} -> ${afetado.name}`)
  console.log(`Corte: ${corte.fim.toISOString()}`)
  console.log(`Conversas a arquivar na conta de ${afetado.name}: ${alvos.length}`)

  if (!apply) {
    console.log("\nDRY-RUN — nada foi alterado. Rode com --apply para efetivar.")
    return
  }

  const ids = alvos.map((a) => a.id)
  let arquivadas = 0
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200)
    const res = await prisma.crmConversation.updateMany({
      where: { id: { in: lote }, userId: afetado.id },
      data: { status: "archived", unreadCount: 0 },
    })
    arquivadas += res.count
    console.log(`  ${arquivadas}/${ids.length}`)
  }

  console.log(`\n${arquivadas} conversas arquivadas na conta de ${afetado.name}.`)
  console.log("Reversível: basta voltar o status para 'open' nas mesmas conversas.")
}

main()
  .catch((e) => {
    console.error("ERRO:", e?.message || e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

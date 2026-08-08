/**
 * Dry-run (somente leitura): dimensiona o resíduo do espelhamento de inbox entre duas contas
 * e classifica o que é seguro remover/arquivar e o que precisa de decisão manual.
 *
 * node scripts/audit-mirror-cleanup-dryrun.js <email-origem> <email-afetado>
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const emailOrigem = process.argv[2] || "alessandra.cassia2017@gmail.com"
const emailAfetado = process.argv[3] || "george.pinheiro19@gmail.com"

async function main() {
  const origem = await prisma.user.findUnique({ where: { email: emailOrigem }, select: { id: true, name: true } })
  const afetado = await prisma.user.findUnique({ where: { email: emailAfetado }, select: { id: true, name: true } })
  if (!origem || !afetado) throw new Error("Usuários não encontrados")

  // Corte: última mensagem comprovadamente espelhada.
  const [corte] = await prisma.$queryRawUnsafe(
    `select max(m."createdAt") as fim
     from "CrmMessage" m
     where m."userId" = $1
       and exists (select 1 from "CrmMessage" m2 where m2."userId" = $2 and m2."messageId" = m."messageId")`,
    afetado.id,
    origem.id,
  )
  const fim = corte.fim
  console.log(`\nEspelhamento: ${origem.name} -> ${afetado.name}`)
  console.log(`Fim do espelhamento: ${fim?.toISOString?.() || fim}`)

  const espelhadas = await prisma.$queryRawUnsafe(
    `select c.id, c."remoteJid", c."createdAt", c."lastMessageAt", c."kanbanStageId",
            (select count(*)::int from "CrmMessage" m where m."conversationId" = c.id) as msgs,
            (select count(*)::int from "CrmMessage" m
              where m."conversationId" = c.id and m."createdAt" > $3) as msgs_pos_corte
     from "CrmConversation" c
     where c."userId" = $1
       and exists (
         select 1 from "CrmMessage" m
         join "CrmMessage" m2 on m2."messageId" = m."messageId" and m2."userId" = $2
         where m."conversationId" = c.id
       )`,
    afetado.id,
    origem.id,
    fim,
  )

  const puras = espelhadas.filter((c) => c.msgs_pos_corte === 0)
  const mistas = espelhadas.filter((c) => c.msgs_pos_corte > 0)

  console.log(`\n--- Classificação das ${espelhadas.length} conversas espelhadas ---`)
  console.log(`  Resíduo puro (nenhuma mensagem após o corte): ${puras.length}`)
  console.log(`  Mistas (${afetado.name} interagiu depois): ${mistas.length}  << exigem decisão manual`)
  console.log(`  Mensagens envolvidas: ${espelhadas.reduce((a, c) => a + c.msgs, 0)}`)

  const ids = espelhadas.map((c) => c.id)
  const idsPuras = puras.map((c) => c.id)

  const contatos = await prisma.crmConversation.findMany({
    where: { id: { in: ids } },
    select: { contactId: true },
  })
  const contactIds = contatos.map((c) => c.contactId)

  console.log("\n--- Impacto em relatórios e integrações ---")
  const atividades = await prisma.crmContactActivity.groupBy({
    by: ["type"],
    where: { contactId: { in: contactIds } },
    _count: { _all: true },
  })
  console.table(atividades.map((a) => ({ atividade: a.type, qtd: a._count._all })))

  const comprasPuras = await prisma.crmContactActivity.count({
    where: {
      type: "purchase_confirmed",
      contact: { conversation: { id: { in: idsPuras } } },
    },
  })
  console.log(`  Compras confirmadas dentro do resíduo puro: ${comprasPuras}`)

  const metaLeads = await prisma.metaAttributionLead.count({ where: { contactId: { in: contactIds } } })
  const metaEnviados = await prisma.crmContact.count({
    where: { id: { in: contactIds }, conversationStartedEventSentAt: { not: null } },
  })
  console.log(`  Leads de atribuição Meta ligados a esses contatos: ${metaLeads}`)
  console.log(`  Contatos com evento Meta já disparado: ${metaEnviados}`)

  const lembretes = await prisma.crmContactReminder.count({
    where: { contactId: { in: contactIds }, status: "pending" },
  })
  console.log(`  Lembretes pendentes: ${lembretes}`)

  const tags = await prisma.crmContactTag.count({ where: { contactId: { in: contactIds } } })
  console.log(`  Marcações de tag: ${tags}`)

  console.log("\n--- Duplicidade de contato: o mesmo lead já existe na conta de origem? ---")
  const jids = espelhadas.map((c) => c.remoteJid)
  const naOrigem = await prisma.crmConversation.count({
    where: { userId: origem.id, remoteJid: { in: jids } },
  })
  console.log(`  ${naOrigem} de ${jids.length} continuam existindo na conta de ${origem.name} (não há perda de histórico).`)

  console.log("\n--- Amostra do resíduo puro (10 primeiras) ---")
  for (const c of puras.slice(0, 10)) {
    console.log(
      `  ${c.remoteJid} | criada=${c.createdAt.toISOString().slice(0, 10)} | últ.msg=${
        c.lastMessageAt?.toISOString?.().slice(0, 16) || "-"
      } | ${c.msgs} msgs`,
    )
  }

  console.log("\n--- Amostra das mistas (exigem decisão) ---")
  for (const c of mistas.slice(0, 10)) {
    console.log(
      `  ${c.remoteJid} | ${c.msgs} msgs (${c.msgs_pos_corte} após o corte) | últ.msg=${
        c.lastMessageAt?.toISOString?.().slice(0, 16) || "-"
      }`,
    )
  }

  console.log("\n=== NADA FOI ALTERADO — este script é somente leitura ===")
}

main()
  .catch((e) => {
    console.error("ERRO:", e?.message || e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

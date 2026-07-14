/**
 * Reenvia Purchase (dataset real) para vendas recentes que ainda têm fbc/fbp/ctwa.
 * Uso:
 *   node scripts/resend-purchases-with-attribution.js --confirmo-poluir-dataset
 */
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const { trackCrmPurchaseEvent } = require("../src/lib/metaConversions")
const { ensureAttributionBeforeMetaEvent } = require("../src/lib/metaAttributionLead")

async function main() {
  if (!process.argv.includes("--confirmo-poluir-dataset")) {
    console.error("Use: node scripts/resend-purchases-with-attribution.js --confirmo-poluir-dataset")
    process.exit(1)
  }

  const prisma = new PrismaClient()
  const email = process.env.META_LIVE_USER_EMAIL || "basesetatacado@gmail.com"
  const user = await prisma.user.findFirst({ where: { email } })
  if (!user) throw new Error("user not found")

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const purchases = await prisma.crmContactActivity.findMany({
    where: { userId: user.id, type: "purchase_confirmed", createdAt: { gte: since } },
    include: { contact: true },
    orderBy: { createdAt: "desc" },
  })

  let sent = 0
  let skipped = 0
  for (const row of purchases) {
    let contact = row.contact
    if (!contact) {
      skipped += 1
      continue
    }
    contact = await ensureAttributionBeforeMetaEvent(prisma, { userId: user.id, contact })
    const meta = contact.customFields?.meta || {}
    const has = Boolean(meta.ctwaClid || meta.fbc || meta.fbp || meta.fbclid)
    if (!has) {
      console.log(`skip ${contact.phone || contact.id} — sem atribuição`)
      skipped += 1
      continue
    }
    const amount = Number(row.payload?.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped += 1
      continue
    }
    const result = await trackCrmPurchaseEvent(prisma, {
      userId: user.id,
      contact,
      amount,
      ticket: row.payload?.ticket || `resend-${row.id}`,
    })
    console.log(
      `${result.sent ? "OK" : "FAIL"} ${contact.phone} R$${amount} attr=${has} err=${result.error || "—"}`,
    )
    if (result.sent) sent += 1
    else skipped += 1
  }

  console.log(`\nResumo: sent=${sent} skipped=${skipped}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Reenvia Purchase à Meta para vendas recentes da org Baseset (OWNER + SELLER).
 *
 * Uso (produção via Railway):
 *   railway run --service <backend> -- node scripts/resend-org-purchases.js --confirmo-enviar --days 7
 *
 * Flags:
 *   --confirmo-enviar   obrigatório para disparar CAPI real
 *   --days N            janela (default 7)
 *   --force             reenvia mesmo com purchaseEventSentAt preenchido
 *   --dry-run           só lista, não envia
 *   --email EMAIL       dono/org seed (default basesetatacado@gmail.com)
 */
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const { trackCrmPurchaseEvent } = require("../src/lib/metaConversions")
const { ensureAttributionBeforeMetaEvent } = require("../src/lib/metaAttributionLead")
const { resolveMetaIntegrationForTracking } = require("../src/lib/metaConversions")

function hasFlag(name) {
  return process.argv.includes(name)
}

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}

async function main() {
  const dryRun = hasFlag("--dry-run")
  const force = hasFlag("--force")
  const days = Math.max(1, Number(argValue("--days", "7")) || 7)
  const email = argValue("--email", process.env.META_LIVE_USER_EMAIL || "basesetatacado@gmail.com")

  if (!dryRun && !hasFlag("--confirmo-enviar")) {
    console.error(
      "Use: node scripts/resend-org-purchases.js --confirmo-enviar [--days 7] [--force] [--dry-run]",
    )
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const seedUser = await prisma.user.findFirst({ where: { email } })
    if (!seedUser) throw new Error(`Usuário não encontrado: ${email}`)

    const membership = await prisma.organizationMember.findUnique({
      where: { userId: seedUser.id },
      select: { organizationId: true },
    })
    if (!membership) throw new Error(`Usuário ${email} sem organização`)

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: membership.organizationId },
      select: { userId: true, role: true, user: { select: { email: true, name: true } } },
    })
    const userIds = members.map((m) => m.userId)
    console.log(
      `Org ${membership.organizationId} — ${members.length} membros:`,
      members.map((m) => `${m.user?.name || m.userId} (${m.role})`).join(", "),
    )

    const metaCtx = await resolveMetaIntegrationForTracking(prisma, seedUser.id)
    console.log(
      `Meta: source=${metaCtx.source} pixel=${metaCtx.integration?.pixelId || "—"} enabled=${Boolean(
        metaCtx.integration?.enabled,
      )} sendPurchases=${metaCtx.integration?.sendPurchases}`,
    )
    if (!metaCtx.integration?.enabled || !metaCtx.integration?.accessToken) {
      throw new Error("Integração Meta do dono indisponível — aborte.")
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const purchases = await prisma.crmContactActivity.findMany({
      where: {
        userId: { in: userIds },
        type: "purchase_confirmed",
        createdAt: { gte: since },
      },
      include: {
        contact: true,
        // contact already includes customFields
      },
      orderBy: { createdAt: "asc" },
    })

    console.log(`\n${purchases.length} venda(s) desde ${since.toISOString()} (últimos ${days}d)\n`)

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const row of purchases) {
      let contact = row.contact
      if (!contact) {
        console.log(`SKIP activity=${row.id} — sem contato`)
        skipped += 1
        continue
      }

      const amount = Number(row.payload?.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        console.log(`SKIP ${contact.phone || contact.id} — valor inválido`)
        skipped += 1
        continue
      }

      const already = Boolean(contact.purchaseEventSentAt)
      if (already && !force) {
        console.log(
          `SKIP ${contact.phone || contact.name} R$${amount} — já tem purchaseEventSentAt (use --force)`,
        )
        skipped += 1
        continue
      }

      contact = await ensureAttributionBeforeMetaEvent(prisma, {
        userId: contact.userId,
        contact,
        attributionUserId: metaCtx.metaUserId,
      })
      const meta = contact.customFields?.meta || {}
      const hasAttr = Boolean(meta.ctwaClid || meta.fbc || meta.fbp || meta.fbclid)

      console.log(
        `${dryRun ? "DRY" : "SEND"} ${contact.phone || contact.name} R$${amount} attr=${hasAttr} already=${already} seller=${contact.userId}`,
      )

      if (dryRun) {
        skipped += 1
        continue
      }

      const ticket = row.payload?.ticket || `backfill-${row.id}`
      const result = await trackCrmPurchaseEvent(prisma, {
        userId: contact.userId,
        contact,
        amount,
        ticket,
        force: force || already,
      })

      if (result.sent) {
        sent += 1
        console.log(
          `  OK eventId=${result.eventId} mode=${result.trackingMode} attr=${result.hasAdsAttribution}`,
        )
      } else if (result.error) {
        failed += 1
        console.log(`  FAIL ${result.error}`)
      } else {
        skipped += 1
        console.log(`  SKIP reason=${result.reason || "—"} ${result.message || ""}`)
      }

      // evita rate limit agressivo
      await new Promise((r) => setTimeout(r, 400))
    }

    console.log(`\nResumo: sent=${sent} skipped=${skipped} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Simulação E2E (sem enviar Purchase à Meta):
 * LP click (dono) → 1ª msg no vendedor → atribuição no contato.
 *
 * node scripts/sim-attribution-e2e.js
 */
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const {
  createAttributionLead,
  resolveAttributionOwnerUserId,
  resolveAndApplyAttributionFromPendingLead,
  contactHasAnyAdsAttribution,
  PENDING_LEAD_MAX_AGE_MS,
} = require("../src/lib/metaAttributionLead")
const { resolveMetaIntegrationForTracking } = require("../src/lib/metaConversions")

const prisma = new PrismaClient()
const REF = `vst_sim${Date.now().toString(36).slice(-5)}`.slice(0, 12)
const FBCLID = `SIM_TEST_${Date.now()}`
const REMOTE = `5551999${String(Date.now()).slice(-7)}@s.whatsapp.net`

async function main() {
  const out = { steps: [], ok: true }
  let paused = []
  let contactId = null
  let createdRef = null

  try {
  const ownerUser = await prisma.user.findFirst({
    where: { email: "basesetatacado@gmail.com" },
  })
  if (!ownerUser) throw new Error("Owner Baseset não encontrado")

  const membership = await prisma.organizationMember.findUnique({
    where: { userId: ownerUser.id },
    select: { organizationId: true },
  })
  const seller = await prisma.organizationMember.findFirst({
    where: { organizationId: membership.organizationId, role: "SELLER" },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!seller) throw new Error("Nenhum SELLER na org Baseset")

  out.steps.push({
    step: "org",
    ownerId: ownerUser.id,
    sellerId: seller.userId,
    sellerName: seller.user?.name || seller.user?.email,
  })

  const ownerFromSeller = await resolveAttributionOwnerUserId(prisma, seller.userId)
  const ownerOk = ownerFromSeller === ownerUser.id
  out.steps.push({ step: "resolveOwner", ownerFromSeller, expected: ownerUser.id, pass: ownerOk })
  if (!ownerOk) out.ok = false

  const meta = await resolveMetaIntegrationForTracking(prisma, seller.userId)
  out.steps.push({
    step: "pixelViaSeller",
    source: meta.source,
    pixelId: meta.integration?.pixelId || null,
    pass: Boolean(meta.integration?.pixelId) && (meta.source === "org_owner" || meta.source === "self"),
  })

  const minClickAt = new Date(Date.now() - PENDING_LEAD_MAX_AGE_MS)
  const othersBefore = await prisma.metaAttributionLead.findMany({
    where: {
      userId: ownerUser.id,
      contactId: null,
      expiresAt: { gt: new Date() },
      clickAt: { gte: minClickAt },
    },
    select: { id: true, expiresAt: true },
  })
  for (const row of othersBefore) {
    paused.push({ id: row.id, expiresAt: row.expiresAt })
    await prisma.metaAttributionLead.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
  }
  if (paused.length) {
    out.steps.push({ step: "pauseOtherPending", count: paused.length, pass: true })
  }

  const created = await createAttributionLead(prisma, ownerUser.id, {
    ref: REF,
    fbclid: FBCLID,
    fbc: `fb.1.${Date.now()}.${FBCLID}`,
    fbp: `fb.1.${Date.now()}.999`,
    clickAt: Date.now(),
    pageUrl: "https://baseset.vercel.app/?fbclid=" + FBCLID,
    contactEventId: `vst_contact_${REF}`,
  })
  if (created.error) throw new Error(created.message || created.error)
  createdRef = REF
  out.steps.push({ step: "lpClick", ref: REF, pass: true })

  const pendingAsSeller = await prisma.metaAttributionLead.count({
    where: { userId: seller.userId, contactId: null, expiresAt: { gt: new Date() }, clickAt: { gte: minClickAt } },
  })
  const pendingAsOwner = await prisma.metaAttributionLead.count({
    where: { userId: ownerUser.id, contactId: null, expiresAt: { gt: new Date() }, clickAt: { gte: minClickAt } },
  })
  out.steps.push({
    step: "pendingCounts",
    pendingAsSeller,
    pendingAsOwner,
    note: "Bug antigo: seller via 0; dono tem o clique",
    pass: pendingAsSeller === 0 && pendingAsOwner === 1,
  })
  if (pendingAsSeller !== 0 || pendingAsOwner !== 1) out.ok = false

  const contact = await prisma.crmContact.create({
    data: {
      userId: seller.userId,
      remoteJid: REMOTE,
      phone: REMOTE.replace(/\D/g, "").slice(0, 13),
      name: "SIM atribuição E2E (apagar)",
      pushName: "SIM E2E",
      customFields: {},
    },
  })
  contactId = contact.id
  out.steps.push({ step: "contactCreated", contactId: contact.id, onSeller: true })

  await resolveAndApplyAttributionFromPendingLead(prisma, {
    userId: seller.userId,
    contact,
  })
  const after = await prisma.crmContact.findUnique({ where: { id: contact.id } })
  const hasAttr = contactHasAnyAdsAttribution(after)
  const metaFields = after?.customFields?.meta || {}
  const claimPass = hasAttr && String(metaFields.fbclid || "") === FBCLID
  out.steps.push({
    step: "claimAsSeller",
    hasAttr,
    fbclid: metaFields.fbclid || null,
    fbc: metaFields.fbc ? "yes" : null,
    fbp: metaFields.fbp ? "yes" : null,
    pass: claimPass,
  })
  if (!claimPass) out.ok = false

  out.steps.push({
    step: "purchaseWouldHaveAdsAttribution",
    hasAdsAttribution: hasAttr,
    toastWouldWarnNoAdClick: !hasAttr,
    pass: hasAttr,
  })
  } finally {
    if (contactId) await prisma.crmContact.delete({ where: { id: contactId } }).catch(() => {})
    if (createdRef) await prisma.metaAttributionLead.deleteMany({ where: { ref: createdRef } }).catch(() => {})
    for (const row of paused) {
      await prisma.metaAttributionLead
        .update({ where: { id: row.id }, data: { expiresAt: row.expiresAt } })
        .catch(() => {})
    }
    out.steps.push({ step: "cleanup", restoredPending: paused.length, pass: true })
  }

  console.log(JSON.stringify(out, null, 2))
  if (!out.ok) process.exit(2)
}

main()
  .catch((e) => {
    console.error("FAIL", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

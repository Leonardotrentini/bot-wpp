const { prisma } = require("./prisma")

const DEFAULT_PLANS = [
  {
    name: "ILIMITADO",
    slug: "free",
    description: "Acesso completo sem limite de grupos",
    priceMonthly: null,
    maxGroups: 9999,
    active: true,
    sortOrder: 0,
  },
  {
    name: "Pro",
    slug: "pro",
    description: "Operação em escala",
    priceMonthly: 9900,
    maxGroups: 50,
    active: true,
    sortOrder: 1,
  },
]

/** Garante planos free/pro (idempotente). Usado no registo e no arranque do servidor. */
async function ensureDefaultPlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        maxGroups: p.maxGroups,
        active: p.active,
        sortOrder: p.sortOrder,
      },
      create: p,
    })
  }
}

module.exports = { ensureDefaultPlans }

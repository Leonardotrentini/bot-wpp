require("dotenv").config()

const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

async function main() {
  const planDefs = [
    {
      name: "Grátis",
      slug: "free",
      description: "Plano inicial para experimentar",
      priceMonthly: null,
      maxGroups: 3,
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

  for (const p of planDefs) {
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

  const email = process.env.ADMIN_SEED_EMAIL || "admin@vesto.group"
  const password = process.env.ADMIN_SEED_PASSWORD || "Admin@ChangeMe!2026"
  const hash = await bcrypt.hash(password, 10)

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: "ADMIN",
      name: "Administrador",
    },
    create: {
      email,
      name: "Administrador",
      passwordHash: hash,
      role: "ADMIN",
    },
  })

  const free = await prisma.plan.findUnique({ where: { slug: "free" } })
  if (free) {
    const existingSub = await prisma.subscription.findFirst({
      where: { userId: admin.id, status: "ACTIVE" },
    })
    if (!existingSub) {
      await prisma.subscription.create({
        data: { userId: admin.id, planId: free.id, status: "ACTIVE" },
      })
    }
  }

  console.log("[seed] Planos criados/atualizados: free, pro")
  console.log("[seed] Admin:", email, "(defina ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD em produção)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

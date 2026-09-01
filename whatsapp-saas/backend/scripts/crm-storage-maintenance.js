/**
 * Manutenção manual de armazenamento CRM (Railway shell / local).
 * Uso: node scripts/crm-storage-maintenance.js [--full]
 */
require("dotenv").config()
const { prisma } = require("../src/lib/prisma")
const { runCrmStorageMaintenance } = require("../src/lib/crmMaintenance")

async function main() {
  const full = process.argv.includes("--full")
  console.log(`Manutenção CRM (full=${full})…`)
  const result = await runCrmStorageMaintenance(prisma, { full })
  console.log(JSON.stringify(result, null, 2))
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * CLI: compacta JSON raw pesado em lotes até esgotar.
 * Uso (dentro do container Railway):
 *   node scripts/compact-message-raw.js
 *   node scripts/compact-message-raw.js --max-batches=50
 */
const { PrismaClient } = require("@prisma/client")
const { compactMessageRawAll } = require("../src/lib/messageRawCompact")

const prisma = new PrismaClient()

function readArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const n = Number(hit.split("=")[1])
  return Number.isFinite(n) ? n : fallback
}

async function main() {
  const maxBatches = readArg("max-batches", 50)
  const limit = readArg("limit", 200)
  let finished = false
  let rounds = 0
  let totalSaved = 0

  while (!finished && rounds < 200) {
    rounds += 1
    const result = await compactMessageRawAll(prisma, { limit, maxBatches, target: "both" })
    totalSaved += result.bytesSavedTotal
    finished = result.finished
    console.log(
      JSON.stringify({
        round: rounds,
        finished: result.finished,
        crm: result.crm,
        group: result.group,
        bytesSavedTotal: result.bytesSavedTotal,
      }),
    )
    if (result.bytesSavedTotal === 0 && !result.crm.updated && !result.group.updated) break
  }

  console.log(
    JSON.stringify({
      done: true,
      rounds,
      totalSavedMb: Math.round((totalSaved / (1024 * 1024)) * 100) / 100,
    }),
  )
}

main()
  .catch((err) => {
    console.error(err?.message || err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

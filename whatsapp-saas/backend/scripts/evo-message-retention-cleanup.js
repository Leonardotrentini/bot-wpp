/**
 * Retenção de mensagens na Evolution (quando DATABASE_SAVE_DATA_NEW_MESSAGE=true).
 * Apaga Message / MessageUpdate mais velhos que N dias no Postgres da Evolution.
 * CRM continua sendo a fonte de verdade histórica.
 *
 * Uso (dry-run padrão):
 *   railway variables -s Postgres-Py8r -e production --json | node scripts/evo-message-retention-cleanup.js
 * Aplicar:
 *   ... | node scripts/evo-message-retention-cleanup.js --apply --days=30
 *
 * Também aceita DATABASE_PUBLIC_URL / DATABASE_URL no JSON (DB da Evolution, não do CRM).
 */
const { Client } = require("pg")

function parseArgs(argv) {
  const out = { apply: false, days: 30, limit: 50000 }
  for (const a of argv) {
    if (a === "--apply") out.apply = true
    else if (a.startsWith("--days=")) out.days = Math.max(1, Number(a.slice(7)) || 30)
    else if (a.startsWith("--limit=")) out.limit = Math.max(100, Number(a.slice(8)) || 50000)
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  const env = raw.trim() ? JSON.parse(raw) : process.env
  const url = env.DATABASE_PUBLIC_URL || env.DATABASE_URL
  if (!url) throw new Error("missing DATABASE_URL for Evolution Postgres")
  if (/railway\.internal/.test(url) && !env.DATABASE_PUBLIC_URL) {
    throw new Error("use DATABASE_PUBLIC_URL (railway.internal não resolve do laptop)")
  }

  const client = new Client({
    connectionString: env.DATABASE_PUBLIC_URL || url,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000)
  // messageTimestamp na Evolution costuma ser epoch seconds (Int) OU DateTime dependendo da versão.
  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "Message") AS messages_total,
      (SELECT COUNT(*)::int FROM "MessageUpdate") AS updates_total
  `)

  // Tenta colunas comuns
  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name IN ('messageTimestamp','messageTimestampMs','createdAt','updatedAt')
  `)
  const colMap = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]))

  let whereSql
  let params = [cutoff]
  if (colMap.messageTimestamp && /timestamp|date/i.test(colMap.messageTimestamp)) {
    whereSql = `"messageTimestamp" < $1`
  } else if (colMap.createdAt) {
    whereSql = `"createdAt" < $1`
  } else if (colMap.messageTimestamp) {
    // epoch seconds
    whereSql = `"messageTimestamp" < $1`
    params = [Math.floor(cutoff.getTime() / 1000)]
  } else {
    throw new Error(`Message table sem coluna de tempo reconhecida: ${JSON.stringify(colMap)}`)
  }

  const oldCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM "Message" WHERE ${whereSql}`,
    params,
  )

  const result = {
    ok: true,
    dryRun: !opts.apply,
    days: opts.days,
    cutoff: cutoff.toISOString(),
    totals: counts.rows[0],
    oldMessages: oldCount.rows[0].n,
    columns: colMap,
  }

  if (!opts.apply) {
    result.next = "Reexecute com --apply --days=30 para apagar"
    console.log(JSON.stringify(result, null, 2))
    await client.end()
    return
  }

  // MessageUpdate primeiro (FK lógica / órfãos)
  let deletedUpdates = 0
  try {
    const upd = await client.query(
      `DELETE FROM "MessageUpdate" WHERE "messageId" IN (
         SELECT id FROM "Message" WHERE ${whereSql} LIMIT ${opts.limit}
       )`,
      params,
    )
    deletedUpdates = upd.rowCount || 0
  } catch (err) {
    result.messageUpdateError = err.message
  }

  const del = await client.query(
    `DELETE FROM "Message" WHERE id IN (
       SELECT id FROM "Message" WHERE ${whereSql} LIMIT ${opts.limit}
     )`,
    params,
  )

  result.deletedMessages = del.rowCount || 0
  result.deletedUpdates = deletedUpdates
  console.log(JSON.stringify(result, null, 2))
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

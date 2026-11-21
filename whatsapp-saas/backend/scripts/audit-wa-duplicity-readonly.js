/**
 * Auditoria readonly: duplicidade Evo1 ∩ Evo2 ∩ CRM WhatsAppConnection.
 *
 * Uso (Railway):
 *   railway variables -s backend -e production --json | node scripts/audit-wa-duplicity-readonly.js
 *
 * Não apaga nada. Imprime comandos de limpeza sugeridos no final.
 */
const { PrismaClient } = require("@prisma/client")

function digits(v) {
  return String(v || "").replace(/\D/g, "")
}

function normalizePhoneKey(v) {
  const d = digits(v)
  if (!d) return null
  if (d.length >= 12 && d.startsWith("55")) return d
  if (d.length >= 10 && d.length <= 11) return `55${d}`
  return d
}

async function fetchInstances(baseUrl, apiKey, hostLabel) {
  const base = String(baseUrl || "").replace(/\/+$/, "")
  if (!base || !apiKey) return { host: hostLabel, error: "missing_creds", instances: [] }
  const res = await fetch(`${base}/instance/fetchInstances`, {
    headers: { apikey: apiKey },
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { host: hostLabel, error: `bad_json_${res.status}`, instances: [], raw: text.slice(0, 200) }
  }
  const list = Array.isArray(data) ? data : data?.instances || data?.data || []
  const instances = (Array.isArray(list) ? list : []).map((item) => {
    const inst = item?.instance || item
    const name = inst?.instanceName || inst?.name || item?.name || null
    const state =
      inst?.connectionStatus || inst?.status || item?.connectionStatus || item?.status || null
    const owner =
      inst?.ownerJid ||
      inst?.owner ||
      inst?.wuid ||
      item?.ownerJid ||
      item?.owner ||
      inst?.number ||
      null
    return {
      instanceName: name,
      state: state ? String(state) : null,
      phone: owner ? String(owner) : null,
      phoneDigits: normalizePhoneKey(owner),
      host: hostLabel,
    }
  }).filter((r) => r.instanceName)
  return { host: hostLabel, httpStatus: res.status, instances }
}

async function main() {
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  const env = raw.trim() ? JSON.parse(raw) : process.env
  // Preferir URL pública — DATABASE_URL interno (*.railway.internal) não resolve do laptop.
  const dbUrl = env.DATABASE_PUBLIC_URL || env.DATABASE_URL
  if (dbUrl) process.env.DATABASE_URL = dbUrl
  if (/railway\.internal/.test(String(process.env.DATABASE_URL || "")) && env.DATABASE_PUBLIC_URL) {
    process.env.DATABASE_URL = env.DATABASE_PUBLIC_URL
  }
  if (/railway\.internal/.test(String(process.env.DATABASE_URL || ""))) {
    throw new Error("DATABASE_URL aponta para railway.internal — forneça DATABASE_PUBLIC_URL no JSON")
  }
  for (const k of [
    "EVOLUTION_BASE_URL",
    "EVOLUTION_API_KEY",
    "EVOLUTION_2_BASE_URL",
    "EVOLUTION_2_API_KEY",
  ]) {
    if (env[k]) process.env[k] = env[k]
  }

  const prisma = new PrismaClient()
  const out = {
    ok: true,
    diagnosedAt: new Date().toISOString(),
    evo1: null,
    evo2: null,
    crm: null,
    dualHostPhones: [],
    dualInstanceSamePhone: [],
    orphansOnEvo: [],
    crmMissingOnEvo: [],
    cleanupCommands: [],
  }

  try {
    const [evo1, evo2] = await Promise.all([
      fetchInstances(process.env.EVOLUTION_BASE_URL, process.env.EVOLUTION_API_KEY, "Evo1"),
      fetchInstances(process.env.EVOLUTION_2_BASE_URL, process.env.EVOLUTION_2_API_KEY, "Evo2"),
    ])
    out.evo1 = { host: evo1.host, httpStatus: evo1.httpStatus, error: evo1.error || null, total: evo1.instances.length }
    out.evo2 = { host: evo2.host, httpStatus: evo2.httpStatus, error: evo2.error || null, total: evo2.instances.length }

    const crmRows = await prisma.whatsAppConnection.findMany({
      select: {
        id: true,
        userId: true,
        instanceName: true,
        phone: true,
        phoneDigits: true,
        evolutionHost: true,
        connected: true,
        status: true,
        syncHealth: true,
        user: { select: { email: true, name: true } },
      },
    })
    out.crm = { total: crmRows.length }

    const evoAll = [...evo1.instances, ...evo2.instances]
    const evoByName = new Map(evoAll.map((i) => [i.instanceName, i]))
    const crmByName = new Map(crmRows.map((r) => [r.instanceName, r]))

    // Telefone em ambos os hosts
    const phonesEvo1 = new Map()
    const phonesEvo2 = new Map()
    for (const i of evo1.instances) {
      if (!i.phoneDigits) continue
      if (!phonesEvo1.has(i.phoneDigits)) phonesEvo1.set(i.phoneDigits, [])
      phonesEvo1.get(i.phoneDigits).push(i)
    }
    for (const i of evo2.instances) {
      if (!i.phoneDigits) continue
      if (!phonesEvo2.has(i.phoneDigits)) phonesEvo2.set(i.phoneDigits, [])
      phonesEvo2.get(i.phoneDigits).push(i)
    }
    for (const [phone, rows1] of phonesEvo1) {
      if (!phonesEvo2.has(phone)) continue
      out.dualHostPhones.push({
        phone,
        evo1: rows1,
        evo2: phonesEvo2.get(phone),
        crm: crmRows.filter((c) => c.phoneDigits === phone || normalizePhoneKey(c.phone) === phone),
      })
    }

    // Mesmo telefone em 2 instanceNames (qualquer host)
    const byPhone = new Map()
    for (const i of evoAll) {
      if (!i.phoneDigits) continue
      if (!byPhone.has(i.phoneDigits)) byPhone.set(i.phoneDigits, [])
      byPhone.get(i.phoneDigits).push(i)
    }
    for (const [phone, rows] of byPhone) {
      const names = new Set(rows.map((r) => r.instanceName))
      if (names.size > 1) {
        out.dualInstanceSamePhone.push({ phone, instances: rows })
      }
    }

    // Órfãs na Evo (sem CRM)
    for (const i of evoAll) {
      if (!crmByName.has(i.instanceName)) {
        out.orphansOnEvo.push(i)
      }
    }

    // CRM apontando para instância inexistente
    for (const c of crmRows) {
      if (!evoByName.has(c.instanceName)) {
        out.crmMissingOnEvo.push({
          instanceName: c.instanceName,
          evolutionHost: c.evolutionHost,
          connected: c.connected,
          status: c.status,
          phone: c.phone,
          email: c.user?.email || null,
          name: c.user?.name || null,
        })
      }
    }

    // Comandos de limpeza (NÃO executar) — só órfãs claramente desconectadas
    for (const orphan of out.orphansOnEvo) {
      if (!orphan.state || /open|connected/i.test(orphan.state)) continue
      const base =
        orphan.host === "Evo2"
          ? "${EVOLUTION_2_BASE_URL}"
          : "${EVOLUTION_BASE_URL}"
      const key =
        orphan.host === "Evo2" ? "${EVOLUTION_2_API_KEY}" : "${EVOLUTION_API_KEY}"
      out.cleanupCommands.push({
        risk: "destructive_delete_instance",
        note: "Só após aprovação — apaga instância órfã DESCONECTADA na Evolution",
        command: `curl -X DELETE "${base}/instance/delete/${orphan.instanceName}" -H "apikey: ${key}"`,
        instanceName: orphan.instanceName,
        host: orphan.host,
        state: orphan.state,
      })
    }

    console.log(JSON.stringify(out, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

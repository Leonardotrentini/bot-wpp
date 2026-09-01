/** Conta runs test vs prod e verifica fluxos INICIANDO/AUDIO1 */
const BASE = "https://backend-production-7a466.up.railway.app/api"
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"

async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  return r.json()
}

async function main() {
  const login = await req("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  const users = await req("/admin/users?q=tarot", { token: login.token })
  const target = users.users.find((u) => String(u.name).includes("tarot"))
  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: login.token })
  const token = imp.token

  const flows = (await req("/crm/flows", { token })).flows
  for (const name of ["AUDIO 1", "INICIANDO"]) {
    const f = flows.find((x) => x.name === name)
    if (!f) continue
    console.log(`\n=== ${name} ===`)
    console.log(`trigger:`, JSON.stringify(f.trigger))
    console.log(`actions:`, f.actions?.map((a) => a.type + (a.stageId ? `→${a.stageId.slice(-6)}` : "")))
    console.log(`cooldown: ${f.cooldownPerContactHours}h conditions:`, f.conditions?.length || 0)
    const runs = (await req(`/crm/flows/${f.id}/runs`, { token })).runs || []
    const dayAgo = Date.now() - 86400000
    const today = runs.filter((r) => new Date(r.createdAt).getTime() >= dayAgo)
    const tests = today.filter((r) => String(r.detail).startsWith("test:"))
    const prod = today.filter((r) => !String(r.detail).startsWith("test:") && r.status === "ok")
    const failed = today.filter((r) => r.status === "failed")
    console.log(`runs 24h: total=${today.length} prod_ok=${prod.length} test=${tests.length} failed=${failed.length}`)
    console.log(`last 5 prod:`, prod.slice(0, 5).map((r) => `${r.createdAt.slice(11, 19)} ${r.conversationId.slice(-6)}`))
  }

  // Conversa que funcionou hoje vs que falhou
  const okRun = (await req(`/crm/flows/${flows.find((x) => x.name === "AUDIO 1").id}/runs`, { token })).runs
    .find((r) => r.status === "ok" && !String(r.detail).startsWith("test:"))
  if (okRun) {
    const conv = await req(`/crm/conversations/${okRun.conversationId}/messages?limit=5`, { token })
    console.log("\n=== Exemplo SUCESSO automático ===")
    console.log("run:", okRun.createdAt, okRun.detail)
    for (const m of (conv.messages || []).slice(0, 3)) {
      console.log(`  ${m.timestamp} ${m.fromMe ? "OUT" : "IN"} ${m.source} ${String(m.body || m.type).slice(0, 40)}`)
    }
  }
}

main().catch(console.error)

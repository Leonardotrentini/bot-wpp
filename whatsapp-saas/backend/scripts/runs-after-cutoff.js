const BASE = "https://backend-production-7a466.up.railway.app/api"
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"

async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
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

  const cutoff = new Date("2026-08-31T19:45:00.000Z")
  console.log("Runs após", cutoff.toISOString(), "\n")

  for (const name of ["AUDIO 1", "INICIANDO"]) {
    const f = flows.find((x) => x.name === name)
    const runs = (await req(`/crm/flows/${f.id}/runs`, { token })).runs || []
    const after = runs.filter((r) => new Date(r.createdAt) >= cutoff)
    console.log(`--- ${name} (${after.length} runs após cutoff) ---`)
    for (const r of after) {
      console.log(`  ${r.createdAt} | ${r.status} | ${r.conversationId.slice(-8)} | ${r.detail?.slice(0, 60)}`)
    }
  }

  // Leads novos após cutoff sem run
  const convs = (await req("/crm/conversations?limit=30", { token })).conversations || []
  const audio1 = flows.find((x) => x.name === "AUDIO 1")
  const audioRuns = (await req(`/crm/flows/${audio1.id}/runs`, { token })).runs || []
  const runConvIds = new Set(audioRuns.map((r) => r.conversationId))

  console.log("\n--- Novas conversas após cutoff sem AUDIO 1 run ---")
  for (const c of convs) {
    if (new Date(c.createdAt) < cutoff) continue
    if (runConvIds.has(c.id)) continue
    const hasTest = audioRuns.some((r) => r.conversationId === c.id && String(r.detail).startsWith("test:"))
    console.log(`  ${c.createdAt} | ${c.contact?.pushName} | test_only=${hasTest}`)
  }
}

main().catch(console.error)

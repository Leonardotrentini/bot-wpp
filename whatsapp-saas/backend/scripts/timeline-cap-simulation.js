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
  const imp = await req(
    `/admin/users/${(await req("/admin/users?q=tarot", { token: login.token })).users.find((u) => u.name.includes("tarot")).id}/impersonate`,
    { method: "POST", token: login.token },
  )
  const token = imp.token
  const audio1 = (await req("/crm/flows", { token })).flows.find((f) => f.name === "AUDIO 1")
  const runs = (await req(`/crm/flows/${audio1.id}/runs`, { token })).runs.sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  )
  const dayAgo = Date.now() - 86400000
  const today = runs.filter((r) => new Date(r.createdAt).getTime() >= dayAgo && r.status === "ok")

  console.log("AUDIO 1 runs cronológicos (24h, ok):\n")
  let prodCount = 0
  let totalCount = 0
  for (const r of today) {
    const isTest = String(r.detail).startsWith("test:")
    if (!isTest) prodCount++
    totalCount++
    const cap20prod = prodCount > 20 ? "BLOCK" : prodCount === 20 ? "CAP20" : ""
    const cap20all = totalCount > 20 ? "BLOCK_ALL" : totalCount === 20 ? "CAP20_ALL" : ""
    console.log(
      `${r.createdAt} | ${isTest ? "TEST" : "PROD"} #${isTest ? totalCount : prodCount} | total=${totalCount} | ${cap20all} ${r.detail?.slice(0, 40)}`,
    )
  }

  console.log("\nSimulação limite antigo (20/dia, testes contam): auto bloqueia quando total >= 20")
  console.log("Simulação fix 86ec6e6 (500/dia, testes ignoram): auto bloqueia quando prod >= 500")
}

main().catch(console.error)

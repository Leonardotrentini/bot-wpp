/**
 * Auditoria rapida de producao — health, WA, fluxos, leads sem resposta.
 */
const BASE = (process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"
const USER_SEARCH = process.env.AUDIT_USER || "tarot"

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  const report = { ok: true, checks: [] }
  const add = (name, pass, detail = "") => {
    report.checks.push({ name, pass, detail })
    if (!pass) report.ok = false
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  }

  console.log("\n=== Auditoria CRM produção ===\n")

  const health = await fetch(BASE.replace(/\/api$/, "") + "/health").then((r) => r.json())
  add("Backend /health", health.ok === true && health.db === "ok", JSON.stringify(health))

  const login = await req("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  add("Login admin", login.ok, login.ok ? "" : JSON.stringify(login.data))
  if (!login.ok) process.exit(1)
  const adminToken = login.data.token

  const users = await req(`/admin/users?q=${encodeURIComponent(USER_SEARCH)}`, { token: adminToken })
  const target = (users.data.users || []).find((u) =>
    String(u.name || "").toLowerCase().includes(USER_SEARCH.toLowerCase()),
  )
  add("Conta alvo", !!target, target ? `${target.name}` : USER_SEARCH)
  if (!target) process.exit(1)

  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: adminToken })
  add("Impersonate", imp.ok)
  const token = imp.data.token

  const wa = await req("/whatsapp/status", { token })
  add("WhatsApp conectado", wa.data?.connected === true, wa.data?.connected ? wa.data.status : JSON.stringify(wa.data))

  const flows = await req("/crm/flows", { token })
  const enabled = (flows.data.flows || []).filter((f) => f.enabled)
  add("Fluxos ativos", enabled.length > 0, `${enabled.length} fluxo(s)`)

  const convs = await req("/crm/conversations?limit=50&q=carta", { token })
  const withCarta = (convs.data.conversations || []).filter((c) =>
    String(c.lastMessagePreview || "").toLowerCase().includes("carta"),
  )

  let missingReply = 0
  for (const c of withCarta.slice(0, 15)) {
    const msgs = await req(`/crm/conversations/${c.id}/messages?limit=30`, { token })
    const list = msgs.data.messages || []
    const lastInbound = list.filter((m) => !m.fromMe && !["flow", "ai"].includes(m.source)).slice(-1)[0]
    const hasFlowAfter = list.some(
      (m) =>
        m.fromMe &&
        lastInbound &&
        new Date(m.timestamp) >= new Date(lastInbound.timestamp),
    )
    if (lastInbound && !hasFlowAfter) {
      missingReply += 1
      console.log(`  ⚠ sem resposta automática: ${c.contact?.pushName || c.id}`)
    }
  }
  add("Leads 'carta' com resposta do fluxo", missingReply === 0, missingReply ? `${missingReply} sem resposta` : `${withCarta.length} verificados`)

  const agents = await req("/crm/agents", { token })
  add("API agentes IA", agents.ok, `aiConfigured=${agents.data.aiConfigured}`)

  console.log(`\nResultado: ${report.ok ? "APROVADO" : "FALHOU"}`)
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

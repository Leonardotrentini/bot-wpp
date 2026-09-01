/**
 * Deep-dive em conversas específicas — produção.
 * node scripts/diagnose-conversation-prod.js "De santa sabor" "Yaneisy" "Gise"
 */
const BASE = (process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"
const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : ["De santa sabor", "Yaneisy", "Gise", "Fatima"]

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try {
    return { ok: res.ok, data: JSON.parse(text) }
  } catch {
    return { ok: res.ok, data: { raw: text.slice(0, 300) } }
  }
}

async function main() {
  const login = await req("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  const users = await req("/admin/users?q=tarot", { token: login.data.token })
  const target = users.data.users.find((u) => String(u.name || "").includes("tarot"))
  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: login.data.token })
  const token = imp.data.token

  const flowsRes = await req("/crm/flows", { token })
  const audio1 = flowsRes.data.flows.find((f) => f.name === "AUDIO 1")
  const iniciando = flowsRes.data.flows.find((f) => f.name === "INICIANDO")

  for (const q of QUERIES) {
    console.log(`\n${"=".repeat(60)}\nBUSCA: "${q}"`)
    const convRes = await req(`/crm/conversations?limit=20&q=${encodeURIComponent(q)}`, { token })
    const conv = (convRes.data.conversations || [])[0]
    if (!conv) {
      console.log("  Conversa não encontrada")
      continue
    }

    console.log(`  id: ${conv.id}`)
    console.log(`  contact: ${conv.contact?.pushName} flowsStoppedAt=${conv.contact?.flowsStoppedAt || "null"}`)
    console.log(`  created: ${conv.createdAt} lastMsg: ${conv.lastMessageAt}`)
    console.log(`  status: ${conv.status} stage: ${conv.kanbanStageId}`)

    const msgs = await req(`/crm/conversations/${conv.id}/messages?limit=50`, { token })
    const list = (msgs.data.messages || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    console.log(`\n  Mensagens (${list.length}):`)
    for (const m of list) {
      console.log(
        `    ${m.timestamp} | ${m.fromMe ? "OUT" : "IN "} | src=${m.source} | ${String(m.body || m.type).slice(0, 50)}`,
      )
    }

    const inbounds = list.filter((m) => !m.fromMe && !["flow", "ai"].includes(m.source))
    const firstInbound = inbounds[0]
    if (firstInbound) {
      const ageMin = Math.round((Date.now() - new Date(firstInbound.timestamp).getTime()) / 60000)
      console.log(`\n  1ª inbound: ${firstInbound.timestamp} (${ageMin} min atrás) source=${firstInbound.source}`)
    }

    for (const flow of [audio1, iniciando].filter(Boolean)) {
      const runs = await req(`/crm/flows/${flow.id}/runs`, { token })
      const onConv = (runs.data.runs || []).filter((r) => r.conversationId === conv.id)
      console.log(`\n  Runs ${flow.name}: ${onConv.length}`)
      for (const r of onConv.slice(0, 5)) {
        console.log(`    ${r.createdAt} ${r.status} — ${r.detail}`)
      }
      const allToday = (runs.data.runs || []).filter(
        (r) => r.status === "ok" && Date.now() - new Date(r.createdAt).getTime() < 86400000,
      )
      console.log(`  Total runs ${flow.name} hoje (API top50): ${allToday.length}`)
    }
  }
}

main().catch(console.error)

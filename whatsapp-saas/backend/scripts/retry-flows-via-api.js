/**
 * Re-dispara fluxos via API de producao (admin -> impersonate -> flow test).
 * Uso: node scripts/retry-flows-via-api.js
 */
const BASE = (process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"
const USER_SEARCH = process.env.RETRY_USER || "tarot"

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

async function main() {
  console.log(`API: ${BASE}`)

  const login = await req("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  const adminToken = login.token

  const users = await req(`/admin/users?q=${encodeURIComponent(USER_SEARCH)}&pageSize=20`, {
    token: adminToken,
  })
  const target = (users.users || []).find((u) =>
    String(u.name || u.email || "").toLowerCase().includes(USER_SEARCH.toLowerCase()),
  )
  if (!target) {
    console.error("Usuario nao encontrado:", USER_SEARCH)
    process.exit(1)
  }
  console.log(`Conta: ${target.name} (${target.email})`)

  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: adminToken })
  const token = imp.token

  const { flows } = await req("/crm/flows", { token })
  const enabled = (flows || []).filter((f) => f.enabled)
  const keywordFlows = enabled.filter((f) => f.trigger?.type === "keyword" || f.trigger?.type === "new_conversation")
  if (!keywordFlows.length) {
    console.error("Nenhum fluxo keyword/new_conversation ativo.")
    process.exit(1)
  }
  const flow = keywordFlows.find((f) =>
    (f.trigger?.keywords || []).some((k) => String(k).toLowerCase().includes("carta")),
  ) || keywordFlows[0]
  console.log(`Fluxo: ${flow.name} (${flow.id})`)

  const { conversations } = await req("/crm/conversations?limit=100&q=carta", { token })
  const targets = (conversations || []).filter((c) =>
    String(c.lastMessagePreview || "").toLowerCase().includes("carta"),
  )

  if (!targets.length) {
    console.log("Nenhuma conversa com 'carta' na preview. Buscando todas recentes…")
    const all = await req("/crm/conversations?limit=100", { token })
    for (const c of all.conversations || []) {
      if (String(c.lastMessagePreview || "").toLowerCase().includes("carta secreta")) {
        targets.push(c)
      }
    }
  }

  console.log(`Conversas a reprocessar: ${targets.length}`)
  let ok = 0
  for (const conv of targets) {
    const label = conv.contact?.pushName || conv.contact?.phone || conv.id
    try {
      const result = await req(`/crm/flows/${flow.id}/test`, {
        method: "POST",
        token,
        body: { conversationId: conv.id },
      })
      await new Promise((r) => setTimeout(r, 3000))
      const msgs = await req(`/crm/conversations/${conv.id}/messages?limit=15`, { token })
      const hasFlow = (msgs.messages || []).some((m) => m.fromMe && m.source === "flow")
      if (hasFlow) {
        console.log(`  ✓ ${label}: enviado (${result.detail?.join(", ") || "ok"})`)
        ok += 1
      } else {
        console.error(`  ✗ ${label}: fluxo não gerou mensagem (${result.message || "sem detalhe"})`)
      }
    } catch (err) {
      console.error(`  ✗ ${label}: ${err.message}`)
    }
  }
  console.log(`\nConcluido: ${ok}/${targets.length} enviados.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

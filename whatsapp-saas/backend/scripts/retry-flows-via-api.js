/**
 * Re-dispara fluxos via API de producao — só conversas sem resposta automatica.
 * Usa POST /conversations/:id/redispatch-flows (caminho real do webhook, nao teste manual).
 *
 * Uso: node scripts/retry-flows-via-api.js [--hours=72] [--user=tarot]
 */
const BASE = (process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"
const USER_SEARCH = process.env.RETRY_USER || process.argv.find((a) => a.startsWith("--user="))?.split("=")[1] || "tarot"
const HOURS = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] || 72)

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

function needsFlowReply(conv, msgs) {
  const list = (msgs || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const inbounds = list.filter((m) => !m.fromMe && !["flow", "ai"].includes(m.source))
  if (!inbounds.length) return false
  const lastInbound = inbounds[inbounds.length - 1]
  const since = Date.now() - HOURS * 3600 * 1000
  if (new Date(lastInbound.timestamp).getTime() < since) return false

  const hasFlowAfter = list.some(
    (m) => m.fromMe && m.source === "flow" && new Date(m.timestamp) >= new Date(lastInbound.timestamp),
  )
  if (hasFlowAfter) return false

  const body = String(lastInbound.body || "").toLowerCase()
  const preview = String(conv.lastMessagePreview || "").toLowerCase()
  const isMetaLead = body.includes("carta") || preview.includes("carta") || body.includes("informacion")
  return isMetaLead || priorInboundCount(list, lastInbound) === 0
}

function priorInboundCount(list, lastInbound) {
  return list.filter(
    (m) =>
      !m.fromMe &&
      !["flow", "ai"].includes(m.source) &&
      m.id !== lastInbound.id &&
      new Date(m.timestamp) < new Date(lastInbound.timestamp),
  ).length
}

async function main() {
  console.log(`API: ${BASE} | conta: ${USER_SEARCH} | janela: ${HOURS}h\n`)

  const login = await req("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  const users = await req(`/admin/users?q=${encodeURIComponent(USER_SEARCH)}&pageSize=20`, { token: login.token })
  const target = (users.users || []).find((u) =>
    String(u.name || u.email || "").toLowerCase().includes(USER_SEARCH.toLowerCase()),
  )
  if (!target) {
    console.error("Usuario nao encontrado:", USER_SEARCH)
    process.exit(1)
  }
  console.log(`Conta: ${target.name} (${target.email})`)

  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: login.token })
  const token = imp.token

  const { conversations } = await req("/crm/conversations?limit=100", { token })
  const targets = []

  for (const conv of conversations || []) {
    const msgs = await req(`/crm/conversations/${conv.id}/messages?limit=40`, { token })
    if (needsFlowReply(conv, msgs.messages)) targets.push(conv)
  }

  console.log(`Conversas sem resposta automatica: ${targets.length}\n`)
  let ok = 0
  for (const conv of targets) {
    const label = conv.contact?.pushName || conv.contact?.phone || conv.id
    try {
      const result = await req(`/crm/conversations/${conv.id}/redispatch-flows`, { method: "POST", token })
      await new Promise((r) => setTimeout(r, 2500))
      const msgs = await req(`/crm/conversations/${conv.id}/messages?limit=15`, { token })
      const hasFlow = (msgs.messages || []).some((m) => m.fromMe && m.source === "flow")
      const runOk = (result.runs || []).some((r) => r.status === "ok")
      if (hasFlow || runOk) {
        console.log(`  ✓ ${label}: ${(result.runs || []).map((r) => r.detail).join("; ") || "ok"}`)
        ok += 1
      } else if ((result.runs || []).some((r) => r.status === "skipped")) {
        console.log(`  ~ ${label}: skipped — ${result.runs.map((r) => r.detail).join("; ")}`)
      } else {
        console.error(`  ✗ ${label}: sem envio (${JSON.stringify(result.runs || [])})`)
      }
    } catch (err) {
      if (err.status === 404 && String(err.message).includes("NOT_FOUND")) {
        console.log(`  ↷ ${label}: endpoint redispatch ainda nao deployado — use deploy primeiro`)
        break
      }
      console.error(`  ✗ ${label}: ${err.message}`)
    }
  }
  console.log(`\nConcluido: ${ok}/${targets.length} reprocessados.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Teste real do X1 contra o backend em produção.
 * Uso: node scripts/test-x1-production.js
 * Env opcionais: API_BASE, ADMIN_EMAIL, ADMIN_PASSWORD
 */
const API_BASE = (process.env.API_BASE || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.")
  process.exit(1)
}

async function request(method, path, { token, body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text?.slice(0, 500) }
    }
    return { status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

function log(step, msg, extra) {
  console.log(`\n[${step}] ${msg}`)
  if (extra !== undefined) console.log(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2))
}

async function main() {
  console.log(`\n=== Teste X1 produção ===\nAPI: ${API_BASE}\n`)

  const healthUrl = API_BASE.replace(/\/api$/, "") + "/health"
  const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(25000) }).then(async (r) => ({
    status: r.status,
    data: await r.json().catch(() => ({})),
  }))
  log("health", `status ${healthRes.status}`, healthRes.data)
  if (healthRes.status !== 200) {
    console.error("Backend indisponível.")
    process.exit(1)
  }

  const login = await request("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  log("login", `status ${login.status}`, login.data?.user ? { email: login.data.user.email, id: login.data.user.id } : login.data)
  if (login.status !== 200 || !login.data?.token) {
    console.error("Login falhou. Verifique ADMIN_EMAIL / ADMIN_PASSWORD.")
    process.exit(1)
  }
  const token = login.data.token

  const wa = await request("GET", "/whatsapp/status", { token })
  log("whatsapp", `connected=${wa.data?.connected}`, { phone: wa.data?.phone, status: wa.data?.status })
  if (!wa.data?.connected) {
    console.warn("⚠ WhatsApp NÃO conectado — teste X1 real pode falhar. Continuando diagnóstico…")
  }

  const groups = await request("GET", "/groups", { token })
  const list = groups.data?.groups || []
  log("groups", `${list.length} grupo(s) no cache`)
  const monitored = list.filter((g) => g.monitoringEnabled)
  console.log(`  Monitorados: ${monitored.length}`)
  if (!monitored.length) {
    console.error("Nenhum grupo monitorado. Ative um grupo no dashboard e rode de novo.")
    process.exit(1)
  }

  const target = monitored[0]
  log("grupo-alvo", target.name || target.id, { id: target.id, monitoringEnabled: target.monitoringEnabled })

  const details = await request("GET", `/groups/${encodeURIComponent(target.id)}`, { token })
  const members = (details.data?.members || []).filter((m) => m.status !== "saiu")
  log("membros", `${members.length} ativo(s)`)
  if (!members.length) {
    console.error("Grupo sem membros sincronizados.")
    process.exit(1)
  }

  const participantJid = members[0].id || members[0].participantJid
  log("participante-teste", members[0].name || participantJid, { participantJid })

  const x1Config = await request("PUT", `/groups/${encodeURIComponent(target.id)}/config`, {
    token,
    body: {
      x1Automation: {
        enabled: true,
        sendX1OnJoin: true,
        sendX1OnLeave: true,
        joinTemplate: "Teste X1 {{nome}} — Vesto Group",
        leaveTemplate: "Saída {{nome}} — posso ajudar no privado?",
        minDelaySec: 0,
        maxDelaySec: 0,
        maxX1PerUser24h: 10,
        quietHoursEnabled: false,
      },
    },
  })
  log("salvar-x1", `status ${x1Config.status}`, x1Config.data?.config?.x1Automation ? "config ok" : x1Config.data)

  const testJoin = await request("POST", `/groups/${encodeURIComponent(target.id)}/x1/test`, {
    token,
    body: { kind: "join", participantJid },
  })
  log("x1/test join", `status ${testJoin.status}`, testJoin.data)

  const deliveries = await request("GET", `/groups/${encodeURIComponent(target.id)}/x1/deliveries?limit=5`, { token })
  log("historico", `${(deliveries.data?.deliveries || []).length} registro(s)`, deliveries.data?.deliveries?.slice(0, 3))

  const last = deliveries.data?.deliveries?.[0]
  if (testJoin.status === 200 && last?.status === "sent") {
    console.log("\n✅ TESTE REAL OK — X1 enviado no privado (status: sent)\n")
    process.exit(0)
  }
  if (testJoin.status === 422 && last?.error) {
    console.log(`\n⚠ X1 respondeu mas não enviou: ${last.error}\n`)
    process.exit(2)
  }
  if (testJoin.status === 409) {
    console.log("\n⚠ WhatsApp desconectado — conecte no dashboard e repita.\n")
    process.exit(2)
  }
  console.log("\n❌ Resultado inesperado — veja logs acima.\n")
  process.exit(1)
}

main().catch((err) => {
  console.error("\nErro:", err.message || err)
  process.exit(1)
})

/**
 * Teste do X1 automático via webhook GROUP_PARTICIPANTS_UPDATE (simula entrada no grupo).
 * Uso: node scripts/test-x1-webhook-auto.js
 */
const API_BASE = (process.env.API_BASE || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const WEBHOOK_BASE = API_BASE.replace(/\/api$/, "")
const WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

if (!WEBHOOK_SECRET || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina EVOLUTION_WEBHOOK_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.")
  process.exit(1)
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log("\n=== Teste X1 automático (webhook entrada) ===\n")

  const login = await api("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  if (!login.data?.token) {
    console.error("Login falhou:", login.data)
    process.exit(1)
  }
  const token = login.data.token

  const wa = await api("GET", "/whatsapp/status", { token })
  const instanceName = wa.data?.instanceName
  console.log("Instância:", instanceName, "| conectado:", wa.data?.connected)
  if (!wa.data?.connected || !instanceName) {
    console.error("WhatsApp desconectado.")
    process.exit(1)
  }

  const groups = (await api("GET", "/groups", { token })).data?.groups || []
  const group = groups.find((g) => g.monitoringEnabled)
  if (!group) {
    console.error("Nenhum grupo monitorado.")
    process.exit(1)
  }
  console.log("Grupo:", group.name, group.id)

  const details = await api("GET", `/groups/${encodeURIComponent(group.id)}`, { token })
  const members = (details.data?.members || []).filter((m) => m.status !== "saiu")
  // Usa membro diferente do último teste manual (Alessandra)
  const participant =
    members.find((m) => !String(m.name || "").includes("Alessandra")) || members[1] || members[0]
  const participantJid = participant.id
  console.log("Participante simulado (entrada):", participant.name, participantJid)

  await api("PUT", `/groups/${encodeURIComponent(group.id)}/config`, {
    token,
    body: {
      x1Automation: {
        enabled: true,
        sendX1OnJoin: true,
        sendX1OnLeave: true,
        joinTemplate: "Bem-vindo(a) {{nome}}! Entrada automática X1 — Vesto",
        leaveTemplate: "Até logo {{nome}} — saída automática X1",
        minDelaySec: 0,
        maxDelaySec: 0,
        maxX1PerUser24h: 20,
        quietHoursEnabled: false,
      },
    },
  })

  const before = await api("GET", `/groups/${encodeURIComponent(group.id)}/x1/deliveries?limit=3`, { token })
  const beforeIds = new Set((before.data?.deliveries || []).map((d) => d.id))

  const webhookBody = {
    event: "GROUP_PARTICIPANTS_UPDATE",
    instance: instanceName,
    data: {
      id: group.id,
      action: "add",
      participants: [participantJid],
    },
  }

  const webhookUrl = `${WEBHOOK_BASE}/api/evolution/webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`
  console.log("\nDisparando webhook simulado (GROUP_PARTICIPANTS_UPDATE / add)...")

  const wh = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookBody),
    signal: AbortSignal.timeout(30000),
  })
  const whData = await wh.json().catch(() => ({}))
  console.log("Webhook resposta:", wh.status, whData)

  await sleep(5000)

  const after = await api("GET", `/groups/${encodeURIComponent(group.id)}/x1/deliveries?limit=10`, { token })
  const newOnes = (after.data?.deliveries || []).filter((d) => !beforeIds.has(d.id))
  const webhookDelivery = newOnes.find((d) => d.source === "webhook" && d.kind === "join")

  console.log("\nNovos registros:", newOnes.length)
  if (webhookDelivery) {
    console.log(JSON.stringify(webhookDelivery, null, 2))
  }

  if (webhookDelivery?.status === "sent") {
    console.log(`\n✅ X1 AUTOMÁTICO OK — webhook → DM enviado para ${participant.name}`)
    console.log(`   Confira o WhatsApp de ${participant.name}\n`)
    process.exit(0)
  }

  if (webhookDelivery?.status === "pending") {
    console.log("\n⏳ X1 enfileirado (pending) — aguardando scheduler…")
    await sleep(35000)
    const later = await api("GET", `/groups/${encodeURIComponent(group.id)}/x1/deliveries?limit=5`, { token })
    const row = (later.data?.deliveries || []).find((d) => d.id === webhookDelivery.id)
    if (row?.status === "sent") {
      console.log(`\n✅ X1 AUTOMÁTICO OK após fila — ${participant.name}\n`)
      process.exit(0)
    }
    console.log("Status final:", row?.status, row?.error)
  }

  if (webhookDelivery?.reason === "DUPLICATE" || webhookDelivery?.status === "skipped") {
    console.log("\n⚠ Bloqueado por duplicata/limite — tente outro participante ou aguarde 5 min.\n")
    process.exit(2)
  }

  console.log("\n❌ X1 automático não confirmou envio. Verifique logs do Railway.\n")
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

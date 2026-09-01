/**
 * Diagnóstico completo de falhas de automação CRM — produção via API.
 * Simula checks de runFlow e correlaciona com mensagens/conversas reais.
 *
 * Uso: node scripts/diagnose-flow-failures-prod.js [--hours=48] [--user=tarot]
 */
const BASE = (process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const ADMIN_PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"
const USER_SEARCH = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1] || "tarot"
const HOURS = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] || 48)
const CRM_FLOW_DISPATCH_RECENT_MS = 15 * 60 * 1000
const CRM_FLOW_MAX_RUNS_PER_DAY = Number(process.env.CRM_FLOW_MAX_RUNS_PER_DAY || 500)

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
    data = { raw: text.slice(0, 500) }
  }
  return { status: res.status, ok: res.ok, data }
}

function normalizeKeyword(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function keywordMatches(trigger, body) {
  const text = normalizeKeyword(body)
  if (!text || !trigger?.keywords?.length) return false
  for (const kw of trigger.keywords) {
    const n = normalizeKeyword(kw)
    if (!n) continue
    if (trigger.matchMode === "exact" ? text === n : text.includes(n)) return true
  }
  return false
}

function isWithinQuietHours(quietHours) {
  if (!quietHours?.enabled) return false
  const now = new Date()
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  const minutes = sp.getHours() * 60 + sp.getMinutes()
  const [sh, sm] = String(quietHours.start || "22:00").split(":").map(Number)
  const [eh, em] = String(quietHours.end || "08:00").split(":").map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start <= end) return minutes >= start && minutes < end
  return minutes >= start || minutes >= end
}

function computeShouldDispatch(source, fromMe, wasNewInbound, isNewConversation, upgradedFromImport, allowFlowDispatch, messageTimestamp) {
  if (fromMe) return { dispatch: false, reason: "fromMe" }
  if (source !== "webhook" && source !== "import") return { dispatch: false, reason: "source_invalid" }
  const now = Date.now()
  const isRecent =
    messageTimestamp instanceof Date &&
    !Number.isNaN(messageTimestamp.getTime()) &&
    now - messageTimestamp.getTime() < CRM_FLOW_DISPATCH_RECENT_MS
  if (source === "import") {
    return wasNewInbound && isRecent
      ? { dispatch: true, reason: "import_new_recent" }
      : { dispatch: false, reason: wasNewInbound ? "import_not_recent" : "import_duplicate" }
  }
  if (allowFlowDispatch === false) {
    return wasNewInbound && isRecent
      ? { dispatch: true, reason: "set_new_recent" }
      : { dispatch: false, reason: wasNewInbound ? "set_not_recent" : "set_duplicate" }
  }
  if (wasNewInbound || isNewConversation || (upgradedFromImport && isRecent)) {
    return { dispatch: true, reason: wasNewInbound ? "webhook_new_inbound" : isNewConversation ? "new_conversation" : "upgraded_import" }
  }
  return { dispatch: false, reason: "webhook_duplicate_old" }
}

function flowHasSendMessage(flow) {
  return (flow.actions || []).some((a) => a.type === "send_message")
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗")
  console.log("║  DIAGNÓSTICO COMPLETO — Automação CRM (produção)         ║")
  console.log("╚══════════════════════════════════════════════════════════╝\n")
  console.log(`API: ${BASE}`)
  console.log(`Janela: últimas ${HOURS}h | Conta: ${USER_SEARCH}`)
  console.log(`Limites simulados: recent=${CRM_FLOW_DISPATCH_RECENT_MS / 60000}min, maxRunsDay=${CRM_FLOW_MAX_RUNS_PER_DAY}\n`)

  const login = await req("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  if (!login.ok) {
    console.error("Falha login:", login.data)
    process.exit(1)
  }
  const adminToken = login.data.token

  const users = await req(`/admin/users?q=${encodeURIComponent(USER_SEARCH)}`, { token: adminToken })
  const target = (users.data.users || []).find((u) =>
    String(u.name || u.email || "").toLowerCase().includes(USER_SEARCH.toLowerCase()),
  )
  if (!target) {
    console.error("Conta não encontrada:", USER_SEARCH)
    process.exit(1)
  }
  console.log(`Conta: ${target.name} (${target.email}) id=${target.id}\n`)

  const imp = await req(`/admin/users/${target.id}/impersonate`, { method: "POST", token: adminToken })
  if (!imp.ok) {
    console.error("Impersonate falhou:", imp.data)
    process.exit(1)
  }
  const token = imp.data.token

  const wa = await req("/whatsapp/status", { token })
  console.log("── WhatsApp ──")
  console.log(`  Conectado: ${wa.data?.connected === true ? "SIM" : "NÃO"} (${wa.data?.status || "?"})`)
  if (!wa.data?.connected) console.log("  ⚠ CRÍTICO: entregas falham sem conexão\n")

  const flowsRes = await req("/crm/flows", { token })
  const flows = (flowsRes.data.flows || []).filter((f) => f.enabled)
  console.log("\n── Fluxos ativos ──")
  for (const f of flows) {
    const trig = f.trigger?.type || "?"
    const sends = flowHasSendMessage(f) ? "envia msg" : "SEM send_message"
    const cd = f.cooldownPerContactHours ?? 24
    console.log(`  • ${f.name} [${trig}] — ${sends}, cooldown=${cd}h`)
  }

  const welcomeFlow = flows.find((f) => f.trigger?.type === "new_conversation" && flowHasSendMessage(f))
  const keywordFlow = flows.find(
    (f) => f.trigger?.type === "keyword" && keywordMatches(f.trigger, "mi carta secreta"),
  )

  const flowRunsToday = {}
  const flowRunsByConv = {}
  for (const f of flows) {
    const runsRes = await req(`/crm/flows/${f.id}/runs`, { token })
    const runs = runsRes.data.runs || []
    const dayAgo = Date.now() - 24 * 3600 * 1000
    const todayOk = runs.filter((r) => r.status === "ok" && new Date(r.createdAt).getTime() >= dayAgo && !String(r.detail || "").startsWith("test:"))
    flowRunsToday[f.id] = todayOk.length
    for (const r of runs) {
      if (!flowRunsByConv[r.conversationId]) flowRunsByConv[r.conversationId] = []
      flowRunsByConv[r.conversationId].push({ ...r, flowName: f.name, flowId: f.id })
    }
    if (todayOk.length >= CRM_FLOW_MAX_RUNS_PER_DAY * 0.8) {
      console.log(`\n  ⚠ Fluxo "${f.name}": ${todayOk.length} runs OK nas últimas 24h (limite=${CRM_FLOW_MAX_RUNS_PER_DAY})`)
    }
  }

  console.log("\n── Runs nas últimas 24h (fluxos principais) ──")
  if (welcomeFlow) console.log(`  ${welcomeFlow.name}: ${flowRunsToday[welcomeFlow.id] || 0} runs`)
  if (keywordFlow) console.log(`  ${keywordFlow.name}: ${flowRunsToday[keywordFlow.id] || 0} runs`)

  const since = Date.now() - HOURS * 3600 * 1000
  const convRes = await req("/crm/conversations?limit=100", { token })
  const conversations = (convRes.data.conversations || []).filter((c) => {
    const t = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0
    return t >= since
  })

  console.log(`\n── Análise de ${conversations.length} conversas recentes ──\n`)

  const failures = []
  let analyzed = 0

  for (const conv of conversations) {
    const msgsRes = await req(`/crm/conversations/${conv.id}/messages?limit=40`, { token })
    const msgs = (msgsRes.data.messages || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    const inbounds = msgs.filter((m) => !m.fromMe && !["flow", "ai"].includes(m.source))
    if (!inbounds.length) continue

    const lastInbound = inbounds[inbounds.length - 1]
    if (new Date(lastInbound.timestamp).getTime() < since) continue

    analyzed += 1
    const outboundsAfter = msgs.filter(
      (m) => m.fromMe && new Date(m.timestamp) >= new Date(lastInbound.timestamp),
    )
    const flowOutAfter = outboundsAfter.filter((m) => m.source === "flow")
    const hasAutoReply = flowOutAfter.length > 0

    const priorInboundCount = inbounds.filter((m) => m.id !== lastInbound.id && new Date(m.timestamp) < new Date(lastInbound.timestamp)).length
    const isNewConversation = priorInboundCount === 0
    const runsOnConv = flowRunsByConv[conv.id] || []
    const runsAfterInbound = runsOnConv.filter((r) => new Date(r.createdAt) >= new Date(lastInbound.timestamp))

    const contactName = conv.contact?.pushName || conv.contact?.phone || conv.remoteJid
    const bodyPreview = String(lastInbound.body || "").slice(0, 60)

    if (hasAutoReply && runsAfterInbound.length > 0) continue

    const blockReasons = []
    const dispatchSim = computeShouldDispatch(
      lastInbound.source || "webhook",
      false,
      true,
      isNewConversation,
      lastInbound.source === "import",
      lastInbound.source !== "import",
      new Date(lastInbound.timestamp),
    )

    if (!dispatchSim.dispatch) {
      const ageMin = Math.round((Date.now() - new Date(lastInbound.timestamp).getTime()) / 60000)
      blockReasons.push({
        code: "NO_DISPATCH",
        detail: `${dispatchSim.reason} (msg ${ageMin}min atrás, source=${lastInbound.source})`,
        severity: "critical",
      })
    }

    if (conv.contact?.flowsStoppedAt) {
      blockReasons.push({ code: "FLOWS_STOPPED", detail: `flowsStoppedAt=${conv.contact.flowsStoppedAt}`, severity: "critical" })
    }

    if (welcomeFlow && isNewConversation) {
      if (isWithinQuietHours(welcomeFlow.quietHours)) {
        blockReasons.push({ code: "QUIET_HOURS", detail: welcomeFlow.name, severity: "high" })
      }
      const cdH = welcomeFlow.cooldownPerContactHours ?? 24
      const recentRunWelcome = runsOnConv.filter(
        (r) =>
          r.flowId === welcomeFlow.id &&
          r.status === "ok" &&
          new Date(r.createdAt).getTime() >= Date.now() - cdH * 3600 * 1000,
      )
      if (recentRunWelcome.length > 0) {
        blockReasons.push({
          code: "COOLDOWN_CONTACT",
          detail: `${welcomeFlow.name} já rodou há ${Math.round((Date.now() - new Date(recentRunWelcome[0].createdAt).getTime()) / 60000)}min`,
          severity: "medium",
        })
      }
      const globalRuns = flowRunsToday[welcomeFlow.id] || 0
      if (globalRuns >= CRM_FLOW_MAX_RUNS_PER_DAY) {
        blockReasons.push({
          code: "GLOBAL_DAILY_CAP",
          detail: `${welcomeFlow.name}: ${globalRuns}/${CRM_FLOW_MAX_RUNS_PER_DAY} runs/dia — BLOQUEIA TODOS os leads novos`,
          severity: "critical",
        })
      } else if (globalRuns >= 20 && CRM_FLOW_MAX_RUNS_PER_DAY > 20) {
        blockReasons.push({
          code: "GLOBAL_DAILY_CAP_LEGACY",
          detail: `Com limite antigo (20/dia) teria bloqueado — hoje ${globalRuns} runs (limite atual ${CRM_FLOW_MAX_RUNS_PER_DAY})`,
          severity: "info",
        })
      }
    }

    if (keywordFlow && keywordMatches(keywordFlow.trigger, lastInbound.body)) {
      if (!flowHasSendMessage(keywordFlow)) {
        blockReasons.push({
          code: "KEYWORD_NO_MESSAGE",
          detail: `Fluxo "${keywordFlow.name}" só faz move_stage — usuário não vê resposta automática`,
          severity: "design",
        })
      }
    }

    if (runsAfterInbound.length > 0 && !hasAutoReply) {
      blockReasons.push({
        code: "RUN_WITHOUT_DELIVERY",
        detail: runsAfterInbound.map((r) => `${r.flowName}:${r.status} (${r.detail})`).join("; "),
        severity: "critical",
      })
    }

    if (runsAfterInbound.length === 0 && blockReasons.filter((b) => b.severity === "critical").length === 0) {
      blockReasons.push({
        code: "SILENT_SKIP",
        detail: "Nenhum CrmFlowRun após inbound — runFlow retornou false antes de registrar (cooldown/quiet/conditions engolidos)",
        severity: "critical",
      })
    }

    const critical = blockReasons.filter((b) => b.severity === "critical" || b.severity === "high")
    if (critical.length || !hasAutoReply) {
      failures.push({
        contactName,
        conversationId: conv.id,
        body: bodyPreview,
        inboundAt: lastInbound.timestamp,
        source: lastInbound.source,
        isNewConversation,
        hasAutoReply,
        runsAfterInbound: runsAfterInbound.length,
        blockReasons,
      })
    }
  }

  console.log(`Conversas analisadas com inbound recente: ${analyzed}`)
  console.log(`Casos problemáticos: ${failures.length}\n`)

  const byCode = {}
  for (const f of failures) {
    for (const b of f.blockReasons) {
      byCode[b.code] = (byCode[b.code] || 0) + 1
    }
  }

  console.log("── Resumo de causas (contagem) ──")
  const sorted = Object.entries(byCode).sort((a, b) => b[1] - a[1])
  for (const [code, count] of sorted) {
    console.log(`  ${code}: ${count}x`)
  }

  console.log("\n── Casos detalhados (até 20) ──")
  for (const f of failures.slice(0, 20)) {
    console.log(`\n  ${f.contactName}`)
    console.log(`    msg: "${f.body}" @ ${f.inboundAt} (${f.source})`)
    console.log(`    nova conv: ${f.isNewConversation} | auto-reply: ${f.hasAutoReply} | runs: ${f.runsAfterInbound}`)
    for (const b of f.blockReasons) {
      console.log(`    → [${b.severity}] ${b.code}: ${b.detail}`)
    }
  }

  console.log("\n── Conclusões do pipeline ──")
  const conclusions = [
    "1. INICIANDO (keyword) só move estágio — boas-vindas vêm de AUDIO 1 (new_conversation).",
    "2. Teto global runs/dia (ex-20) bloqueava leads NOVOS mesmo sem run na conversa deles.",
    "3. MESSAGES_SET/sync: msg fora da janela 15min não dispara fluxo no webhook tardio.",
    "4. dispatchCrmMessageFlows NÃO é await no webhook — risco menor mas existe em crash/OOM.",
    "5. runFlow bloqueado (cooldown/quiet/STOP) não gera CrmFlowRun — falha silenciosa.",
    "6. Testes manuais (test:) agora ignorados no teto — retries não consomem cota.",
  ]
  for (const c of conclusions) console.log(`  ${c}`)

  console.log("\n══ FIM DO DIAGNÓSTICO ══\n")
  process.exit(failures.some((f) => f.blockReasons.some((b) => b.severity === "critical")) ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

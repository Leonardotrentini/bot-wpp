const DEFAULT_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 25000)
const GROUPS_TIMEOUT_MS = Number(process.env.EVOLUTION_GROUPS_TIMEOUT_MS || 180000)
/** Probe leve de status — evita 2× timeout de 25s quando a Evo está morta. */
const STATUS_PROBE_TIMEOUT_MS = Number(process.env.EVOLUTION_STATUS_TIMEOUT_MS || 8000)
const QRCode = require("qrcode")
const {
  resolveCreds,
  guessInstanceFromPath,
  bindInstanceHost,
  getDefaultHostForNewConnections,
  normalizeHostId,
} = require("./evolutionHosts")

function ensureConfig() {
  if (!process.env.EVOLUTION_BASE_URL || !process.env.EVOLUTION_API_KEY) {
    const err = new Error("Evolution API não configurada.")
    err.code = "EVOLUTION_CONFIG_MISSING"
    throw err
  }
}

function normalizeBaseUrl(raw) {
  return String(raw || "").replace(/\/+$/, "")
}

function parseEvolutionJson(text) {
  if (!text || !String(text).trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    const err = new Error(`Resposta não-JSON da Evolution (${String(text).slice(0, 120)}…)`)
    err.code = "EVOLUTION_BAD_RESPONSE"
    err.rawPreview = String(text).slice(0, 500)
    throw err
  }
}

/** Webhook na v2 é objeto `{ url, events? }`, não string. */
function normalizeWebhook(input) {
  if (input == null || input === "") return undefined
  if (typeof input === "object" && input.url) return input
  const url = typeof input === "string" ? input.trim() : ""
  if (!/^https?:\/\//i.test(url)) return undefined
  return {
    url,
    events: [
      "CONNECTION_UPDATE",
      "QRCODE_UPDATED",
      "GROUPS_UPSERT",
      "GROUP_UPDATE",
      "GROUP_PARTICIPANTS_UPDATE",
      "MESSAGES_UPSERT",
      "MESSAGES_SET",
      "MESSAGES_UPDATE",
      "LABELS_EDIT",
      "LABELS_ASSOCIATION",
    ],
  }
}

async function requestEvolution(
  path,
  { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, hostId, creds, instanceName } = {},
) {
  const guessed = instanceName || guessInstanceFromPath(path)
  const resolved = await resolveCreds({ creds, hostId, instanceName: guessed })
  // Primary sempre precisa existir; secondary só quando hostId/instance apontam para ela.
  if (resolved.hostId === "primary") ensureConfig()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${normalizeBaseUrl(resolved.baseUrl)}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: resolved.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    const data = parseEvolutionJson(text)
    if (!res.ok) {
      const msg =
        data?.message ||
        (Array.isArray(data?.response?.message) ? data.response.message.join("; ") : data?.response?.message) ||
        data?.error ||
        `Evolution HTTP ${res.status}`
      const err = new Error(msg)
      err.code = "EVOLUTION_HTTP_ERROR"
      err.status = res.status
      err.details = data
      throw err
    }
    return data
  } catch (err) {
    if (err?.name === "AbortError") {
      const e = new Error(`A Evolution não respondeu a tempo (timeout ${Math.round(timeoutMs / 1000)}s). A primeira busca após conectar costuma ser lenta; tente de novo em alguns segundos.`)
      e.code = "EVOLUTION_TIMEOUT"
      e.retryable = true
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function firstSuccess(calls) {
  let lastError = null
  for (const call of calls) {
    try {
      return await call()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/** QR já pronto para `<img src>` (data URL ou URL). */
function pickQrSync(data) {
  if (!data) return null
  const b =
    data.qrcode?.base64 ??
    (typeof data.qrcode === "string" ? data.qrcode : null) ??
    (typeof data.qr === "string" ? data.qr : null) ??
    (typeof data.base64 === "string" ? data.base64 : null)
  if (!b) return null
  if (b.startsWith("data:") || b.startsWith("http")) return b
  return `data:image/png;base64,${b}`
}

/**
 * Evolution v2 `/instance/connect` devolve sobretudo `code` (ref Baileys), não PNG.
 * Gera data URL quando necessário.
 */
async function resolveQrForStorage(data) {
  if (!data) return null
  const code = data.code
  if (typeof code === "string" && code.length > 10) {
    try {
      return await QRCode.toDataURL(code, {
        margin: 4,
        width: 360,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      })
    } catch (e) {
      console.error("[evolution] Falha ao gerar QR a partir de code:", e?.message || e)
      return null
    }
  }
  const direct = pickQrSync(data)
  if (direct) return direct
  return null
}

function pickConnected(data) {
  const state = (
    data?.instance?.state ||
    data?.state ||
    data?.status ||
    data?.instance?.status ||
    ""
  )
    .toString()
    .toLowerCase()
  return ["open", "connected", "online"].includes(state)
}

function pickStatus(data) {
  return (
    data?.instance?.state ||
    data?.state ||
    data?.status ||
    data?.instance?.status ||
    "unknown"
  ).toString()
}

function pickPhone(data) {
  return (
    data?.instance?.ownerJid ||
    data?.instance?.owner ||
    data?.instance?.number ||
    data?.ownerJid ||
    data?.owner ||
    data?.number ||
    data?.phone ||
    null
  )
}

/** Dados completos da instância (traz ownerJid, que o connectionState não devolve). */
async function fetchInstanceInfo(instanceName) {
  const payload = await requestEvolution(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    { method: "GET" },
  )
  const list = Array.isArray(payload) ? payload : payload?.instances || [payload]
  for (const item of list) {
    const node = item?.instance || item
    const name = node?.name || node?.instanceName
    if (name === instanceName) return node
  }
  return null
}

/** Dígitos com DDI; BR sem 55 ganha prefixo 55. */
function normalizeWhatsappNumber(input) {
  let digits = String(input || "").replace(/\D/g, "")
  if (!digits) return ""
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    digits = `55${digits}`
  }
  return digits
}

async function createInstance(instanceName, webhookInput, { hostId, number } = {}) {
  const resolvedHost = normalizeHostId(hostId || getDefaultHostForNewConnections())
  bindInstanceHost(instanceName, resolvedHost)
  const webhook = normalizeWebhook(webhookInput)
  const phone = normalizeWhatsappNumber(number)
  const body = {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    ...(phone ? { number: phone } : {}),
    ...(webhook ? { webhook } : {}),
  }
  return requestEvolution("/instance/create", {
    method: "POST",
    body,
    hostId: resolvedHost,
    instanceName,
  })
}

async function setInstanceWebhook(instanceName, webhookInput) {
  const webhook = normalizeWebhook(webhookInput)
  if (!webhook) return null

  const body = {
    webhook: {
      enabled: true,
      url: webhook.url,
      byEvents: false,
      base64: false,
      events: webhook.events,
    },
  }

  return firstSuccess([
    () => requestEvolution(`/webhook/set/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
    () => requestEvolution(`/webhook/set/${encodeURIComponent(instanceName)}`, { method: "POST", body: body.webhook }),
  ])
}

/** URL padrão do webhook CRM (mesmo contrato do server.js). */
function buildDefaultWebhookUrl() {
  const explicit = process.env.EVOLUTION_WEBHOOK_URL?.trim()
  if (explicit) return explicit
  const publicUrl = process.env.BACKEND_PUBLIC_URL?.trim()?.replace(/\/+$/, "")
  if (!publicUrl) return null
  const base = `${publicUrl}/api/evolution/webhook`
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim()
  return secret ? `${base}?secret=${encodeURIComponent(secret)}` : base
}

/** Regrava webhook na Evolution após soft-restart (evita sessão viva sem delivery). */
async function reassertInstanceWebhook(instanceName) {
  const url = buildDefaultWebhookUrl()
  if (!url) return { skipped: true, reason: "no_webhook_url" }
  try {
    await setInstanceWebhook(instanceName, url)
    return { ok: true, url: url.split("?")[0] }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

function isInstanceAlreadyExistsError(err) {
  const message = (err?.details?.message || err?.message || "").toString().toLowerCase()
  return message.includes("already") || message.includes("exist") || message.includes("in use")
}

async function connectInstance(instanceName, { number } = {}) {
  const phone = normalizeWhatsappNumber(number)
  const query = phone ? `?number=${encodeURIComponent(phone)}` : ""
  return firstSuccess([
    () =>
      requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}${query}`, {
        method: "GET",
      }),
    () => requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}${query}`),
    ...(phone
      ? []
      : [
          () => requestEvolution(`/instance/qr/${encodeURIComponent(instanceName)}`, { method: "GET" }),
          () => requestEvolution(`/instance/qrcode/${encodeURIComponent(instanceName)}`, { method: "GET" }),
        ]),
  ])
}

function pickPairingCode(data) {
  const raw = data?.pairingCode ?? data?.pairing_code ?? data?.qrcode?.pairingCode ?? null
  if (raw == null) return null
  const code = String(raw).trim().toUpperCase()
  return code.length >= 6 ? code : null
}

/**
 * Gera pairing code (Conectar com número). Se a sessão estiver em connecting
 * sem código, reinicia só esta instância para sair do estado preso.
 */
async function recoverPairingCode(instanceName, number) {
  const phone = normalizeWhatsappNumber(number)
  if (phone.length < 12) {
    const err = new Error("Informe o WhatsApp com DDI e DDD (ex.: 5511985712645).")
    err.code = "INVALID_PHONE"
    throw err
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let stateData = await getConnectionStateForProbe(instanceName).catch(() => null)
  let state = pickStatus(stateData).toLowerCase()

  if (state === "open") {
    return { qrData: stateData, pairingCode: null, qrReady: false, alreadyOpen: true }
  }

  // Evolution não gera pairingCode enquanto state === connecting (devolve QR antigo).
  if (state === "connecting") {
    try {
      await restartInstance(instanceName)
      await sleep(2000)
    } catch (err) {
      console.warn("[evolution] restart antes do pairing:", err?.message || err)
    }
    stateData = await getConnectionStateForProbe(instanceName).catch(() => null)
    state = pickStatus(stateData).toLowerCase()
    if (state === "connecting" || state === "open") {
      try {
        await logoutInstance(instanceName)
        await sleep(1500)
      } catch (err) {
        console.warn("[evolution] logout antes do pairing:", err?.message || err)
      }
    }
  }

  let qrData = await connectInstance(instanceName, { number: phone })
  let pairingCode = pickPairingCode(qrData)
  if (!pairingCode) {
    try {
      await restartInstance(instanceName)
      await sleep(2000)
    } catch (err) {
      console.warn("[evolution] restart retry pairing:", err?.message || err)
    }
    qrData = await connectInstance(instanceName, { number: phone })
    pairingCode = pickPairingCode(qrData)
  }

  const qrReady = Boolean(await resolveQrForStorage(qrData))
  return { qrData, pairingCode, qrReady, alreadyOpen: false, phone }
}

async function getConnectionState(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`, { method: "GET" }),
    () => requestEvolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
      method: "GET",
    }),
  ])
}

/** Só connectionState, timeout curto — para status/reconcile (não busca ownerJid). */
async function getConnectionStateForProbe(instanceName, { timeoutMs = STATUS_PROBE_TIMEOUT_MS } = {}) {
  return requestEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    method: "GET",
    timeoutMs,
    instanceName,
  })
}

function isEvolutionUnreachableError(err) {
  const code = String(err?.code || "")
  const status = Number(err?.status || 0)
  const msg = String(err?.message || "").toLowerCase()
  const name = String(err?.name || "")
  if (code === "EVOLUTION_TIMEOUT") return true
  if (name === "AbortError") return true
  if (status === 502 || status === 503 || status === 504) return true
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  ) {
    return true
  }
  return false
}

/** Connect; se vier sem QR, restart e tenta de novo (sessão presa em connecting). */
async function recoverQrIfStuck(instanceName) {
  let qrData = await connectInstance(instanceName)
  let qrReady = await resolveQrForStorage(qrData)
  if (qrReady) return { qrData, qrReady: true }
  try {
    await restartInstance(instanceName)
    await new Promise((r) => setTimeout(r, 1500))
    qrData = await connectInstance(instanceName)
    qrReady = await resolveQrForStorage(qrData)
  } catch (err) {
    console.warn("[evolution] recoverQrIfStuck:", err?.message || err)
  }
  return { qrData, qrReady: Boolean(qrReady) }
}

async function fetchAllGroups(instanceName, { getParticipants = false } = {}) {
  return requestEvolution(
    `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=${getParticipants ? "true" : "false"}`,
    { method: "GET", timeoutMs: GROUPS_TIMEOUT_MS },
  )
}

async function fetchGroupParticipants(instanceName, groupJid) {
  return requestEvolution(
    `/group/participants/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    { method: "GET" },
  )
}

/**
 * Verifica se número(s) existem no WhatsApp (Evolution: /chat/whatsappNumbers).
 * Retorno normalizado: [{ number, exists, jid }].
 */
async function checkWhatsappNumbers(instanceName, numbers) {
  const list = (Array.isArray(numbers) ? numbers : [numbers])
    .map((n) => String(n || "").replace(/\D/g, ""))
    .filter(Boolean)
  if (!list.length) return []

  const data = await firstSuccess([
    () =>
      requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { numbers: list },
        instanceName,
        timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, 15000),
      }),
    () =>
      requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { number: list[0], numbers: list },
        instanceName,
        timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, 15000),
      }),
  ])

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.numbers)
      ? data.numbers
      : Array.isArray(data?.response)
        ? data.response
        : data && typeof data === "object"
          ? [data]
          : []

  return rows.map((row) => {
    const number =
      String(row?.number || row?.phone || "").replace(/\D/g, "") ||
      String(row?.jid || "")
        .split("@")[0]
        .replace(/\D/g, "")
    let exists = false
    if (typeof row?.exists === "boolean") {
      exists = row.exists
    } else if (row?.jid) {
      exists = true
    }
    return {
      number,
      exists,
      jid: row?.jid || (number ? `${number}@s.whatsapp.net` : null),
      raw: row,
    }
  })
}

/** true se o número tem conta WhatsApp; false se não; null se não deu para verificar. */
async function numberExistsOnWhatsapp(instanceName, phoneDigits) {
  const digits = String(phoneDigits || "").replace(/\D/g, "")
  if (!digits) return { ok: false, exists: false, reason: "empty" }
  try {
    const rows = await checkWhatsappNumbers(instanceName, [digits])
    const hit =
      rows.find((r) => r.number === digits) ||
      rows.find((r) => r.number && (digits.endsWith(r.number) || r.number.endsWith(digits))) ||
      rows[0]
    if (!hit) return { ok: true, exists: false, reason: "not_found" }
    if (hit.exists === false) return { ok: true, exists: false, reason: "not_on_whatsapp", jid: hit.jid || null }
    return { ok: true, exists: true, jid: hit.jid || `${digits}@s.whatsapp.net` }
  } catch (err) {
    return { ok: false, exists: null, reason: "check_failed", error: err?.message || String(err) }
  }
}

/** Perfil do contato (nome exibido no WhatsApp). Aceita dígitos ou JID completo (@lid / @s.whatsapp.net). */
async function fetchProfile(instanceName, number) {
  const raw = String(number || "").trim()
  const digits = raw.replace(/\D/g, "")
  const bodyVariants = []
  if (raw.includes("@")) bodyVariants.push({ number: raw })
  if (digits) {
    bodyVariants.push({ number: digits })
    bodyVariants.push({ number: `${digits}@s.whatsapp.net` })
  }
  const attempts = bodyVariants.map(
    (body) => () => requestEvolution(`/chat/fetchProfile/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
  )
  return firstSuccess(attempts)
}

/** Foto de perfil — funciona mesmo sem o contato salvo na agenda. */
async function fetchProfilePictureUrl(instanceName, numberOrJid) {
  const raw = String(numberOrJid || "").trim()
  const digits = raw.replace(/\D/g, "")
  const bodyVariants = []
  if (raw.includes("@")) bodyVariants.push({ number: raw })
  if (digits) {
    bodyVariants.push({ number: digits })
    bodyVariants.push({ number: `${digits}@s.whatsapp.net` })
  }
  const attempts = []
  for (const body of bodyVariants) {
    attempts.push(() =>
      requestEvolution(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
    )
  }
  return firstSuccess(attempts)
}

/** Salva contato na agenda do WhatsApp conectado. */
async function saveContact(instanceName, { number, name, saveOnDevice = true }) {
  const digits = String(number || "").replace(/\D/g, "")
  const body = { number: digits, name: String(name || "").trim(), saveOnDevice: Boolean(saveOnDevice) }
  return firstSuccess([
    () => requestEvolution(`/contact/save/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
    () => requestEvolution(`/chat/saveContact/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
  ])
}

/** Lista contatos da instância (pushName / número quando disponível). */
async function findContacts(instanceName, where = {}) {
  return firstSuccess([
    () =>
      requestEvolution(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { where },
      }),
    () =>
      requestEvolution(`/contact/findContacts/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { where },
      }),
  ])
}

/**
 * Busca mensagens de um grupo (Evolution v2 `POST /chat/findMessages/{instance}`).
 * Ordena por timestamp desc; paginado para limitar o volume por chamada.
 */
const { normalizeEvolutionMessages, filterMessagesForGroup, jidsMatch, normalizeJid } = require("./evolutionMessages")

function findMessagesEndpoints(instanceName, body) {
  return [
    () => requestEvolution(`/chat/findMessages/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
    () => requestEvolution(`/message/findMessages/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
  ]
}

async function requestFindMessages(instanceName, body) {
  return firstSuccess(findMessagesEndpoints(instanceName, body))
}

/** Formato real da Evolution v2: `page` + `offset` (tamanho da página), não limit/take. */
function buildEvolutionFindMessagesBody(groupJid, { page = 1, pageSize = 50, cutoffMs } = {}) {
  const nowSec = Math.floor(Date.now() / 1000)
  const where = { key: { remoteJid: groupJid } }
  if (cutoffMs && Number.isFinite(cutoffMs)) {
    where.messageTimestamp = {
      gte: Math.floor(Number(cutoffMs) / 1000),
      lte: nowSec,
    }
  }
  return { where, page, offset: pageSize }
}

async function fetchGroupMessages(instanceName, groupJid, { page = 1, pageSize = 50, cutoffMs, alternateJids = [] } = {}) {
  const targets = [groupJid, ...(alternateJids || [])]
    .map((j) => String(j || "").trim())
    .filter(Boolean)
  const uniqueTargets = [...new Set(targets)]

  const bodies = []
  for (const jid of uniqueTargets) {
    bodies.push(buildEvolutionFindMessagesBody(jid, { page, pageSize, cutoffMs }))
    bodies.push(buildEvolutionFindMessagesBody(jid, { page, pageSize, cutoffMs: null }))
    bodies.push({
      where: { key: { remoteJidAlt: jid } },
      page,
      offset: pageSize,
    })
  }

  let lastPayload = null
  for (const body of bodies) {
    try {
      const payload = await requestFindMessages(instanceName, body)
      lastPayload = payload
      const records = filterMessagesForGroup(normalizeEvolutionMessages(payload), groupJid, uniqueTargets)
      if (records.length) return { payload, records, source: "filtered" }
      // Query por alt/LID: se a Evolution já filtrou no where, aceita batch bruto.
      const rawRecords = normalizeEvolutionMessages(payload)
      if (rawRecords.length) {
        const matched = filterMessagesForGroup(rawRecords, groupJid, uniqueTargets)
        if (matched.length) return { payload, records: matched, source: "filtered" }
        // Último recurso: where já apontava para este chat — não descartar por domínio lid≠pn.
        const queriedJid =
          body?.where?.key?.remoteJid || body?.where?.key?.remoteJidAlt || null
        if (queriedJid && uniqueTargets.some((t) => jidsMatch(t, queriedJid) || normalizeJid(t) === normalizeJid(queriedJid))) {
          return { payload, records: rawRecords, source: "unfiltered-query-match" }
        }
      }
    } catch {
      /* tenta próximo formato */
    }
  }

  if (lastPayload) {
    const records = filterMessagesForGroup(normalizeEvolutionMessages(lastPayload), groupJid, uniqueTargets)
    if (records.length) return { payload: lastPayload, records, source: "filtered-partial" }
  }

  return { payload: lastPayload || {}, records: [], source: "none" }
}

/** Lista chats da instância (Evolution v2 `POST /chat/findChats/{instance}`). */
async function findChats(instanceName, { limit, offset = 0 } = {}) {
  const take = limit || undefined
  const skip = Number(offset) > 0 ? Number(offset) : 0
  const page = take ? Math.floor(skip / take) + 1 : 1
  const bodies = []
  if (take) {
    bodies.push({ where: {}, take, skip })
    bodies.push({ where: {}, take, offset: skip })
    bodies.push({ where: {}, take, page })
    bodies.push({ where: {}, take })
  } else {
    bodies.push({ where: {} })
  }
  const attempts = bodies.map(
    (body) => () =>
      requestEvolution(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body,
        timeoutMs: GROUPS_TIMEOUT_MS,
      }),
  )
  attempts.push(() =>
    requestEvolution(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {},
      timeoutMs: GROUPS_TIMEOUT_MS,
    }),
  )
  return firstSuccess(attempts)
}

/**
 * Varre findChats em páginas até esgotar ou atingir maxTotal.
 * Evolution nem sempre pagina — se uma página repetir/zerar, para.
 */
async function findChatsPaginated(instanceName, { pageSize = 500, maxTotal = 10000 } = {}) {
  const all = []
  const seen = new Set()
  let offset = 0
  let pages = 0
  const maxPages = Math.ceil(maxTotal / pageSize) + 2
  while (pages < maxPages && all.length < maxTotal) {
    pages += 1
    let payload
    try {
      payload = await findChats(instanceName, { limit: pageSize, offset })
    } catch (err) {
      if (pages === 1) throw err
      break
    }
    const list = Array.isArray(payload)
      ? payload
      : payload?.records || payload?.chats || payload?.data || payload?.response || []
    if (!Array.isArray(list) || !list.length) break
    let added = 0
    for (const row of list) {
      const jid = String(row?.remoteJid || row?.id || row?.jid || row?.key?.remoteJid || "").trim()
      if (!jid || seen.has(jid)) continue
      seen.add(jid)
      all.push(row)
      added += 1
      if (all.length >= maxTotal) break
    }
    if (added === 0) break
    if (list.length < pageSize) break
    offset += pageSize
  }
  return all
}

/** Histórico paginado de um chat 1:1 (mesmo findMessages usado para grupos). */
async function fetchChatMessages(instanceName, remoteJid, { page = 1, pageSize = 50, cutoffMs, alternateJids = [] } = {}) {
  return fetchGroupMessages(instanceName, remoteJid, { page, pageSize, cutoffMs, alternateJids })
}

/** Localiza mensagem enviada pelo ID (independente do JID — mais confiável para ACK). */
async function findMessageById(instanceName, messageId, { pageSize = 10, jids = [] } = {}) {
  const id = String(messageId || "").trim()
  if (!id) return null
  const bodies = [
    { where: { key: { id } }, page: 1, offset: pageSize },
    { where: { key: { id, fromMe: true } }, page: 1, offset: pageSize },
    { where: { id }, page: 1, offset: pageSize },
    { where: { messageId: id }, page: 1, offset: pageSize },
  ]
  for (const jid of jids) {
    if (!jid) continue
    bodies.push({ where: { key: { id, remoteJid: jid } }, page: 1, offset: pageSize })
    bodies.push({ where: { key: { id, remoteJid: jid, fromMe: true } }, page: 1, offset: pageSize })
  }
  for (const body of bodies) {
    try {
      const payload = await requestFindMessages(instanceName, body)
      const records = normalizeEvolutionMessages(payload)
      const hit = (records || []).find((r) => r?.key?.id === id)
      if (hit) return hit
    } catch {
      /* tenta próximo formato */
    }
  }
  return null
}

/** presence: "composing" | "recording" — delay em ms (máx ~20s por chamada no WhatsApp). */
async function sendPresence(instanceName, number, { presence = "recording", delayMs = 3000 } = {}) {
  const delay = Math.max(500, Math.min(Number(delayMs) || 3000, 20000))
  const instance = encodeURIComponent(instanceName)
  const flatBody = { number, delay, presence }
  const nestedBody = { number, options: { delay, presence, number } }
  return firstSuccess([
    () =>
      requestEvolution(`/chat/sendPresence/${instance}`, {
        method: "POST",
        body: flatBody,
      }),
    () =>
      requestEvolution(`/chat/sendPresence/${instance}`, {
        method: "POST",
        body: nestedBody,
      }),
    () =>
      requestEvolution(`/message/sendPresence/${instance}`, {
        method: "POST",
        body: flatBody,
      }),
    () =>
      requestEvolution(`/message/sendPresence/${instance}`, {
        method: "POST",
        body: nestedBody,
      }),
  ])
}

function mentionedForEvolution(mentioned) {
  if (!Array.isArray(mentioned) || !mentioned.length) return null
  // Teto duro: a Evolution coloca cada item em mentionedJid. Lista grande vira "@" solto.
  return mentioned.slice(0, 2)
}

async function sendText(instanceName, number, text, options = {}) {
  const { linkPreview, mentionsEveryOne: _mentionsEveryOne, mentioned, mentionAll: _mentionAll, quoted, ...rest } = options
  const body = {
    number,
    text,
    ...rest,
  }
  const safeMentioned = mentionedForEvolution(mentioned)
  if (safeMentioned) body.mentioned = safeMentioned
  if (linkPreview === true) body.linkPreview = true
  if (quoted) body.quoted = quoted
  return requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body,
  })
}

/** Apaga mensagem para todos (Evolution / Baileys). */
async function deleteMessageForEveryone(instanceName, { id, remoteJid, fromMe = true, participant } = {}) {
  const body = { id, remoteJid, fromMe: Boolean(fromMe) }
  if (participant) body.participant = participant
  return requestEvolution(`/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`, {
    method: "DELETE",
    body,
  })
}

/** Edita texto de mensagem própria. */
async function updateMessageText(instanceName, { number, text, key } = {}) {
  return requestEvolution(`/chat/updateMessage/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: { number, text, key },
  })
}

/** Marca mensagens como lidas no WhatsApp (ticks do contato). */
async function markMessagesAsRead(instanceName, readMessages = []) {
  if (!Array.isArray(readMessages) || !readMessages.length) return null
  return firstSuccess([
    () =>
      requestEvolution(`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { readMessages },
      }),
    () =>
      requestEvolution(`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
        method: "PUT",
        body: { readMessages },
      }),
  ])
}

/** mediatype: "image" | "video" | "audio" | "document". media: base64 (sem prefixo data:) ou URL. */
async function sendMedia(instanceName, number, { mediatype, media, mimetype, caption, fileName, linkPreview, mentionsEveryOne: _mentionsEveryOne, mentioned, mentionAll: _mentionAll, ...rest }) {
  const { stripDataUrl } = require("./whatsappAudio")
  let mediaPayload = stripDataUrl(media)
  let mime = mimetype
  let name = fileName
  if (mediatype === "video") {
    const { prepareWhatsAppVideo, WHATSAPP_VIDEO_MIME } = require("./whatsappAudio")
    const prepared = await prepareWhatsAppVideo({ media, mimetype, fileName })
    mediaPayload = prepared.base64
    mime = prepared.mimetype || WHATSAPP_VIDEO_MIME
    name = prepared.fileName
  } else if (mediatype === "image") {
    const { prepareWhatsAppImage, WHATSAPP_IMAGE_MIME } = require("./whatsappAudio")
    const prepared = prepareWhatsAppImage({ media, mimetype, fileName })
    mediaPayload = prepared.base64
    mime = prepared.mimetype || WHATSAPP_IMAGE_MIME
    name = prepared.fileName
  }
  const body = { number, mediatype, media: mediaPayload, ...rest }
  if (mime) body.mimetype = mime
  if (caption) body.caption = caption
  if (name) body.fileName = name
  else if (mediatype === "video") body.fileName = "video.mp4"
  const safeMentioned = mentionedForEvolution(mentioned)
  if (safeMentioned) body.mentioned = safeMentioned
  if (linkPreview === true) body.linkPreview = true
  const timeoutMs = Number(process.env.EVOLUTION_SEND_MEDIA_TIMEOUT_MS || 180000)
  const opts = { method: "POST", body, timeoutMs }
  return firstSuccess([
    () => requestEvolution(`/message/sendMedia/${encodeURIComponent(instanceName)}`, opts),
    () => requestEvolution(`/message/sendMedia/${encodeURIComponent(instanceName)}`, { ...opts, body: { ...body, options: {} } }),
  ])
}

/**
 * Nota de voz (PTT). Converte webm/mp3/mp4 → ogg/opus no backend antes de enviar —
 * a Evolution costuma devolver 200 com webm cru, e o WhatsApp do destinatário não toca.
 */
async function sendWhatsAppAudio(instanceName, number, { audio, encoding = true, mimetype } = {}) {
  const { prepareWhatsAppPttAudio, assertWhatsAppAudioAccepted, WHATSAPP_PTT_MIME } = require("./whatsappAudio")
  const prepared = await prepareWhatsAppPttAudio({ audio, mimetype })
  const timeoutMs = Number(process.env.EVOLUTION_SEND_MEDIA_TIMEOUT_MS || 180000)
  const instance = encodeURIComponent(instanceName)
  const rawMedia = prepared.base64
  const opts = { method: "POST", timeoutMs }

  // encoding:true no ogg já convertido faz a Evolution marcar PTT.
  // encoding:false deixava ptt vazio e o WhatsApp não mostrava a nota de voz.
  // Evolution faz Buffer.from(audio, 'base64') — data URL no campo corrompe o ogg
  // e o WhatsApp não toca. Sempre base64 cru. encoding:true marca PTT no Baileys.
  const resp = await firstSuccess([
    () =>
      requestEvolution(`/message/sendWhatsAppAudio/${instance}`, {
        ...opts,
        body: {
          number,
          audio: rawMedia,
          encoding: true,
          delay: 1200,
        },
      }),
    () =>
      requestEvolution(`/message/sendWhatsAppAudio/${instance}`, {
        ...opts,
        body: {
          number,
          audio: rawMedia,
          encoding: false,
        },
      }),
    () =>
      requestEvolution(`/message/sendMedia/${instance}`, {
        ...opts,
        body: {
          number,
          mediatype: "audio",
          media: rawMedia,
          mimetype: "audio/ogg",
          fileName: "audio.ogg",
        },
      }),
  ])

  assertWhatsAppAudioAccepted(resp)
  if (resp && typeof resp === "object") {
    resp._vestoAudio = {
      mimetype: prepared.mimetype,
      converted: prepared.converted,
      originalMimetype: prepared.originalMimetype,
    }
  }
  return resp
}

async function getBase64FromMediaMessage(instanceName, rawRecord, { convertToMp4 = false } = {}) {
  if (!rawRecord || typeof rawRecord !== "object") {
    throw new Error("Mensagem sem payload de mídia.")
  }
  const { prepareMediaMessageRecord } = require("./crmMedia")
  const instance = encodeURIComponent(instanceName)
  const slim = prepareMediaMessageRecord(rawRecord)
  const body = {
    message: slim,
    convertToMp4: Boolean(convertToMp4),
  }
  // Timeout curto no download (chat). Envios usam EVOLUTION_SEND_MEDIA_TIMEOUT_MS.
  const timeoutMs = Number(process.env.EVOLUTION_MEDIA_DOWNLOAD_TIMEOUT_MS || 45000)
  const opts = { method: "POST", body, timeoutMs }
  return firstSuccess([
    () => requestEvolution(`/chat/getBase64FromMediaMessage/${instance}`, opts),
    () => requestEvolution(`/message/getBase64FromMediaMessage/${instance}`, opts),
    () =>
      requestEvolution(`/chat/getBase64FromMediaMessage/${instance}`, {
        ...opts,
        body: { message: { key: slim.key, message: slim.message }, convertToMp4: Boolean(convertToMp4) },
      }),
  ])
}

function extractMediaBase64Payload(resp) {
  const { extractMediaBase64Payload: extract } = require("./crmMedia")
  return extract(resp)
}

async function logoutInstance(instanceName) {
  try {
    return await requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
    })
  } catch (err) {
    // Já fechada / inexistente: desconectar no CRM ainda deve concluir.
    if (isBenignLogoutError(err)) {
      return { skipped: true, reason: err.message, status: err.status || null }
    }
    throw err
  }
}

/** Reinicia sessão Baileys (útil quando fica em connecting sem QR). */
async function restartInstance(instanceName) {
  return firstSuccess([
    () =>
      requestEvolution(`/instance/restart/${encodeURIComponent(instanceName)}`, {
        method: "POST",
      }),
    () =>
      requestEvolution(`/instance/restart/${encodeURIComponent(instanceName)}`, {
        method: "PUT",
      }),
  ])
}

function isBenignLogoutError(err) {
  const status = Number(err?.status || 0)
  const msg = String(err?.message || "").toLowerCase()
  const details = JSON.stringify(err?.details || "").toLowerCase()
  if (status === 404) return true
  if (status === 400 && (msg.includes("not connected") || details.includes("not connected"))) return true
  if (msg.includes("not connected") || details.includes("not connected")) return true
  if (msg.includes("does not exist") || details.includes("does not exist")) return true
  if (msg.includes("instance not found") || details.includes("instance not found")) return true
  return false
}

async function deleteInstance(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "DELETE" }),
    () => requestEvolution(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "GET" }),
  ])
}

/** Lista etiquetas WhatsApp Business da instância. */
async function findLabels(instanceName) {
  const data = await requestEvolution(`/label/findLabels/${encodeURIComponent(instanceName)}`, {
    method: "GET",
    instanceName,
  })
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.labels)) return data.labels
  if (Array.isArray(data?.data)) return data.data
  return []
}

/** Força re-sync das labels (Evolution recente). Fallback: findLabels. */
async function syncLabels(instanceName) {
  try {
    const data = await requestEvolution(`/label/syncLabels/${encodeURIComponent(instanceName)}`, {
      method: "GET",
      instanceName,
      timeoutMs: 20000,
    })
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.labels)) return data.labels
    if (Array.isArray(data?.data)) return data.data
  } catch (err) {
    console.warn("[evolution] syncLabels fallback findLabels:", err?.message || err)
  }
  return findLabels(instanceName)
}

/**
 * Adiciona/remove etiqueta num chat.
 * Evo2 exige `number` + `labelId`; builds antigas usavam `name`/`id`/`type`.
 * Enviamos os dois formatos para cobrir primary e secondary.
 */
async function handleLabel(instanceName, { labelId, chatJid, action = "add" }) {
  const jid = String(chatJid || "").trim()
  const label = String(labelId || "").trim()
  const act = action === "remove" ? "remove" : "add"
  if (!jid || !label) {
    throw new Error("handleLabel requer chatJid e labelId")
  }
  const body = {
    number: jid,
    labelId: label,
    action: act,
    // legado (Evo1 / docs antigas)
    name: label,
    type: "chat",
    id: jid,
  }
  return requestEvolution(`/label/handleLabel/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body,
    instanceName,
  })
}

module.exports = {
  createInstance,
  setInstanceWebhook,
  buildDefaultWebhookUrl,
  reassertInstanceWebhook,
  connectInstance,
  getConnectionState,
  getConnectionStateForProbe,
  isEvolutionUnreachableError,
  recoverQrIfStuck,
  recoverPairingCode,
  normalizeWhatsappNumber,
  pickPairingCode,
  fetchAllGroups,
  fetchGroupParticipants,
  findContacts,
  fetchProfile,
  fetchProfilePictureUrl,
  checkWhatsappNumbers,
  numberExistsOnWhatsapp,
  saveContact,
  fetchGroupMessages,
  findChats,
  findChatsPaginated,
  fetchChatMessages,
  findMessageById,
  sendText,
  sendPresence,
  sendMedia,
  sendWhatsAppAudio,
  deleteMessageForEveryone,
  updateMessageText,
  markMessagesAsRead,
  getBase64FromMediaMessage,
  extractMediaBase64Payload,
  logoutInstance,
  restartInstance,
  deleteInstance,
  findLabels,
  syncLabels,
  handleLabel,
  isBenignLogoutError,
  pickQrSync,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  fetchInstanceInfo,
  isInstanceAlreadyExistsError,
  bindInstanceHost,
  getDefaultHostForNewConnections,
  normalizeHostId,
}

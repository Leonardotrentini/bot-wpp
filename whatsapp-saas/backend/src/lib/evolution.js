const DEFAULT_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 25000)
const GROUPS_TIMEOUT_MS = Number(process.env.EVOLUTION_GROUPS_TIMEOUT_MS || 120000)
const QRCode = require("qrcode")

function ensureConfig() {
  if (!process.env.EVOLUTION_BASE_URL || !process.env.EVOLUTION_API_KEY) {
    const err = new Error("Evolution API não configurada.")
    err.code = "EVOLUTION_CONFIG_MISSING"
    throw err
  }
}

function normalizeBaseUrl(raw) {
  return raw.replace(/\/+$/, "")
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
    ],
  }
}

async function requestEvolution(path, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  ensureConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${normalizeBaseUrl(process.env.EVOLUTION_BASE_URL)}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.EVOLUTION_API_KEY,
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
    data?.instance?.owner ||
    data?.instance?.number ||
    data?.owner ||
    data?.number ||
    data?.phone ||
    null
  )
}

async function createInstance(instanceName, webhookInput) {
  const webhook = normalizeWebhook(webhookInput)
  const body = {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    ...(webhook ? { webhook } : {}),
  }
  return requestEvolution("/instance/create", { method: "POST", body })
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

function isInstanceAlreadyExistsError(err) {
  const message = (err?.details?.message || err?.message || "").toString().toLowerCase()
  return message.includes("already") || message.includes("exist") || message.includes("in use")
}

async function connectInstance(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`, { method: "GET" }),
    () => requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`),
    () => requestEvolution(`/instance/qr/${encodeURIComponent(instanceName)}`, { method: "GET" }),
    () => requestEvolution(`/instance/qrcode/${encodeURIComponent(instanceName)}`, { method: "GET" }),
  ])
}

async function getConnectionState(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`, { method: "GET" }),
    () => requestEvolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
      method: "GET",
    }),
  ])
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
 * Busca mensagens de um grupo (Evolution v2 `POST /chat/findMessages/{instance}`).
 * Ordena por timestamp desc; paginado para limitar o volume por chamada.
 */
async function fetchGroupMessages(instanceName, groupJid, { page = 1, pageSize = 50 } = {}) {
  const body = {
    where: { key: { remoteJid: groupJid } },
    page,
    offset: pageSize,
  }
  return firstSuccess([
    () => requestEvolution(`/chat/findMessages/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
    () => requestEvolution(`/message/findMessages/${encodeURIComponent(instanceName)}`, { method: "POST", body }),
  ])
}

async function logoutInstance(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" }),
    () => requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "GET" }),
  ])
}

module.exports = {
  createInstance,
  setInstanceWebhook,
  connectInstance,
  getConnectionState,
  fetchAllGroups,
  fetchGroupParticipants,
  fetchGroupMessages,
  logoutInstance,
  pickQrSync,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
}

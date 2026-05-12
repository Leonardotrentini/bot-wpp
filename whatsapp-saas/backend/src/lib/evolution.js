const DEFAULT_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 15000)

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

async function requestEvolution(path, { method = "GET", body } = {}) {
  ensureConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

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
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) {
      const err = new Error(data?.message || `Evolution HTTP ${res.status}`)
      err.code = "EVOLUTION_HTTP_ERROR"
      err.status = res.status
      err.details = data
      throw err
    }
    return data
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

function pickQr(data) {
  return (
    data?.qrcode?.base64 ||
    data?.qrcode ||
    data?.qr ||
    data?.base64 ||
    data?.code ||
    data?.data?.qrcode?.base64 ||
    data?.data?.qrcode ||
    null
  )
}

function pickConnected(data) {
  const state = (
    data?.instance?.state ||
    data?.state ||
    data?.status ||
    data?.instance?.status ||
    ""
  ).toString().toLowerCase()
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

async function createInstance(instanceName, webhook) {
  return firstSuccess([
    () =>
      requestEvolution("/instance/create", {
        method: "POST",
        body: {
          instanceName,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          webhook,
        },
      }),
    () =>
      requestEvolution("/instance/create", {
        method: "POST",
        body: { instanceName, qrcode: true, webhook },
      }),
  ])
}

function isInstanceAlreadyExistsError(err) {
  const message = (
    err?.details?.message ||
    err?.message ||
    ""
  ).toString().toLowerCase()
  return message.includes("already") || message.includes("exist")
}

async function connectInstance(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`),
    () => requestEvolution(`/instance/qr/${encodeURIComponent(instanceName)}`),
    () => requestEvolution(`/instance/qrcode/${encodeURIComponent(instanceName)}`),
  ])
}

async function getConnectionState(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`),
    () => requestEvolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`),
  ])
}

async function logoutInstance(instanceName) {
  return firstSuccess([
    () => requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" }),
    () => requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`),
  ])
}

module.exports = {
  createInstance,
  connectInstance,
  getConnectionState,
  logoutInstance,
  pickQr,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
}

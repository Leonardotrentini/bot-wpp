/**
 * Multi-Evolution hosts (isolados).
 * - primary  → EVOLUTION_BASE_URL / EVOLUTION_API_KEY (Evo1, clientes atuais)
 * - secondary → EVOLUTION_2_BASE_URL / EVOLUTION_2_API_KEY (Evo2, conexões novas)
 *
 * Não migra ninguém automaticamente: só escolhe o host na criação.
 */

const HOST_PRIMARY = "primary"
const HOST_SECONDARY = "secondary"

/** @type {Map<string, string>} instanceName → hostId */
const instanceHostCache = new Map()

function normalizeBaseUrl(raw) {
  return String(raw || "").replace(/\/+$/, "")
}

function isSecondaryConfigured() {
  return Boolean(
    process.env.EVOLUTION_2_BASE_URL?.trim() && process.env.EVOLUTION_2_API_KEY?.trim(),
  )
}

function getHostCreds(hostId = HOST_PRIMARY) {
  if (hostId === HOST_SECONDARY) {
    const baseUrl = normalizeBaseUrl(process.env.EVOLUTION_2_BASE_URL)
    const apiKey = process.env.EVOLUTION_2_API_KEY?.trim()
    if (!baseUrl || !apiKey) {
      const err = new Error("Evolution API secundária não configurada (EVOLUTION_2_*).")
      err.code = "EVOLUTION_CONFIG_MISSING"
      throw err
    }
    return { hostId: HOST_SECONDARY, baseUrl, apiKey }
  }

  const baseUrl = normalizeBaseUrl(process.env.EVOLUTION_BASE_URL)
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    const err = new Error("Evolution API não configurada.")
    err.code = "EVOLUTION_CONFIG_MISSING"
    throw err
  }
  return { hostId: HOST_PRIMARY, baseUrl, apiKey }
}

/** Novas conexões vão para a Evo2 se estiver configurada; senão ficam na Evo1. */
function getDefaultHostForNewConnections() {
  const forced = String(process.env.EVOLUTION_NEW_HOST || "").trim().toLowerCase()
  if (forced === HOST_PRIMARY || forced === "evo1" || forced === "1") return HOST_PRIMARY
  if (forced === HOST_SECONDARY || forced === "evo2" || forced === "2") {
    if (!isSecondaryConfigured()) return HOST_PRIMARY
    return HOST_SECONDARY
  }
  return isSecondaryConfigured() ? HOST_SECONDARY : HOST_PRIMARY
}

function normalizeHostId(raw) {
  const v = String(raw || "").trim().toLowerCase()
  if (v === HOST_SECONDARY || v === "evo2" || v === "2") return HOST_SECONDARY
  return HOST_PRIMARY
}

function bindInstanceHost(instanceName, hostId) {
  const name = String(instanceName || "").trim()
  if (!name) return
  instanceHostCache.set(name, normalizeHostId(hostId))
}

function peekInstanceHost(instanceName) {
  const name = String(instanceName || "").trim()
  if (!name) return null
  return instanceHostCache.get(name) || null
}

async function lookupHostFromDb(instanceName) {
  const name = String(instanceName || "").trim()
  if (!name) return HOST_PRIMARY
  try {
    const { prisma } = require("./prisma")
    const row = await prisma.whatsAppConnection.findUnique({
      where: { instanceName: name },
      select: { evolutionHost: true },
    })
    const hostId = normalizeHostId(row?.evolutionHost || HOST_PRIMARY)
    bindInstanceHost(name, hostId)
    return hostId
  } catch {
    return HOST_PRIMARY
  }
}

async function resolveCreds({ creds, hostId, instanceName } = {}) {
  if (creds?.baseUrl && creds?.apiKey) {
    return {
      hostId: creds.hostId || HOST_PRIMARY,
      baseUrl: normalizeBaseUrl(creds.baseUrl),
      apiKey: creds.apiKey,
    }
  }
  if (hostId) return getHostCreds(normalizeHostId(hostId))

  if (instanceName) {
    const cached = peekInstanceHost(instanceName)
    if (cached) return getHostCreds(cached)
    const fromDb = await lookupHostFromDb(instanceName)
    return getHostCreds(fromDb)
  }

  return getHostCreds(HOST_PRIMARY)
}

/** Extrai instanceName de paths Evolution v2 (`/message/sendText/NAME`, query, etc.). */
function guessInstanceFromPath(path) {
  const raw = String(path || "")
  const [pathPart, query = ""] = raw.split("?")
  try {
    const q = new URLSearchParams(query)
    const fromQuery = q.get("instanceName")
    if (fromQuery) return fromQuery
  } catch {
    /* ignore */
  }
  if (/\/instance\/create\/?$/i.test(pathPart)) return null
  const parts = pathPart.split("/").filter(Boolean)
  if (parts.length >= 3) {
    try {
      return decodeURIComponent(parts[parts.length - 1])
    } catch {
      return parts[parts.length - 1]
    }
  }
  return null
}

async function warmInstanceHostCache(rows = []) {
  for (const row of rows) {
    if (row?.instanceName) bindInstanceHost(row.instanceName, row.evolutionHost || HOST_PRIMARY)
  }
}

module.exports = {
  HOST_PRIMARY,
  HOST_SECONDARY,
  isSecondaryConfigured,
  getHostCreds,
  getDefaultHostForNewConnections,
  normalizeHostId,
  bindInstanceHost,
  peekInstanceHost,
  resolveCreds,
  guessInstanceFromPath,
  warmInstanceHostCache,
}

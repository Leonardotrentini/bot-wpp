const DEFAULT_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 25000)
const GROUPS_TIMEOUT_MS = Number(process.env.EVOLUTION_GROUPS_TIMEOUT_MS || 180000)
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
      "MESSAGES_SET",
      "MESSAGES_UPDATE",
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
const { normalizeEvolutionMessages, filterMessagesForGroup } = require("./evolutionMessages")

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

async function fetchGroupMessages(instanceName, groupJid, { page = 1, pageSize = 50, cutoffMs } = {}) {
  const bodies = [
    buildEvolutionFindMessagesBody(groupJid, { page, pageSize, cutoffMs }),
    buildEvolutionFindMessagesBody(groupJid, { page, pageSize, cutoffMs: null }),
    {
      where: { key: { remoteJidAlt: groupJid } },
      page,
      offset: pageSize,
    },
  ]

  let lastPayload = null
  for (const body of bodies) {
    try {
      const payload = await requestFindMessages(instanceName, body)
      lastPayload = payload
      const records = filterMessagesForGroup(normalizeEvolutionMessages(payload), groupJid)
      if (records.length) return { payload, records, source: "filtered" }
    } catch {
      /* tenta próximo formato */
    }
  }

  if (lastPayload) {
    const records = filterMessagesForGroup(normalizeEvolutionMessages(lastPayload), groupJid)
    if (records.length) return { payload: lastPayload, records, source: "filtered-partial" }
  }

  return { payload: lastPayload || {}, records: [], source: "none" }
}

/** Lista chats da instância (Evolution v2 `POST /chat/findChats/{instance}`). */
async function findChats(instanceName, { limit } = {}) {
  const body = limit ? { where: {}, take: limit } : { where: {} }
  return firstSuccess([
    () => requestEvolution(`/chat/findChats/${encodeURIComponent(instanceName)}`, { method: "POST", body, timeoutMs: GROUPS_TIMEOUT_MS }),
    () => requestEvolution(`/chat/findChats/${encodeURIComponent(instanceName)}`, { method: "POST", body: {}, timeoutMs: GROUPS_TIMEOUT_MS }),
  ])
}

/** Histórico paginado de um chat 1:1 (mesmo findMessages usado para grupos). */
async function fetchChatMessages(instanceName, remoteJid, { page = 1, pageSize = 50, cutoffMs } = {}) {
  return fetchGroupMessages(instanceName, remoteJid, { page, pageSize, cutoffMs })
}

async function sendText(instanceName, number, text, options = {}) {
  const { linkPreview, mentionsEveryOne, mentioned, mentionAll, ...rest } = options
  const body = {
    number,
    text,
    ...rest,
  }
  if (mentionsEveryOne === true) body.mentionsEveryOne = true
  if (Array.isArray(mentioned) && mentioned.length) body.mentioned = mentioned
  if (linkPreview === true) body.linkPreview = true
  // Campo experimental — Evolution/Baileys recentes podem repassar mentionAll (nonJidMentions)
  if (mentionAll === true) body.mentionAll = true
  return requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body,
  })
}

/** mediatype: "image" | "video" | "audio" | "document". media: base64 (sem prefixo data:) ou URL. */
async function sendMedia(instanceName, number, { mediatype, media, mimetype, caption, fileName, linkPreview, mentionsEveryOne, mentioned, mentionAll, ...rest }) {
  const body = { number, mediatype, media, ...rest }
  if (mimetype) body.mimetype = mimetype
  if (caption) body.caption = caption
  if (fileName) body.fileName = fileName
  if (mentionsEveryOne === true) body.mentionsEveryOne = true
  if (Array.isArray(mentioned) && mentioned.length) body.mentioned = mentioned
  if (linkPreview === true) body.linkPreview = true
  if (mentionAll === true) body.mentionAll = true
  const timeoutMs = Number(process.env.EVOLUTION_MEDIA_TIMEOUT_MS || 600000)
  const opts = { method: "POST", body, timeoutMs }
  return firstSuccess([
    () => requestEvolution(`/message/sendMedia/${encodeURIComponent(instanceName)}`, opts),
    () => requestEvolution(`/message/sendMedia/${encodeURIComponent(instanceName)}`, { ...opts, body: { ...body, options: {} } }),
  ])
}

/** Mensagem de voz (PTT) — endpoint dedicado da Evolution; aceita webm/mp3/ogg com encoding. */
async function sendWhatsAppAudio(instanceName, number, { audio, encoding = true, mimetype } = {}) {
  const body = { number, audio, encoding: Boolean(encoding) }
  if (mimetype) body.mimetype = mimetype
  const timeoutMs = Number(process.env.EVOLUTION_MEDIA_TIMEOUT_MS || 600000)
  const opts = { method: "POST", body, timeoutMs }
  const instance = encodeURIComponent(instanceName)
  return firstSuccess([
    () => requestEvolution(`/message/sendWhatsAppAudio/${instance}`, opts),
    () => requestEvolution(`/message/sendWhatsAppAudio/${instance}`, { ...opts, body: { ...body, options: {} } }),
    () =>
      requestEvolution(`/message/sendMedia/${instance}`, {
        ...opts,
        body: {
          number,
          mediatype: "audio",
          media: typeof audio === "string" ? audio.replace(/^data:[^;]+;base64,/, "") : audio,
          mimetype: mimetype || "audio/ogg; codecs=opus",
          ptt: true,
        },
      }),
  ])
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
  const timeoutMs = Number(process.env.EVOLUTION_MEDIA_TIMEOUT_MS || 600000)
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
  findContacts,
  fetchProfile,
  fetchProfilePictureUrl,
  saveContact,
  fetchGroupMessages,
  findChats,
  fetchChatMessages,
  sendText,
  sendMedia,
  sendWhatsAppAudio,
  getBase64FromMediaMessage,
  extractMediaBase64Payload,
  logoutInstance,
  pickQrSync,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
}

require("dotenv").config()

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || typeof jwtSecret !== "string" || jwtSecret.trim().length < 8) {
  console.error(
    "[fatal] JWT_SECRET em falta ou demasiado curto. No Railway, adicione JWT_SECRET (ex.: 32+ caracteres aleatórios). Sem isto, login/registo falham com 500 ao gerar o token.",
  )
  process.exit(1)
}

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const { z } = require("zod")
const { createServer } = require("http")
const { Server } = require("socket.io")
const { prisma } = require("./lib/prisma")
const { ensureDefaultPlans } = require("./lib/ensureBillingDefaults")
const { signToken, authMiddleware } = require("./lib/auth")
const {
  createInstance,
  setInstanceWebhook,
  connectInstance,
  getConnectionState,
  fetchAllGroups,
  fetchGroupParticipants,
  fetchGroupMessages,
  sendText,
  sendMedia,
  logoutInstance,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
} = require("./lib/evolution")
const { getAnalyticsSnapshot } = require("./data/mock")
const adminRoutes = require("./routes/admin")

const GROUP_SYNC_MIN_INTERVAL_MS = Number(process.env.GROUP_SYNC_MIN_INTERVAL_MS || 5 * 60 * 1000)
const GROUP_SYNC_RATE_LIMIT_BACKOFF_MS = Number(process.env.GROUP_SYNC_RATE_LIMIT_BACKOFF_MS || 10 * 60 * 1000)
const PARTICIPANTS_SYNC_MIN_INTERVAL_MS = Number(process.env.PARTICIPANTS_SYNC_MIN_INTERVAL_MS || 15 * 60 * 1000)
const GROUP_SYNC_ITEM_DELAY_MS = Number(process.env.GROUP_SYNC_ITEM_DELAY_MS || 350)
const activeGroupSyncs = new Set()

// Importação de mensagens: 1 grupo por vez, só os últimos N dias, com pausas para não estourar o WhatsApp.
const MESSAGE_BACKFILL_DAYS = Number(process.env.MESSAGE_BACKFILL_DAYS || 2)
const MESSAGE_SYNC_PAGE_SIZE = Number(process.env.MESSAGE_SYNC_PAGE_SIZE || 50)
const MESSAGE_SYNC_MAX_PAGES = Number(process.env.MESSAGE_SYNC_MAX_PAGES || 10)
const MESSAGE_SYNC_PAGE_DELAY_MS = Number(process.env.MESSAGE_SYNC_PAGE_DELAY_MS || 1500)
const MESSAGE_SYNC_GROUP_DELAY_MS = Number(process.env.MESSAGE_SYNC_GROUP_DELAY_MS || 4000)
const STATUS_REFRESH_MIN_INTERVAL_MS = Number(process.env.STATUS_REFRESH_MIN_INTERVAL_MS || 15000)
const activeMessageImports = new Set()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  },
})

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  }),
)
app.use(express.json({ limit: "32mb" }))

app.use("/api/admin", adminRoutes)

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vesto-backend", ts: new Date().toISOString() })
})

app.post("/api/auth/register", async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const { name, email, password } = parsed.data
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return res.status(409).json({ error: "EMAIL_IN_USE", message: "E-mail já cadastrado." })

  await ensureDefaultPlans()
  const freePlan = await prisma.plan.findUnique({ where: { slug: "free" } })
  if (!freePlan) {
    return res.status(503).json({
      error: "NO_DEFAULT_PLAN",
      message: "Não foi possível criar o plano padrão. Verifique a base de dados.",
    })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { name, email, passwordHash },
    })
    await tx.subscription.create({
      data: { userId: u.id, planId: freePlan.id, status: "ACTIVE" },
    })
    return u
  })

  const token = signToken(user)
  return res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  })
})

app.post("/api/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Credenciais inválidas." })

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." })

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." })

  const token = signToken(user)
  return res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  })
})

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { startedAt: "desc" },
        include: { plan: { select: { id: true, name: true, slug: true, maxGroups: true } } },
      },
    },
  })
  if (!user) return res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." })

  const sub = user.subscriptions[0]
  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: sub ? { id: sub.plan.id, name: sub.plan.name, slug: sub.plan.slug, maxGroups: sub.plan.maxGroups } : null,
    },
  })
})

function fallbackGroupImage(seed) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed || "WhatsApp")}`
}

function toIsoFromEvolutionTimestamp(value) {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return new Date(n < 10_000_000_000 ? n * 1000 : n).toISOString()
}

function normalizeEvolutionGroups(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.groups)) return payload.groups
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.response)) return payload.response
  if (payload?.data && typeof payload.data === "object") return normalizeEvolutionGroups(payload.data)
  if (payload?.id || payload?.jid || payload?.groupJid || payload?.remoteJid || payload?.subject) return [payload]
  return []
}

function serializeJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value))
}

/** Resumo curto do que a Evolution devolveu, para diagnosticar 0 grupos sem precisar de logs. */
function previewPayloadShape(payload) {
  if (payload == null) return "vazio/null"
  if (Array.isArray(payload)) {
    const first = payload[0]
    const keys = first && typeof first === "object" ? Object.keys(first).slice(0, 6).join(",") : typeof first
    return `array(${payload.length})${payload.length ? ` item0={${keys}}` : ""}`
  }
  if (typeof payload === "object") return `object{${Object.keys(payload).slice(0, 8).join(",")}}`
  return `${typeof payload}: ${String(payload).slice(0, 60)}`
}

function isRateLimitError(err) {
  const message = `${err?.message || ""} ${JSON.stringify(err?.details || {})}`.toLowerCase()
  return err?.status === 429 || err?.details?.status === 429 || message.includes("429") || message.includes("rate-overlimit") || message.includes("rate limit")
}

function getGroupApiPayload(group) {
  return {
    id: group.groupJid,
    name: group.name,
    memberCount: group.memberCount,
    status: group.status,
    lastMessage: group.lastMessage || "Grupo sincronizado do WhatsApp.",
    lastMessageAt: group.lastMessageAt?.toISOString?.() || group.lastMessageAt || null,
    image: group.image || fallbackGroupImage(group.name),
    messagesPerDay: 0,
    activeMembers: group.memberCount,
    peakHour: "—",
    description: group.description || "",
    announce: Boolean(group.announce),
    restrict: Boolean(group.restrict),
    owner: group.owner || null,
    monitoringEnabled: Boolean(group.monitoringEnabled),
    messageSyncStatus: group.messageSyncStatus || "IDLE",
    messageSyncProgress: group.messageSyncProgress || 0,
    messagesSyncedCount: group.messagesSyncedCount || 0,
    messagesLastSyncAt: group.messagesLastSyncAt?.toISOString?.() || group.messagesLastSyncAt || null,
  }
}

function getParticipantApiPayload(participant, groupName) {
  return {
    id: participant.participantJid,
    name: participant.name || participant.phone || "Participante",
    phone: participant.phone || "—",
    role: participant.role,
    status: participant.status,
    tags: participant.role === "admin" || participant.role === "superadmin" ? ["admin"] : [],
    groups: groupName ? [groupName] : [],
    lastActivity: participant.lastSyncedAt?.toISOString?.() || new Date().toISOString(),
    avatar: fallbackGroupImage(participant.name || participant.phone || participant.participantJid),
  }
}

function mapEvolutionGroup(group, instanceName) {
  const id = group?.id || group?.jid || group?.groupJid || group?.remoteJid
  const name = group?.subject || group?.name || id || "Grupo sem nome"
  const memberCount = Number(group?.size || group?.participants?.length || 0)
  const lastMessageAt = toIsoFromEvolutionTimestamp(group?.subjectTime || group?.creation)

  return {
    groupJid: id,
    instanceName,
    name,
    memberCount,
    status: "ativo",
    lastMessage: group?.desc || "Grupo sincronizado do WhatsApp.",
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt) : null,
    image: group?.pictureUrl || fallbackGroupImage(name),
    description: group?.desc || "",
    announce: Boolean(group?.announce),
    restrict: Boolean(group?.restrict),
    owner: group?.owner || null,
    raw: serializeJson(group),
  }
}

function normalizeEvolutionParticipants(payload, group) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.participants)) return payload.participants
  if (Array.isArray(payload?.data?.participants)) return payload.data.participants
  if (Array.isArray(group?.participants)) return group.participants
  return []
}

function mapEvolutionParticipant(participant) {
  const id = participant?.id || participant?.jid || participant?.number || participant
  const phone = String(id || "").split("@")[0]
  const role = participant?.admin ? "admin" : "membro"
  const name = participant?.name || participant?.pushName || participant?.notify || phone || "Participante"

  return {
    participantJid: String(id || phone),
    name,
    phone: phone ? `+${phone}` : "—",
    role,
    status: "ativo",
    raw: serializeJson(participant),
  }
}

function normalizeEvolutionMessages(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.messages?.records)) return payload.messages.records
  if (Array.isArray(payload?.messages)) return payload.messages
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.data?.messages?.records)) return payload.data.messages.records
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") return ""
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  )
}

function mapEvolutionMessage(record) {
  const key = record?.key || {}
  const messageId = key.id || record?.id
  const timestampRaw = record?.messageTimestamp || record?.messageTimestampMs || record?.timestamp
  const iso = toIsoFromEvolutionTimestamp(timestampRaw)
  const fromMe = Boolean(key.fromMe)
  const senderJid = key.participant || key.remoteJid || record?.participant || null
  const body = extractMessageText(record?.message) || record?.body || ""

  return {
    messageId: messageId ? String(messageId) : null,
    fromMe,
    senderJid: senderJid ? String(senderJid) : null,
    senderName: fromMe ? "Você" : record?.pushName || (senderJid ? String(senderJid).split("@")[0] : null),
    type: record?.messageType || "text",
    body: body ? String(body).slice(0, 4000) : "",
    timestamp: iso ? new Date(iso) : new Date(),
    raw: serializeJson(record),
  }
}

async function getUserWhatsAppConnection(userId) {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!existing?.instanceName) {
    const err = new Error("Conecte o WhatsApp antes de sincronizar grupos.")
    err.code = "WHATSAPP_NOT_CONNECTED"
    throw err
  }
  return existing
}

function getSyncPayload(conn, groupsCount = 0) {
  const retryAt = conn?.groupSyncRetryAfter?.toISOString?.() || null
  return {
    status: conn?.groupSyncStatus || "IDLE",
    progress: conn?.groupSyncProgress || 0,
    message: conn?.groupSyncMessage || null,
    error: conn?.groupSyncError || null,
    retryAfter: retryAt,
    groupsLastSync: conn?.groupsLastSync?.toISOString?.() || null,
    groupsCount,
  }
}

function getImportPayload(conn) {
  return {
    status: conn?.msgImportStatus || "IDLE",
    total: conn?.msgImportTotal || 0,
    done: conn?.msgImportDone || 0,
    message: conn?.msgImportMessage || null,
    error: conn?.msgImportError || null,
    retryAfter: conn?.msgImportRetryAfter?.toISOString?.() || null,
    backfillDays: MESSAGE_BACKFILL_DAYS,
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readCachedGroups(userId) {
  const rows = await prisma.whatsAppGroup.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  })
  return rows.map(getGroupApiPayload)
}

async function updateConnectionSync(userId, data) {
  return prisma.whatsAppConnection.update({
    where: { userId },
    data,
  })
}

function getGroupCreateData(userId, group, status = "pendente") {
  return {
    userId,
    ...group,
    status,
  }
}

function getGroupUpdateData(group, extra = {}) {
  const { status: _status, ...data } = group
  return { ...data, ...extra }
}

async function upsertDiscoveredGroup(userId, group, status = "pendente") {
  const now = new Date()
  return prisma.whatsAppGroup.upsert({
    where: { userId_groupJid: { userId, groupJid: group.groupJid } },
    create: {
      ...getGroupCreateData(userId, group, status),
      lastSyncedAt: now,
    },
    update: {
      ...getGroupUpdateData(group, status === "ativo" ? { status } : {}),
      lastSyncedAt: now,
    },
  })
}

async function discoverGroupsFromEvolution(conn, { force = false } = {}) {
  const now = new Date()
  const cachedCount = await prisma.whatsAppGroup.count({ where: { userId: conn.userId } })

  if (conn.groupSyncStatus === "RATE_LIMITED" && conn.groupSyncRetryAfter && conn.groupSyncRetryAfter > now) {
    return {
      skipped: true,
      reason: "backoff",
      conn,
      message: "A Evolution/WhatsApp limitou consultas. Vamos tentar novamente depois do cooldown.",
    }
  }

  if (!force && conn.groupsLastSync && now.getTime() - conn.groupsLastSync.getTime() < GROUP_SYNC_MIN_INTERVAL_MS) {
    const updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: cachedCount ? "GROUPS_FOUND" : "IDLE",
      groupSyncProgress: cachedCount ? 100 : 0,
      groupSyncMessage: cachedCount
        ? `${cachedCount} grupos já foram encontrados recentemente. Clique em Sincronizar ${cachedCount} grupos.`
        : "Nenhum grupo encontrado no cache recente.",
      groupSyncError: null,
    })
    return {
      skipped: true,
      reason: "fresh-cache",
      conn: updatedConn,
      message: "Usando cache recente de grupos para evitar rate-limit.",
    }
  }

  let updatedConn = await updateConnectionSync(conn.userId, {
    groupSyncStatus: "DISCOVERING_GROUPS",
    groupSyncProgress: cachedCount ? 40 : 15,
    groupSyncStartedAt: now,
    groupSyncMessage: "Procurando a lista leve de grupos no WhatsApp, sem participantes e sem mensagens antigas.",
    groupSyncError: null,
  })

  try {
    const maxAttempts = Number(process.env.GROUP_DISCOVER_MAX_ATTEMPTS || 4)
    let payload
    for (let attempt = 1; ; attempt += 1) {
      try {
        payload = await fetchAllGroups(conn.instanceName, { getParticipants: false })
        break
      } catch (err) {
        const retryable = err?.code === "EVOLUTION_TIMEOUT" || err?.retryable
        if (!retryable || attempt >= maxAttempts) throw err
        await updateConnectionSync(conn.userId, {
          groupSyncStatus: "DISCOVERING_GROUPS",
          groupSyncMessage: `A Evolution está demorando (tentativa ${attempt}/${maxAttempts}). A primeira busca após conectar é mais lenta; aguardando para tentar de novo…`,
        })
        await wait(8000)
      }
    }
    const shape = previewPayloadShape(payload)
    const realGroups = normalizeEvolutionGroups(payload)
      .map((g) => mapEvolutionGroup(g, conn.instanceName))
      .filter((g) => g.groupJid)

    updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: "DISCOVERING_GROUPS",
      groupSyncProgress: realGroups.length ? 65 : 100,
      groupSyncMessage: realGroups.length
        ? `${realGroups.length} grupos encontrados. Preparando para sincronizar em etapas.`
        : "Nenhum grupo foi retornado pelo WhatsApp.",
      groupSyncError: null,
    })

    for (const [index, group] of realGroups.entries()) {
      await upsertDiscoveredGroup(conn.userId, group, "pendente")

      const done = index + 1
      const progress = Math.min(98, Math.round(65 + (done / Math.max(1, realGroups.length)) * 33))
      updatedConn = await updateConnectionSync(conn.userId, {
        groupSyncStatus: "DISCOVERING_GROUPS",
        groupSyncProgress: progress,
        groupSyncMessage: `${done} de ${realGroups.length} grupos identificados.`,
      })

      if (GROUP_SYNC_ITEM_DELAY_MS > 0 && done < realGroups.length) {
        await wait(GROUP_SYNC_ITEM_DELAY_MS)
      }
    }

    if (realGroups.length > 0) {
      await prisma.whatsAppGroup.updateMany({
        where: { userId: conn.userId, groupJid: { notIn: realGroups.map((g) => g.groupJid) } },
        data: { status: "inativo", lastSyncedAt: now },
      })
    }

    updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: realGroups.length ? "GROUPS_FOUND" : "READY",
      groupSyncProgress: 100,
      groupSyncMessage: realGroups.length
        ? `${realGroups.length} grupos encontrados. Selecione os que quer conectar e clique em Conectar e importar.`
        : "A Evolution respondeu, mas reconhecemos 0 grupos. Se você acabou de conectar, aguarde ~1 min (a sessão ainda sincroniza) e tente de novo.",
      groupSyncError: realGroups.length ? null : `Resposta da Evolution: ${shape}`,
      groupSyncRetryAfter: null,
      groupsLastSync: realGroups.length ? now : conn.groupsLastSync,
    })

    return { skipped: false, conn: updatedConn, count: realGroups.length }
  } catch (err) {
    if (isRateLimitError(err)) {
      const retryAfter = new Date(Date.now() + GROUP_SYNC_RATE_LIMIT_BACKOFF_MS)
      updatedConn = await updateConnectionSync(conn.userId, {
        groupSyncStatus: "RATE_LIMITED",
        groupSyncProgress: cachedCount ? 90 : 45,
        groupSyncMessage: "WhatsApp limitou a busca de grupos. O Vesto vai usar cache e tentar depois.",
        groupSyncError: err?.message || "rate-overlimit",
        groupSyncRetryAfter: retryAfter,
      })
      return { skipped: true, reason: "rate-limited", conn: updatedConn, error: err }
    }
    updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: "ERROR",
      groupSyncProgress: cachedCount ? 90 : 45,
      groupSyncMessage: "Não foi possível procurar grupos agora.",
      groupSyncError: err?.message || "Erro ao procurar grupos",
      groupSyncRetryAfter: null,
    })
    throw err
  }
}

async function runDiscoverInBackground(userId) {
  if (activeGroupSyncs.has(userId)) return
  activeGroupSyncs.add(userId)
  try {
    const conn = await getUserWhatsAppConnection(userId)
    await discoverGroupsFromEvolution(conn)
  } catch (err) {
    console.error("[groups-discover] background:", err?.message || err)
  } finally {
    activeGroupSyncs.delete(userId)
  }
}

async function storeGroupMessages(group, records, { cutoffMs } = {}) {
  let saved = 0
  let reachedCutoff = false
  let lastMessage = null
  let lastMessageAt = null

  for (const record of records) {
    const mapped = mapEvolutionMessage(record)
    if (!mapped.messageId) continue

    const ts = mapped.timestamp.getTime()
    if (cutoffMs && ts < cutoffMs) {
      reachedCutoff = true
      continue
    }

    await prisma.whatsAppMessage.upsert({
      where: { groupId_messageId: { groupId: group.id, messageId: mapped.messageId } },
      create: { userId: group.userId, groupId: group.id, ...mapped },
      update: { body: mapped.body, type: mapped.type, senderName: mapped.senderName, raw: mapped.raw },
    })
    saved += 1

    if (!lastMessageAt || ts > lastMessageAt.getTime()) {
      lastMessageAt = mapped.timestamp
      lastMessage = mapped.body || group.lastMessage
    }
  }

  return { saved, reachedCutoff, lastMessage, lastMessageAt }
}

async function importGroupMessages(conn, group, cutoffMs) {
  await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: { messageSyncStatus: "SYNCING", messageSyncProgress: 5 },
  })

  let totalSaved = 0
  let latestMessage = null
  let latestAt = null

  for (let page = 1; page <= MESSAGE_SYNC_MAX_PAGES; page += 1) {
    const payload = await fetchGroupMessages(conn.instanceName, group.groupJid, {
      page,
      pageSize: MESSAGE_SYNC_PAGE_SIZE,
    })
    const records = normalizeEvolutionMessages(payload)
    if (!records.length) break

    const { saved, reachedCutoff, lastMessage, lastMessageAt } = await storeGroupMessages(group, records, { cutoffMs })
    totalSaved += saved
    if (lastMessageAt && (!latestAt || lastMessageAt.getTime() > latestAt.getTime())) {
      latestAt = lastMessageAt
      latestMessage = lastMessage
    }

    await prisma.whatsAppGroup.update({
      where: { id: group.id },
      data: {
        messageSyncStatus: "SYNCING",
        messageSyncProgress: Math.min(95, Math.round((page / MESSAGE_SYNC_MAX_PAGES) * 95)),
        messagesSyncedCount: totalSaved,
      },
    })

    if (reachedCutoff || records.length < MESSAGE_SYNC_PAGE_SIZE) break
    if (page < MESSAGE_SYNC_MAX_PAGES) await wait(MESSAGE_SYNC_PAGE_DELAY_MS)
  }

  await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: {
      status: "ativo",
      messageSyncStatus: "READY",
      messageSyncProgress: 100,
      messagesSyncedCount: totalSaved,
      messagesLastSyncAt: new Date(),
      ...(latestMessage ? { lastMessage: latestMessage } : {}),
      ...(latestAt ? { lastMessageAt: latestAt } : {}),
    },
  })

  return totalSaved
}

async function runMessageImport(userId) {
  if (activeMessageImports.has(userId)) return
  activeMessageImports.add(userId)
  try {
    const conn = await getUserWhatsAppConnection(userId)
    const monitoredGroups = await prisma.whatsAppGroup.findMany({
      where: { userId, monitoringEnabled: true },
      orderBy: { name: "asc" },
    })
    const total = monitoredGroups.length
    const cutoffMs = Date.now() - MESSAGE_BACKFILL_DAYS * 24 * 60 * 60 * 1000

    if (!total) {
      await updateConnectionSync(userId, {
        msgImportStatus: "IDLE",
        msgImportTotal: 0,
        msgImportDone: 0,
        msgImportMessage: "Selecione ao menos um grupo para importar mensagens.",
        msgImportError: null,
      })
      return
    }

    await updateConnectionSync(userId, {
      msgImportStatus: "RUNNING",
      msgImportTotal: total,
      msgImportDone: 0,
      msgImportStartedAt: new Date(),
      msgImportMessage: `Importando mensagens dos últimos ${MESSAGE_BACKFILL_DAYS} dias. 0 de ${total} grupos.`,
      msgImportError: null,
      msgImportRetryAfter: null,
    })

    for (const [index, group] of monitoredGroups.entries()) {
      try {
        await importGroupMessages(conn, group, cutoffMs)
      } catch (err) {
        if (isRateLimitError(err)) {
          await prisma.whatsAppGroup.update({
            where: { id: group.id },
            data: { messageSyncStatus: "RATE_LIMITED" },
          })
          await updateConnectionSync(userId, {
            msgImportStatus: "RATE_LIMITED",
            msgImportMessage: "WhatsApp limitou as consultas. Importação pausada; retomaremos depois do cooldown.",
            msgImportError: err?.message || "rate-overlimit",
            msgImportRetryAfter: new Date(Date.now() + GROUP_SYNC_RATE_LIMIT_BACKOFF_MS),
          })
          return
        }
        console.error(`[msg-import] grupo ${group.groupJid}:`, err?.message || err)
        await prisma.whatsAppGroup.update({
          where: { id: group.id },
          data: { messageSyncStatus: "ERROR" },
        })
      }

      const done = index + 1
      await updateConnectionSync(userId, {
        msgImportStatus: "RUNNING",
        msgImportDone: done,
        msgImportMessage: `Importando mensagens dos últimos ${MESSAGE_BACKFILL_DAYS} dias. ${done} de ${total} grupos.`,
      })

      if (done < total) await wait(MESSAGE_SYNC_GROUP_DELAY_MS)
    }

    await updateConnectionSync(userId, {
      msgImportStatus: "READY",
      msgImportDone: total,
      msgImportMessage: `${total} grupos importados (últimos ${MESSAGE_BACKFILL_DAYS} dias). Novas mensagens chegam por webhook.`,
      msgImportError: null,
      msgImportRetryAfter: null,
    })
  } catch (err) {
    console.error("[msg-import] background:", err?.message || err)
    await updateConnectionSync(userId, {
      msgImportStatus: "ERROR",
      msgImportMessage: "Não foi possível importar as mensagens agora.",
      msgImportError: err?.message || "Erro ao importar mensagens",
    }).catch(() => {})
  } finally {
    activeMessageImports.delete(userId)
  }
}

app.get("/api/groups", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    const cachedGroups = await readCachedGroups(req.user.sub)
    res.json({
      groups: cachedGroups,
      sync: getSyncPayload(conn, cachedGroups.length),
      import: getImportPayload(conn),
    })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: err.message,
        groups: [],
        sync: { status: "DISCONNECTED", progress: 0, message: err.message, groupsCount: 0 },
        import: { status: "IDLE", total: 0, done: 0 },
      })
    }
    return handleEvolutionError(res, err)
  }
})

app.post("/api/groups/select", authMiddleware, async (req, res) => {
  try {
    const schema = z.object({ groupIds: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Selecione ao menos um grupo." })
    }

    const conn = await getUserWhatsAppConnection(req.user.sub)
    if (!conn.connected) {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "Conecte o WhatsApp antes de importar mensagens.",
      })
    }

    const { groupIds } = parsed.data
    // groupIds vêm como groupJid (id exposto na API). Marca monitoramento e reseta os demais.
    await prisma.whatsAppGroup.updateMany({
      where: { userId: req.user.sub, groupJid: { in: groupIds } },
      data: { monitoringEnabled: true, messageSyncStatus: "QUEUED", messageSyncProgress: 0, status: "ativo" },
    })
    await prisma.whatsAppGroup.updateMany({
      where: { userId: req.user.sub, groupJid: { notIn: groupIds } },
      data: { monitoringEnabled: false },
    })

    if (activeMessageImports.has(req.user.sub)) {
      const cachedGroups = await readCachedGroups(req.user.sub)
      const current = await getUserWhatsAppConnection(req.user.sub)
      return res.status(202).json({ groups: cachedGroups, import: getImportPayload(current) })
    }

    const queuedConn = await updateConnectionSync(req.user.sub, {
      msgImportStatus: "QUEUED",
      msgImportTotal: groupIds.length,
      msgImportDone: 0,
      msgImportMessage: `Importação de ${groupIds.length} grupo(s) agendada (últimos ${MESSAGE_BACKFILL_DAYS} dias).`,
      msgImportError: null,
      msgImportRetryAfter: null,
    })

    void runMessageImport(req.user.sub)

    const cachedGroups = await readCachedGroups(req.user.sub)
    return res.status(202).json({ groups: cachedGroups, import: getImportPayload(queuedConn) })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.post("/api/groups/status", authMiddleware, async (req, res) => {
  try {
    const schema = z.object({
      groupIds: z.array(z.string()).min(1),
      status: z.enum(["ativo", "inativo", "pendente"]),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Selecione grupos e um status válido." })
    }

    const conn = await getUserWhatsAppConnection(req.user.sub)
    const { groupIds, status } = parsed.data
    const data =
      status === "ativo"
        ? { status: "ativo", monitoringEnabled: true }
        : status === "inativo"
          ? { status: "inativo", monitoringEnabled: false }
          : { status: "pendente", monitoringEnabled: false }

    await prisma.whatsAppGroup.updateMany({
      where: { userId: req.user.sub, groupJid: { in: groupIds } },
      data,
    })

    const cachedGroups = await readCachedGroups(req.user.sub)
    return res.json({
      groups: cachedGroups,
      sync: getSyncPayload(conn, cachedGroups.length),
      import: getImportPayload(conn),
    })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.get("/api/groups/:id/messages", authMiddleware, async (req, res) => {
  try {
    const groupJid = decodeURIComponent(req.params.id)
    const group = await prisma.whatsAppGroup.findUnique({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
      select: { id: true, name: true },
    })
    if (!group) return res.status(404).json({ error: "NOT_FOUND", message: "Grupo não encontrado no cache." })

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    const rows = await prisma.whatsAppMessage.findMany({
      where: { groupId: group.id },
      orderBy: { timestamp: "desc" },
      take: limit,
    })

    res.json({
      groupName: group.name,
      messages: rows.map((m) => ({
        id: m.id,
        messageId: m.messageId,
        fromMe: m.fromMe,
        sender: m.senderName || (m.senderJid ? m.senderJid.split("@")[0] : "—"),
        body: m.body,
        type: m.type,
        timestamp: m.timestamp.toISOString(),
      })),
    })
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.post("/api/groups/discover", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    const cachedGroups = await readCachedGroups(req.user.sub)
    const now = new Date()

    if (!conn.connected) {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "Conecte o WhatsApp antes de procurar grupos.",
        groups: cachedGroups,
        sync: getSyncPayload(conn, cachedGroups.length),
      })
    }

    if (conn.groupSyncStatus === "RATE_LIMITED" && conn.groupSyncRetryAfter && conn.groupSyncRetryAfter > now) {
      return res.status(202).json({
        groups: cachedGroups,
        sync: getSyncPayload(conn, cachedGroups.length),
      })
    }

    if (activeGroupSyncs.has(req.user.sub)) {
      return res.status(202).json({
        groups: cachedGroups,
        sync: {
          ...getSyncPayload(conn, cachedGroups.length),
          status: conn.groupSyncStatus || "QUEUED",
          message: conn.groupSyncMessage || "Já existe uma operação de grupos em andamento.",
        },
      })
    }

    const queuedConn = await updateConnectionSync(req.user.sub, {
      groupSyncStatus: "QUEUED",
      groupSyncProgress: cachedGroups.length ? 35 : 5,
      groupSyncMessage: "Busca de grupos agendada. Vamos pedir só a lista leve para a Evolution.",
      groupSyncError: null,
    })

    void runDiscoverInBackground(req.user.sub)

    return res.status(202).json({
      groups: cachedGroups,
      sync: getSyncPayload(queuedConn, cachedGroups.length),
    })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message, groups: [] })
    }
    return handleEvolutionError(res, err)
  }
})

app.post("/api/groups/sync", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    const cachedGroups = await readCachedGroups(req.user.sub)

    if (!conn.connected) {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "Conecte o WhatsApp antes de sincronizar grupos.",
        groups: cachedGroups,
        import: getImportPayload(conn),
      })
    }

    if (activeMessageImports.has(req.user.sub)) {
      return res.status(202).json({ groups: cachedGroups, import: getImportPayload(conn) })
    }

    const monitoredCount = await prisma.whatsAppGroup.count({
      where: { userId: req.user.sub, monitoringEnabled: true },
    })
    if (!monitoredCount) {
      return res.status(202).json({
        groups: cachedGroups,
        import: {
          ...getImportPayload(conn),
          status: "IDLE",
          message: "Selecione os grupos que quer conectar antes de importar mensagens.",
        },
      })
    }

    const queuedConn = await updateConnectionSync(req.user.sub, {
      msgImportStatus: "QUEUED",
      msgImportTotal: monitoredCount,
      msgImportDone: 0,
      msgImportMessage: `Reimportação de ${monitoredCount} grupo(s) agendada (últimos ${MESSAGE_BACKFILL_DAYS} dias).`,
      msgImportError: null,
      msgImportRetryAfter: null,
    })

    void runMessageImport(req.user.sub)

    return res.status(202).json({ groups: cachedGroups, import: getImportPayload(queuedConn) })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message, groups: [] })
    }
    return handleEvolutionError(res, err)
  }
})

app.get("/api/groups/:id", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    const groupJid = decodeURIComponent(req.params.id)
    let groupRow = await prisma.whatsAppGroup.findUnique({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
      include: { participants: { orderBy: { name: "asc" } } },
    })

    if (!groupRow) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Grupo não encontrado no cache. Sincronize a lista de grupos antes de abrir detalhes.",
      })
    }

    const needsParticipantSync =
      !groupRow.participantsSyncedAt ||
      Date.now() - groupRow.participantsSyncedAt.getTime() > PARTICIPANTS_SYNC_MIN_INTERVAL_MS
    let participantRows = groupRow.participants

    if (needsParticipantSync && (!conn.groupSyncRetryAfter || conn.groupSyncRetryAfter <= new Date())) {
      try {
        const participantsPayload = await fetchGroupParticipants(conn.instanceName, groupJid)
        const participants = normalizeEvolutionParticipants(participantsPayload, groupRow.raw).map(mapEvolutionParticipant)
        for (const participant of participants) {
          await prisma.whatsAppGroupParticipant.upsert({
            where: { groupId_participantJid: { groupId: groupRow.id, participantJid: participant.participantJid } },
            create: {
              groupId: groupRow.id,
              ...participant,
              lastSyncedAt: new Date(),
            },
            update: {
              ...participant,
              lastSyncedAt: new Date(),
            },
          })
        }
        await prisma.whatsAppGroup.update({
          where: { id: groupRow.id },
          data: {
            memberCount: participants.length || groupRow.memberCount,
            participantsSyncedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        })
        participantRows = await prisma.whatsAppGroupParticipant.findMany({
          where: { groupId: groupRow.id },
          orderBy: { name: "asc" },
        })
      } catch (err) {
        if (!isRateLimitError(err)) throw err
        await updateConnectionSync(conn.userId, {
          groupSyncStatus: "RATE_LIMITED",
          groupSyncMessage: "WhatsApp limitou consultas de participantes. Mostrando cache salvo.",
          groupSyncError: err?.message || "rate-overlimit",
          groupSyncRetryAfter: new Date(Date.now() + GROUP_SYNC_RATE_LIMIT_BACKOFF_MS),
        })
      }
    }

    const group = getGroupApiPayload(groupRow)
    const members = participantRows.map((p) => getParticipantApiPayload(p, group.name))
    const activity = [
      { day: "Seg", count: 0 },
      { day: "Ter", count: 0 },
      { day: "Qua", count: 0 },
      { day: "Qui", count: 0 },
      { day: "Sex", count: 0 },
      { day: "Sáb", count: 0 },
      { day: "Dom", count: 0 },
    ]

    res.json({ group, members, activity, settings: null })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.get("/api/analytics", authMiddleware, (req, res) => {
  const period = req.query.period || "7d"
  res.json(getAnalyticsSnapshot(period))
})

// ===================== Mensagens reais + biblioteca + automações =====================

const MESSAGE_SEND_GROUP_DELAY_MS = Number(process.env.MESSAGE_SEND_GROUP_DELAY_MS || 1500)
const MEDIA_MAX_BASE64_LEN = Number(process.env.MEDIA_MAX_BASE64_LEN || 24_000_000) // ~16MB binário
const ENABLE_SCHEDULER = process.env.ENABLE_SCHEDULER !== "false"
const SP_OFFSET = "-03:00" // America/Sao_Paulo (sem horário de verão)
const schedulerLock = new Set()

function stripDataUrlPrefix(b64) {
  if (!b64) return b64
  const idx = b64.indexOf("base64,")
  return idx >= 0 ? b64.slice(idx + 7) : b64
}

function getMessageContent(source) {
  return {
    body: source?.body || "",
    mediaType: source?.mediaType || "none",
    mediaBase64: source?.mediaBase64 || null,
    mediaMime: source?.mediaMime || null,
    mediaName: source?.mediaName || null,
  }
}

function validateContent(content) {
  const hasMedia = content.mediaType === "image" || content.mediaType === "video"
  if (!hasMedia && !content.body?.trim()) return "Escreva um texto ou anexe uma mídia."
  if (hasMedia && !content.mediaBase64) return "Mídia ausente para o tipo selecionado."
  if (hasMedia && content.mediaBase64.length > MEDIA_MAX_BASE64_LEN) {
    return "Mídia grande demais. Use imagens até ~5MB e vídeos até ~16MB."
  }
  return null
}

async function resolveContentFromBody(userId, body) {
  if (body.templateId) {
    const tpl = await prisma.messageTemplate.findFirst({ where: { id: body.templateId, userId } })
    if (!tpl) {
      const e = new Error("Mensagem não encontrada na biblioteca.")
      e.code = "TEMPLATE_NOT_FOUND"
      throw e
    }
    return getMessageContent(tpl)
  }
  return getMessageContent(body)
}

async function resolveGroupName(userId, groupJid) {
  const g = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId, groupJid } },
    select: { name: true },
  })
  return g?.name || groupJid
}

async function deliverToGroup(instanceName, groupJid, content) {
  if (content.mediaType === "image" || content.mediaType === "video") {
    await sendMedia(instanceName, groupJid, {
      mediatype: content.mediaType,
      media: stripDataUrlPrefix(content.mediaBase64),
      mimetype: content.mediaMime || undefined,
      caption: content.body || undefined,
      fileName: content.mediaName || undefined,
    })
  } else {
    await sendText(instanceName, groupJid, content.body)
  }
}

async function dispatchMessage({ userId, instanceName, groupJids, content, automationId = null }) {
  const results = []
  for (const [index, groupJid] of groupJids.entries()) {
    const groupName = await resolveGroupName(userId, groupJid)
    try {
      await deliverToGroup(instanceName, groupJid, content)
      await prisma.outboundMessage.create({
        data: { userId, automationId, groupJid, groupName, body: content.body || null, mediaType: content.mediaType, status: "entregue" },
      })
      results.push({ groupJid, groupName, status: "entregue" })
    } catch (err) {
      await prisma.outboundMessage.create({
        data: {
          userId,
          automationId,
          groupJid,
          groupName,
          body: content.body || null,
          mediaType: content.mediaType,
          status: "falhou",
          error: (err?.message || "erro").slice(0, 300),
        },
      })
      results.push({ groupJid, groupName, status: "falhou", error: err?.message || "erro" })
    }
    if (index < groupJids.length - 1) await wait(MESSAGE_SEND_GROUP_DELAY_MS)
  }
  return results
}

function spParts(date) {
  const sp = new Date(date.getTime() - 3 * 3600 * 1000)
  return { y: sp.getUTCFullYear(), m: sp.getUTCMonth(), d: sp.getUTCDate(), dow: sp.getUTCDay() }
}

function spDateAt(baseDate, hh, mm) {
  const { y, m, d } = spParts(baseDate)
  return new Date(Date.UTC(y, m, d, hh + 3, mm, 0, 0))
}

function parseScheduledAt(value) {
  if (!value) return null
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return new Date(`${s}:00${SP_OFFSET}`)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function computeNextRun(a, from = new Date()) {
  if (a.frequency === "once") return a.scheduledAt ? new Date(a.scheduledAt) : null
  if (a.frequency === "daily" || a.frequency === "weekly") {
    if (!a.timeOfDay || !/^\d{1,2}:\d{2}$/.test(a.timeOfDay)) return null
    const [hh, mm] = a.timeOfDay.split(":").map(Number)
    let cand = spDateAt(from, hh, mm)
    const dayMs = 24 * 3600 * 1000
    if (a.frequency === "daily") {
      if (cand <= from) cand = new Date(cand.getTime() + dayMs)
      return cand
    }
    const target = Number.isInteger(a.weekday) ? a.weekday : 0
    for (let i = 0; i < 9; i += 1) {
      if (spParts(cand).dow === target && cand > from) return cand
      cand = new Date(cand.getTime() + dayMs)
    }
    return cand
  }
  return null
}

function getAutomationPayload(a) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    groupJids: a.groupJids,
    groupNames: a.groupNames,
    templateId: a.templateId,
    body: a.body,
    mediaType: a.mediaType,
    mediaName: a.mediaName,
    frequency: a.frequency,
    scheduledAt: a.scheduledAt?.toISOString() || null,
    timeOfDay: a.timeOfDay,
    weekday: a.weekday,
    nextRunAt: a.nextRunAt?.toISOString() || null,
    lastRunAt: a.lastRunAt?.toISOString() || null,
  }
}

function getTemplatePayload(t) {
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    mediaType: t.mediaType,
    mediaBase64: t.mediaBase64,
    mediaMime: t.mediaMime,
    mediaName: t.mediaName,
    updatedAt: t.updatedAt?.toISOString?.() || null,
  }
}

const templateBodySchema = z.object({
  name: z.string().min(1),
  body: z.string().optional(),
  mediaType: z.enum(["none", "image", "video"]).optional(),
  mediaBase64: z.string().optional().nullable(),
  mediaMime: z.string().optional().nullable(),
  mediaName: z.string().optional().nullable(),
})

app.get("/api/messages/templates", authMiddleware, async (req, res) => {
  const rows = await prisma.messageTemplate.findMany({ where: { userId: req.user.sub }, orderBy: { updatedAt: "desc" } })
  res.json({ templates: rows.map(getTemplatePayload) })
})

app.post("/api/messages/templates", authMiddleware, async (req, res) => {
  const parsed = templateBodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da mensagem inválidos." })
  const content = getMessageContent(parsed.data)
  const invalid = validateContent(content)
  if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })
  const tpl = await prisma.messageTemplate.create({
    data: { userId: req.user.sub, name: parsed.data.name, ...content },
  })
  res.status(201).json({ template: getTemplatePayload(tpl) })
})

app.put("/api/messages/templates/:id", authMiddleware, async (req, res) => {
  const parsed = templateBodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da mensagem inválidos." })
  const existing = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })
  const content = getMessageContent(parsed.data)
  const invalid = validateContent(content)
  if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })
  const tpl = await prisma.messageTemplate.update({
    where: { id: existing.id },
    data: { name: parsed.data.name, ...content },
  })
  res.json({ template: getTemplatePayload(tpl) })
})

app.delete("/api/messages/templates/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Mensagem não encontrada." })
  await prisma.messageTemplate.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

app.post("/api/messages/send", authMiddleware, async (req, res) => {
  try {
    const schema = z.object({
      groupIds: z.array(z.string()).min(1),
      templateId: z.string().optional(),
      body: z.string().optional(),
      mediaType: z.enum(["none", "image", "video"]).optional(),
      mediaBase64: z.string().optional().nullable(),
      mediaMime: z.string().optional().nullable(),
      mediaName: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })

    const conn = await getUserWhatsAppConnection(req.user.sub)
    if (!conn.connected) {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: "Conecte o WhatsApp antes de enviar." })
    }

    const content = await resolveContentFromBody(req.user.sub, parsed.data)
    const invalid = validateContent(content)
    if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })

    const results = await dispatchMessage({
      userId: req.user.sub,
      instanceName: conn.instanceName,
      groupJids: parsed.data.groupIds,
      content,
    })
    const sent = results.filter((r) => r.status === "entregue").length
    return res.status(201).json({ results, sent, failed: results.length - sent })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    if (err?.code === "TEMPLATE_NOT_FOUND") {
      return res.status(404).json({ error: "TEMPLATE_NOT_FOUND", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.get("/api/messages/history", authMiddleware, async (req, res) => {
  const rows = await prisma.outboundMessage.findMany({
    where: { userId: req.user.sub },
    orderBy: { sentAt: "desc" },
    take: 100,
  })
  res.json({
    items: rows.map((m) => ({
      id: m.id,
      group: m.groupName,
      body: m.body,
      mediaType: m.mediaType,
      status: m.status === "entregue" ? "entregue" : "falhou",
      error: m.error,
      sentAt: m.sentAt.toISOString(),
    })),
  })
})

app.get("/api/automations", authMiddleware, async (req, res) => {
  const rows = await prisma.automation.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "desc" } })
  res.json({ automations: rows.map(getAutomationPayload) })
})

app.post("/api/automations", authMiddleware, async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      groupIds: z.array(z.string()).min(1),
      templateId: z.string().optional(),
      body: z.string().optional(),
      mediaType: z.enum(["none", "image", "video"]).optional(),
      mediaBase64: z.string().optional().nullable(),
      mediaMime: z.string().optional().nullable(),
      mediaName: z.string().optional().nullable(),
      frequency: z.enum(["now", "once", "daily", "weekly"]),
      scheduledAt: z.string().optional().nullable(),
      timeOfDay: z.string().optional().nullable(),
      weekday: z.number().int().min(0).max(6).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da automação inválidos." })

    const conn = await getUserWhatsAppConnection(req.user.sub)
    const content = await resolveContentFromBody(req.user.sub, parsed.data)
    const invalid = validateContent(content)
    if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })

    const groupNames = []
    for (const jid of parsed.data.groupIds) groupNames.push(await resolveGroupName(req.user.sub, jid))

    const scheduledAt = parsed.data.frequency === "once" ? parseScheduledAt(parsed.data.scheduledAt) : null
    if (parsed.data.frequency === "once" && !scheduledAt) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe data e hora válidas para o agendamento único." })
    }
    if ((parsed.data.frequency === "daily" || parsed.data.frequency === "weekly") && !parsed.data.timeOfDay) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe o horário do disparo." })
    }

    if (parsed.data.frequency === "now") {
      if (!conn.connected) {
        return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: "Conecte o WhatsApp antes de enviar." })
      }
      const created = await prisma.automation.create({
        data: {
          userId: req.user.sub,
          name: parsed.data.name,
          status: "concluida",
          groupJids: parsed.data.groupIds,
          groupNames,
          templateId: parsed.data.templateId || null,
          ...content,
          frequency: "now",
          lastRunAt: new Date(),
        },
      })
      const results = await dispatchMessage({
        userId: req.user.sub,
        instanceName: conn.instanceName,
        groupJids: parsed.data.groupIds,
        content,
        automationId: created.id,
      })
      const sent = results.filter((r) => r.status === "entregue").length
      return res.status(201).json({ automation: getAutomationPayload(created), results, sent, failed: results.length - sent })
    }

    const draft = {
      frequency: parsed.data.frequency,
      scheduledAt,
      timeOfDay: parsed.data.timeOfDay || null,
      weekday: Number.isInteger(parsed.data.weekday) ? parsed.data.weekday : null,
    }
    const nextRunAt = computeNextRun(draft)

    const created = await prisma.automation.create({
      data: {
        userId: req.user.sub,
        name: parsed.data.name,
        status: "ativa",
        groupJids: parsed.data.groupIds,
        groupNames,
        templateId: parsed.data.templateId || null,
        ...content,
        frequency: parsed.data.frequency,
        scheduledAt,
        timeOfDay: draft.timeOfDay,
        weekday: draft.weekday,
        nextRunAt,
      },
    })
    return res.status(201).json({ automation: getAutomationPayload(created) })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    if (err?.code === "TEMPLATE_NOT_FOUND") {
      return res.status(404).json({ error: "TEMPLATE_NOT_FOUND", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.patch("/api/automations/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.automation.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Automação não encontrada." })

  const schema = z.object({ status: z.enum(["ativa", "pausada"]).optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const data = {}
  if (parsed.data.status) {
    data.status = parsed.data.status
    if (parsed.data.status === "ativa" && existing.frequency !== "once") {
      data.nextRunAt = computeNextRun(existing)
    }
  }
  const updated = await prisma.automation.update({ where: { id: existing.id }, data })
  res.json({ automation: getAutomationPayload(updated) })
})

app.delete("/api/automations/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.automation.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Automação não encontrada." })
  await prisma.automation.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

async function processDueAutomations() {
  const now = new Date()
  const due = await prisma.automation.findMany({
    where: { status: "ativa", nextRunAt: { lte: now } },
    take: 20,
  })

  for (const a of due) {
    if (schedulerLock.has(a.id)) continue
    schedulerLock.add(a.id)
    try {
      const next = a.frequency === "once" ? null : computeNextRun(a, new Date(now.getTime() + 60000))
      const newStatus = a.frequency === "once" ? "concluida" : "ativa"
      const claim = await prisma.automation.updateMany({
        where: { id: a.id, status: "ativa", nextRunAt: { lte: now } },
        data: { nextRunAt: next, lastRunAt: now, status: newStatus },
      })
      if (claim.count === 0) continue

      const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: a.userId } })
      if (!conn?.instanceName || !conn.connected) continue

      await dispatchMessage({
        userId: a.userId,
        instanceName: conn.instanceName,
        groupJids: a.groupJids,
        content: getMessageContent(a),
        automationId: a.id,
      })
    } catch (err) {
      console.error("[scheduler]", a.id, err?.message || err)
    } finally {
      schedulerLock.delete(a.id)
    }
  }
}

function toInstanceName(userId) {
  const prefix = process.env.EVOLUTION_INSTANCE_PREFIX || "vesto"
  return `${prefix}-${userId}`.replace(/[^a-zA-Z0-9-_]/g, "")
}

function formatConnectionPayload(conn, groupsCount = 0) {
  return {
    connected: conn?.connected || false,
    qr: conn?.qrCode || null,
    lastSync: conn?.lastSync?.toISOString() || null,
    status: conn?.status || "DISCONNECTED",
    phone: conn?.phone || null,
    instanceName: conn?.instanceName || null,
    sync: getSyncPayload(conn, groupsCount),
    import: getImportPayload(conn),
  }
}

function buildEvolutionWebhookUrl() {
  const explicit = process.env.EVOLUTION_WEBHOOK_URL?.trim()
  if (explicit) return explicit

  const publicUrl = process.env.BACKEND_PUBLIC_URL?.trim()?.replace(/\/+$/, "")
  if (!publicUrl) return undefined

  const base = `${publicUrl}/api/evolution/webhook`
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim()
  return secret ? `${base}?secret=${encodeURIComponent(secret)}` : base
}

function isValidEvolutionWebhook(req) {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim()
  if (!expected) return true
  const received =
    req.query.secret ||
    req.get("x-evolution-secret") ||
    req.get("x-webhook-secret") ||
    req.get("authorization")?.replace(/^Bearer\s+/i, "")
  return received === expected
}

function getWebhookEvent(body) {
  return (body?.event || body?.type || body?.data?.event || "").toString().toUpperCase()
}

function getWebhookInstanceName(body) {
  const candidate =
    body?.data?.instanceName ||
    body?.data?.instance?.instanceName ||
    body?.data?.instance?.name ||
    body?.instanceName ||
    body?.instance ||
    null
  return typeof candidate === "string" ? candidate : null
}

function getWebhookPayload(body) {
  return body?.data || body
}

async function updateConnectionFromWebhook(instanceName, body) {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { instanceName } })
  if (!existing) return null

  const payload = getWebhookPayload(body)
  const connected = pickConnected(payload) || pickConnected(body)
  const qr = (await resolveQrForStorage(payload)) || (await resolveQrForStorage(body)) || existing.qrCode
  const nextStatus = pickStatus(payload) || pickStatus(body)
  const status = nextStatus && nextStatus !== "unknown" ? nextStatus.toUpperCase() : existing.status
  const phone = pickPhone(payload) || pickPhone(body)

  const conn = await prisma.whatsAppConnection.update({
    where: { instanceName },
    data: {
      connected,
      status,
      qrCode: connected ? null : qr,
      phone: phone ? String(phone) : existing.phone,
      lastSync: new Date(),
    },
  })

  io.emit("whatsapp:status", formatConnectionPayload(conn))
  if (conn.qrCode) io.emit("whatsapp:qr", { qr: conn.qrCode })
  return conn
}

async function updateGroupsFromWebhook(instanceName, body) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { instanceName } })
  if (!conn) return 0

  const eventGroups = normalizeEvolutionGroups(getWebhookPayload(body))
    .map((g) => mapEvolutionGroup(g, instanceName))
    .filter((g) => g.groupJid)

  for (const group of eventGroups) {
    await upsertDiscoveredGroup(conn.userId, group, "ativo")
  }

  if (eventGroups.length) {
    const groupsCount = await prisma.whatsAppGroup.count({ where: { userId: conn.userId } })
    const updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: "READY",
      groupSyncProgress: 100,
      groupSyncMessage: `${groupsCount} grupos atualizados por eventos do WhatsApp.`,
      groupSyncError: null,
    })
    io.emit("whatsapp:status", formatConnectionPayload(updatedConn, groupsCount))
  }

  return eventGroups.length
}

/** Mensagens novas (a partir da conexão). Só grava em grupos monitorados; sem histórico antigo. */
async function storeIncomingMessages(instanceName, body) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { instanceName } })
  if (!conn) return 0

  const records = normalizeEvolutionMessages(getWebhookPayload(body))
  if (!records.length) return 0

  let saved = 0
  const touchedGroups = new Map()

  for (const record of records) {
    const groupJid = record?.key?.remoteJid || record?.remoteJid
    if (!groupJid || !String(groupJid).endsWith("@g.us")) continue

    let group = touchedGroups.get(groupJid)
    if (!group) {
      group = await prisma.whatsAppGroup.findUnique({
        where: { userId_groupJid: { userId: conn.userId, groupJid } },
      })
      if (!group || !group.monitoringEnabled) {
        touchedGroups.set(groupJid, null)
        continue
      }
      touchedGroups.set(groupJid, group)
    }
    if (!group) continue

    const mapped = mapEvolutionMessage(record)
    if (!mapped.messageId) continue

    await prisma.whatsAppMessage.upsert({
      where: { groupId_messageId: { groupId: group.id, messageId: mapped.messageId } },
      create: { userId: conn.userId, groupId: group.id, ...mapped },
      update: { body: mapped.body, type: mapped.type, senderName: mapped.senderName, raw: mapped.raw },
    })
    saved += 1

    await prisma.whatsAppGroup.update({
      where: { id: group.id },
      data: {
        lastMessage: mapped.body || group.lastMessage,
        lastMessageAt: mapped.timestamp,
        messagesSyncedCount: { increment: 1 },
        messagesLastSyncAt: new Date(),
      },
    })
  }

  return saved
}

async function upsertConnectionFromEvolution({ userId, instanceName, stateData, qrData }) {
  const connected = pickConnected(stateData)
  let qr =
    (await resolveQrForStorage(qrData)) || (await resolveQrForStorage(stateData))
  const status = pickStatus(stateData).toUpperCase()
  const phone = pickPhone(stateData)

  if (!connected && !qr) {
    const existing = await prisma.whatsAppConnection.findUnique({
      where: { userId },
      select: { qrCode: true },
    })
    qr = existing?.qrCode || null
  }

  const conn = await prisma.whatsAppConnection.upsert({
    where: { userId },
    create: {
      userId,
      instanceName,
      connected,
      status,
      qrCode: connected ? null : qr,
      phone: phone ? String(phone) : null,
      lastSync: new Date(),
    },
    update: {
      instanceName,
      connected,
      status,
      qrCode: connected ? null : qr,
      phone: phone ? String(phone) : null,
      lastSync: new Date(),
    },
  })

  return conn
}

function handleEvolutionError(res, err) {
  if (err?.code === "EVOLUTION_CONFIG_MISSING") {
    return res.status(503).json({
      error: "EVOLUTION_NOT_CONFIGURED",
      message: "Defina EVOLUTION_BASE_URL e EVOLUTION_API_KEY no backend.",
    })
  }
  if (isRateLimitError(err)) {
    return res.status(429).json({
      error: "EVOLUTION_RATE_LIMITED",
      message: "WhatsApp limitou consultas temporariamente. Aguarde alguns minutos antes de tentar de novo.",
      details: err?.details || null,
    })
  }
  console.error("Evolution error:", err?.message || err, err?.details || err?.rawPreview || "")
  return res.status(502).json({
    error: "EVOLUTION_ERROR",
    message: err?.message || "Falha ao comunicar com a Evolution API.",
    details: err?.details || (err?.rawPreview ? { rawPreview: err.rawPreview } : null),
  })
}

app.post("/api/evolution/webhook", async (req, res) => {
  try {
    if (!isValidEvolutionWebhook(req)) {
      return res.status(401).json({ error: "INVALID_WEBHOOK_SECRET" })
    }

    const event = getWebhookEvent(req.body)
    const instanceName = getWebhookInstanceName(req.body)
    if (!instanceName) return res.json({ ok: true, ignored: "missing-instance" })

    if (event === "CONNECTION_UPDATE" || event === "QRCODE_UPDATED") {
      await updateConnectionFromWebhook(instanceName, req.body)
    } else if (["GROUPS_UPSERT", "GROUP_UPDATE", "GROUP_PARTICIPANTS_UPDATE"].includes(event)) {
      await updateGroupsFromWebhook(instanceName, req.body)
    } else if (event === "MESSAGES_UPSERT") {
      await storeIncomingMessages(instanceName, req.body)
    }

    return res.json({ ok: true })
  } catch (err) {
    console.error("[evolution-webhook]", err?.message || err)
    return res.status(200).json({ ok: false })
  }
})

app.get("/api/whatsapp/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub
    const existing = await prisma.whatsAppConnection.findUnique({ where: { userId } })
    if (!existing) return res.json(formatConnectionPayload(null))
    const groupsCount = await prisma.whatsAppGroup.count({ where: { userId } })

    // TTL: se já está conectado e sincronizou há pouco, devolve cache e evita martelar a Evolution.
    const recentlySynced =
      existing.lastSync && Date.now() - existing.lastSync.getTime() < STATUS_REFRESH_MIN_INTERVAL_MS
    if (existing.connected && recentlySynced) {
      return res.json(formatConnectionPayload(existing, groupsCount))
    }

    const stateData = await getConnectionState(existing.instanceName)
    const conn = await upsertConnectionFromEvolution({
      userId,
      instanceName: existing.instanceName,
      stateData,
      qrData: null,
    })

    io.emit("whatsapp:status", formatConnectionPayload(conn, groupsCount))
    return res.json(formatConnectionPayload(conn, groupsCount))
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.post("/api/whatsapp/connect", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub
    const instanceName = toInstanceName(userId)
    const webhook = buildEvolutionWebhookUrl()

    try {
      await createInstance(instanceName, webhook)
    } catch (err) {
      if (!isInstanceAlreadyExistsError(err)) throw err
    }
    if (webhook) {
      await setInstanceWebhook(instanceName, webhook).catch((err) => {
        console.warn("[evolution] Não foi possível atualizar webhook da instância:", err?.message || err)
      })
    }
    const qrData = await connectInstance(instanceName)
    const stateData = await getConnectionState(instanceName)

    const conn = await upsertConnectionFromEvolution({
      userId,
      instanceName,
      stateData,
      qrData,
    })

    io.emit("whatsapp:qr", { qr: conn.qrCode })
    io.emit("whatsapp:status", formatConnectionPayload(conn))
    return res.status(201).json(formatConnectionPayload(conn))
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.post("/api/whatsapp/disconnect", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub
    const existing = await prisma.whatsAppConnection.findUnique({ where: { userId } })
    if (!existing) return res.json(formatConnectionPayload(null))

    await logoutInstance(existing.instanceName)
    const conn = await prisma.whatsAppConnection.update({
      where: { userId },
      data: {
        connected: false,
        status: "DISCONNECTED",
        qrCode: null,
        lastSync: new Date(),
        groupSyncStatus: "IDLE",
        groupSyncProgress: 0,
        groupSyncMessage: null,
        groupSyncError: null,
        groupSyncRetryAfter: null,
        msgImportStatus: "IDLE",
        msgImportTotal: 0,
        msgImportDone: 0,
        msgImportMessage: null,
        msgImportError: null,
        msgImportRetryAfter: null,
      },
    })

    io.emit("whatsapp:status", formatConnectionPayload(conn))
    return res.json(formatConnectionPayload(conn))
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno do servidor." })
})

const port = Number(process.env.PORT || 4000)

httpServer.listen(port, () => {
  void ensureDefaultPlans().catch((err) => console.error("[bootstrap] ensureDefaultPlans:", err?.message || err))
  console.log(`Backend online na porta ${port}`)
  if (ENABLE_SCHEDULER) {
    setInterval(() => {
      processDueAutomations().catch((err) => console.error("[scheduler] tick:", err?.message || err))
    }, 30000)
    console.log("Agendador de automações ativo (tick 30s).")
  }
})

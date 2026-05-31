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
const { v4: uuid } = require("uuid")
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
  logoutInstance,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
} = require("./lib/evolution")
const { groups, scheduledMessages, sentMessages, getAnalyticsSnapshot } = require("./data/mock")
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
app.use(express.json({ limit: "8mb" }))

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

app.get("/api/messages/history", authMiddleware, (_req, res) => {
  res.json({ items: sentMessages.slice(0, 100) })
})

app.get("/api/messages/scheduled", authMiddleware, (_req, res) => {
  res.json({ items: scheduledMessages })
})

app.post("/api/messages/send", authMiddleware, (req, res) => {
  const schema = z.object({
    groupIds: z.array(z.string()).min(1),
    body: z.string().min(1),
    recipients: z.array(z.string()).optional(),
    attachments: z.array(z.any()).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })

  const item = {
    id: uuid(),
    groupIds: parsed.data.groupIds,
    group: groups.find((g) => g.id === parsed.data.groupIds[0])?.name || "Grupo",
    body: parsed.data.body,
    status: "entregue",
    sentAt: new Date().toISOString(),
  }
  sentMessages.unshift(item)
  io.emit("message:sent", item)
  res.status(201).json({ message: item })
})

app.post("/api/messages/schedule", authMiddleware, (req, res) => {
  const schema = z.object({
    groupIds: z.array(z.string()).min(1),
    body: z.string().min(1),
    scheduledAt: z.string(),
    recurrence: z.string().optional(),
    timezone: z.string().optional(),
    retryPolicy: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })

  const row = {
    id: `sch-${uuid()}`,
    groupNames: groups.filter((g) => parsed.data.groupIds.includes(g.id)).map((g) => g.name),
    body: parsed.data.body,
    scheduledAt: parsed.data.scheduledAt,
    recurrence: parsed.data.recurrence || "unico",
    timezone: parsed.data.timezone || "America/Sao_Paulo",
    retryPolicy: parsed.data.retryPolicy || "2x",
    status: "pendente",
  }
  scheduledMessages.unshift(row)
  res.status(201).json({ item: row })
})

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
})

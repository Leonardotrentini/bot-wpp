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
const { isPlausibleWhatsAppGroup, cleanupGhostGroups } = require("./lib/groupDiscovery")
const {
  getGroupLimitsPayload,
  resolveActivationBatch,
  resolveMonitoredGroupJidsForSend,
} = require("./lib/groupLimits")
const { enqueueUserSend } = require("./lib/sendQueue")
const { scheduleParticipantSync } = require("./lib/participantSyncQueue")
const { ensureDefaultPlans } = require("./lib/ensureBillingDefaults")
const { signToken, authMiddleware } = require("./lib/auth")
const {
  createInstance,
  setInstanceWebhook,
  connectInstance,
  getConnectionState,
  fetchAllGroups,
  fetchGroupParticipants,
  findContacts,
  fetchProfile,
  fetchGroupMessages,
  findChats,
  fetchChatMessages,
  sendText,
  sendMedia,
  logoutInstance,
  resolveQrForStorage,
  pickConnected,
  pickStatus,
  pickPhone,
  isInstanceAlreadyExistsError,
} = require("./lib/evolution")
const { buildAnalytics, buildDashboard, buildOverview } = require("./lib/analytics.js")
const {
  loadUnifiedMessages,
  computeGroupOverview,
  retentionRange,
  buildMetricsMeta,
} = require("./lib/messageMetrics")
const {
  normalizeEvolutionMessages,
  collectWebhookMessageRecords,
  filterMessagesForGroup,
  mapEvolutionMessage,
  jidsMatch,
  isReactionRecord,
  extractReactionTargetMessageId,
} = require("./lib/evolutionMessages")
const {
  enqueueX1ForParticipant,
  processPendingX1Deliveries,
  handleGroupParticipantsX1Webhook,
  notifyX1FromParticipantSync,
  getX1Deliveries,
  formatDeliveryRow,
  resolveParticipantMeta,
  normalizeX1Config,
  migrateStoredX1Templates,
  cancelPendingX1DeliveriesForGroups,
  isGroupX1Eligible,
} = require("./lib/groupX1Automation")
const adminRoutes = require("./routes/admin")
const {
  isPublicRegistrationAllowed,
  getCorsOrigin,
  isValidEvolutionWebhook,
  sanitizeClientError,
  logStartupSecurityChecks,
} = require("./lib/security")
const { authRateLimit } = require("./lib/authRateLimit")
const {
  normalizeMentionsInput,
  mergeMentionsFromBody,
  resolveMentionsForGroup,
  buildEvolutionSendOptions,
  isParticipantMentionable,
  resolveMentionPhoneDigits,
} = require("./lib/messageMentions")
const jwt = require("jsonwebtoken")
const { createCrmRouter } = require("./routes/crm")
const {
  isIndividualJid,
  ingestCrmMessage,
  emitCrmEvent,
  formatMessageRow: formatCrmMessageRow,
  formatConversationRow: formatCrmConversationRow,
} = require("./lib/crmCore")
const { scheduleProfileFetch, contactNeedsProfile } = require("./lib/crmProfile")
const { onCrmMessage, processNoReplyFlows } = require("./lib/crmFlows")
const { maybeReplyWithAi } = require("./lib/crmAiAgent")
const { processPendingCrmDeliveries } = require("./lib/crmDelivery")

const GROUP_SYNC_MIN_INTERVAL_MS = Number(process.env.GROUP_SYNC_MIN_INTERVAL_MS || 5 * 60 * 1000)
const GROUP_SYNC_RATE_LIMIT_BACKOFF_MS = Number(process.env.GROUP_SYNC_RATE_LIMIT_BACKOFF_MS || 10 * 60 * 1000)
const PARTICIPANTS_SYNC_MIN_INTERVAL_MS = Number(process.env.PARTICIPANTS_SYNC_MIN_INTERVAL_MS || 15 * 60 * 1000)
const GROUP_SYNC_ITEM_DELAY_MS = Number(process.env.GROUP_SYNC_ITEM_DELAY_MS || 350)
const activeGroupSyncs = new Set()

const {
  MESSAGE_RETENTION_DAYS,
  getRetentionCutoffMs,
  getRetentionCutoffDate,
  pruneUserMessagesBeyondRetention,
} = require("./lib/messageRetention")

// Importação de mensagens: 1 grupo por vez, só os últimos N dias, com pausas para não estourar o WhatsApp.
const MESSAGE_BACKFILL_DAYS = MESSAGE_RETENTION_DAYS
const MESSAGE_SYNC_PAGE_SIZE = Number(process.env.MESSAGE_SYNC_PAGE_SIZE || 50)
const MESSAGE_SYNC_MAX_PAGES = Number(process.env.MESSAGE_SYNC_MAX_PAGES || 10)
const MESSAGE_SYNC_PAGE_DELAY_MS = Number(process.env.MESSAGE_SYNC_PAGE_DELAY_MS || 1500)
const MESSAGE_SYNC_GROUP_DELAY_MS = Number(process.env.MESSAGE_SYNC_GROUP_DELAY_MS || 4000)
const STATUS_REFRESH_MIN_INTERVAL_MS = Number(process.env.STATUS_REFRESH_MIN_INTERVAL_MS || 15000)
const activeMessageImports = new Set()

const app = express()
app.set("trust proxy", 1)
const httpServer = createServer(app)
const corsOrigin = getCorsOrigin()
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
})

// Autentica o socket via JWT e entra na sala do usuário (eventos privados do CRM).
io.on("connection", (socket) => {
  const token = socket.handshake?.auth?.token || null
  if (!token) return
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload?.sub) socket.join(`user:${payload.sub}`)
  } catch {
    /* socket sem sala privada; ainda recebe eventos globais */
  }
})

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  next()
})

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "850mb" }))

app.use("/api/admin", adminRoutes)
app.use("/api/crm", createCrmRouter({ io }))

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, service: "vesto-backend", db: "ok", ts: new Date().toISOString() })
  } catch (err) {
    res.status(503).json({
      ok: false,
      service: "vesto-backend",
      db: "error",
      message: err?.message || "Database unavailable",
      ts: new Date().toISOString(),
    })
  }
})

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  if (!isPublicRegistrationAllowed()) {
    return res.status(403).json({
      error: "REGISTRATION_DISABLED",
      message: "Cadastro público desativado. Peça acesso ao administrador.",
    })
  }
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
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      avatar: user.avatarUrl || null,
      role: user.role,
    },
    token,
  })
})

app.post("/api/auth/login", authRateLimit, async (req, res) => {
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
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      avatar: user.avatarUrl || null,
      role: user.role,
    },
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
      phone: user.phone || "",
      avatar: user.avatarUrl || null,
      role: user.role,
      plan: sub ? { id: sub.plan.id, name: sub.plan.name, slug: sub.plan.slug, maxGroups: sub.plan.maxGroups } : null,
    },
  })
})

app.put("/api/auth/profile", authMiddleware, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(32).optional().nullable(),
    avatar: z.string().max(1_000_000).optional().nullable(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: z.string().min(6).max(128).optional(),
  })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues?.[0]?.message || "Dados inválidos.",
    })
  }

  const payload = parsed.data
  if (!Object.values(payload).some((v) => v !== undefined)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Nenhum campo informado para atualizar." })
  }

  try {
    if (payload.email) {
      const emailInUse = await prisma.user.findFirst({
        where: { email: payload.email, id: { not: req.user.sub } },
        select: { id: true },
      })
      if (emailInUse) {
        return res.status(409).json({ error: "EMAIL_IN_USE", message: "Este e-mail já está em uso." })
      }
    }

    const data = {}
    if (payload.name !== undefined) data.name = payload.name
    if (payload.email !== undefined) data.email = payload.email
    if (payload.phone !== undefined) data.phone = payload.phone || null
    if (payload.avatar !== undefined) data.avatarUrl = payload.avatar || null
    if (payload.newPassword) {
      if (!payload.currentPassword) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Informe a senha atual para definir uma nova senha.",
        })
      }
      const current = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { passwordHash: true },
      })
      const ok = current && (await bcrypt.compare(payload.currentPassword, current.passwordHash))
      if (!ok) {
        return res.status(401).json({ error: "INVALID_PASSWORD", message: "Senha atual incorreta." })
      }
      data.passwordHash = await bcrypt.hash(payload.newPassword, 10)
    }

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data,
      select: { id: true, name: true, email: true, phone: true, avatarUrl: true, role: true },
    })

    return res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone || "",
        avatar: updated.avatarUrl || null,
        role: updated.role,
      },
    })
  } catch (err) {
    console.error("auth profile update:", err)
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Falha ao atualizar perfil." })
  }
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
    activatedAt: group.activatedAt?.toISOString?.() || group.activatedAt || null,
    messageSyncStatus: group.messageSyncStatus || "IDLE",
    messageSyncProgress: group.messageSyncProgress || 0,
    messagesSyncedCount: group.messagesSyncedCount || 0,
    messagesLastSyncAt: group.messagesLastSyncAt?.toISOString?.() || group.messagesLastSyncAt || null,
  }
}

function getParticipantApiPayload(participant, groupName) {
  return {
    id: participant.participantJid,
    name: participant.name || "Sem nome",
    phone: participant.phone || "—",
    role: participant.role,
    status: participant.status,
    tags: participant.role === "admin" || participant.role === "superadmin" ? ["admin"] : [],
    groups: groupName ? [groupName] : [],
    lastActivity: participant.lastSyncedAt?.toISOString?.() || new Date().toISOString(),
    avatar: fallbackGroupImage(participant.name || participant.phone || participant.participantJid),
  }
}

function participantTags(participant) {
  const tags = []
  if (participant.role === "admin" || participant.role === "superadmin") tags.push("admin")
  return tags
}

function mergeGlobalMember(map, participant, groupApi) {
  const key = participant.participantJid || participant.phone || participant.id
  if (!key) return
  const lastAt = participant.lastSyncedAt?.toISOString?.() || new Date().toISOString()
  const isLid = jidDomain(participant.participantJid) === "lid"
  const phoneDigits = resolveMentionPhoneDigits(participant)
  const mentionable = isParticipantMentionable(participant)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, {
      id: key,
      name: participant.name || participant.phone || "Participante",
      phone: participant.phone || "—",
      phoneDigits: phoneDigits || undefined,
      mentionable,
      isLid,
      role: participant.role,
      status: participant.status || "ativo",
      tags: participantTags(participant),
      groups: [groupApi.name],
      groupIds: [groupApi.id],
      lastActivity: lastAt,
      avatar: fallbackGroupImage(participant.name || participant.phone || key),
    })
    return
  }
  if (!existing.groupIds.includes(groupApi.id)) {
    existing.groupIds.push(groupApi.id)
    existing.groups.push(groupApi.name)
  }
  const betterName = participant.name || existing.name
  if (betterName && betterName !== existing.name && !String(betterName).includes("número oculto")) {
    existing.name = betterName
  }
  if (participant.phone && participant.phone !== "—" && existing.phone === "—") {
    existing.phone = participant.phone
  }
  if (phoneDigits && !existing.phoneDigits) existing.phoneDigits = phoneDigits
  existing.isLid = isLid || existing.isLid
  existing.mentionable = isParticipantMentionable({
    ...participant,
    phone: existing.phone !== "—" ? existing.phone : participant.phone,
  })
  if (new Date(lastAt).getTime() > new Date(existing.lastActivity).getTime()) {
    existing.lastActivity = lastAt
  }
  if (participant.role === "admin" || participant.role === "superadmin") {
    if (!existing.tags.includes("admin")) existing.tags.push("admin")
  }
}

async function loadSenderNamesFromGroupMessages(groupId) {
  const rows = await prisma.whatsAppMessage.findMany({
    where: {
      groupId,
      fromMe: false,
      senderName: { not: null },
      NOT: { senderName: "" },
    },
    select: { senderJid: true, senderName: true },
    orderBy: { timestamp: "desc" },
    take: 8000,
  })
  const byJid = new Map()
  for (const row of rows) {
    const n = String(row.senderName || "").trim()
    if (!n || n === "Você") continue
    if (row.senderJid && !byJid.has(row.senderJid)) byJid.set(row.senderJid, n)
    const pd = phoneDigitsFromJid(row.senderJid)
    if (pd && !byJid.has(`digits:${pd}`)) byJid.set(`digits:${pd}`, n)
  }
  return byJid
}

function applyMessageDisplayName(participant, messageNames) {
  if (!messageNames?.size || hasRealDisplayName(participant)) return participant
  const fromMsg =
    messageNames.get(participant.participantJid) ||
    (participant.phoneDigits ? messageNames.get(`digits:${participant.phoneDigits}`) : null)
  if (!fromMsg || digitsOnly(fromMsg) === participant.phoneDigits) return participant
  return { ...participant, name: fromMsg }
}

async function enrichParticipantsWithNames(conn, groupRow, mapped) {
  let contactIndex = null
  try {
    const contactsPayload = await findContacts(conn.instanceName, {})
    contactIndex = buildContactIndex(normalizeContactList(contactsPayload))
  } catch (err) {
    console.warn("[members] findContacts:", err?.message || err)
  }

  const messageNames = await loadSenderNamesFromGroupMessages(groupRow.id)

  const enriched = []
  let profileLookups = 0
  const PROFILE_LOOKUP_MAX = 40

  for (let p of mapped) {
    const hit = lookupContact(contactIndex, p)
    if (hit) p = enrichParticipantFromContact(p, hit)

    p = applyMessageDisplayName(p, messageNames)

    if (!hasRealDisplayName(p) && p.phoneDigits && profileLookups < PROFILE_LOOKUP_MAX) {
      try {
        const profile = await fetchProfile(conn.instanceName, p.phoneDigits)
        const profileName = displayNameFromParticipant(profile?.profile || profile, p.phoneDigits)
        if (profileName) p = { ...p, name: profileName }
        profileLookups += 1
        await wait(250)
      } catch {
        /* ignore profile errors */
      }
    }

    p = { ...p, name: finalizeParticipantName(p) }
    enriched.push(p)
  }

  return enriched
}

async function syncParticipantsForGroupRow(conn, groupRow) {
  const participantsPayload = await fetchGroupParticipants(conn.instanceName, groupRow.groupJid)
  const mapped = normalizeEvolutionParticipants(participantsPayload, groupRow.raw).map(mapEvolutionParticipant)
  const enriched = await enrichParticipantsWithNames(conn, groupRow, mapped)

  const currentJids = new Set(enriched.map((p) => p.participantJid))
  const now = new Date()

  const existingRows = await prisma.whatsAppGroupParticipant.findMany({
    where: { groupId: groupRow.id },
    select: { participantJid: true, status: true, name: true, phone: true, raw: true },
  })
  const existingByJid = new Map(existingRows.map((r) => [r.participantJid, r]))

  const joinedForX1 = []
  const leftForX1 = []

  for (const participant of enriched) {
    const prev = existingByJid.get(participant.participantJid)
    const isNewJoin = !prev || prev.status === "saiu"
    const prevStatus = prev?.status
    const status = prevStatus === "inativo" ? "inativo" : "ativo"
    const data = {
      name: finalizeParticipantName(participant),
      phone: participant.phone,
      role: participant.role,
      status,
      leftAt: null,
      raw: serializeJson(participant.raw),
      lastSyncedAt: now,
    }
    await prisma.whatsAppGroupParticipant.upsert({
      where: { groupId_participantJid: { groupId: groupRow.id, participantJid: participant.participantJid } },
      create: { groupId: groupRow.id, participantJid: participant.participantJid, ...data },
      update: data,
    })
    if (isNewJoin && status === "ativo") {
      joinedForX1.push({
        participantJid: participant.participantJid,
        name: data.name,
        phoneDigits: participant.phoneDigits,
        isLid: participant.isLid,
      })
    }
  }

  if (currentJids.size > 0) {
    const stale = await prisma.whatsAppGroupParticipant.findMany({
      where: { groupId: groupRow.id, participantJid: { notIn: [...currentJids] }, status: { not: "saiu" } },
      select: { id: true, participantJid: true, name: true, phone: true, raw: true },
    })
    if (stale.length) {
      await prisma.whatsAppGroupParticipant.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: "saiu", leftAt: now, lastSyncedAt: now },
      })
      for (const s of stale) {
        const meta = resolveParticipantMeta(s.participantJid, s.raw, s)
        leftForX1.push({
          participantJid: s.participantJid,
          name: s.name || meta.participantName,
          phoneDigits: meta.phoneDigits,
          isLid: meta.isLid || participantIsLidSafe(s.participantJid),
        })
      }
    }
  }

  await prisma.whatsAppGroup.update({
    where: { id: groupRow.id },
    data: {
      memberCount: enriched.length || groupRow.memberCount,
      participantsSyncedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  })

  const freshGroupRow = await prisma.whatsAppGroup.findUnique({ where: { id: groupRow.id } })
  if (freshGroupRow && isGroupX1Eligible(freshGroupRow) && (joinedForX1.length || leftForX1.length)) {
    void notifyX1FromParticipantSync(getX1Deps(), {
      conn,
      groupRow: freshGroupRow,
      joined: joinedForX1,
      left: leftForX1,
    }).catch((err) => console.error("[x1] sync notify:", err?.message || err))
  }

  return enriched.length
}

function participantIsLidSafe(jid) {
  const domain = String(jid || "").split("@")[1]?.toLowerCase()
  return domain === "lid"
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

const {
  mapEvolutionParticipant,
  enrichParticipantFromContact,
  normalizeContactList,
  buildContactIndex,
  hasRealDisplayName,
  finalizeParticipantName,
  lookupContact,
  displayNameFromParticipant,
  phoneDigitsFromJid,
  digitsOnly,
  jidDomain,
} = require("./lib/participantIdentity.js")

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
  return rows.filter((row) => row.monitoringEnabled || isPlausibleWhatsAppGroup(row)).map(getGroupApiPayload)
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

/** Descoberta/webhook: grava metadados plausíveis; status só muda via /groups/status ou activateGroupsForMonitoring. */
async function upsertDiscoveredGroup(userId, group) {
  const existing = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId, groupJid: group.groupJid } },
  })

  if (existing?.status === "inativo" && !existing.monitoringEnabled) {
    return existing
  }

  const plausible = isPlausibleWhatsAppGroup(group) || Boolean(existing?.monitoringEnabled)
  if (!plausible) return existing || null

  const now = new Date()
  return prisma.whatsAppGroup.upsert({
    where: { userId_groupJid: { userId, groupJid: group.groupJid } },
    create: {
      ...getGroupCreateData(userId, group, "pendente"),
      lastSyncedAt: now,
    },
    update: {
      ...getGroupUpdateData(group),
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
    const allMapped = normalizeEvolutionGroups(payload)
      .map((g) => mapEvolutionGroup(g, conn.instanceName))
      .filter((g) => g.groupJid)
    const realGroups = allMapped.filter((g) => isPlausibleWhatsAppGroup(g))
    const skippedGhosts = allMapped.length - realGroups.length

    updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: "DISCOVERING_GROUPS",
      groupSyncProgress: realGroups.length ? 65 : 100,
      groupSyncMessage: realGroups.length
        ? `${realGroups.length} grupos encontrados${skippedGhosts ? ` (${skippedGhosts} entradas inválidas ignoradas)` : ""}. Preparando para sincronizar em etapas.`
        : skippedGhosts
          ? `${skippedGhosts} entradas inválidas ignoradas; nenhum grupo real encontrado.`
          : "Nenhum grupo foi retornado pelo WhatsApp.",
      groupSyncError: null,
    })

    for (const [index, group] of realGroups.entries()) {
      await upsertDiscoveredGroup(conn.userId, group)

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
        where: { userId: conn.userId, groupJid: { notIn: realGroups.map((g) => g.groupJid) }, monitoringEnabled: false },
        data: { status: "inativo", lastSyncedAt: now },
      })
    }

    const cleanedGhosts = await cleanupGhostGroups(prisma, conn.userId)

    updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: realGroups.length ? "GROUPS_FOUND" : "READY",
      groupSyncProgress: 100,
      groupSyncMessage: realGroups.length
        ? `${realGroups.length} grupos encontrados${skippedGhosts ? ` · ${skippedGhosts} fantasma(s) ignorado(s)` : ""}${cleanedGhosts ? ` · ${cleanedGhosts} limpo(s)` : ""}. Selecione e marque como ativo para monitorar.`
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
  let inbound = 0
  let lastMessage = null
  let lastMessageAt = null

  const filtered = filterMessagesForGroup(records, group.groupJid)
  let inWindowCount = 0

  for (const record of filtered) {
    const mapped = mapEvolutionMessage(record)
    if (!mapped.messageId) continue
    if (!mapped.timestamp || Number.isNaN(mapped.timestamp.getTime())) continue

    const ts = mapped.timestamp.getTime()
    if (cutoffMs && ts < cutoffMs) continue

    inWindowCount += 1

    await prisma.whatsAppMessage.upsert({
      where: { groupId_messageId: { groupId: group.id, messageId: mapped.messageId } },
      create: { userId: group.userId, groupId: group.id, ...mapped },
      update: {
        body: mapped.body,
        type: mapped.type,
        fromMe: mapped.fromMe,
        senderJid: mapped.senderJid,
        senderName: mapped.senderName,
        raw: mapped.raw,
      },
    })
    saved += 1
    if (!mapped.fromMe) inbound += 1

    if (!lastMessageAt || ts > lastMessageAt.getTime()) {
      lastMessageAt = mapped.timestamp
      lastMessage = mapped.body || group.lastMessage
    }
  }

  const allBelowCutoff = filtered.length > 0 && inWindowCount === 0
  return { saved, inbound, allBelowCutoff, lastMessage, lastMessageAt }
}

async function importGroupMessages(conn, group, cutoffMs) {
  await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: { messageSyncStatus: "SYNCING", messageSyncProgress: 5 },
  })

  let totalSaved = 0
  let inboundSaved = 0
  let evolutionRecords = 0
  let latestMessage = null
  let latestAt = null

  for (let page = 1; page <= MESSAGE_SYNC_MAX_PAGES; page += 1) {
    const { records, source } = await fetchGroupMessages(conn.instanceName, group.groupJid, {
      page,
      pageSize: MESSAGE_SYNC_PAGE_SIZE,
      cutoffMs,
    })
    evolutionRecords += records.length
    if (!records.length) break

    const { saved, allBelowCutoff, lastMessage, lastMessageAt, inbound } = await storeGroupMessages(group, records, {
      cutoffMs,
    })
    totalSaved += saved
    inboundSaved += inbound
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

    if (allBelowCutoff || records.length < MESSAGE_SYNC_PAGE_SIZE) break
    if (page < MESSAGE_SYNC_MAX_PAGES) await wait(MESSAGE_SYNC_PAGE_DELAY_MS)
  }

  await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: {
      messageSyncStatus: "READY",
      messageSyncProgress: 100,
      messagesSyncedCount: totalSaved,
      messagesLastSyncAt: new Date(),
      ...(latestMessage ? { lastMessage: latestMessage } : {}),
      ...(latestAt ? { lastMessageAt: latestAt } : {}),
    },
  })

  if (evolutionRecords === 0) {
    console.warn(`[msg-import] grupo ${group.groupJid}: Evolution retornou 0 mensagens no banco dela.`)
  } else if (totalSaved > 0 && inboundSaved === 0) {
    console.warn(
      `[msg-import] grupo ${group.groupJid}: ${totalSaved} salvas, 0 de membros (${evolutionRecords} na Evolution).`,
    )
  }

  return { totalSaved, inboundSaved, evolutionRecords }
}

/** Sincroniza participantes dos grupos ativos (entrada/saída). */
async function syncParticipantsForActiveGroups(userId, groupJids = null) {
  const conn = await getUserWhatsAppConnection(userId)
  if (!conn?.connected) return { synced: 0, failed: 0 }

  const where = { userId, status: "ativo", monitoringEnabled: true }
  if (groupJids?.length) where.groupJid = { in: groupJids }

  const rows = await prisma.whatsAppGroup.findMany({ where, orderBy: { name: "asc" } })
  let synced = 0
  let failed = 0
  for (const [index, row] of rows.entries()) {
    try {
      await syncParticipantsForGroupRow(conn, row)
      synced++
    } catch (err) {
      failed++
      if (isRateLimitError(err)) {
        console.warn("[participants-sync] rate limit em", row.groupJid)
        break
      }
      console.warn("[participants-sync]", row.groupJid, err?.message || err)
    }
    if (index < rows.length - 1 && GROUP_SYNC_ITEM_DELAY_MS > 0) {
      await wait(GROUP_SYNC_ITEM_DELAY_MS)
    }
  }
  return { synced, failed }
}

function buildActivationMessage({ activated, batch }) {
  if (!activated) {
    return batch?.partial
      ? `Limite de ${batch.limit} grupos atingido. Nenhum grupo novo foi ativado.`
      : "Nenhum grupo foi ativado."
  }
  if (batch?.partial && batch.skipped > 0) {
    return `${activated} grupo(s) ativo(s). ${batch.skipped} não ativado(s) — limite de ${batch.limit} grupos monitorados por número.`
  }
  if (batch?.unknown > 0) {
    return `${activated} grupo(s) ativo(s). ${batch.unknown} ID(s) ignorado(s) (não encontrados no cache).`
  }
  return `${activated} grupo(s) ativo(s). Métricas e mensagens a partir de agora.`
}

/** Ativa monitoramento em tempo real (sem backup de mensagens antigas). */
async function activateGroupsForMonitoring(userId, groupJids) {
  const batch = await resolveActivationBatch(userId, groupJids)
  const unique = batch.jids
  if (!unique.length) return { activated: 0, batch }

  const monitoredBefore = await prisma.whatsAppGroup.findMany({
    where: { userId, groupJid: { in: unique }, monitoringEnabled: true, status: "ativo" },
    select: { groupJid: true },
  })
  const monitoredBeforeSet = new Set(monitoredBefore.map((g) => g.groupJid))

  const now = new Date()
  const rows = await prisma.whatsAppGroup.findMany({
    where: { userId, groupJid: { in: unique } },
    select: { id: true, groupJid: true, activatedAt: true },
  })

  for (const row of rows) {
    await prisma.whatsAppGroup.update({
      where: { id: row.id },
      data: {
        monitoringEnabled: true,
        status: "ativo",
        messageSyncStatus: "READY",
        messageSyncProgress: 100,
        activatedAt: row.activatedAt || now,
      },
    })
  }

  const newlyActivated = unique.filter((jid) => !monitoredBeforeSet.has(jid))
  if (newlyActivated.length) {
    scheduleParticipantSync(userId, newlyActivated, async (groupJid) => {
      const conn = await getUserWhatsAppConnection(userId)
      if (!conn?.connected) return
      const groupRow = await prisma.whatsAppGroup.findUnique({
        where: { userId_groupJid: { userId, groupJid } },
      })
      if (groupRow) await syncParticipantsForGroupRow(conn, groupRow)
    })
  }

  return { activated: rows.length, batch }
}

async function runMessageImport(userId, { onlyGroupJids } = {}) {
  if (activeMessageImports.has(userId)) return
  activeMessageImports.add(userId)
  try {
    const conn = await getUserWhatsAppConnection(userId)
    const groupWhere = { userId, monitoringEnabled: true }
    if (onlyGroupJids?.length) groupWhere.groupJid = { in: onlyGroupJids }
    const monitoredGroups = await prisma.whatsAppGroup.findMany({
      where: groupWhere,
      orderBy: { name: "asc" },
    })
    const total = monitoredGroups.length
    const cutoffMs = getRetentionCutoffMs()

    await pruneUserMessagesBeyondRetention(userId).catch((err) => {
      console.warn("[msg-import] prune:", err?.message || err)
    })

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

    let importSavedTotal = 0
    let importInboundTotal = 0
    let importEvolutionTotal = 0

    for (const [index, group] of monitoredGroups.entries()) {
      try {
        const result = await importGroupMessages(conn, group, cutoffMs)
        importSavedTotal += result.totalSaved
        importInboundTotal += result.inboundSaved
        importEvolutionTotal += result.evolutionRecords
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

    await pruneUserMessagesBeyondRetention(userId).catch(() => {})

    let finalMessage
    if (importEvolutionTotal === 0) {
      finalMessage =
        `Importação concluída, mas a Evolution não tinha mensagens salvas (0 no banco dela). ` +
        `Mensagens novas entram pelo webhook com o WhatsApp conectado. Confira EVOLUTION_WEBHOOK_URL no Railway.`
    } else if (importSavedTotal === 0) {
      finalMessage = `Evolution retornou ${importEvolutionTotal} mensagem(ns), mas nenhuma ficou nos últimos ${MESSAGE_BACKFILL_DAYS} dias.`
    } else if (importInboundTotal === 0) {
      finalMessage =
        `${importSavedTotal} mensagem(ns) importadas, porém nenhuma de outros membros (só suas). ` +
        `A Evolution pode não ter histórico de terceiros nesta instância.`
    } else {
      finalMessage =
        `${importSavedTotal} mensagens importadas (${importInboundTotal} de membros). ` +
        `Novas mensagens chegam por webhook.`
    }

    await updateConnectionSync(userId, {
      msgImportStatus: "READY",
      msgImportDone: total,
      msgImportMessage: finalMessage,
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
    await cleanupGhostGroups(prisma, req.user.sub)
    const cachedGroups = await readCachedGroups(req.user.sub)
    const limits = await getGroupLimitsPayload(req.user.sub)
    res.json({
      groups: cachedGroups,
      sync: getSyncPayload(conn, cachedGroups.length),
      import: getImportPayload(conn),
      limits,
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
        message: "Conecte o WhatsApp antes de ativar grupos.",
      })
    }

    const { groupIds } = parsed.data
    const { activated, batch } = await activateGroupsForMonitoring(req.user.sub, groupIds)
    const cachedGroups = await readCachedGroups(req.user.sub)
    const limits = await getGroupLimitsPayload(req.user.sub)
    return res.json({
      groups: cachedGroups,
      import: getImportPayload(conn),
      limits,
      message: buildActivationMessage({ activated, batch }),
      meta: batch?.partial ? { skipped: batch.skipped, limit: batch.limit } : undefined,
    })
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
    let activationResult = null
    if (status === "ativo") {
      if (!conn.connected) {
        return res.status(409).json({
          error: "WHATSAPP_NOT_CONNECTED",
          message: "Conecte o WhatsApp antes de ativar grupos.",
        })
      }
      activationResult = await activateGroupsForMonitoring(req.user.sub, groupIds)
    } else {
      const data =
        status === "inativo"
          ? { status: "inativo", monitoringEnabled: false }
          : { status: "pendente", monitoringEnabled: false }
      await prisma.whatsAppGroup.updateMany({
        where: { userId: req.user.sub, groupJid: { in: groupIds } },
        data,
      })
      await cancelPendingX1DeliveriesForGroups(prisma, req.user.sub, groupIds)
    }

    const cachedGroups = await readCachedGroups(req.user.sub)
    const limits = await getGroupLimitsPayload(req.user.sub)
    const message =
      status === "ativo"
        ? buildActivationMessage({
            activated: activationResult?.activated ?? groupIds.length,
            batch: activationResult?.batch,
          })
        : undefined
    return res.json({
      groups: cachedGroups,
      sync: getSyncPayload(conn, cachedGroups.length),
      import: getImportPayload(conn),
      limits,
      message,
      meta:
        activationResult?.batch?.partial
          ? { skipped: activationResult.batch.skipped, limit: activationResult.batch.limit }
          : undefined,
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
    const retentionStart = getRetentionCutoffDate()
    const rows = await prisma.whatsAppMessage.findMany({
      where: { groupId: group.id, timestamp: { gte: retentionStart } },
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
    const schema = z.object({ groupIds: z.array(z.string()).optional() })
    const parsed = schema.safeParse(req.body || {})
    const requestedGroupIds = parsed.success && parsed.data.groupIds?.length ? parsed.data.groupIds : null

    const conn = await getUserWhatsAppConnection(req.user.sub)
    const cachedGroups = await readCachedGroups(req.user.sub)

    if (!conn.connected) {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "Conecte o WhatsApp antes de sincronizar.",
        groups: cachedGroups,
      })
    }

    const { synced, failed } = await syncParticipantsForActiveGroups(req.user.sub, requestedGroupIds)

    return res.json({
      groups: await readCachedGroups(req.user.sub),
      message: `Participantes atualizados em ${synced} grupo(s).${failed ? ` ${failed} falha(s).` : ""}`,
      participants: { synced, failed },
    })
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

    let participantRows = groupRow.participants
    const needsParticipantSync =
      !groupRow.participantsSyncedAt ||
      Date.now() - groupRow.participantsSyncedAt.getTime() > PARTICIPANTS_SYNC_MIN_INTERVAL_MS

    if (
      needsParticipantSync &&
      isGroupX1Eligible(groupRow) &&
      (!conn.groupSyncRetryAfter || conn.groupSyncRetryAfter <= new Date())
    ) {
      void syncParticipantsForGroupRow(conn, groupRow).catch((err) => {
        if (isRateLimitError(err)) {
          return updateConnectionSync(conn.userId, {
            groupSyncStatus: "RATE_LIMITED",
            groupSyncMessage: "WhatsApp limitou consultas de participantes. Mostrando cache salvo.",
            groupSyncError: err?.message || "rate-overlimit",
            groupSyncRetryAfter: new Date(Date.now() + GROUP_SYNC_RATE_LIMIT_BACKOFF_MS),
          })
        }
        console.error(`[groups/${groupJid}] sync participantes:`, err?.message || err)
      })
    }

    const groupBase = getGroupApiPayload(groupRow)

    let contactIndex = null
    try {
      const contactsPayload = await findContacts(conn.instanceName, {})
      contactIndex = buildContactIndex(normalizeContactList(contactsPayload))
    } catch (err) {
      console.warn("[groups] findContacts:", err?.message || err)
    }
    const messageNames = await loadSenderNamesFromGroupMessages(groupRow.id)

    const members = participantRows.map((p) => {
      let mapped = p.raw
        ? mapEvolutionParticipant(p.raw)
        : mapEvolutionParticipant({ id: p.participantJid, admin: p.role === "admin" ? "admin" : p.role === "superadmin" ? "superadmin" : null })
      mapped.role =
        p.role === "superadmin" ? "superadmin" : p.role === "admin" ? "admin" : mapped.role || "membro"
      mapped.status =
        p.status === "inativo" ? "inativo" : p.status === "saiu" ? "saiu" : p.status === "ativo" ? "ativo" : "ativo"

      const hit = lookupContact(contactIndex, mapped)
      if (hit) mapped = enrichParticipantFromContact(mapped, hit)
      mapped = applyMessageDisplayName(mapped, messageNames)
      mapped.name = finalizeParticipantName(mapped)

      if (hasRealDisplayName({ name: p.name, phoneDigits: mapped.phoneDigits }) && !hasRealDisplayName(mapped)) {
        mapped.name = p.name
        if (p.phone && p.phone !== "—") mapped.phone = p.phone
      }

      return getParticipantApiPayload(
        {
          participantJid: p.participantJid,
          name: mapped.name,
          phone: mapped.phone,
          role: mapped.role,
          status: mapped.status,
          lastSyncedAt: p.lastSyncedAt,
        },
        groupBase.name,
      )
    })

    const now = new Date()
    const { start, end, retentionDays } = retentionRange(now)
    const { messages } = await loadUnifiedMessages(req.user.sub, [groupRow], start, end)
    const overview = computeGroupOverview(messages, groupRow.id, start, end)
    const activeCount = groupRow.participants.filter((p) => p.status === "ativo").length
    const group = {
      ...groupBase,
      messagesPerDay: overview.messagesPerDay,
      peakHour: overview.peakHour,
      activeMembers: activeCount || groupRow.memberCount,
    }

    res.json({
      group,
      members,
      activity: overview.activity,
      settings: groupRow.groupSettings || null,
      config: {
        governance: groupRow.groupGovernance || null,
        statusRules: groupRow.groupStatusRules || null,
        routines: groupRow.groupRoutines || null,
        x1Automation: groupRow.groupX1Automation ? normalizeX1Config(groupRow.groupX1Automation) : null,
        auditLog: groupRow.groupAuditLog || null,
        snapshots: groupRow.groupSnapshots || null,
        catalogExtras: groupRow.groupCatalogExtras || null,
      },
      meta: { messageRetentionDays: retentionDays },
    })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.put("/api/groups/:id/config", authMiddleware, async (req, res) => {
  try {
    const groupJid = decodeURIComponent(req.params.id)
    const jsonRecord = () => z.record(z.string(), z.unknown())
    const schema = z
      .object({
        settings: jsonRecord().optional(),
        governance: jsonRecord().optional(),
        statusRules: jsonRecord().optional(),
        routines: z.array(z.unknown()).optional(),
        x1Automation: jsonRecord().optional(),
        auditLog: z.array(z.unknown()).optional(),
        snapshots: z.array(z.unknown()).optional(),
        catalogExtras: z.array(z.unknown()).optional(),
      })
      .refine((val) => Object.values(val).some((x) => x !== undefined), {
        message: "Informe ao menos uma seção para salvar.",
      })

    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues?.[0]?.message || "Payload inválido.",
      })
    }

    const data = {}
    if (parsed.data.settings !== undefined) data.groupSettings = parsed.data.settings
    if (parsed.data.governance !== undefined) data.groupGovernance = parsed.data.governance
    if (parsed.data.statusRules !== undefined) data.groupStatusRules = parsed.data.statusRules
    if (parsed.data.routines !== undefined) data.groupRoutines = parsed.data.routines
    if (parsed.data.x1Automation !== undefined) data.groupX1Automation = normalizeX1Config(parsed.data.x1Automation)
    if (parsed.data.auditLog !== undefined) data.groupAuditLog = parsed.data.auditLog
    if (parsed.data.snapshots !== undefined) data.groupSnapshots = parsed.data.snapshots
    if (parsed.data.catalogExtras !== undefined) data.groupCatalogExtras = parsed.data.catalogExtras

    const row = await prisma.whatsAppGroup.update({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
      data,
      select: {
        groupSettings: true,
        groupGovernance: true,
        groupStatusRules: true,
        groupRoutines: true,
        groupX1Automation: true,
        groupAuditLog: true,
        groupSnapshots: true,
        groupCatalogExtras: true,
      },
    })

    return res.json({
      ok: true,
      settings: row.groupSettings || null,
      config: {
        governance: row.groupGovernance || null,
        statusRules: row.groupStatusRules || null,
        routines: row.groupRoutines || null,
        x1Automation: row.groupX1Automation ? normalizeX1Config(row.groupX1Automation) : null,
        auditLog: row.groupAuditLog || null,
        snapshots: row.groupSnapshots || null,
        catalogExtras: row.groupCatalogExtras || null,
      },
    })
  } catch (err) {
    if (err?.code?.startsWith?.("P")) {
      console.error("group config save:", err)
      return res.status(500).json({
        error: "DATABASE_ERROR",
        message: "Não foi possível salvar as configurações do grupo. Verifique se a base de dados está atualizada.",
      })
    }
    console.error("group config save:", err)
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: err?.message || "Falha ao salvar configurações do grupo.",
    })
  }
})

app.get("/api/groups/:id/x1/deliveries", authMiddleware, async (req, res) => {
  try {
    const groupJid = decodeURIComponent(req.params.id)
    const groupRow = await prisma.whatsAppGroup.findUnique({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
      select: { id: true },
    })
    if (!groupRow) return res.status(404).json({ error: "NOT_FOUND", message: "Grupo não encontrado." })

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
    const rows = await getX1Deliveries(prisma, req.user.sub, groupRow.id, { limit })
    return res.json({ deliveries: rows.map(formatDeliveryRow) })
  } catch (err) {
    console.error("x1 deliveries:", err)
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Falha ao carregar histórico X1." })
  }
})

app.post("/api/groups/:id/x1/test", authMiddleware, async (req, res) => {
  try {
    const groupJid = decodeURIComponent(req.params.id)
    const schema = z.object({
      kind: z.enum(["join", "leave"]),
      participantJid: z.string().min(3),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues?.[0]?.message || "Informe kind e participantJid.",
      })
    }

    const groupRow = await prisma.whatsAppGroup.findUnique({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
    })
    if (!groupRow) return res.status(404).json({ error: "NOT_FOUND", message: "Grupo não encontrado." })

    const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: req.user.sub } })
    if (!conn?.connected) {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: "Conecte o WhatsApp antes de testar o X1." })
    }

    const participant = await prisma.whatsAppGroupParticipant.findUnique({
      where: {
        groupId_participantJid: { groupId: groupRow.id, participantJid: parsed.data.participantJid },
      },
      select: { participantJid: true, name: true, phone: true, raw: true },
    })
    if (!participant) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Participante não encontrado neste grupo." })
    }

    const meta = resolveParticipantMeta(participant.participantJid, participant.raw, participant)
    const result = await enqueueX1ForParticipant(getX1Deps(), {
      userId: req.user.sub,
      groupRow,
      participantJid: participant.participantJid,
      participantName: meta.participantName,
      phoneDigits: meta.phoneDigits,
      isLid: meta.isLid,
      kind: parsed.data.kind,
      source: "test",
      skipDelay: true,
      force: true,
    })

    if (result.delivery?.status === "failed" || result.delivery?.status === "skipped") {
      return res.status(422).json({
        ok: false,
        reason: result.reason,
        delivery: formatDeliveryRow(result.delivery),
      })
    }

    if (result.ok && result.delivery) {
      await processPendingX1Deliveries(getX1Deps())
      const fresh = await prisma.groupX1Delivery.findUnique({ where: { id: result.delivery.id } })
      return res.json({ ok: true, delivery: formatDeliveryRow(fresh || result.delivery) })
    }

    return res.status(400).json({
      ok: false,
      reason: result.reason || "UNKNOWN",
      message: "Não foi possível enfileirar o teste X1.",
    })
  } catch (err) {
    console.error("x1 test:", err)
    return handleEvolutionError(res, err)
  }
})

app.get("/api/members", authMiddleware, async (req, res) => {
  try {
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId.trim() : ""
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : ""
    const status = typeof req.query.status === "string" ? req.query.status.trim() : ""
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : ""
    const inactiveDays = req.query.inactiveDays ? Number(req.query.inactiveDays) : 0
    const activeGroupsOnly = req.query.activeGroupsOnly === "true" || req.query.activeGroupsOnly === "1"

    const groupWhere = { userId: req.user.sub }
    if (groupId) groupWhere.groupJid = groupId

    const groupRows = await prisma.whatsAppGroup.findMany({
      where: groupWhere,
      include: { participants: true },
      orderBy: { name: "asc" },
    })

    const map = new Map()
    for (const row of groupRows) {
      const groupApi = getGroupApiPayload(row)
      if (activeGroupsOnly && groupApi.status !== "ativo") continue
      for (const p of row.participants) {
        mergeGlobalMember(map, p, groupApi)
      }
    }

    let members = [...map.values()]

    if (activeGroupsOnly) {
      const activeIds = new Set(
        (await prisma.whatsAppGroup.findMany({ where: { userId: req.user.sub, status: "ativo" }, select: { groupJid: true } })).map(
          (g) => g.groupJid,
        ),
      )
      members = members
        .map((m) => {
          const pairs = m.groupIds.map((id, i) => ({ id, name: m.groups[i] })).filter((p) => activeIds.has(p.id))
          return {
            ...m,
            groupIds: pairs.map((p) => p.id),
            groups: pairs.map((p) => p.name),
          }
        })
        .filter((m) => m.groupIds.length > 0)
    }

    if (groupId) {
      members = members.filter((m) => m.groupIds.includes(groupId))
    }
    if (status) members = members.filter((m) => m.status === status)
    if (tag) members = members.filter((m) => m.tags.includes(tag))
    if (inactiveDays > 0) {
      const now = Date.now()
      members = members.filter((m) => {
        const last = new Date(m.lastActivity).getTime()
        if (Number.isNaN(last)) return false
        return (now - last) / (1000 * 60 * 60 * 24) >= inactiveDays
      })
    }
    if (q) {
      members = members.filter(
        (m) => m.name.toLowerCase().includes(q) || String(m.phone).toLowerCase().includes(q),
      )
    }

    members.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

    const groups = await readCachedGroups(req.user.sub)
    const groupsWithParticipants = await prisma.whatsAppGroup.count({
      where: { userId: req.user.sub, participantsSyncedAt: { not: null } },
    })

    res.json({
      members,
      groups,
      total: members.length,
      meta: {
        groupsTotal: groups.length,
        groupsWithParticipants,
      },
    })
  } catch (err) {
    if (err?.code === "WHATSAPP_NOT_CONNECTED") {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: err.message,
        members: [],
        groups: [],
      })
    }
    return handleEvolutionError(res, err)
  }
})

app.post("/api/members/sync-participants", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    if (!conn.connected) {
      return res.status(409).json({ error: "WHATSAPP_NOT_CONNECTED", message: "Conecte o WhatsApp antes de sincronizar." })
    }

    const maxGroups = Number(req.body?.maxGroups || 8)
    const rows = await prisma.whatsAppGroup.findMany({
      where: { userId: req.user.sub, status: "ativo" },
      orderBy: { participantsSyncedAt: "asc" },
      take: maxGroups,
    })

    let synced = 0
    let failed = 0
    for (const row of rows) {
      try {
        await syncParticipantsForGroupRow(conn, row)
        synced += 1
        await wait(400)
      } catch (err) {
        if (isRateLimitError(err)) {
          return res.status(429).json({
            error: "EVOLUTION_RATE_LIMITED",
            message: "WhatsApp limitou a consulta. Tente novamente em alguns minutos.",
            synced,
          })
        }
        failed += 1
      }
    }

    res.json({ synced, failed, attempted: rows.length })
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.post("/api/groups/:id/participants/status", authMiddleware, async (req, res) => {
  try {
    const groupJid = decodeURIComponent(req.params.id)
    const schema = z.object({
      participantIds: z.array(z.string()).min(1),
      status: z.enum(["ativo", "inativo"]),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos para status do participante." })
    }

    const { participantIds, status } = parsed.data
    const group = await prisma.whatsAppGroup.findUnique({
      where: { userId_groupJid: { userId: req.user.sub, groupJid } },
      select: { id: true },
    })

    if (!group) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Grupo não encontrado no cache." })
    }

    const now = new Date()
    const { count } = await prisma.whatsAppGroupParticipant.updateMany({
      where: { groupId: group.id, participantJid: { in: participantIds } },
      data: {
        status,
        leftAt: null,
        lastSyncedAt: now,
      },
    })

    if (count === 0) {
      return res.status(404).json({
        error: "PARTICIPANT_NOT_FOUND",
        message: "Participante não encontrado neste grupo.",
        updated: 0,
      })
    }

    return res.json({ updated: count, status })
  } catch (err) {
    return handleEvolutionError(res, err)
  }
})

app.get("/api/analytics", authMiddleware, async (req, res) => {
  try {
    const period = typeof req.query.period === "string" ? req.query.period : "2d"
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined
    const data = await buildAnalytics(req.user.sub, period, startDate, endDate)
    res.json(data)
  } catch (err) {
    console.error("[analytics]", err)
    res.status(500).json({ error: "ANALYTICS_FAILED", message: err?.message || "Falha ao carregar analytics." })
  }
})

function parseOverviewQuery(req) {
  const rawIds = req.query?.groupIds || req.query?.groupId || req.body?.groupIds
  const groupJids = rawIds
    ? (Array.isArray(rawIds) ? rawIds : String(rawIds).split(","))
        .map((s) => String(s).trim())
        .filter(Boolean)
    : null
  const period = typeof (req.query?.period || req.body?.period) === "string" ? req.query?.period || req.body?.period : "2d"
  return { groupJids, period }
}

async function handleOverview(req, res) {
  try {
    const { groupJids, period } = parseOverviewQuery(req)
    const data = await buildOverview(req.user.sub, { groupJids, period })
    res.json(data)
  } catch (err) {
    console.error("[overview]", err)
    res.status(500).json({ error: "OVERVIEW_FAILED", message: err?.message || "Falha ao carregar visão geral." })
  }
}

app.get("/api/overview", authMiddleware, handleOverview)
app.get("/api/dashboard", authMiddleware, handleOverview)

app.post("/api/overview/refresh", authMiddleware, async (req, res) => {
  try {
    const conn = await getUserWhatsAppConnection(req.user.sub)
    if (!conn.connected) {
      return res.status(409).json({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "Conecte o WhatsApp antes de atualizar.",
      })
    }
    const { groupJids, period } = parseOverviewQuery(req)
    const { synced, failed } = await syncParticipantsForActiveGroups(req.user.sub, groupJids)
    const data = await buildOverview(req.user.sub, { groupJids, period })
    res.json({
      ...data,
      refresh: {
        synced,
        failed,
        at: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error("[overview/refresh]", err)
    res.status(500).json({ error: "OVERVIEW_REFRESH_FAILED", message: err?.message || "Falha ao atualizar." })
  }
})

// ===================== Mensagens reais + biblioteca + automações =====================

const MESSAGE_SEND_GROUP_DELAY_MS = Number(process.env.MESSAGE_SEND_GROUP_DELAY_MS || 3000)
const MESSAGE_SEND_JITTER_MS = Number(process.env.MESSAGE_SEND_JITTER_MS || 4000)
const MESSAGE_SEND_RETRIES = Number(process.env.MESSAGE_SEND_RETRIES || 1)
const MESSAGE_SEND_RETRY_DELAY_MS = Number(process.env.MESSAGE_SEND_RETRY_DELAY_MS || 4000)
const { validateMediaContentSize } = require("./lib/mediaLimits.js")
const ENABLE_SCHEDULER = process.env.ENABLE_SCHEDULER !== "false"

function getX1Deps() {
  return { prisma, sendText }
}
const SCHEDULER_CATCHUP_HOURS = Number(process.env.SCHEDULER_CATCHUP_HOURS || 6)
const SCHEDULER_MAX_AUTOMATIONS_PER_TICK = Number(process.env.SCHEDULER_MAX_AUTOMATIONS_PER_TICK || 5)
const SP_OFFSET = "-03:00" // America/Sao_Paulo (sem horário de verão)
const schedulerLock = new Set()
let schedulerTickBusy = false

function sendDelayWithJitter() {
  return MESSAGE_SEND_GROUP_DELAY_MS + Math.floor(Math.random() * Math.max(0, MESSAGE_SEND_JITTER_MS))
}

function extractProviderId(resp) {
  return resp?.key?.id || resp?.message?.key?.id || resp?.id || null
}

function stripDataUrlPrefix(b64) {
  if (!b64) return b64
  const idx = b64.indexOf("base64,")
  return idx >= 0 ? b64.slice(idx + 7) : b64
}

function getMessageContent(source) {
  const body = source?.body || ""
  const mergedMentions = mergeMentionsFromBody(body, source?.mentionsJson)
  const hasMentions = mergedMentions.mentions.some((m) => m.type === "user")
  return {
    body,
    mediaType: source?.mediaType || "none",
    mediaBase64: source?.mediaBase64 || null,
    mediaMime: source?.mediaMime || null,
    mediaName: source?.mediaName || null,
    mentionsJson: hasMentions ? mergedMentions : null,
    linkPreview: source?.linkPreview !== false,
  }
}

function validateContent(content) {
  return validateMediaContentSize(content)
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

async function deliverToGroup(instanceName, groupJid, content, userId) {
  const mentionOpts = await resolveMentionsForGroup(prisma, userId, groupJid, content)
  const sendOpts = buildEvolutionSendOptions(mentionOpts)
  const text = mentionOpts.whatsappBody ?? content.body
  if (sendOpts.mentioned?.length) {
    console.log(
      "[mentions]",
      JSON.stringify({
        groupJid,
        bodyPreview: String(text || "").slice(0, 80),
        mentioned: sendOpts.mentioned,
        debug: mentionOpts.mentionDebug,
      }),
    )
  }
  if (content.mediaType === "image" || content.mediaType === "video") {
    return sendMedia(instanceName, groupJid, {
      mediatype: content.mediaType,
      media: stripDataUrlPrefix(content.mediaBase64),
      mimetype: content.mediaMime || undefined,
      caption: text || undefined,
      fileName: content.mediaName || undefined,
      ...sendOpts,
    })
  }
  return sendText(instanceName, groupJid, text, sendOpts)
}

async function deliverWithRetry(instanceName, groupJid, content, userId) {
  let attempt = 0
  for (;;) {
    try {
      return await deliverToGroup(instanceName, groupJid, content, userId)
    } catch (err) {
      if (attempt >= MESSAGE_SEND_RETRIES || !isRetryableSendError(err)) throw err
      attempt += 1
      await wait(MESSAGE_SEND_RETRY_DELAY_MS)
    }
  }
}

function isRetryableSendError(err) {
  if (err?.code === "EVOLUTION_RATE_LIMIT") return false // não insistir em rate-limit
  if (err?.code === "VALIDATION_ERROR") return false
  return true
}

async function recordOutboundAsGroupMessage(userId, groupJid, content, providerMessageId) {
  const group = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId, groupJid } },
    select: { id: true },
  })
  if (!group) return

  const messageId =
    providerMessageId || `outbound-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const mediaType = content.mediaType && content.mediaType !== "none" ? content.mediaType : "text"

  await prisma.whatsAppMessage.upsert({
    where: { groupId_messageId: { groupId: group.id, messageId } },
    create: {
      userId,
      groupId: group.id,
      messageId,
      fromMe: true,
      senderName: "Você",
      type: mediaType,
      body: content.body || null,
      timestamp: new Date(),
    },
    update: {
      body: content.body || null,
      type: mediaType,
      timestamp: new Date(),
    },
  })
}

async function dispatchMessage({ userId, instanceName, groupJids, content, automationId = null, onProgress = null }) {
  const results = []
  let sent = 0
  let failed = 0
  for (const [index, groupJid] of groupJids.entries()) {
    const groupName = await resolveGroupName(userId, groupJid)
    try {
      const resp = await deliverWithRetry(instanceName, groupJid, content, userId)
      const providerMessageId = extractProviderId(resp)
      await prisma.outboundMessage.create({
        data: {
          userId,
          automationId,
          groupJid,
          groupName,
          body: content.body || null,
          mediaType: content.mediaType,
          status: "enviado",
          providerMessageId,
        },
      })
      await recordOutboundAsGroupMessage(userId, groupJid, content, providerMessageId)
      sent += 1
      results.push({ groupJid, groupName, status: "enviado" })
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
      failed += 1
      results.push({ groupJid, groupName, status: "falhou", error: err?.message || "erro" })
    }
    if (onProgress) await onProgress({ done: index + 1, sent, failed })
    if (index < groupJids.length - 1) await wait(sendDelayWithJitter())
  }
  return results
}

async function runSendJob(jobId, { userId, instanceName, groupJids, content, automationId = null }) {
  return enqueueUserSend(userId, async () => {
    try {
      const { valid } = await resolveMonitoredGroupJidsForSend(userId, groupJids)
      await dispatchMessage({
        userId,
        instanceName,
        groupJids: valid,
        content,
        automationId,
        onProgress: async ({ done, sent, failed }) => {
          await prisma.sendJob.update({ where: { id: jobId }, data: { done, sent, failed, total: valid.length } }).catch(() => {})
        },
      })
      await prisma.sendJob.update({ where: { id: jobId }, data: { status: "done" } }).catch(() => {})
    } catch (err) {
      await prisma.sendJob
        .update({ where: { id: jobId }, data: { status: "error", error: (err?.message || "erro").slice(0, 300) } })
        .catch(() => {})
    }
  })
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
    cadenceId: a.cadenceId || null,
    name: a.name,
    status: a.status,
    groupJids: a.groupJids,
    groupNames: a.groupNames,
    templateId: a.templateId,
    body: a.body,
    mediaType: a.mediaType,
    mediaBase64: a.mediaBase64,
    mediaMime: a.mediaMime,
    mediaName: a.mediaName,
    mentionsJson: a.mentionsJson || null,
    linkPreview: a.linkPreview !== false,
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
    mentionsJson: t.mentionsJson || null,
    linkPreview: t.linkPreview !== false,
    updatedAt: t.updatedAt?.toISOString?.() || null,
  }
}

function getJobPayload(j) {
  return {
    id: j.id,
    label: j.label,
    total: j.total,
    done: j.done,
    sent: j.sent,
    failed: j.failed,
    status: j.status,
    error: j.error,
  }
}

const mentionEntrySchema = z.object({
  type: z.literal("user"),
  label: z.string().min(1),
  participantJid: z.string().optional(),
  phone: z.string().optional(),
})

const mentionsJsonSchema = z
  .object({
    mentionAll: z.boolean().optional(),
    mentions: z.array(mentionEntrySchema).max(2).optional(),
  })
  .optional()
  .nullable()

const templateBodySchema = z.object({
  name: z.string().min(1),
  body: z.string().optional(),
  mediaType: z.enum(["none", "image", "video"]).optional(),
  mediaBase64: z.string().optional().nullable(),
  mediaMime: z.string().optional().nullable(),
  mediaName: z.string().optional().nullable(),
  mentionsJson: mentionsJsonSchema,
  linkPreview: z.boolean().optional(),
})

app.get("/api/messages/templates", authMiddleware, async (req, res) => {
  const rows = await prisma.messageTemplate.findMany({ where: { userId: req.user.sub }, orderBy: { updatedAt: "desc" } })
  res.json({ templates: rows.map(getTemplatePayload) })
})

app.post("/api/messages/templates", authMiddleware, async (req, res) => {
  try {
    const parsed = templateBodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da mensagem inválidos." })
    const content = getMessageContent(parsed.data)
    const invalid = validateContent(content)
    if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })
    const tpl = await prisma.messageTemplate.create({
      data: { userId: req.user.sub, name: parsed.data.name, ...content },
    })
    return res.status(201).json({ template: getTemplatePayload(tpl) })
  } catch (err) {
    console.error("[templates/create]", err?.message || err)
    return res.status(500).json({ error: "TEMPLATE_SAVE_FAILED", message: "Não foi possível salvar a mensagem." })
  }
})

app.put("/api/messages/templates/:id", authMiddleware, async (req, res) => {
  try {
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
    return res.json({ template: getTemplatePayload(tpl) })
  } catch (err) {
    console.error("[templates/update]", err?.message || err)
    return res.status(500).json({ error: "TEMPLATE_SAVE_FAILED", message: "Não foi possível salvar a mensagem." })
  }
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
      mentionsJson: mentionsJsonSchema,
      linkPreview: z.boolean().optional(),
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

    const { valid: monitoredGroupIds } = await resolveMonitoredGroupJidsForSend(req.user.sub, parsed.data.groupIds)

    const job = await prisma.sendJob.create({
      data: { userId: req.user.sub, label: "Envio imediato", total: monitoredGroupIds.length },
    })
    void runSendJob(job.id, {
      userId: req.user.sub,
      instanceName: conn.instanceName,
      groupJids: monitoredGroupIds,
      content,
    })
    return res.status(202).json({ job: getJobPayload(job) })
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

app.get("/api/messages/jobs/:id", authMiddleware, async (req, res) => {
  const job = await prisma.sendJob.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!job) return res.status(404).json({ error: "NOT_FOUND", message: "Job não encontrado." })
  res.json({ job: getJobPayload(job) })
})

app.get("/api/messages/history", authMiddleware, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const where = { userId: req.user.sub }
  if (req.query.status && ["enviado", "entregue", "lido", "falhou"].includes(req.query.status)) {
    where.status = req.query.status
  }
  if (req.query.group) {
    where.groupName = { contains: String(req.query.group), mode: "insensitive" }
  }
  const [rows, total] = await Promise.all([
    prisma.outboundMessage.findMany({ where, orderBy: { sentAt: "desc" }, take: limit, skip: offset }),
    prisma.outboundMessage.count({ where }),
  ])
  res.json({
    total,
    limit,
    offset,
    source: "platform_outbound",
    items: rows.map((m) => ({
      id: m.id,
      group: m.groupName,
      body: m.body,
      mediaType: m.mediaType,
      status: m.status,
      error: m.error,
      sentAt: m.sentAt.toISOString(),
    })),
  })
})

app.get("/api/messages/activity", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40))
    const groups = await prisma.whatsAppGroup.findMany({
      where: { userId: req.user.sub, status: "ativo" },
      select: { id: true, groupJid: true, name: true },
    })
    const now = new Date()
    const { start, end, retentionDays } = retentionRange(now)
    const { messages, importedCount, outboundCount } = await loadUnifiedMessages(
      req.user.sub,
      groups,
      start,
      end,
    )
    const nameByGroupId = new Map(groups.map((g) => [g.id, g.name]))
    const items = [...messages]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        group: nameByGroupId.get(m.groupId) || "Grupo",
        body: m.body || "",
        fromMe: Boolean(m.fromMe),
        senderName: m.senderName || (m.fromMe ? "Você" : "Membro"),
        isPlatformOutbound: String(m.id).startsWith("outbound-"),
        sentAt: new Date(m.timestamp).toISOString(),
      }))
    res.json({
      items,
      meta: buildMetricsMeta({ messages, importedCount, outboundCount, start, end, retentionDays }),
    })
  } catch (err) {
    console.error("[messages/activity]", err)
    res.status(500).json({ error: "ACTIVITY_FAILED", message: err?.message || "Falha ao carregar atividade." })
  }
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
      mentionsJson: mentionsJsonSchema,
      linkPreview: z.boolean().optional(),
      frequency: z.enum(["now", "once", "daily", "weekly"]),
      scheduledAt: z.string().optional().nullable(),
      timeOfDay: z.string().optional().nullable(),
      weekday: z.number().int().min(0).max(6).optional().nullable(),
      cadenceId: z.string().optional().nullable(),
      status: z.enum(["ativa", "pausada"]).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da automação inválidos." })

    const conn = await getUserWhatsAppConnection(req.user.sub)
    const content = await resolveContentFromBody(req.user.sub, parsed.data)
    const invalid = validateContent(content)
    if (invalid) return res.status(400).json({ error: "VALIDATION_ERROR", message: invalid })

    const { valid: monitoredGroupIds, invalid: invalidGroupIds } = await resolveMonitoredGroupJidsForSend(
      req.user.sub,
      parsed.data.groupIds,
    )

    let cadenceId = null
    if (parsed.data.cadenceId) {
      const cad = await prisma.cadence.findFirst({ where: { id: parsed.data.cadenceId, userId: req.user.sub }, select: { id: true } })
      cadenceId = cad?.id || null
    }

    const groupNames = []
    for (const jid of monitoredGroupIds) groupNames.push(await resolveGroupName(req.user.sub, jid))

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
          cadenceId,
          name: parsed.data.name,
          status: "concluida",
          groupJids: monitoredGroupIds,
          groupNames,
          templateId: parsed.data.templateId || null,
          ...content,
          frequency: "now",
          lastRunAt: new Date(),
        },
      })
      const job = await prisma.sendJob.create({
        data: { userId: req.user.sub, label: parsed.data.name, total: monitoredGroupIds.length },
      })
      void runSendJob(job.id, {
        userId: req.user.sub,
        instanceName: conn.instanceName,
        groupJids: monitoredGroupIds,
        content,
        automationId: created.id,
      })
      return res.status(202).json({
        automation: getAutomationPayload(created),
        job: getJobPayload(job),
        meta: invalidGroupIds.length ? { skippedGroups: invalidGroupIds.length } : undefined,
      })
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
        cadenceId,
        name: parsed.data.name,
        status: parsed.data.status === "pausada" ? "pausada" : "ativa",
        groupJids: monitoredGroupIds,
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
    return res.status(201).json({
      automation: getAutomationPayload(created),
      meta: invalidGroupIds.length ? { skippedGroups: invalidGroupIds.length } : undefined,
    })
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

app.put("/api/automations/:id", authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.automation.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Automação não encontrada." })

    const schema = z.object({
      name: z.string().min(1),
      groupIds: z.array(z.string()).min(1),
      templateId: z.string().optional(),
      body: z.string().optional(),
      mediaType: z.enum(["none", "image", "video"]).optional(),
      mediaBase64: z.string().optional().nullable(),
      mediaMime: z.string().optional().nullable(),
      mediaName: z.string().optional().nullable(),
      mentionsJson: mentionsJsonSchema,
      linkPreview: z.boolean().optional(),
      frequency: z.enum(["once", "daily", "weekly"]),
      scheduledAt: z.string().optional().nullable(),
      timeOfDay: z.string().optional().nullable(),
      weekday: z.number().int().min(0).max(6).optional().nullable(),
      status: z.enum(["ativa", "pausada"]).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados da automação inválidos." })

    const bodyForContent = { ...parsed.data }
    const hasNewMedia = bodyForContent.mediaType === "image" || bodyForContent.mediaType === "video"
    if (!bodyForContent.templateId && hasNewMedia && !bodyForContent.mediaBase64 && existing.mediaBase64) {
      bodyForContent.mediaBase64 = existing.mediaBase64
      bodyForContent.mediaMime = existing.mediaMime
      bodyForContent.mediaName = existing.mediaName || bodyForContent.mediaName
    }

    const content = await resolveContentFromBody(req.user.sub, bodyForContent)
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

    const draft = {
      frequency: parsed.data.frequency,
      scheduledAt,
      timeOfDay: parsed.data.timeOfDay || null,
      weekday: Number.isInteger(parsed.data.weekday) ? parsed.data.weekday : null,
    }

    const updated = await prisma.automation.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        status: parsed.data.status === "pausada" ? "pausada" : "ativa",
        groupJids: parsed.data.groupIds,
        groupNames,
        templateId: parsed.data.templateId || null,
        ...content,
        frequency: parsed.data.frequency,
        scheduledAt,
        timeOfDay: draft.timeOfDay,
        weekday: draft.weekday,
        nextRunAt: computeNextRun(draft),
      },
    })
    return res.json({ automation: getAutomationPayload(updated) })
  } catch (err) {
    if (err?.code === "TEMPLATE_NOT_FOUND") {
      return res.status(404).json({ error: "TEMPLATE_NOT_FOUND", message: err.message })
    }
    return handleEvolutionError(res, err)
  }
})

app.delete("/api/automations/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.automation.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Automação não encontrada." })
  await prisma.automation.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

// ===================== Cadências (agrupam automações) =====================

function getCadencePayload(c) {
  return { id: c.id, name: c.name, status: c.status || "pausada" }
}

async function syncLegacyCadenceStatus() {
  const activeByCadence = await prisma.automation.groupBy({
    by: ["cadenceId"],
    where: { status: "ativa", cadenceId: { not: null } },
  })
  for (const row of activeByCadence) {
    if (!row.cadenceId) continue
    await prisma.cadence.updateMany({
      where: { id: row.cadenceId, status: "pausada" },
      data: { status: "ativa" },
    })
  }
}

app.get("/api/cadences", authMiddleware, async (req, res) => {
  const rows = await prisma.cadence.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "asc" } })
  res.json({ cadences: rows.map(getCadencePayload) })
})

app.post("/api/cadences", authMiddleware, async (req, res) => {
  const schema = z.object({ name: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um nome para a cadência." })
  const c = await prisma.cadence.create({ data: { userId: req.user.sub, name: parsed.data.name.trim() } })
  res.status(201).json({ cadence: getCadencePayload(c) })
})

app.patch("/api/cadences/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.cadence.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Cadência não encontrada." })
  const schema = z.object({ name: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Informe um nome válido." })
  const c = await prisma.cadence.update({ where: { id: existing.id }, data: { name: parsed.data.name.trim() } })
  res.json({ cadence: getCadencePayload(c) })
})

app.delete("/api/cadences/:id", authMiddleware, async (req, res) => {
  const existing = await prisma.cadence.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Cadência não encontrada." })
  await prisma.automation.updateMany({ where: { userId: req.user.sub, cadenceId: existing.id }, data: { cadenceId: null } })
  await prisma.cadence.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

app.post("/api/cadences/:id/automations", authMiddleware, async (req, res) => {
  const existing = await prisma.cadence.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Cadência não encontrada." })
  const schema = z.object({ automationIds: z.array(z.string()) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Lista de automações inválida." })

  // Remove as que não estão mais na lista e adiciona as novas (somente do próprio usuário)
  await prisma.automation.updateMany({
    where: { userId: req.user.sub, cadenceId: existing.id, id: { notIn: parsed.data.automationIds } },
    data: { cadenceId: null },
  })
  if (parsed.data.automationIds.length) {
    await prisma.automation.updateMany({
      where: { userId: req.user.sub, id: { in: parsed.data.automationIds } },
      data: { cadenceId: existing.id },
    })
  }
  const automations = await prisma.automation.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "desc" } })
  res.json({ automations: automations.map(getAutomationPayload) })
})

app.post("/api/cadences/:id/status", authMiddleware, async (req, res) => {
  const existing = await prisma.cadence.findFirst({ where: { id: req.params.id, userId: req.user.sub } })
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Cadência não encontrada." })
  const schema = z.object({ status: z.enum(["ativa", "pausada"]) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Status inválido." })

  const updatedCadence = await prisma.cadence.update({
    where: { id: existing.id },
    data: { status: parsed.data.status },
  })

  const members = await prisma.automation.findMany({
    where: { userId: req.user.sub, cadenceId: existing.id, frequency: { not: "now" }, status: { not: "concluida" } },
  })
  for (const a of members) {
    const data = { status: parsed.data.status }
    if (parsed.data.status === "ativa" && a.frequency !== "once") data.nextRunAt = computeNextRun(a)
    await prisma.automation.update({ where: { id: a.id }, data })
  }
  const automations = await prisma.automation.findMany({ where: { userId: req.user.sub }, orderBy: { createdAt: "desc" } })
  res.json({ cadence: getCadencePayload(updatedCadence), automations: automations.map(getAutomationPayload) })
})

async function processDueAutomations() {
  const now = new Date()
  const due = await prisma.automation.findMany({
    where: { status: "ativa", nextRunAt: { lte: now } },
    take: SCHEDULER_MAX_AUTOMATIONS_PER_TICK,
    orderBy: { nextRunAt: "asc" },
  })

  const cadenceIds = [...new Set(due.map((a) => a.cadenceId).filter(Boolean))]
  const pausedCadenceIds = new Set(
    cadenceIds.length
      ? (await prisma.cadence.findMany({ where: { id: { in: cadenceIds }, status: "pausada" }, select: { id: true } })).map(
          (c) => c.id,
        )
      : [],
  )

  const catchupMs = SCHEDULER_CATCHUP_HOURS * 3600 * 1000

  for (const a of due) {
    if (a.cadenceId && pausedCadenceIds.has(a.cadenceId)) continue
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

      // Catch-up: ignora disparos muito atrasados (ex.: servidor ficou offline)
      if (a.nextRunAt && now.getTime() - new Date(a.nextRunAt).getTime() > catchupMs) {
        console.warn("[scheduler] pulando disparo atrasado:", a.id)
        continue
      }

      const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: a.userId } })
      if (!conn?.instanceName || !conn.connected) continue

      const { valid } = await resolveMonitoredGroupJidsForSend(a.userId, a.groupJids).catch((err) => {
        console.warn("[scheduler] grupos inválidos:", a.id, err?.message || err)
        return { valid: [] }
      })
      if (!valid.length) {
        console.warn("[scheduler] automação sem grupos monitorados:", a.id)
        continue
      }

      await enqueueUserSend(a.userId, () =>
        dispatchMessage({
          userId: a.userId,
          instanceName: conn.instanceName,
          groupJids: valid,
          content: getMessageContent(a),
          automationId: a.id,
        }),
      )
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

function getWebhookEvent(body) {
  const raw = body?.event || body?.type || body?.data?.event || ""
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[.\-]/g, "_")
}

function getWebhookInstanceName(body) {
  const candidate =
    body?.instance ||
    body?.data?.instanceName ||
    body?.data?.instance?.instanceName ||
    body?.data?.instance?.name ||
    body?.instanceName ||
    null
  if (typeof candidate === "string") return candidate
  if (candidate && typeof candidate === "object") {
    return candidate.instanceName || candidate.name || null
  }
  return null
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

  let saved = 0
  for (const group of eventGroups) {
    if (!isPlausibleWhatsAppGroup(group)) continue
    await upsertDiscoveredGroup(conn.userId, group)
    saved += 1
  }

  const cleanedGhosts = await cleanupGhostGroups(prisma, conn.userId)

  if (saved || cleanedGhosts) {
    const visibleCount = (await readCachedGroups(conn.userId)).length
    const updatedConn = await updateConnectionSync(conn.userId, {
      groupSyncStatus: "READY",
      groupSyncProgress: 100,
      groupSyncMessage: `${visibleCount} grupo(s) visíveis${saved ? ` · ${saved} evento(s) processado(s)` : ""}${cleanedGhosts ? ` · ${cleanedGhosts} fantasma(s) ocultado(s)` : ""}. Ative manualmente os que quiser monitorar.`,
      groupSyncError: null,
    })
    io.emit("whatsapp:status", formatConnectionPayload(updatedConn, visibleCount))
  }

  return saved
}

/** Deps compartilhadas dos motores do CRM (fluxos, IA, fila de envio). */
function getCrmDeps() {
  return { prisma, io, sendText, sendMedia, findChats, fetchChatMessages }
}

/** Grava mensagem 1:1 no CRM, emite tempo real e dispara fluxos/IA. */
async function handleCrmIncomingRecord(userId, record, instanceName = null) {
  const result = await ingestCrmMessage(getCrmDeps(), { userId, record, source: "webhook" })
  if (!result || !result.created) return

  emitCrmEvent(io, userId, "crm:message", {
    conversationId: result.conversation.id,
    message: formatCrmMessageRow(result.message),
    conversation: formatCrmConversationRow(result.conversation),
  })

  // Contato sem foto: busca perfil na Evolution (fila com throttle anti-ban)
  if (instanceName && contactNeedsProfile(result.conversation.contact)) {
    scheduleProfileFetch(
      { prisma, io, fetchProfile, fetchProfilePictureUrl },
      { userId, instanceName, remoteJid: result.conversation.remoteJid },
    )
  }

  if (!result.message.fromMe) {
    onCrmMessage(getCrmDeps(), {
      conversation: result.conversation,
      message: result.message,
      isNewConversation: result.isNewConversation,
    }).catch((err) => console.error("[crm-flow] onMessage:", err?.message || err))

    maybeReplyWithAi(getCrmDeps(), {
      conversation: result.conversation,
      message: result.message,
    }).catch((err) => console.error("[crm-ai] reply:", err?.message || err))
  }
}

/** Mensagens novas (a partir da conexão). Só grava em grupos monitorados; sem histórico antigo. */
async function storeIncomingMessages(instanceName, body) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { instanceName } })
  if (!conn) return 0

  const records = collectWebhookMessageRecords(body)
  if (!records.length) {
    const event = getWebhookEvent(body)
    if (event.includes("MESSAGE")) {
      console.warn(`[webhook] ${event} sem registros parseáveis (${instanceName})`)
    }
    return 0
  }

  let saved = 0
  const touchedGroups = new Map()

  for (const record of records) {
    const groupJid = record?.key?.remoteJid || record?.remoteJid
    if (!groupJid) continue
    if (!String(groupJid).endsWith("@g.us")) {
      // Chats 1:1 (@s.whatsapp.net / @lid) alimentam o CRM em tempo real.
      if (isIndividualJid(groupJid) && !isReactionRecord(record)) {
        await handleCrmIncomingRecord(conn.userId, record, instanceName).catch((err) =>
          console.error("[crm] ingest webhook:", err?.message || err),
        )
      }
      continue
    }

    let group = touchedGroups.get(groupJid)
    if (!group) {
      group = await prisma.whatsAppGroup.findUnique({
        where: { userId_groupJid: { userId: conn.userId, groupJid } },
      })
      if (!group) {
        const monitored = await prisma.whatsAppGroup.findMany({
          where: { userId: conn.userId, monitoringEnabled: true },
        })
        group = monitored.find((g) => jidsMatch(g.groupJid, groupJid)) || null
      }
      if (!group || !group.monitoringEnabled) {
        touchedGroups.set(groupJid, null)
        continue
      }
      touchedGroups.set(groupJid, group)
    }
    if (!group) continue

    if (isReactionRecord(record)) {
      const targetId = extractReactionTargetMessageId(record)
      if (targetId) {
        await prisma.messageEngagement
          .upsert({
            where: { groupId_messageId: { groupId: group.id, messageId: targetId } },
            create: {
              userId: conn.userId,
              groupId: group.id,
              messageId: targetId,
              reactionsCount: 1,
            },
            update: { reactionsCount: { increment: 1 } },
          })
          .catch(() => {})
      }
      continue
    }

    const mapped = mapEvolutionMessage(record)
    if (!mapped.messageId) continue
    if (!mapped.timestamp || Number.isNaN(mapped.timestamp.getTime())) continue
    if (mapped.timestamp.getTime() < getRetentionCutoffMs()) continue

    await prisma.whatsAppMessage.upsert({
      where: { groupId_messageId: { groupId: group.id, messageId: mapped.messageId } },
      create: { userId: conn.userId, groupId: group.id, ...mapped },
      update: {
        body: mapped.body,
        type: mapped.type,
        fromMe: mapped.fromMe,
        senderJid: mapped.senderJid,
        senderName: mapped.senderName,
        raw: mapped.raw,
      },
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

  if (saved > 0) {
    console.log(`[webhook] ${saved} mensagem(ns) de grupo gravadas (${instanceName})`)
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
  if (err?.code === "GROUP_LIMIT_EXCEEDED") {
    const { status, body } = sanitizeClientError(err, { error: "GROUP_LIMIT_EXCEEDED", status: 409 })
    body.meta = err.meta || null
    return res.status(status).json(body)
  }
  if (err?.code === "GROUPS_NOT_MONITORED") {
    const { status, body } = sanitizeClientError(err, { error: "GROUPS_NOT_MONITORED", status: 400 })
    body.meta = err.meta || null
    return res.status(status).json(body)
  }
  if (err?.code === "EVOLUTION_CONFIG_MISSING") {
    return res.status(503).json({
      error: "EVOLUTION_NOT_CONFIGURED",
      message: "Serviço WhatsApp temporariamente indisponível.",
    })
  }
  if (isRateLimitError(err)) {
    return res.status(429).json({
      error: "EVOLUTION_RATE_LIMITED",
      message: "WhatsApp limitou consultas temporariamente. Aguarde alguns minutos antes de tentar de novo.",
    })
  }
  console.error("Evolution error:", err?.message || err, err?.details || err?.rawPreview || "")
  const { status, body } = sanitizeClientError(err, {
    error: "EVOLUTION_ERROR",
    message: "Falha ao comunicar com o WhatsApp. Tente novamente.",
    status: 502,
  })
  return res.status(status).json(body)
}

/** Atualiza status de entrega (ack) das mensagens enviadas, por messageId. */
async function updateOutboundAckFromWebhook(instanceName, body) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { instanceName }, select: { userId: true } })
  if (!conn) return
  const raw = body?.data ?? body
  const updates = Array.isArray(raw) ? raw : [raw]
  for (const u of updates) {
    const messageId = u?.keyId || u?.key?.id || u?.id || u?.update?.key?.id
    const statusRaw = String(u?.status || u?.update?.status || "").toUpperCase()
    if (!messageId || !statusRaw) continue
    let status = null
    if (statusRaw.includes("READ") || statusRaw === "4") status = "lido"
    else if (statusRaw.includes("DELIVERY") || statusRaw === "3") status = "entregue"
    else if (statusRaw.includes("ERROR") || statusRaw.includes("FAIL")) status = "falhou"
    if (!status) continue
    // Não rebaixa um status já mais avançado (lido > entregue > enviado)
    const rank = { enviado: 1, entregue: 2, lido: 3, falhou: 1 }
    const current = await prisma.outboundMessage.findFirst({
      where: { userId: conn.userId, providerMessageId: messageId },
      select: { id: true, status: true },
    })
    if (!current) continue
    if ((rank[status] || 0) <= (rank[current.status] || 0) && status !== "falhou") continue
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status } }).catch(() => {})
  }
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
    } else if (event === "GROUP_PARTICIPANTS_UPDATE") {
      await updateGroupsFromWebhook(instanceName, req.body)
      await handleGroupParticipantsX1Webhook(getX1Deps(), instanceName, req.body)
    } else if (["GROUPS_UPSERT", "GROUP_UPDATE"].includes(event)) {
      await updateGroupsFromWebhook(instanceName, req.body)
    } else if (event === "MESSAGES_UPSERT" || event === "MESSAGES_SET") {
      await storeIncomingMessages(instanceName, req.body)
    } else if (event === "MESSAGES_UPDATE") {
      await updateOutboundAckFromWebhook(instanceName, req.body)
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

async function refreshConnectedInstanceWebhooks() {
  const webhook = buildEvolutionWebhookUrl()
  if (!webhook) return
  const connections = await prisma.whatsAppConnection.findMany({
    where: { connected: true },
    select: { instanceName: true },
  })
  for (const { instanceName } of connections) {
    await setInstanceWebhook(instanceName, webhook).catch((err) => {
      console.warn(`[evolution] webhook ${instanceName}:`, err?.message || err)
    })
  }
  if (connections.length) {
    console.log(`[evolution] Webhook atualizado em ${connections.length} instância(s) conectada(s).`)
  }
}

httpServer.listen(port, () => {
  void ensureDefaultPlans().catch((err) => console.error("[bootstrap] ensureDefaultPlans:", err?.message || err))
  void syncLegacyCadenceStatus().catch((err) => console.error("[bootstrap] syncLegacyCadenceStatus:", err?.message || err))
  void migrateStoredX1Templates(prisma).catch((err) => console.error("[bootstrap] migrateStoredX1Templates:", err?.message || err))
  void refreshConnectedInstanceWebhooks().catch((err) =>
    console.error("[bootstrap] refreshConnectedInstanceWebhooks:", err?.message || err),
  )
  console.log(`Backend online na porta ${port}`)
  logStartupSecurityChecks()
  if (ENABLE_SCHEDULER) {
    setInterval(() => {
      if (schedulerTickBusy) return
      schedulerTickBusy = true
      processDueAutomations()
        .catch((err) => console.error("[scheduler] tick:", err?.message || err))
        .then(() => processPendingX1Deliveries(getX1Deps()))
        .catch((err) => console.error("[x1] scheduler:", err?.message || err))
        .then(() => processPendingCrmDeliveries(getCrmDeps()))
        .catch((err) => console.error("[crm] delivery scheduler:", err?.message || err))
        .then(() => processNoReplyFlows(getCrmDeps()))
        .catch((err) => console.error("[crm] no-reply flows:", err?.message || err))
        .finally(() => {
          schedulerTickBusy = false
        })
    }, 30000)
    console.log(`Agendador de automações e X1 ativo (tick 30s, max ${SCHEDULER_MAX_AUTOMATIONS_PER_TICK}/tick).`)
  }
})

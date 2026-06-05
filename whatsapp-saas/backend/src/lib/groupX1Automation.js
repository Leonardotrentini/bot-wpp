const { jidDomain, phoneDigitsFromJid, resolvePhoneDigits, digitsOnly } = require("./participantIdentity")

const DEFAULT_KIND_SETTINGS = {
  minDelaySec: 15,
  maxDelaySec: 75,
  maxX1PerUser24h: 2,
  quietHoursEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
}

const DEFAULT_X1_CONFIG = {
  enabled: true,
  sendX1OnJoin: true,
  sendX1OnLeave: true,
  join: {
    ...DEFAULT_KIND_SETTINGS,
    template: "Olá {{nome}}, seja bem-vindo(a)! Me chama no X1 para receber o guia rápido.",
  },
  leave: {
    ...DEFAULT_KIND_SETTINGS,
    template: "Percebi que você saiu do grupo. Posso te ajudar por aqui no X1?",
  },
}

const X1_TIMEZONE = "America/Sao_Paulo"
const processingLock = new Set()

function normalizeDelayPair(src, fallback) {
  let minDelaySec = Math.max(
    0,
    src.minDelaySec != null && src.minDelaySec !== "" ? Number(src.minDelaySec) : fallback.minDelaySec,
  )
  let maxDelaySec = Math.max(
    0,
    src.maxDelaySec != null && src.maxDelaySec !== "" ? Number(src.maxDelaySec) : fallback.maxDelaySec,
  )
  if (Number.isNaN(minDelaySec)) minDelaySec = fallback.minDelaySec
  if (Number.isNaN(maxDelaySec)) maxDelaySec = fallback.maxDelaySec
  if (maxDelaySec < minDelaySec) maxDelaySec = minDelaySec
  return { minDelaySec, maxDelaySec }
}

function normalizeKindBlock(rawBlock, { kind, legacyFlat }) {
  const fallback = DEFAULT_X1_CONFIG[kind]
  const src = rawBlock && typeof rawBlock === "object" ? rawBlock : {}
  const templateKey = kind === "join" ? "joinTemplate" : "leaveTemplate"
  const { minDelaySec, maxDelaySec } = normalizeDelayPair(
    {
      minDelaySec: src.minDelaySec ?? legacyFlat?.minDelaySec,
      maxDelaySec: src.maxDelaySec ?? legacyFlat?.maxDelaySec,
    },
    fallback,
  )

  return {
    template: String(src.template ?? legacyFlat?.[templateKey] ?? fallback.template),
    minDelaySec,
    maxDelaySec,
    maxX1PerUser24h: Math.max(
      1,
      Number(src.maxX1PerUser24h ?? legacyFlat?.maxX1PerUser24h) || fallback.maxX1PerUser24h,
    ),
    quietHoursEnabled:
      src.quietHoursEnabled != null
        ? src.quietHoursEnabled !== false
        : legacyFlat?.quietHoursEnabled !== false,
    quietHoursStart: String(
      src.quietHoursStart ?? legacyFlat?.quietHoursStart ?? fallback.quietHoursStart,
    ),
    quietHoursEnd: String(src.quietHoursEnd ?? legacyFlat?.quietHoursEnd ?? fallback.quietHoursEnd),
  }
}

function normalizeX1Config(raw) {
  const src = raw && typeof raw === "object" ? raw : {}

  const join = normalizeKindBlock(src.join, { kind: "join", legacyFlat: src })
  const leave = normalizeKindBlock(src.leave, { kind: "leave", legacyFlat: src })

  return {
    enabled: src.enabled !== false,
    sendX1OnJoin: src.sendX1OnJoin !== false,
    sendX1OnLeave: src.sendX1OnLeave !== false,
    join,
    leave,
    // compat legado (leitores antigos)
    joinTemplate: join.template,
    leaveTemplate: leave.template,
    minDelaySec: join.minDelaySec,
    maxDelaySec: join.maxDelaySec,
    maxX1PerUser24h: join.maxX1PerUser24h,
    quietHoursEnabled: join.quietHoursEnabled,
    quietHoursStart: join.quietHoursStart,
    quietHoursEnd: join.quietHoursEnd,
  }
}

function getKindConfig(config, kind) {
  if (kind === "leave") return config.leave
  return config.join
}

function renderX1Template(template, { nome = "amigo(a)" } = {}) {
  const name = String(nome || "amigo(a)").trim() || "amigo(a)"
  return String(template || "").replace(/\{\{\s*nome\s*\}\}/gi, name)
}

function randomInt(min, max) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function parseTimeParts(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm, minutes: hh * 60 + mm }
}

function spWallClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: X1_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hh: Number(get("hour")),
    mm: Number(get("minute")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  }
}

function spDateAtLocal(y, m, d, hh, mm) {
  const guess = new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0))
  for (let i = 0; i < 3; i += 1) {
    const wall = spWallClockParts(guess)
    const deltaMin = (wall.hh * 60 + wall.mm) - (hh * 60 + mm)
    if (deltaMin === 0) return guess
    guess.setUTCMinutes(guess.getUTCMinutes() - deltaMin)
  }
  return guess
}

function isInQuietHours(at, config) {
  if (!config.quietHoursEnabled) return false
  const start = parseTimeParts(config.quietHoursStart)
  const end = parseTimeParts(config.quietHoursEnd)
  if (!start || !end) return false

  const wall = spWallClockParts(at)
  const nowMin = wall.minutes
  const startMin = start.minutes
  const endMin = end.minutes

  if (startMin === endMin) return false
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin
  return nowMin >= startMin || nowMin < endMin
}

function nextAllowedAfterQuietHours(at, config) {
  const end = parseTimeParts(config.quietHoursEnd)
  if (!end) return at

  const wall = spWallClockParts(at)
  let target = spDateAtLocal(wall.y, wall.m, wall.d, end.hh, end.mm)
  if (target <= at) target = new Date(target.getTime() + 24 * 3600 * 1000)
  return target
}

function computeScheduledAt(config, { now = new Date(), skipDelay = false } = {}) {
  let scheduledAt = new Date(now.getTime())
  if (!skipDelay) {
    const delaySec = randomInt(config.minDelaySec, config.maxDelaySec)
    scheduledAt = new Date(now.getTime() + delaySec * 1000)
  }
  if (config.quietHoursEnabled && isInQuietHours(scheduledAt, config)) {
    scheduledAt = nextAllowedAfterQuietHours(scheduledAt, config)
  }
  return scheduledAt
}

function extractProviderId(resp) {
  return resp?.key?.id || resp?.message?.key?.id || resp?.id || null
}

function resolveSendNumber(participantJid, phoneDigits) {
  if (phoneDigits) return phoneDigits
  return phoneDigitsFromJid(participantJid)
}

function participantIsLid(participantJid) {
  return jidDomain(participantJid) === "lid"
}

function mapParticipantAction(action) {
  const a = String(action || "").toLowerCase()
  if (["add", "join", "invite"].includes(a)) return "join"
  if (["remove", "leave"].includes(a)) return "leave"
  return null
}

function parseParticipantsUpdatePayload(body) {
  const payload = body?.data || body
  const groupJid =
    payload?.id ||
    payload?.groupJid ||
    payload?.jid ||
    payload?.remoteJid ||
    payload?.group?.id ||
    payload?.group?.jid ||
    null

  const action = payload?.action || payload?.type || payload?.event || payload?.updateType || ""
  let participants = payload?.participants || payload?.participant || payload?.members || []
  if (!Array.isArray(participants)) participants = participants ? [participants] : []

  return {
    groupJid: groupJid ? String(groupJid) : null,
    action: mapParticipantAction(action),
    participants: participants.map((p) => {
      if (typeof p === "string") return { participantJid: p, raw: null }
      const participantJid = String(p?.id || p?.jid || p?.participantJid || p?.phoneNumber || "")
      return { participantJid, raw: p }
    }).filter((p) => p.participantJid),
  }
}

function resolveParticipantMeta(participantJid, raw, dbParticipant) {
  const isLid = participantIsLid(participantJid) || Boolean(dbParticipant?.participantJid && participantIsLid(dbParticipant.participantJid))
  const phoneDigits =
    resolvePhoneDigits(raw) ||
    phoneDigitsFromJid(participantJid) ||
    (dbParticipant?.phone ? digitsOnly(dbParticipant.phone) : null)
  const participantName =
    dbParticipant?.name ||
    raw?.name ||
    raw?.pushName ||
    raw?.notify ||
    (phoneDigits ? "Sem nome" : "Participante")

  return { isLid, phoneDigits, participantName }
}

async function countRecentDeliveries(prisma, { userId, groupId, participantJid, kind }) {
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const where = {
    userId,
    groupId,
    participantJid,
    status: { in: ["pending", "sending", "sent"] },
    createdAt: { gte: since },
  }
  if (kind && kind !== "test") where.kind = kind
  return prisma.groupX1Delivery.count({ where })
}

async function enqueueX1ForParticipant(deps, ctx) {
  const { prisma } = deps
  const {
    userId,
    groupRow,
    participantJid,
    participantName,
    phoneDigits,
    isLid,
    kind,
    source = "webhook",
    skipDelay = false,
    force = false,
  } = ctx

  if (!groupRow?.monitoringEnabled) {
    console.log("[x1] ignorado — grupo sem monitoramento:", groupRow?.groupJid)
    return { ok: false, reason: "MONITORING_DISABLED" }
  }

  const config = normalizeX1Config(groupRow.groupX1Automation)
  if (!config.enabled && !force) {
    console.log("[x1] ignorado — automação desativada:", groupRow.groupJid)
    return { ok: false, reason: "X1_DISABLED" }
  }

  const eventKind = kind === "leave" ? "leave" : "join"
  const kindConfig = getKindConfig(config, eventKind)

  if (!force) {
    if (eventKind === "join" && !config.sendX1OnJoin) return { ok: false, reason: "JOIN_DISABLED" }
    if (eventKind === "leave" && !config.sendX1OnLeave) return { ok: false, reason: "LEAVE_DISABLED" }
  }

  const effectiveKind = kind === "test" ? eventKind : kind
  const template = kindConfig.template
  const body = renderX1Template(template, { nome: participantName })

  if (!force && effectiveKind !== "test") {
    const duplicate = await prisma.groupX1Delivery.findFirst({
      where: {
        userId,
        groupId: groupRow.id,
        participantJid,
        kind: effectiveKind,
        status: { in: ["pending", "sending", "sent"] },
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    })
    if (duplicate) {
      console.log("[x1] ignorado — evento duplicado recente:", participantJid, effectiveKind)
      return { ok: false, reason: "DUPLICATE", delivery: duplicate }
    }
  }

  if (!force) {
    const recent = await countRecentDeliveries(prisma, {
      userId,
      groupId: groupRow.id,
      participantJid,
      kind: effectiveKind,
    })
    if (recent >= kindConfig.maxX1PerUser24h) {
      const skipped = await prisma.groupX1Delivery.create({
        data: {
          userId,
          groupId: groupRow.id,
          participantJid,
          participantName,
          kind: effectiveKind,
          body,
          status: "skipped",
          error: "Limite de X1 por usuário (24h) atingido.",
          source,
          scheduledAt: new Date(),
          sentAt: null,
        },
      })
      console.log("[x1] limite 24h:", participantJid, groupRow.groupJid)
      return { ok: false, reason: "RATE_LIMIT", delivery: skipped }
    }
  }

  const sendNumber = resolveSendNumber(participantJid, phoneDigits)
  if (!sendNumber) {
    const failed = await prisma.groupX1Delivery.create({
      data: {
        userId,
        groupId: groupRow.id,
        participantJid,
        participantName,
        kind: effectiveKind,
        body,
        status: "failed",
        error: isLid
          ? "Número oculto (LID) sem telefone resolvível — não é possível enviar X1 privado."
          : "Telefone indisponível para envio X1 privado.",
        source,
        scheduledAt: new Date(),
        sentAt: null,
      },
    })
    console.warn("[x1] sem número para envio:", participantJid, groupRow.groupJid)
    return { ok: false, reason: "NO_PHONE", delivery: failed }
  }

  if (isLid) {
    console.log("[x1] LID resolvido via telefone:", sendNumber, participantJid)
  }

  const scheduledAt = computeScheduledAt(kindConfig, {
    now: new Date(),
    skipDelay: skipDelay || force || kind === "test",
  })

  const delivery = await prisma.groupX1Delivery.create({
    data: {
      userId,
      groupId: groupRow.id,
      participantJid,
      participantName,
      kind: effectiveKind,
      body,
      status: "pending",
      source,
      scheduledAt,
    },
  })

  console.log(
    `[x1] enfileirado ${effectiveKind} → ${participantJid} (${groupRow.groupJid}) agendado ${scheduledAt.toISOString()}`,
  )
  return { ok: true, delivery }
}

async function processOneDelivery(deps, deliveryId) {
  if (processingLock.has(deliveryId)) return null
  processingLock.add(deliveryId)

  const { prisma, sendText } = deps
  try {
    const claim = await prisma.groupX1Delivery.updateMany({
      where: { id: deliveryId, status: "pending", scheduledAt: { lte: new Date() } },
      data: { status: "sending" },
    })
    if (claim.count === 0) return null

    const delivery = await prisma.groupX1Delivery.findUnique({ where: { id: deliveryId } })
    if (!delivery) return null

    const groupRow = await prisma.whatsAppGroup.findUnique({
      where: { id: delivery.groupId },
      select: {
        id: true,
        userId: true,
        groupJid: true,
        monitoringEnabled: true,
        groupX1Automation: true,
        instanceName: true,
      },
    })
    if (!groupRow || groupRow.userId !== delivery.userId) {
      await prisma.groupX1Delivery.update({
        where: { id: deliveryId },
        data: { status: "failed", error: "Grupo não encontrado." },
      })
      return null
    }

    const conn = await prisma.whatsAppConnection.findUnique({ where: { userId: delivery.userId } })
    if (!conn?.connected || !conn.instanceName) {
      await prisma.groupX1Delivery.update({
        where: { id: deliveryId },
        data: { status: "failed", error: "WhatsApp desconectado." },
      })
      return null
    }

    const participant = await prisma.whatsAppGroupParticipant.findUnique({
      where: { groupId_participantJid: { groupId: groupRow.id, participantJid: delivery.participantJid } },
      select: { phone: true, name: true, participantJid: true, raw: true },
    })

    const meta = resolveParticipantMeta(
      delivery.participantJid,
      participant?.raw,
      participant,
    )
    const sendNumber = resolveSendNumber(delivery.participantJid, meta.phoneDigits)
    if (!sendNumber) {
      await prisma.groupX1Delivery.update({
        where: { id: deliveryId },
        data: { status: "failed", error: "Telefone indisponível para envio X1." },
      })
      return null
    }

    const kindConfig = getKindConfig(normalizeX1Config(groupRow.groupX1Automation), delivery.kind)
    const body =
      delivery.body || renderX1Template(kindConfig.template, { nome: delivery.participantName })
    console.log(`[x1] enviando DM ${delivery.kind} → ${sendNumber} (grupo ${groupRow.groupJid})`)

    const resp = await sendText(conn.instanceName, sendNumber, body)
    const providerMessageId = extractProviderId(resp)

    const sent = await prisma.groupX1Delivery.update({
      where: { id: deliveryId },
      data: {
        status: "sent",
        sentAt: new Date(),
        providerMessageId,
        error: null,
      },
    })
    console.log(`[x1] enviado com sucesso id=${deliveryId} provider=${providerMessageId || "?"}`)
    return sent
  } catch (err) {
    await prisma.groupX1Delivery
      .update({
        where: { id: deliveryId },
        data: { status: "failed", error: String(err?.message || err).slice(0, 300) },
      })
      .catch(() => {})
    console.error("[x1] falha ao enviar:", deliveryId, err?.message || err)
    return null
  } finally {
    processingLock.delete(deliveryId)
  }
}

async function processPendingX1Deliveries(deps) {
  const { prisma } = deps
  const pending = await prisma.groupX1Delivery.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    take: 15,
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  })

  for (const row of pending) {
    await processOneDelivery(deps, row.id)
  }
  return pending.length
}

async function handleGroupParticipantsX1Webhook(deps, instanceName, body) {
  const { prisma } = deps
  const parsed = parseParticipantsUpdatePayload(body)
  if (!parsed.groupJid || !parsed.action || !parsed.participants.length) {
    console.log("[x1] webhook participantes sem dados acionáveis:", parsed.groupJid, parsed.action)
    return 0
  }

  const conn = await prisma.whatsAppConnection.findUnique({ where: { instanceName } })
  if (!conn) return 0

  const groupRow = await prisma.whatsAppGroup.findUnique({
    where: { userId_groupJid: { userId: conn.userId, groupJid: parsed.groupJid } },
  })
  if (!groupRow) {
    console.log("[x1] grupo não cadastrado:", parsed.groupJid)
    return 0
  }

  let enqueued = 0
  for (const p of parsed.participants) {
    const dbParticipant = await prisma.whatsAppGroupParticipant.findUnique({
      where: { groupId_participantJid: { groupId: groupRow.id, participantJid: p.participantJid } },
      select: { name: true, phone: true, participantJid: true, raw: true },
    })
    const meta = resolveParticipantMeta(p.participantJid, p.raw || dbParticipant?.raw, dbParticipant)
    const result = await enqueueX1ForParticipant(deps, {
      userId: conn.userId,
      groupRow,
      participantJid: p.participantJid,
      participantName: meta.participantName,
      phoneDigits: meta.phoneDigits,
      isLid: meta.isLid,
      kind: parsed.action,
      source: "webhook",
    })
    if (result.ok) enqueued += 1
  }

  if (enqueued) await processPendingX1Deliveries(deps)
  return enqueued
}

async function notifyX1FromParticipantSync(deps, { conn, groupRow, joined, left }) {
  let enqueued = 0
  for (const p of joined || []) {
    const result = await enqueueX1ForParticipant(deps, {
      userId: conn.userId,
      groupRow,
      participantJid: p.participantJid,
      participantName: p.name,
      phoneDigits: p.phoneDigits,
      isLid: p.isLid,
      kind: "join",
      source: "sync",
    })
    if (result.ok) enqueued += 1
  }
  for (const p of left || []) {
    const result = await enqueueX1ForParticipant(deps, {
      userId: conn.userId,
      groupRow,
      participantJid: p.participantJid,
      participantName: p.name,
      phoneDigits: p.phoneDigits,
      isLid: p.isLid,
      kind: "leave",
      source: "sync",
    })
    if (result.ok) enqueued += 1
  }
  if (enqueued) await processPendingX1Deliveries(deps)
  return enqueued
}

async function getX1Deliveries(prisma, userId, groupId, { limit = 30 } = {}) {
  return prisma.groupX1Delivery.findMany({
    where: { userId, groupId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      participantJid: true,
      participantName: true,
      kind: true,
      body: true,
      status: true,
      error: true,
      source: true,
      scheduledAt: true,
      sentAt: true,
      createdAt: true,
    },
  })
}

function formatDeliveryRow(row) {
  return {
    id: row.id,
    participantJid: row.participantJid,
    participantName: row.participantName,
    kind: row.kind,
    bodyPreview: row.body ? row.body.slice(0, 120) : null,
    status: row.status,
    error: row.error,
    source: row.source,
    scheduledAt: row.scheduledAt?.toISOString?.() || row.scheduledAt,
    sentAt: row.sentAt?.toISOString?.() || row.sentAt,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
  }
}

module.exports = {
  DEFAULT_X1_CONFIG,
  DEFAULT_KIND_SETTINGS,
  normalizeX1Config,
  normalizeKindBlock,
  getKindConfig,
  renderX1Template,
  parseParticipantsUpdatePayload,
  mapParticipantAction,
  isInQuietHours,
  computeScheduledAt,
  enqueueX1ForParticipant,
  processPendingX1Deliveries,
  processOneDelivery,
  handleGroupParticipantsX1Webhook,
  notifyX1FromParticipantSync,
  getX1Deliveries,
  formatDeliveryRow,
  resolveParticipantMeta,
}

/**
 * Sincronização de conversas antigas (CRM).
 *
 * Estratégia anti-ban: 1 chat por vez, páginas de 50 mensagens com pausa entre
 * páginas e entre chats (mesmos valores usados na importação de grupos).
 * Rate-limit (429) pausa o job e grava retryAfter; o job pode ser retomado.
 */

const { normalizeEvolutionMessages, filterMessagesForGroup, toIsoFromEvolutionTimestamp } = require("./evolutionMessages")
const { isIndividualJid, ingestCrmMessage, emitCrmEvent, formatConversationRow, phoneFromChatItem } = require("./crmCore")
const { syncContactProfiles, lookupDirectoryInfo } = require("./crmProfile")

const CRM_SYNC_PAGE_SIZE = Number(process.env.CRM_SYNC_PAGE_SIZE || 50)
const CRM_SYNC_MAX_PAGES_PER_CHAT = Number(process.env.CRM_SYNC_MAX_PAGES_PER_CHAT || 20)
const CRM_SYNC_PAGE_DELAY_MS = Number(process.env.CRM_SYNC_PAGE_DELAY_MS || 1500)
const CRM_SYNC_CHAT_DELAY_MS = Number(process.env.CRM_SYNC_CHAT_DELAY_MS || 4000)
const CRM_SYNC_RATE_LIMIT_BACKOFF_MS = Number(process.env.CRM_SYNC_RATE_LIMIT_BACKOFF_MS || 10 * 60 * 1000)
const CRM_SYNC_MAX_CHATS = Number(process.env.CRM_SYNC_MAX_CHATS || 300)

const activeSyncs = new Set()

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function isRateLimitError(err) {
  if (err?.code === "EVOLUTION_RATE_LIMIT") return true
  const status = err?.status || err?.details?.status
  if (Number(status) === 429) return true
  const msg = String(err?.message || "").toLowerCase()
  return msg.includes("rate") && msg.includes("limit")
}

function normalizeChatList(payload) {
  if (Array.isArray(payload)) return payload
  return payload?.records || payload?.chats || payload?.data || payload?.response || []
}

/** Mapa remoteJid @lid → telefone (remoteJidAlt nas conversas da Evolution). */
function extractLidPhoneMap(payload) {
  const map = new Map()
  for (const chat of normalizeChatList(payload)) {
    const jid = String(chat?.remoteJid || chat?.id || chat?.jid || chat?.key?.remoteJid || "").trim()
    if (!/@lid$/i.test(jid)) continue
    const phone = phoneFromChatItem(chat)
    if (phone) map.set(jid, phone)
  }
  return map
}

/** Extrai JIDs individuais da resposta do findChats (formatos variados). */
function extractIndividualChats(payload) {
  const list = normalizeChatList(payload)
  const out = []
  const seen = new Set()
  for (const chat of Array.isArray(list) ? list : []) {
    const jid = chat?.remoteJid || chat?.id || chat?.jid || chat?.key?.remoteJid
    if (!jid || !isIndividualJid(jid)) continue
    const norm = String(jid).trim()
    if (seen.has(norm)) continue
    seen.add(norm)
    const altJid = chat?.remoteJidAlt || chat?.jidAlt || chat?.key?.remoteJidAlt || null
    const tsIso = toIsoFromEvolutionTimestamp(
      chat?.updatedAt || chat?.lastMsgTimestamp || chat?.lastMessageTimestamp || chat?.conversationTimestamp,
    )
    out.push({
      remoteJid: norm,
      remoteJidAlt: altJid ? String(altJid).trim() : null,
      phone: phoneFromChatItem(chat),
      pushName: chat?.pushName || chat?.name || null,
      avatarUrl: chat?.profilePicUrl || chat?.profilePictureUrl || null,
      lastActivityAt: tsIso ? new Date(tsIso) : null,
    })
  }
  // Mais recentes primeiro — se o job for interrompido, o mais importante já foi
  out.sort((a, b) => (b.lastActivityAt?.getTime() || 0) - (a.lastActivityAt?.getTime() || 0))
  return out.slice(0, CRM_SYNC_MAX_CHATS)
}

function jobPayload(job) {
  if (!job) return null
  const elapsedMs = Date.now() - job.startedAt.getTime()
  const perChatMs = job.doneChats > 0 ? elapsedMs / job.doneChats : null
  const remaining = Math.max(0, job.totalChats - job.doneChats)
  const etaSeconds = perChatMs && remaining ? Math.round((perChatMs * remaining) / 1000) : null
  return {
    id: job.id,
    scope: job.scope,
    status: job.status,
    totalChats: job.totalChats,
    doneChats: job.doneChats,
    totalMessages: job.totalMessages,
    currentChat: job.currentChat || null,
    cutoffDate: job.cutoffDate ? job.cutoffDate.toISOString() : null,
    error: job.error || null,
    retryAfter: job.retryAfter ? job.retryAfter.toISOString() : null,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    etaSeconds,
    elapsedSeconds: Math.round(elapsedMs / 1000),
  }
}

async function updateJob(deps, job, data) {
  const fresh = await deps.prisma.crmSyncJob.update({ where: { id: job.id }, data })
  emitCrmEvent(deps.io, fresh.userId, "crm:sync", { job: jobPayload(fresh) })
  return fresh
}

/** Importa o histórico de UM chat, paginado. Retorna { imported, rateLimited }. */
async function syncSingleChat(deps, { userId, instanceName, remoteJid, cutoffMs }) {
  const { fetchChatMessages, prisma } = deps
  let imported = 0

  await prisma.crmConversation
    .updateMany({ where: { userId, remoteJid }, data: { syncStatus: "SYNCING" } })
    .catch(() => {})

  try {
    for (let page = 1; page <= CRM_SYNC_MAX_PAGES_PER_CHAT; page += 1) {
      const { payload, records } = await fetchChatMessages(instanceName, remoteJid, {
        page,
        pageSize: CRM_SYNC_PAGE_SIZE,
        cutoffMs,
      })
      const filtered = filterMessagesForGroup(normalizeEvolutionMessages(payload), remoteJid)
      const batch = records?.length ? records : filtered

      if (!batch.length) break

      let reachedCutoff = false
      for (const record of batch) {
        const result = await ingestCrmMessage(deps, { userId, record, source: "import", updateUnread: false })
        if (result?.created) imported += 1
        const tsIso = toIsoFromEvolutionTimestamp(
          record?.messageTimestamp || record?.key?.messageTimestamp || record?.timestamp,
        )
        if (cutoffMs && tsIso && new Date(tsIso).getTime() < cutoffMs) reachedCutoff = true
      }

      if (reachedCutoff || batch.length < CRM_SYNC_PAGE_SIZE) break
      await wait(CRM_SYNC_PAGE_DELAY_MS)
    }

    await prisma.crmConversation
      .updateMany({ where: { userId, remoteJid }, data: { syncStatus: "READY" } })
      .catch(() => {})
    return { imported, rateLimited: false }
  } catch (err) {
    const rateLimited = isRateLimitError(err)
    await prisma.crmConversation
      .updateMany({
        where: { userId, remoteJid },
        data: { syncStatus: rateLimited ? "RATE_LIMITED" : "ERROR" },
      })
      .catch(() => {})
    if (rateLimited) return { imported, rateLimited: true }
    console.error(`[crm-sync] chat ${remoteJid}:`, err?.message || err)
    return { imported, rateLimited: false }
  }
}

/**
 * Inicia um job de sincronização em background.
 * scope: "all" ou um remoteJid específico.
 */
async function startCrmSync(deps, userId, { scope = "all", cutoffDate = null } = {}) {
  const { prisma } = deps

  if (activeSyncs.has(userId)) {
    const running = await prisma.crmSyncJob.findFirst({
      where: { userId, status: "running" },
      orderBy: { startedAt: "desc" },
    })
    if (running) return { alreadyRunning: true, job: jobPayload(running) }
  }

  const conn = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!conn || !conn.connected) {
    const err = new Error("WhatsApp não conectado. Conecte antes de sincronizar.")
    err.code = "WHATSAPP_NOT_CONNECTED"
    throw err
  }

  const lastRateLimited = await prisma.crmSyncJob.findFirst({
    where: { userId, status: "rate_limited", retryAfter: { gt: new Date() } },
    orderBy: { startedAt: "desc" },
  })
  if (lastRateLimited) {
    return { rateLimited: true, job: jobPayload(lastRateLimited) }
  }

  const job = await prisma.crmSyncJob.create({
    data: {
      userId,
      scope,
      status: "running",
      cutoffDate: cutoffDate ? new Date(cutoffDate) : null,
    },
  })

  activeSyncs.add(userId)
  runSyncJob(deps, { userId, instanceName: conn.instanceName, job }).finally(() => {
    activeSyncs.delete(userId)
  })

  return { started: true, job: jobPayload(job) }
}

async function runSyncJob(deps, { userId, instanceName, job }) {
  const { prisma, findChats } = deps
  const cutoffMs = job.cutoffDate ? job.cutoffDate.getTime() : null
  let current = job

  try {
    let chats
    if (job.scope !== "all") {
      chats = [{ remoteJid: job.scope, pushName: null }]
    } else {
      const payload = await findChats(instanceName)
      chats = extractIndividualChats(payload)
    }

    current = await updateJob(deps, current, { totalChats: chats.length })

    const profileResult = await syncContactProfiles(deps, { userId, instanceName, chats }).catch(() => ({
      enriched: 0,
      queued: 0,
      directorySize: 0,
      directory: new Map(),
    }))
    if (profileResult.enriched || profileResult.queued) {
      console.log(
        `[crm-sync] perfis: ${profileResult.enriched} atualizados, ${profileResult.queued} na fila (${profileResult.directorySize} no diretório)`,
      )
    }

    const { ensureContactAndConversation, phoneFromJid, sanitizePushName } = require("./crmCore")
    for (const chat of chats) {
      const phone = chat.phone || phoneFromJid(chat.remoteJid)
      const info = lookupDirectoryInfo(profileResult.directory, {
        remoteJid: chat.remoteJid,
        phone,
      })
      await ensureContactAndConversation(prisma, userId, chat.remoteJid, {
        pushName: info?.pushName || sanitizePushName(chat.pushName, phone),
        avatarUrl: info?.avatarUrl || chat.avatarUrl,
        phone,
      }).catch(() => {})
    }

    let totalMessages = current.totalMessages
    for (let i = 0; i < chats.length; i += 1) {
      const chat = chats[i]
      current = await updateJob(deps, current, { currentChat: chat.pushName || chat.remoteJid.split("@")[0] })

      const { imported, rateLimited } = await syncSingleChat(deps, {
        userId,
        instanceName,
        remoteJid: chat.remoteJid,
        cutoffMs,
      })
      totalMessages += imported

      if (rateLimited) {
        await updateJob(deps, current, {
          status: "rate_limited",
          doneChats: i,
          totalMessages,
          error: "WhatsApp limitou as consultas. A sincronização continua automaticamente mais tarde.",
          retryAfter: new Date(Date.now() + CRM_SYNC_RATE_LIMIT_BACKOFF_MS),
          finishedAt: new Date(),
        })
        return
      }

      current = await updateJob(deps, current, { doneChats: i + 1, totalMessages })
      if (i < chats.length - 1) await wait(CRM_SYNC_CHAT_DELAY_MS)
    }

    await updateJob(deps, current, {
      status: "done",
      currentChat: null,
      finishedAt: new Date(),
    })
    console.log(`[crm-sync] concluído: ${current.doneChats}/${current.totalChats} chats, ${current.totalMessages} msgs (${instanceName})`)
  } catch (err) {
    console.error("[crm-sync] job falhou:", err?.message || err)
    await updateJob(deps, current, {
      status: isRateLimitError(err) ? "rate_limited" : "error",
      error: String(err?.message || "Erro inesperado na sincronização."),
      retryAfter: isRateLimitError(err) ? new Date(Date.now() + CRM_SYNC_RATE_LIMIT_BACKOFF_MS) : null,
      finishedAt: new Date(),
    }).catch(() => {})
  }
}

async function getCrmSyncStatus(prisma, userId) {
  const job = await prisma.crmSyncJob.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
  })
  return jobPayload(job)
}

function isSyncRunning(userId) {
  return activeSyncs.has(userId)
}

module.exports = {
  startCrmSync,
  getCrmSyncStatus,
  isSyncRunning,
  extractIndividualChats,
  extractLidPhoneMap,
  normalizeChatList,
  jobPayload,
}

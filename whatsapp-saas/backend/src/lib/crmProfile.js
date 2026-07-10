/**
 * Enriquecimento de perfil dos contatos do CRM (nome do WhatsApp + foto).
 *
 * Duas fontes:
 * 1. `findContacts` da Evolution — uma chamada só, devolve pushName (nome salvo
 *    na agenda quando sincronizado) e profilePicUrl de todos os contatos.
 *    Usada durante a sincronização de histórico (crmSync).
 * 2. `fetchProfile` da Evolution — consulta individual, usada on-demand quando
 *    chega mensagem de um contato sem nome/foto. Com throttle por contato e
 *    espaçamento global para não martelar a API (anti-ban).
 */

const {
  phoneFromJid,
  cleanIncomingPushName,
  extractIdentityHintsFromRecord,
  contactNeedsIdentification,
  phoneFromChatItem,
  sanitizePushName,
} = require("./crmCore")
const {
  displayNameFromParticipant,
  normalizeContactList,
  phoneDigitsFromJid,
  resolvePhoneDigits,
} = require("./participantIdentity")
const {
  formatConversationRow,
  emitCrmEvent,
  CONVERSATION_INCLUDE,
} = require("./crmCore")

const PROFILE_RETRY_MS = Number(process.env.CRM_PROFILE_RETRY_MS || 12 * 3600 * 1000)
const AVATAR_REFRESH_MS = Number(process.env.CRM_AVATAR_REFRESH_MS || 4 * 3600 * 1000)
const PROFILE_FETCH_GAP_MS = Number(process.env.CRM_PROFILE_FETCH_GAP_MS || 2000)
const PROFILE_QUEUE_MAX = Number(process.env.CRM_PROFILE_QUEUE_MAX || 60)
const PROFILE_BATCH_QUEUE_MAX = Number(process.env.CRM_PROFILE_BATCH_QUEUE_MAX || 120)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function cleanText(value) {
  const s = String(value || "").trim()
  return s || null
}

function cleanUrl(value) {
  const s = String(value || "").trim()
  return /^https?:\/\//i.test(s) ? s : null
}

function mergeInfo(prev = {}, next = {}) {
  return {
    pushName: prev.pushName || next.pushName || null,
    avatarUrl: prev.avatarUrl || next.avatarUrl || null,
    phone: prev.phone || next.phone || null,
  }
}

function directorySet(directory, jid, info) {
  if (!jid || !info) return
  directory.set(jid, mergeInfo(directory.get(jid), info))
  const pd = phoneFromJid(jid) || phoneDigitsFromJid(jid)
  if (pd) directory.set(`digits:${pd}`, mergeInfo(directory.get(`digits:${pd}`), info))
}

function lookupDirectoryInfo(directory, contact) {
  if (!directory?.size || !contact) return null
  const direct = directory.get(contact.remoteJid)
  if (direct) return direct
  const pd = contact.phone || phoneFromJid(contact.remoteJid) || phoneDigitsFromJid(contact.remoteJid)
  if (pd) return directory.get(`digits:${pd}`) || null
  return null
}

/** Normaliza a lista do findContacts (formatos variados) em Map jid -> { pushName, avatarUrl }. */
function buildContactDirectory(payload) {
  const directory = new Map()
  const list = normalizeContactList(payload)
  if (!list.length && payload && typeof payload === "object") {
    const wrapped = payload?.records || payload?.contacts || payload?.data || payload?.response || []
    if (Array.isArray(wrapped)) list.push(...wrapped)
  }

  for (const item of list) {
    const jid = cleanText(item?.remoteJid || item?.id || item?.jid)
    if (!jid || !jid.includes("@")) continue
    const altJid = cleanText(item?.remoteJidAlt || item?.jidAlt || item?.alternateJid)
    const phoneDigits =
      resolvePhoneDigits(item) || phoneDigitsFromJid(jid) || (altJid ? phoneDigitsFromJid(altJid) : null)
    const pushName = sanitizePushName(
      displayNameFromParticipant(item, phoneDigits) ||
        item?.pushName ||
        item?.name ||
        item?.notify,
      phoneDigits,
    )
    const avatarUrl = cleanUrl(item?.profilePicUrl || item?.profilePictureUrl || item?.picture)
    const info = { pushName, avatarUrl, phone: phoneDigits || null }
    if (!pushName && !avatarUrl && !phoneDigits) continue
    directorySet(directory, jid, info)
    if (altJid) directorySet(directory, altJid, info)
    if (phoneDigits) directorySet(directory, `digits:${phoneDigits}`, info)
  }
  return directory
}

/** Complementa o directory com dados que vieram na lista de chats (findChats). */
function mergeChatsIntoDirectory(directory, chats = []) {
  for (const chat of chats) {
    const jid = cleanText(chat?.remoteJid)
    if (!jid) continue
    const phone = chat?.phone || phoneFromChatItem(chat) || null
    const prev = lookupDirectoryInfo(directory, { remoteJid: jid, phone: phone || phoneFromJid(jid) })
    const pushName = sanitizePushName(chat?.pushName, phone)
    const avatarUrl = cleanUrl(chat?.avatarUrl)
    if (!pushName && !avatarUrl && !phone) continue
    directorySet(directory, jid, {
      pushName: prev?.pushName || pushName || null,
      avatarUrl: prev?.avatarUrl || avatarUrl || null,
      phone: prev?.phone || phone || null,
    })
    const altJid = cleanText(chat?.remoteJidAlt)
    if (altJid) {
      directorySet(directory, altJid, {
        pushName: prev?.pushName || pushName || null,
        avatarUrl: prev?.avatarUrl || avatarUrl || null,
        phone: prev?.phone || phone || null,
      })
    }
  }
  return directory
}

/** Extrai URL da foto (fetchProfilePictureUrl ou fetchProfile). */
function pickAvatarFromPicturePayload(payload) {
  const p = payload?.data || payload?.response || payload || {}
  return cleanUrl(p?.profilePictureUrl || p?.profilePicUrl || p?.picture || p?.imgUrl)
}

/** Extrai { pushName, avatarUrl } da resposta do fetchProfile (formatos variados). */
function pickProfileFields(payload) {
  const p = payload?.data || payload?.response || payload?.profile || payload || {}
  const phoneDigits = resolvePhoneDigits(p) || phoneDigitsFromJid(p?.id || p?.remoteJid)
  return {
    pushName: sanitizePushName(
      displayNameFromParticipant(p, phoneDigits) || p?.name || p?.pushName || p?.verifiedName,
      phoneDigits,
    ),
    avatarUrl: pickAvatarFromPicturePayload(p),
    phone: phoneDigits || null,
  }
}

/** Aplica o directory nos CrmContact do usuário. Retorna quantos foram atualizados. */
async function enrichContactsFromDirectory(prisma, userId, directory) {
  if (!directory || directory.size === 0) return 0
  const contacts = await prisma.crmContact.findMany({
    where: { userId },
    select: { id: true, remoteJid: true, phone: true, pushName: true, avatarUrl: true },
  })
  let updated = 0
  for (const contact of contacts) {
    const info = lookupDirectoryInfo(directory, contact)
    if (!info) continue
    const data = {}
    if (info.pushName && info.pushName !== contact.pushName) data.pushName = info.pushName
    if (info.avatarUrl && info.avatarUrl !== contact.avatarUrl) data.avatarUrl = info.avatarUrl
    if (info.phone && !contact.phone) data.phone = info.phone
    if (!Object.keys(data).length) continue
    await prisma.crmContact.update({ where: { id: contact.id }, data }).catch(() => {})
    updated += 1
  }
  return updated
}

/** Monta o diretório de perfis a partir de findContacts + lista de chats. */
async function buildProfileDirectory(deps, instanceName, chats = []) {
  const { findContacts, findChats } = deps
  let directory = new Map()
  if (typeof findContacts === "function") {
    try {
      directory = buildContactDirectory(await findContacts(instanceName))
    } catch (err) {
      console.warn("[crm-profile] findContacts:", err?.message || err)
    }
  }

  let chatList = chats
  if (!chatList.length && typeof findChats === "function") {
    try {
      const { extractIndividualChats } = require("./crmSync")
      chatList = extractIndividualChats(await findChats(instanceName))
    } catch (err) {
      console.warn("[crm-profile] findChats:", err?.message || err)
    }
  }
  mergeChatsIntoDirectory(directory, chatList)
  return { directory, chats: chatList }
}

/** Aplica mapa @lid → telefone nos contatos do CRM (fonte: findChats). */
async function applyLidPhoneMap(deps, userId, lidPhoneMap) {
  const { prisma, io } = deps || {}
  if (!prisma || !lidPhoneMap?.size) return 0

  let updated = 0
  for (const [remoteJid, phone] of lidPhoneMap.entries()) {
    if (!phone) continue
    const contact = await prisma.crmContact.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: { id: true, phone: true },
    })
    if (!contact || contact.phone) continue
    await prisma.crmContact.update({ where: { id: contact.id }, data: { phone } }).catch(() => {})
    updated += 1

    if (io) {
      const conversation = await prisma.crmConversation.findUnique({
        where: { userId_remoteJid: { userId, remoteJid } },
        include: CONVERSATION_INCLUDE,
      })
      if (conversation) {
        emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
      }
    }
  }
  return updated
}

/** Busca findChats e resolve telefones de contatos @lid via remoteJidAlt. */
async function resolveLidPhonesFromChats(deps, { userId, instanceName } = {}) {
  const { findChats } = deps || {}
  if (!findChats || !instanceName) return { resolved: 0, mapSize: 0 }

  try {
    const payload = await findChats(instanceName)
    const { extractLidPhoneMap } = require("./crmSync")
    const map = extractLidPhoneMap(payload)
    const resolved = await applyLidPhoneMap(deps, userId, map)
    return { resolved, mapSize: map.size, payload }
  } catch (err) {
    console.warn("[crm-profile] resolveLidPhonesFromChats:", err?.message || err)
    return { resolved: 0, mapSize: 0, payload: null }
  }
}

/** Remove pushName "Você" gravado por engano (mensagens enviadas / findChats). */
async function clearSelfPushNames(prisma, userId) {
  if (!prisma) return 0
  const bad = await prisma.crmContact.findMany({
    where: { userId, pushName: { not: null } },
    select: { id: true, pushName: true, phone: true, remoteJid: true },
  })
  let cleared = 0
  for (const c of bad) {
    const pd = c.phone || phoneFromJid(c.remoteJid) || phoneDigitsFromJid(c.remoteJid)
    if (!sanitizePushName(c.pushName, pd)) {
      await prisma.crmContact.update({ where: { id: c.id }, data: { pushName: null } }).catch(() => {})
      cleared += 1
    }
  }
  return cleared
}

/** Preenche telefone a partir do JID (@s.whatsapp.net) quando o campo phone está vazio. */
async function backfillPhonesFromJid(prisma, userId) {
  if (!prisma) return 0
  const contacts = await prisma.crmContact.findMany({
    where: { userId, phone: null },
    select: { id: true, remoteJid: true },
    take: 500,
  })
  let updated = 0
  for (const contact of contacts) {
    const phone = phoneFromJid(contact.remoteJid) || phoneDigitsFromJid(contact.remoteJid)
    if (!phone) continue
    await prisma.crmContact.update({ where: { id: contact.id }, data: { phone } }).catch(() => {})
    updated += 1
  }
  return updated
}

/** Varre mensagens recebidas para extrair pushName e telefone alternativo. */
async function reidentifyContactsFromMessages(deps, userId) {
  const { prisma, io } = deps || {}
  if (!prisma) return 0

  const contacts = await prisma.crmContact.findMany({
    where: {
      userId,
      phone: null,
    },
    select: {
      id: true,
      remoteJid: true,
      pushName: true,
      phone: true,
      name: true,
      isLid: true,
      conversation: { select: { id: true } },
    },
    take: 400,
    orderBy: [{ isLid: "desc" }, { updatedAt: "desc" }],
  })

  let updated = 0
  for (const contact of contacts) {
    if (!contact.conversation?.id) continue

    const messages = await prisma.crmMessage.findMany({
      where: { conversationId: contact.conversation.id },
      orderBy: { timestamp: "desc" },
      select: { raw: true, fromMe: true },
      take: 60,
    })

    let pushName = contact.pushName
    let phone = contact.phone

    for (const msg of messages) {
      const raw = msg?.raw
      if (!raw || typeof raw !== "object") continue
      const fromMe = Boolean(msg.fromMe || raw?.key?.fromMe)
      const hints = extractIdentityHintsFromRecord(raw, contact.remoteJid)
      if (!fromMe && !pushName && hints.pushName) pushName = hints.pushName
      if (!phone && hints.phone) phone = hints.phone
      if (pushName && phone) break
    }

    if (!phone) phone = phoneFromJid(contact.remoteJid) || phoneDigitsFromJid(contact.remoteJid)

    const data = {}
    if (pushName && pushName !== contact.pushName) data.pushName = pushName
    if (phone && !contact.phone) data.phone = phone
    if (!Object.keys(data).length) continue

    await prisma.crmContact.update({ where: { id: contact.id }, data }).catch(() => {})
    updated += 1

    if (io) {
      const conversation = await prisma.crmConversation.findUnique({
        where: { userId_remoteJid: { userId, remoteJid: contact.remoteJid } },
        include: CONVERSATION_INCLUDE,
      })
      if (conversation) {
        emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
      }
    }
  }
  return updated
}

/** Extrai pushName de mensagens recentes para contatos sem nome. */
async function enrichPushNamesFromMessages(deps, userId) {
  return reidentifyContactsFromMessages(deps, userId)
}

/**
 * Sincroniza nomes/fotos em lote (findContacts + findChats) e agenda fetchProfile
 * para contatos que ainda ficaram sem nome ou foto.
 */
async function syncContactProfiles(deps, { userId, instanceName, chats = [] } = {}) {
  const { prisma, findChats } = deps
  if (!instanceName) return { enriched: 0, queued: 0, avatarQueued: 0, namesFromMessages: 0, lidPhonesResolved: 0, phonesBackfilled: 0, directorySize: 0, directory: new Map() }

  const clearedPushNames = await clearSelfPushNames(prisma, userId).catch(() => 0)
  const { resolved: lidPhonesResolved, payload: chatPayload } = await resolveLidPhonesFromChats(deps, {
    userId,
    instanceName,
  }).catch(() => ({ resolved: 0, payload: null }))

  let chatList = chats
  if (!chatList.length && chatPayload) {
    const { extractIndividualChats } = require("./crmSync")
    chatList = extractIndividualChats(chatPayload)
  }

  const phonesBackfilled = await backfillPhonesFromJid(prisma, userId).catch(() => 0)
  const namesFromMessages = await reidentifyContactsFromMessages(deps, userId).catch(() => 0)
  const { directory } = await buildProfileDirectory(deps, instanceName, chatList)
  const enriched = await enrichContactsFromDirectory(prisma, userId, directory).catch(() => 0)
  const queued = await queueMissingProfileFetches(deps, { userId, instanceName, limit: PROFILE_BATCH_QUEUE_MAX })
  const avatarQueued = await queueStaleAvatarRefreshes(deps, { userId, instanceName, limit: PROFILE_BATCH_QUEUE_MAX })

  return { enriched, queued, avatarQueued, namesFromMessages, lidPhonesResolved, phonesBackfilled, clearedPushNames, directorySize: directory.size, directory }
}

function queueMissingProfileFetches(deps, { userId, instanceName, limit = PROFILE_BATCH_QUEUE_MAX }) {
  const { prisma } = deps
  if (!prisma || !instanceName) return Promise.resolve(0)

  return prisma.crmContact
    .findMany({
      where: { userId },
      select: { remoteJid: true, pushName: true, name: true, avatarUrl: true, isLid: true },
    })
    .then((contacts) => {
      const pending = contacts
        .filter((c) => contactNeedsProfile(c))
        .sort((a, b) => {
          const aId = contactNeedsIdentification(a) ? 0 : 1
          const bId = contactNeedsIdentification(b) ? 0 : 1
          if (aId !== bId) return aId - bId
          const aScore = !a.avatarUrl ? 0 : 1
          const bScore = !b.avatarUrl ? 0 : 1
          if (aScore !== bScore) return aScore - bScore
          return Number(a.isLid) - Number(b.isLid)
        })

      let queued = 0
      for (const contact of pending) {
        if (queued >= limit) break
        if (scheduleProfileFetch(deps, { userId, instanceName, remoteJid: contact.remoteJid })) queued += 1
      }
      return queued
    })
    .catch(() => 0)
}

/** Re-enfileira refresh de foto para contatos que já têm URL (pode ter expirado). */
function queueStaleAvatarRefreshes(deps, { userId, instanceName, limit = PROFILE_BATCH_QUEUE_MAX }) {
  const { prisma } = deps
  if (!prisma || !instanceName) return Promise.resolve(0)

  return prisma.crmContact
    .findMany({
      where: { userId, avatarUrl: { not: null } },
      select: { remoteJid: true, avatarUrl: true },
    })
    .then((contacts) => {
      let queued = 0
      for (const contact of contacts) {
        if (queued >= limit) break
        if (scheduleProfileFetch(deps, { userId, instanceName, remoteJid: contact.remoteJid, avatarRefresh: true })) {
          queued += 1
        }
      }
      return queued
    })
    .catch(() => 0)
}

// ------------------------- fetch individual (webhook) -------------------------

const lastAttemptByKey = new Map()
const avatarAttemptByKey = new Map()
let fetchChain = Promise.resolve()
let queuedCount = 0

/**
 * Agenda uma busca de perfil para um contato sem nome/foto (fila com espaçamento).
 * avatarRefresh: re-busca foto mesmo quando já existe URL (URLs do WhatsApp expiram).
 * deps: { prisma, io, fetchProfile }. Retorna true se entrou na fila.
 */
function scheduleProfileFetch(deps, { userId, instanceName, remoteJid, avatarRefresh = false }) {
  const { prisma, io, fetchProfile, fetchProfilePictureUrl } = deps
  if (!instanceName || !remoteJid) return false

  const attemptMap = avatarRefresh ? avatarAttemptByKey : lastAttemptByKey
  const retryMs = avatarRefresh ? AVATAR_REFRESH_MS : PROFILE_RETRY_MS
  const key = `${userId}:${remoteJid}`

  const last = attemptMap.get(key) || 0
  if (Date.now() - last < retryMs) return false
  if (queuedCount >= PROFILE_QUEUE_MAX) return false

  attemptMap.set(key, Date.now())
  queuedCount += 1

  fetchChain = fetchChain
    .then(async () => {
      await wait(PROFILE_FETCH_GAP_MS)

      let pushName = null
      let avatarUrl = null
      let phoneHint = null

      // Foto: endpoint dedicado — funciona sem contato salvo na agenda
      if (typeof fetchProfilePictureUrl === "function") {
        try {
          avatarUrl = pickAvatarFromPicturePayload(await fetchProfilePictureUrl(instanceName, remoteJid))
        } catch {
          /* tenta fetchProfile abaixo */
        }
      }

      const needsName = !avatarRefresh
      if ((needsName && (!avatarUrl || !pushName)) && typeof fetchProfile === "function") {
        try {
          const profileTarget = String(remoteJid).includes("@") ? remoteJid : remoteJid.split("@")[0]
          const fields = pickProfileFields(await fetchProfile(instanceName, profileTarget))
          pushName = pushName || fields.pushName
          avatarUrl = avatarUrl || fields.avatarUrl
          phoneHint = fields.phone || null
        } catch {
          /* ignore */
        }
      } else if (avatarRefresh && !avatarUrl && typeof fetchProfile === "function") {
        try {
          const profileTarget = String(remoteJid).includes("@") ? remoteJid : remoteJid.split("@")[0]
          const fields = pickProfileFields(await fetchProfile(instanceName, profileTarget))
          avatarUrl = fields.avatarUrl
          pushName = fields.pushName || null
          phoneHint = fields.phone || null
        } catch {
          /* ignore */
        }
      }

      if (!pushName && !avatarUrl && !phoneHint) return

      const contactBefore = await prisma.crmContact.findUnique({
        where: { userId_remoteJid: { userId, remoteJid } },
        select: { id: true, pushName: true, avatarUrl: true, phone: true },
      })
      if (!contactBefore) return

      const data = {}
      if (pushName && pushName !== contactBefore.pushName) data.pushName = pushName
      if (avatarUrl && avatarUrl !== contactBefore.avatarUrl) data.avatarUrl = avatarUrl
      if (phoneHint && !contactBefore.phone) data.phone = phoneHint
      if (!Object.keys(data).length) return

      await prisma.crmContact.update({ where: { id: contactBefore.id }, data })

      const conversation = await prisma.crmConversation.findUnique({
        where: { userId_remoteJid: { userId, remoteJid } },
        include: CONVERSATION_INCLUDE,
      })
      if (conversation) {
        emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(conversation) })
      }
    })
    .catch((err) => {
      console.warn(`[crm-profile] fetch ${remoteJid}:`, err?.message || err)
    })
    .finally(() => {
      queuedCount -= 1
    })

  return true
}

/** true quando falta foto ou nome do WhatsApp (candidato a enriquecimento). */
function contactNeedsProfile(contact) {
  if (!contact) return false
  if (contactNeedsIdentification(contact)) return true
  return contactNeedsAvatar(contact)
}

/** true quando ainda não tem foto de perfil. */
function contactNeedsAvatar(contact) {
  if (!contact) return false
  return !contact.avatarUrl
}

module.exports = {
  buildContactDirectory,
  mergeChatsIntoDirectory,
  pickProfileFields,
  pickAvatarFromPicturePayload,
  lookupDirectoryInfo,
  buildProfileDirectory,
  enrichContactsFromDirectory,
  enrichPushNamesFromMessages,
  reidentifyContactsFromMessages,
  backfillPhonesFromJid,
  resolveLidPhonesFromChats,
  applyLidPhoneMap,
  syncContactProfiles,
  queueMissingProfileFetches,
  queueStaleAvatarRefreshes,
  scheduleProfileFetch,
  contactNeedsProfile,
  contactNeedsAvatar,
}

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

const { phoneFromJid } = require("./crmCore")
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
const PROFILE_FETCH_GAP_MS = Number(process.env.CRM_PROFILE_FETCH_GAP_MS || 2500)
const PROFILE_QUEUE_MAX = Number(process.env.CRM_PROFILE_QUEUE_MAX || 30)
const PROFILE_BATCH_QUEUE_MAX = Number(process.env.CRM_PROFILE_BATCH_QUEUE_MAX || 40)

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
    const phoneDigits = resolvePhoneDigits(item) || phoneDigitsFromJid(jid)
    const pushName = cleanText(
      displayNameFromParticipant(item, phoneDigits) ||
        item?.pushName ||
        item?.name ||
        item?.notify,
    )
    const avatarUrl = cleanUrl(item?.profilePicUrl || item?.profilePictureUrl || item?.picture)
    if (!pushName && !avatarUrl) continue
    directorySet(directory, jid, { pushName, avatarUrl })
  }
  return directory
}

/** Complementa o directory com dados que vieram na lista de chats (findChats). */
function mergeChatsIntoDirectory(directory, chats = []) {
  for (const chat of chats) {
    const jid = cleanText(chat?.remoteJid)
    if (!jid) continue
    const prev = lookupDirectoryInfo(directory, { remoteJid: jid, phone: phoneFromJid(jid) })
    const pushName = cleanText(chat?.pushName)
    const avatarUrl = cleanUrl(chat?.avatarUrl)
    if (!pushName && !avatarUrl) continue
    directorySet(directory, jid, {
      pushName: prev?.pushName || pushName || null,
      avatarUrl: prev?.avatarUrl || avatarUrl || null,
    })
  }
  return directory
}

/** Extrai { pushName, avatarUrl } da resposta do fetchProfile (formatos variados). */
function pickProfileFields(payload) {
  const p = payload?.data || payload?.response || payload?.profile || payload || {}
  const phoneDigits = resolvePhoneDigits(p) || phoneDigitsFromJid(p?.id || p?.remoteJid)
  return {
    pushName: cleanText(displayNameFromParticipant(p, phoneDigits) || p?.name || p?.pushName || p?.verifiedName),
    avatarUrl: cleanUrl(p?.picture || p?.profilePicUrl || p?.profilePictureUrl),
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

/**
 * Sincroniza nomes/fotos em lote (findContacts + findChats) e agenda fetchProfile
 * para contatos que ainda ficaram sem nome ou foto.
 */
async function syncContactProfiles(deps, { userId, instanceName, chats = [] } = {}) {
  const { prisma } = deps
  if (!instanceName) return { enriched: 0, queued: 0, directorySize: 0, directory: new Map() }

  const { directory } = await buildProfileDirectory(deps, instanceName, chats)
  const enriched = await enrichContactsFromDirectory(prisma, userId, directory).catch(() => 0)
  const queued = await queueMissingProfileFetches(deps, { userId, instanceName, limit: PROFILE_BATCH_QUEUE_MAX })

  return { enriched, queued, directorySize: directory.size, directory }
}

function queueMissingProfileFetches(deps, { userId, instanceName, limit = PROFILE_BATCH_QUEUE_MAX }) {
  const { prisma } = deps
  if (!prisma || !instanceName) return 0

  return prisma.crmContact
    .findMany({
      where: { userId },
      select: { remoteJid: true, pushName: true, name: true, avatarUrl: true, isLid: true },
      take: Math.max(limit * 3, 50),
    })
    .then((contacts) => {
      let queued = 0
      for (const contact of contacts) {
        if (queued >= limit) break
        if (!contactNeedsProfile(contact)) continue
        if (scheduleProfileFetch(deps, { userId, instanceName, remoteJid: contact.remoteJid })) queued += 1
      }
      return queued
    })
    .catch(() => 0)
}

// ------------------------- fetch individual (webhook) -------------------------

const lastAttemptByKey = new Map()
let fetchChain = Promise.resolve()
let queuedCount = 0

/**
 * Agenda uma busca de perfil para um contato sem nome/foto (fila com espaçamento).
 * deps: { prisma, io, fetchProfile }. Retorna true se entrou na fila.
 */
function scheduleProfileFetch(deps, { userId, instanceName, remoteJid }) {
  const { prisma, io, fetchProfile } = deps
  if (!fetchProfile || !instanceName || !remoteJid) return false
  if (String(remoteJid).endsWith("@lid")) return false

  const key = `${userId}:${remoteJid}`
  const last = lastAttemptByKey.get(key) || 0
  if (Date.now() - last < PROFILE_RETRY_MS) return false
  if (queuedCount >= PROFILE_QUEUE_MAX) return false

  lastAttemptByKey.set(key, Date.now())
  queuedCount += 1

  fetchChain = fetchChain
    .then(async () => {
      await wait(PROFILE_FETCH_GAP_MS)
      const payload = await fetchProfile(instanceName, remoteJid.split("@")[0])
      const { pushName, avatarUrl } = pickProfileFields(payload)
      if (!pushName && !avatarUrl) return

      const contact = await prisma.crmContact.findUnique({
        where: { userId_remoteJid: { userId, remoteJid } },
        select: { id: true, pushName: true, avatarUrl: true },
      })
      if (!contact) return

      const data = {}
      if (pushName && pushName !== contact.pushName) data.pushName = pushName
      if (avatarUrl && avatarUrl !== contact.avatarUrl) data.avatarUrl = avatarUrl
      if (!Object.keys(data).length) return

      await prisma.crmContact.update({ where: { id: contact.id }, data })

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

/** true quando o contato ainda não tem nome nem foto (candidato a enriquecimento). */
function contactNeedsProfile(contact) {
  if (!contact) return false
  if (contact.isLid) return !contact.avatarUrl
  return !contact.avatarUrl || !(contact.pushName || contact.name)
}

module.exports = {
  buildContactDirectory,
  mergeChatsIntoDirectory,
  pickProfileFields,
  lookupDirectoryInfo,
  buildProfileDirectory,
  enrichContactsFromDirectory,
  syncContactProfiles,
  queueMissingProfileFetches,
  scheduleProfileFetch,
  contactNeedsProfile,
}

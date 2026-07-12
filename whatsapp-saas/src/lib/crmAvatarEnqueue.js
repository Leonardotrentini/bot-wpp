/**
 * Coordenador de busca progressiva de fotos de perfil (CRM).
 * Uma fila global por aba, batches pequenos e intervalo entre requests HTTP.
 */

import { enqueueCrmAvatars } from '../services/api.js'

const ENQUEUED_TTL_MS = 6 * 60 * 60 * 1000
const BATCH_SIZE = 8
const BATCH_GAP_MS = 3500
const MIN_HTTP_GAP_MS = 3200
const MAX_PENDING_IDS = 96
const BACKGROUND_BATCH_MIN_MS = 90 * 1000
const BACKGROUND_CONVERSATION_MAX = 24
const BACKGROUND_SERVER_LIMIT = 12

const enqueuedAt = new Map()
const pendingIds = new Set()
let activeScope = null
let flushChain = Promise.resolve()
let lastHttpAt = 0
let lastBackgroundBatchAt = 0
let draining = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pruneEnqueuedMap() {
  if (enqueuedAt.size < 2500) return
  const now = Date.now()
  for (const [id, ts] of enqueuedAt) {
    if (now - ts > ENQUEUED_TTL_MS) enqueuedAt.delete(id)
  }
}

function wasEnqueuedRecently(contactId) {
  const ts = enqueuedAt.get(contactId)
  return Boolean(ts && Date.now() - ts < ENQUEUED_TTL_MS)
}

function markEnqueued(contactIds) {
  const now = Date.now()
  for (const id of contactIds) enqueuedAt.set(id, now)
  pruneEnqueuedMap()
}

/** Limpa estado ao trocar de conta (logout, impersonação, etc.). */
export function resetCrmAvatarEnqueueState(scopeKey) {
  const scope = String(scopeKey || '').trim() || 'default'
  if (activeScope === scope) return
  activeScope = scope
  enqueuedAt.clear()
  pendingIds.clear()
  lastBackgroundBatchAt = 0
}

function collectMissingAvatarContactIds(conversations, { max = BACKGROUND_CONVERSATION_MAX } = {}) {
  if (!Array.isArray(conversations)) return []
  const ids = []
  for (const row of conversations) {
    const contact = row?.contact
    if (!contact?.id || contact.isGroup || contact.avatarUrl) continue
    if (wasEnqueuedRecently(contact.id) || pendingIds.has(contact.id)) continue
    ids.push(contact.id)
    if (ids.length >= max) break
  }
  return ids
}

function addToPending(contactIds) {
  let added = false
  for (const id of contactIds) {
    if (pendingIds.size >= MAX_PENDING_IDS) break
    if (!id || wasEnqueuedRecently(id) || pendingIds.has(id)) continue
    pendingIds.add(id)
    added = true
  }
  if (added) triggerDrain()
}

function triggerDrain() {
  if (draining) return
  flushChain = flushChain.then(drainPendingQueue).catch(() => {})
}

async function waitForHttpSlot() {
  const waitMs = Math.max(0, MIN_HTTP_GAP_MS - (Date.now() - lastHttpAt))
  if (waitMs) await sleep(waitMs)
}

async function postAvatarEnqueue(payload) {
  await waitForHttpSlot()
  const res = await enqueueCrmAvatars(payload)
  lastHttpAt = Date.now()
  return res
}

async function drainPendingQueue() {
  if (draining || pendingIds.size === 0) return
  draining = true
  try {
    while (pendingIds.size > 0) {
      const chunk = []
      for (const id of pendingIds) {
        chunk.push(id)
        if (chunk.length >= BATCH_SIZE) break
      }
      for (const id of chunk) pendingIds.delete(id)

      try {
        await postAvatarEnqueue({ contactIds: chunk })
        markEnqueued(chunk)
      } catch {
        /* falha pontual — IDs podem ser reenfileirados depois do TTL */
      }

      if (pendingIds.size > 0) await sleep(BATCH_GAP_MS)
    }
  } finally {
    draining = false
    if (pendingIds.size > 0) triggerDrain()
  }
}

/** Enfileira um contato visível (IntersectionObserver). */
export function requestContactAvatarEnqueue(contactId) {
  const id = String(contactId || '').trim()
  if (!id) return
  addToPending([id])
}

/** Enfileira contatos da lista sem foto. */
export function enqueueAvatarsFromConversations(conversations, options) {
  const ids = collectMissingAvatarContactIds(conversations, options)
  if (!ids.length) return flushChain
  addToPending(ids)
  return flushChain
}

async function maybeEnqueueServerBatch(limit = BACKGROUND_SERVER_LIMIT) {
  const now = Date.now()
  if (now - lastBackgroundBatchAt < BACKGROUND_BATCH_MIN_MS) return
  if (pendingIds.size > BATCH_SIZE) return

  lastBackgroundBatchAt = now
  try {
    await postAvatarEnqueue({ limit })
  } catch {
    /* servidor aplica throttle próprio */
  }
}

/** Varredura periódica: lista visível + lote por atividade recente no servidor. */
export function runBackgroundAvatarSweep(conversations) {
  enqueueAvatarsFromConversations(conversations, { max: BACKGROUND_CONVERSATION_MAX })
  return maybeEnqueueServerBatch()
}

/** @deprecated Prefer runBackgroundAvatarSweep — mantido para compatibilidade. */
export function enqueueNextAvatarBatch(limit = BACKGROUND_SERVER_LIMIT) {
  return maybeEnqueueServerBatch(limit)
}

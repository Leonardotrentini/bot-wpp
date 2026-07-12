/**
 * Enfileira busca progressiva de fotos de perfil (CRM) sem bloquear a UI.
 */

import { enqueueCrmAvatars } from '../services/api.js'

const ENQUEUED_TTL_MS = 6 * 60 * 60 * 1000
const BATCH_SIZE = 18
const BATCH_GAP_MS = 2000

const enqueuedAt = new Map()
let flushChain = Promise.resolve()

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

function collectMissingAvatarContactIds(conversations, { max = 80 } = {}) {
  if (!Array.isArray(conversations)) return []
  const ids = []
  for (const row of conversations) {
    const contact = row?.contact
    if (!contact?.id || contact.isGroup || contact.avatarUrl) continue
    if (wasEnqueuedRecently(contact.id)) continue
    ids.push(contact.id)
    if (ids.length >= max) break
  }
  return ids
}

function scheduleFlush(contactIds) {
  if (!contactIds.length) return flushChain

  markEnqueued(contactIds)

  flushChain = flushChain.then(async () => {
    for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
      const chunk = contactIds.slice(i, i + BATCH_SIZE)
      try {
        await enqueueCrmAvatars({ contactIds: chunk })
      } catch {
        /* fila no servidor — falha pontual não interrompe o lote */
      }
      if (i + BATCH_SIZE < contactIds.length) await sleep(BATCH_GAP_MS)
    }
  })

  return flushChain
}

/** Enfileira IDs específicos (ex.: avatar visível na lista). */
export function requestContactAvatarEnqueue(contactId) {
  const id = String(contactId || '').trim()
  if (!id || wasEnqueuedRecently(id)) return
  scheduleFlush([id])
}

/** Enfileira contatos visíveis/recentes sem foto. */
export function enqueueAvatarsFromConversations(conversations, options) {
  const ids = collectMissingAvatarContactIds(conversations, options)
  if (!ids.length) return Promise.resolve()
  return scheduleFlush(ids)
}

/** Enfileira próximo lote por atividade recente (servidor escolhe se contactIds vazio). */
export function enqueueNextAvatarBatch(limit = 25) {
  return enqueueCrmAvatars({ limit }).catch(() => {})
}

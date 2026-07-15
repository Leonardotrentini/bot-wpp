/** Cache em memória das mensagens recentes por conversa (stale-while-revalidate). */

const MAX_CONVERSATIONS = 40
const FRESH_MS = 2 * 60 * 1000

const cache = new Map()
const inflight = new Map()

function trimCache() {
  while (cache.size > MAX_CONVERSATIONS) {
    const oldestKey = cache.keys().next().value
    if (oldestKey == null) break
    cache.delete(oldestKey)
  }
}

export function getCachedConversationMessages(conversationId) {
  if (!conversationId) return null
  return cache.get(conversationId) || null
}

export function setCachedConversationMessages(conversationId, { messages, hasMore }) {
  if (!conversationId) return
  cache.set(conversationId, {
    messages: messages || [],
    hasMore: Boolean(hasMore),
    fetchedAt: Date.now(),
  })
  trimCache()
}

export function patchCachedConversationMessages(conversationId, patchFn) {
  const entry = cache.get(conversationId)
  if (!entry) return null
  const next = patchFn(entry)
  if (!next) return entry
  cache.set(conversationId, { ...entry, ...next, fetchedAt: Date.now() })
  return cache.get(conversationId)
}

export function appendCachedMessage(conversationId, message) {
  if (!conversationId || !message) return
  patchCachedConversationMessages(conversationId, (entry) => {
    if (entry.messages.some((m) => m.id === message.id)) return entry
    return { messages: [...entry.messages, message] }
  })
}

export function replaceCachedMessage(conversationId, tempId, message) {
  if (!conversationId || !message) return
  patchCachedConversationMessages(conversationId, (entry) => ({
    messages: entry.messages.map((m) => (m.id === tempId ? message : m)),
  }))
}

export function removeCachedMessage(conversationId, messageId) {
  if (!conversationId || !messageId) return
  patchCachedConversationMessages(conversationId, (entry) => ({
    messages: entry.messages.filter((m) => m.id !== messageId),
  }))
}

export function prependCachedMessages(conversationId, olderMessages, hasMore) {
  if (!conversationId || !olderMessages?.length) return
  patchCachedConversationMessages(conversationId, (entry) => {
    const ids = new Set(entry.messages.map((m) => m.id))
    const unique = olderMessages.filter((m) => !ids.has(m.id))
    return {
      messages: [...unique, ...entry.messages],
      hasMore: hasMore ?? entry.hasMore,
    }
  })
}

async function fetchAndStore(conversationId, fetchFn) {
  const result = await fetchFn(conversationId, { limit: 50 })
  const entry = {
    messages: result.messages || [],
    hasMore: Boolean(result.hasMore),
    fetchedAt: Date.now(),
  }
  cache.set(conversationId, entry)
  trimCache()
  inflight.delete(conversationId)
  return entry
}

/**
 * Busca mensagens com stale-while-revalidate.
 * @param {Function} fetchFn async (conversationId, { limit }) => { messages, hasMore }
 * @param {Function} [onUpdated] callback quando revalidação em background termina
 */
export async function fetchConversationMessagesCached(
  conversationId,
  fetchFn,
  { force = false, onUpdated } = {},
) {
  if (!conversationId) return { messages: [], hasMore: false, fetchedAt: Date.now() }

  const cached = cache.get(conversationId)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity

  if (!force && cached && age < FRESH_MS) {
    return cached
  }

  if (!force && cached) {
    if (!inflight.has(conversationId)) {
      const promise = fetchAndStore(conversationId, fetchFn)
        .then((entry) => {
          onUpdated?.(entry)
          return entry
        })
        .catch((err) => {
          inflight.delete(conversationId)
          throw err
        })
      inflight.set(conversationId, promise)
    }
    return cached
  }

  if (inflight.has(conversationId)) {
    return inflight.get(conversationId)
  }

  const promise = fetchAndStore(conversationId, fetchFn).catch((err) => {
    inflight.delete(conversationId)
    throw err
  })
  inflight.set(conversationId, promise)
  return promise
}

/** Prefetch silencioso ao passar o mouse na lista de conversas. */
export function prefetchConversationMessages(conversationId, fetchFn) {
  if (!conversationId) return
  const cached = cache.get(conversationId)
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return
  if (inflight.has(conversationId)) return
  fetchConversationMessagesCached(conversationId, fetchFn).catch(() => {})
}

export function clearConversationMessagesCache() {
  cache.clear()
  inflight.clear()
}

/** Cache em memória das mensagens recentes por conversa (stale-while-revalidate).
 * Chaves incluem userId para não exibir thread de outra conta.
 */

const MAX_CONVERSATIONS = 40
const FRESH_MS = 2 * 60 * 1000

const cache = new Map()
const inflight = new Map()

function msgKey(conversationId, userId) {
  return `${userId || '_anon'}::${conversationId}`
}

function trimCache() {
  while (cache.size > MAX_CONVERSATIONS) {
    const oldestKey = cache.keys().next().value
    if (oldestKey == null) break
    cache.delete(oldestKey)
  }
}

export function getCachedConversationMessages(conversationId, userId) {
  if (!conversationId || !userId) return null
  return cache.get(msgKey(conversationId, userId)) || null
}

export function setCachedConversationMessages(conversationId, { messages, hasMore }, userId) {
  if (!conversationId || !userId) return
  cache.set(msgKey(conversationId, userId), {
    messages: messages || [],
    hasMore: Boolean(hasMore),
    fetchedAt: Date.now(),
    userId,
  })
  trimCache()
}

export function patchCachedConversationMessages(conversationId, patchFn, userId) {
  if (!userId) return null
  const key = msgKey(conversationId, userId)
  const entry = cache.get(key)
  if (!entry) return null
  const next = patchFn(entry)
  if (!next) return entry
  cache.set(key, { ...entry, ...next, fetchedAt: Date.now(), userId })
  return cache.get(key)
}

export function appendCachedMessage(conversationId, message, userId) {
  if (!conversationId || !message || !userId) return
  if (!cache.has(msgKey(conversationId, userId))) {
    setCachedConversationMessages(conversationId, { messages: [message], hasMore: false }, userId)
    return
  }
  patchCachedConversationMessages(
    conversationId,
    (entry) => {
      if (entry.messages.some((m) => m.id === message.id || (message.messageId && m.messageId === message.messageId))) {
        return entry
      }
      return { messages: [...entry.messages, message] }
    },
    userId,
  )
}

export function replaceCachedMessage(conversationId, tempId, message, userId) {
  if (!conversationId || !message || !userId) return
  patchCachedConversationMessages(
    conversationId,
    (entry) => ({
      messages: entry.messages.map((m) => (m.id === tempId ? message : m)),
    }),
    userId,
  )
}

export function removeCachedMessage(conversationId, messageId, userId) {
  if (!conversationId || !messageId || !userId) return
  patchCachedConversationMessages(
    conversationId,
    (entry) => ({
      messages: entry.messages.filter((m) => m.id !== messageId),
    }),
    userId,
  )
}

export function prependCachedMessages(conversationId, olderMessages, hasMore, userId) {
  if (!conversationId || !olderMessages?.length || !userId) return
  patchCachedConversationMessages(
    conversationId,
    (entry) => {
      const ids = new Set(entry.messages.map((m) => m.id))
      const unique = olderMessages.filter((m) => !ids.has(m.id))
      return {
        messages: [...unique, ...entry.messages],
        hasMore: hasMore ?? entry.hasMore,
      }
    },
    userId,
  )
}

async function fetchAndStore(conversationId, fetchFn, userId) {
  const result = await fetchFn(conversationId, { limit: 50 })
  const key = msgKey(conversationId, userId)
  const entry = {
    messages: result.messages || [],
    hasMore: Boolean(result.hasMore),
    fetchedAt: Date.now(),
    userId,
  }
  cache.set(key, entry)
  trimCache()
  inflight.delete(key)
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
  { force = false, onUpdated, userId } = {},
) {
  if (!conversationId || !userId) return { messages: [], hasMore: false, fetchedAt: Date.now() }

  const key = msgKey(conversationId, userId)
  const cached = cache.get(key)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity

  if (!force && cached && age < FRESH_MS) {
    return cached
  }

  if (!force && cached) {
    if (!inflight.has(key)) {
      const promise = fetchAndStore(conversationId, fetchFn, userId)
        .then((entry) => {
          onUpdated?.(entry)
          return entry
        })
        .catch((err) => {
          inflight.delete(key)
          throw err
        })
      inflight.set(key, promise)
    }
    return cached
  }

  if (inflight.has(key)) {
    return inflight.get(key)
  }

  const promise = fetchAndStore(conversationId, fetchFn, userId).catch((err) => {
    inflight.delete(key)
    throw err
  })
  inflight.set(key, promise)
  return promise
}

/** Prefetch silencioso ao passar o mouse na lista de conversas. */
export function prefetchConversationMessages(conversationId, fetchFn, userId) {
  if (!conversationId || !userId) return
  const key = msgKey(conversationId, userId)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return
  if (inflight.has(key)) return
  fetchConversationMessagesCached(conversationId, fetchFn, { userId }).catch(() => {})
}

export function clearConversationMessagesCache() {
  cache.clear()
  inflight.clear()
}

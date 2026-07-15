/** Cache da lista de conversas (stale-while-revalidate entre Chat, CRM, filtros e remounts). */

const FRESH_MS = 30_000
const cache = new Map()

export const CRM_CONVERSATIONS_LIST_PARAMS = { limit: 200, includeTotal: 0 }
export const CHAT_CONVERSATIONS_LIST_PARAMS = { includeTotal: 0 }

function paramsKey(params) {
  return JSON.stringify(params || {})
}

/** Lista com filtro de membro não pode virar cache "global" da inbox. */
function isNarrowListParams(params) {
  if (!params || typeof params !== 'object') return false
  return Boolean(params.sellerUserId || params.tagId || params.stageId || params.q)
}

export function getCachedConversationsList(params) {
  const entry = cache.get(paramsKey(params))
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > FRESH_MS) return null
  return entry.conversations
}

export function setCachedConversationsList(params, conversations) {
  cache.set(paramsKey(params), { conversations, fetchedAt: Date.now(), narrow: isNarrowListParams(params) })
  if (cache.size > 12) {
    const oldest = cache.keys().next().value
    if (oldest != null) cache.delete(oldest)
  }
}

/** Grava a mesma lista em chaves usadas pelo Chat e pelo CRM (só se for lista ampla). */
export function mirrorConversationsListCache(conversations, sourceParams) {
  if (!conversations?.length) return
  setCachedConversationsList(sourceParams, conversations)
  if (isNarrowListParams(sourceParams)) return
  setCachedConversationsList(CRM_CONVERSATIONS_LIST_PARAMS, conversations)
  setCachedConversationsList(CHAT_CONVERSATIONS_LIST_PARAMS, conversations)
}

/** Retorna a lista em cache mais recente (prioriza os params informados). */
export function getBestCachedConversationsList(preferredParams = CRM_CONVERSATIONS_LIST_PARAMS) {
  const preferred = getCachedConversationsList(preferredParams)
  if (preferred?.length) return preferred

  let best = null
  let bestAt = 0
  for (const entry of cache.values()) {
    if (!entry.conversations?.length) continue
    if (entry.narrow) continue
    if (Date.now() - entry.fetchedAt > FRESH_MS) continue
    if (entry.fetchedAt > bestAt) {
      best = entry.conversations
      bestAt = entry.fetchedAt
    }
  }
  return best
}

export function clearConversationsListCache() {
  cache.clear()
}

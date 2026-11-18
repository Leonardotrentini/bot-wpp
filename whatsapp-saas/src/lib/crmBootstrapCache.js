/** Cache compartilhado entre Chat/CRM para evitar refetch ao trocar de rota.
 * Isolado por userId — evita tags/estágios/WA status de outra conta após impersonação.
 */

const FRESH_MS = 5 * 60 * 1000

const emptyStore = () => ({
  tags: null,
  stages: null,
  agents: null,
  quickReplies: null,
  waConnected: null,
  waSyncStale: null,
  aiConfigured: false,
  aiKeyLast4: null,
  aiStatusLoaded: false,
  fetchedAt: 0,
  userId: null,
})

let store = emptyStore()

export function getCrmBootstrapCache(userId) {
  if (!userId || store.userId !== userId) return null
  if (!store.fetchedAt || Date.now() - store.fetchedAt > FRESH_MS) return null
  return { ...store }
}

export function setCrmBootstrapCache(partial, userId) {
  if (!userId) return
  if (store.userId && store.userId !== userId) {
    store = emptyStore()
  }
  Object.assign(store, partial, { fetchedAt: Date.now(), userId })
}

export function profilesRefreshDoneThisSession() {
  try {
    return sessionStorage.getItem('crm_profiles_refreshed') === '1'
  } catch {
    return false
  }
}

export function markProfilesRefreshDone() {
  try {
    sessionStorage.setItem('crm_profiles_refreshed', '1')
  } catch {
    /* ignore */
  }
}

export function clearCrmBootstrapCache() {
  store = emptyStore()
}

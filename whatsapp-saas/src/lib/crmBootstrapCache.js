/** Cache compartilhado entre Chat/CRM para evitar refetch ao trocar de rota. */

const FRESH_MS = 5 * 60 * 1000

const store = {
  tags: null,
  stages: null,
  agents: null,
  quickReplies: null,
  waConnected: null,
  fetchedAt: 0,
}

export function getCrmBootstrapCache() {
  if (!store.fetchedAt || Date.now() - store.fetchedAt > FRESH_MS) return null
  return { ...store }
}

export function setCrmBootstrapCache(partial) {
  Object.assign(store, partial, { fetchedAt: Date.now() })
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
  store.tags = null
  store.stages = null
  store.agents = null
  store.quickReplies = null
  store.waConnected = null
  store.fetchedAt = 0
}

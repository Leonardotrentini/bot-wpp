/**
 * Limpa caches em memória e força reconnect do socket ao trocar de conta/sessão,
 * evitando "respingo" de conversas/mensagens entre vendedores ou impersonação.
 */

import { clearConversationsListCache } from './conversationsListCache.js'
import { clearConversationMessagesCache } from './conversationMessagesCache.js'
import { clearCrmBootstrapCache } from './crmBootstrapCache.js'
import { disconnectSocket, connectSocket } from '../services/socket.js'
import { resolveUseRealApi } from './runtimeEnv.js'

export function clearSessionScopedCaches() {
  clearConversationsListCache()
  clearConversationMessagesCache()
  clearCrmBootstrapCache()
  try {
    sessionStorage.removeItem('crm_profiles_refreshed')
  } catch {
    /* ignore */
  }
}

/** Chamar após login, logout, impersonate ou exit impersonate. */
export function resetRealtimeAndCaches() {
  clearSessionScopedCaches()
  disconnectSocket()
  if (resolveUseRealApi() && localStorage.getItem('vg_auth_token')) {
    connectSocket()
  }
}

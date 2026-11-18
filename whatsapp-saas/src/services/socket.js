import { io } from 'socket.io-client'
import { resolveApiBaseURL, resolveUseRealApi } from '../lib/runtimeEnv.js'

let socket = null
let everConnected = false
const reconnectHandlers = new Set()

function socketBaseUrl() {
  // API base termina em /api — o socket fica na raiz do mesmo host
  return resolveApiBaseURL().replace(/\/api\/?$/, '')
}

function notifyReconnect() {
  for (const handler of reconnectHandlers) {
    try {
      handler()
    } catch {
      /* handler isolado */
    }
  }
}

function bindLifecycle(s) {
  if (s.__vestoLifecycleBound) return
  s.__vestoLifecycleBound = true
  s.on('connect', () => {
    // 1ª conexão: só marca; reconexões disparam refresh da inbox/CRM
    if (everConnected) notifyReconnect()
    everConnected = true
  })
}

export function getSocket() {
  return socket
}

/** Conecta o socket autenticado (sala privada do usuário no backend). */
export function connectSocket() {
  if (!resolveUseRealApi()) return null
  const token = localStorage.getItem('vg_auth_token')
  if (!token) return null

  if (socket) {
    socket.auth = { token }
    if (!socket.connected) socket.connect()
    return socket
  }

  socket = io(socketBaseUrl(), {
    autoConnect: true,
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  })
  bindLifecycle(socket)
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  everConnected = false
}

/** Assina um evento e devolve função de unsubscribe. */
export function onSocketEvent(event, handler) {
  const s = connectSocket()
  if (!s) return () => {}
  s.on(event, handler)
  return () => s.off(event, handler)
}

/** Roda após o socket reconectar (eventos perdidos no intervalo). */
export function onSocketReconnect(handler) {
  if (typeof handler !== 'function') return () => {}
  connectSocket()
  reconnectHandlers.add(handler)
  return () => reconnectHandlers.delete(handler)
}

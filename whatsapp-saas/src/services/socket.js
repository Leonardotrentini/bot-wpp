import { io } from 'socket.io-client'
import { resolveApiBaseURL, resolveUseRealApi } from '../lib/runtimeEnv.js'

let socket = null

function socketBaseUrl() {
  // API base termina em /api — o socket fica na raiz do mesmo host
  return resolveApiBaseURL().replace(/\/api\/?$/, '')
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
  })
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

/** Assina um evento e devolve função de unsubscribe. */
export function onSocketEvent(event, handler) {
  const s = connectSocket()
  if (!s) return () => {}
  s.on(event, handler)
  return () => s.off(event, handler)
}

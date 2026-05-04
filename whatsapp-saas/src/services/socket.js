/**
 * Cliente Socket.io — preparado para uso com backend real.
 *
 * Exemplo (descomente quando o servidor estiver pronto):
 *
 * import { io } from 'socket.io-client'
 * const URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000'
 * export const socket = io(URL, { autoConnect: false, transports: ['websocket'] })
 * export function connectSocket(token) {
 *   socket.auth = { token }
 *   socket.connect()
 * }
 */

export const socket = null
export function connectSocket() {}
export function disconnectSocket() {}

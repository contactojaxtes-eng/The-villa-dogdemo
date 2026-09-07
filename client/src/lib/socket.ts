import { io as connect, type ManagerOptions, type SocketOptions } from 'socket.io-client'
import { api } from './api'

// Read the current token on every handshake, including reconnections.
export function io(url: string, options: Partial<ManagerOptions & SocketOptions> = {}) {
  const socket = connect(url, {
    ...options,
    auth: callback => callback({ token: api.getToken() }),
  })
  // Invalidar primero los datos relacionados para que los listeners de cada vista
  // siempre consulten la versión nueva cuando reciben un evento en tiempo real.
  socket.prependAny((event) => api.invalidateRealtimeEvent(String(event || '')))
  let disposed = false
  const disconnect = socket.disconnect.bind(socket)
  socket.disconnect = () => { disposed = true; return disconnect() }
  let refreshing = false
  const reconnectSession = async () => {
    if (disposed || refreshing || !api.getToken()) return
    refreshing = true
    try {
      if (await api.refreshSession() && !disposed) socket.connect()
    } finally { refreshing = false }
  }
  socket.on('connect_error', error => {
    if (error.message === 'SESSION_EXPIRED') void reconnectSession()
  })
  socket.on('disconnect', reason => {
    if (reason === 'io server disconnect') void reconnectSession()
  })
  return socket
}

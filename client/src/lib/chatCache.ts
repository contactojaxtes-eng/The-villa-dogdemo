// Caché en memoria del espacio de WhatsApp. Sobrevive a la navegación entre
// módulos durante la sesión y evita volver a mostrar bandejas o chats vacíos.
import { DEFAULT_SITE_ID } from './multisite'

export interface CachedSession {
  id: string
  phone: string
  customerPhone?: string | null
  customerName: string | null
  lastMessageAt?: string
  assignedToId?: string | null
  assignedTo?: { id: string; name: string } | null
  unreadCount?: number
  waitingForAdvisor?: boolean
  activeOrder?: { id: string; orderNumber: number; status: string; total?: number } | null
  messages?: any[]
}

type SessionCacheEntry = {
  sessions: CachedSession[]
  savedAt: number
  siteId: string
}

const sessionQueries = new Map<string, SessionCacheEntry>()
const MAX_SESSION_QUERIES = 12
const MAX_MESSAGE_CHATS = 30
const MAX_MESSAGES_PER_CHAT = 180

export let globalSessionsCache: CachedSession[] | null = null
export let globalActiveSessionIdCache: string | null = null
export const globalMessagesCache: Record<string, any[]> = {}
const messageCacheSites = new Map<string, string>()
let activeChatSiteId: string | null = null

/**
 * Changes the in-memory cache namespace.  This is deliberately separate from
 * the API cache: switching sites must make an old WhatsApp response harmless
 * even if a component is still completing an asynchronous render.
 */
export function setChatCacheScope(siteId?: string | null) {
  const normalized = String(siteId || DEFAULT_SITE_ID).trim() || DEFAULT_SITE_ID
  if (activeChatSiteId === normalized) return
  clearChatCache()
  activeChatSiteId = normalized
}

export function getChatCacheScope() {
  return activeChatSiteId
}

export function getSessionCacheKey(search = '', filter = 'TODAY') {
  return `${filter.trim().toUpperCase() || 'TODAY'}::${search.trim().toLowerCase()}`
}

export function getCachedSessions(search = '', filter = 'TODAY') {
  const key = getSessionCacheKey(search, filter)
  const entry = sessionQueries.get(key)
  if (!entry || (activeChatSiteId && entry.siteId !== activeChatSiteId)) return null
  sessionQueries.delete(key)
  sessionQueries.set(key, entry)
  return entry.sessions
}

export function setCachedSessions(search: string, filter: string, sessions: CachedSession[]) {
  const key = getSessionCacheKey(search, filter)
  sessionQueries.delete(key)
  sessionQueries.set(key, {
    sessions,
    savedAt: Date.now(),
    siteId: activeChatSiteId || DEFAULT_SITE_ID,
  })
  if (!search.trim() && filter.toUpperCase() === 'TODAY') globalSessionsCache = sessions

  while (sessionQueries.size > MAX_SESSION_QUERIES) {
    const oldestKey = sessionQueries.keys().next().value as string | undefined
    if (!oldestKey) break
    sessionQueries.delete(oldestKey)
  }
}

export function setGlobalSessionsCache(sessions: CachedSession[] | null) {
  globalSessionsCache = sessions
  if (sessions) setCachedSessions('', 'TODAY', sessions)
}

export function getCachedMessages(sessionId: string) {
  if (activeChatSiteId && messageCacheSites.get(sessionId) !== activeChatSiteId) return null
  const cached = globalMessagesCache[sessionId]
  return cached?.length ? cached : null
}

export function setCachedMessages(sessionId: string, messages: any[], siteId?: string | null) {
  if (!sessionId) return
  const normalizedSiteId = String(siteId || activeChatSiteId || DEFAULT_SITE_ID).trim() || DEFAULT_SITE_ID
  if (activeChatSiteId && normalizedSiteId !== activeChatSiteId) return
  delete globalMessagesCache[sessionId]
  globalMessagesCache[sessionId] = messages.slice(-MAX_MESSAGES_PER_CHAT)
  messageCacheSites.set(sessionId, normalizedSiteId)

  const ids = Object.keys(globalMessagesCache)
  while (ids.length > MAX_MESSAGE_CHATS) {
    const oldestId = ids.shift()
    if (oldestId) delete globalMessagesCache[oldestId]
  }
}

export function removeCachedMessages(sessionId: string) {
  delete globalMessagesCache[sessionId]
  messageCacheSites.delete(sessionId)
}

export function cacheWhatsappMessage(payload: {
  id?: string
  waMessageId?: string
  sessionId?: string
  phone?: string
  customerName?: string
  direction: 'IN' | 'OUT'
  content?: string
  messageType?: string
  status?: string
  createdAt?: string
  assignedToId?: string | null
  assignedTo?: { id: string; name: string } | null
  siteId?: string | null
}) {
  if (!payload.sessionId) return
  const payloadSiteId = String(payload.siteId || '').trim()
  // Secondary-site socket payloads must carry their site.  Legacy principal
  // events can omit it for compatibility, but an event explicitly tagged for
  // another site is always ignored.
  if (activeChatSiteId && payloadSiteId && payloadSiteId !== activeChatSiteId) return
  if (activeChatSiteId && activeChatSiteId !== DEFAULT_SITE_ID && !payloadSiteId) return
  const sessionId = payload.sessionId

  const messageId = payload.id || payload.waMessageId || `socket-${Date.now()}`
  const message = {
    id: messageId,
    waMessageId: payload.waMessageId || null,
    direction: payload.direction,
    content: payload.content || '',
    messageType: payload.messageType || 'text',
    status: payload.status || (payload.direction === 'OUT' ? 'sent' : 'received'),
    createdAt: payload.createdAt || new Date().toISOString(),
  }
  const normalizedPhone = (value?: string) => (value || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')
  const payloadPhone = normalizedPhone(payload.phone)

  const updateSessions = (sessions: CachedSession[], addMissing: boolean) => {
    const index = sessions.findIndex(session =>
      session.id === sessionId ||
      Boolean(payloadPhone && normalizedPhone(session.phone) === payloadPhone)
    )
    const next = [...sessions]

    if (index >= 0) {
      const current = next[index]
      const existingMessages = current.messages || []
      const isDuplicate = existingMessages.some(existing =>
        existing.id === message.id ||
        Boolean(message.waMessageId && existing.waMessageId === message.waMessageId)
      )
      next[index] = {
        ...current,
        customerName: payload.customerName || current.customerName,
        lastMessageAt: message.createdAt,
        assignedToId: payload.assignedToId !== undefined ? payload.assignedToId : current.assignedToId,
        assignedTo: payload.assignedTo !== undefined ? payload.assignedTo : current.assignedTo,
        unreadCount: payload.direction === 'IN' && !isDuplicate ? (current.unreadCount || 0) + 1 : current.unreadCount,
        messages: isDuplicate ? existingMessages : [message, ...existingMessages].slice(0, 12),
      }
    } else if (addMissing) {
      next.unshift({
        id: sessionId,
        phone: payload.phone || '',
        customerName: payload.customerName || payload.phone || 'Cliente',
        lastMessageAt: message.createdAt,
        assignedToId: payload.assignedToId || null,
        assignedTo: payload.assignedTo || null,
        unreadCount: payload.direction === 'IN' ? 1 : 0,
        messages: [message],
      })
    }

    return next.sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime())
  }

  for (const [key, entry] of sessionQueries.entries()) {
    const separator = key.indexOf('::')
    const filter = separator >= 0 ? key.slice(0, separator) : 'TODAY'
    const search = separator >= 0 ? key.slice(separator + 2) : ''
    entry.sessions = updateSessions(entry.sessions, !search && (filter === 'TODAY' || filter === 'ALL'))
    entry.savedAt = Date.now()
  }

  const todayEntry = sessionQueries.get(getSessionCacheKey('', 'TODAY'))
  if (todayEntry) {
    globalSessionsCache = todayEntry.sessions
  } else {
    setCachedSessions('', 'TODAY', updateSessions(globalSessionsCache || [], true))
  }

  const currentMessages = globalMessagesCache[sessionId] || []
  const alreadyCached = currentMessages.some(existing =>
    existing.id === message.id ||
    Boolean(message.waMessageId && existing.waMessageId === message.waMessageId)
  )
  if (!alreadyCached) setCachedMessages(sessionId, [...currentMessages, message], payloadSiteId || activeChatSiteId)
}

export function setGlobalActiveSessionIdCache(id: string | null) {
  globalActiveSessionIdCache = id
}

export function clearChatCache() {
  sessionQueries.clear()
  globalSessionsCache = null
  globalActiveSessionIdCache = null
  for (const sessionId of Object.keys(globalMessagesCache)) {
    delete globalMessagesCache[sessionId]
  }
  messageCacheSites.clear()
}

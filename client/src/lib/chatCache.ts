// Centralized cache for WhatsApp sessions to avoid circular dependencies between ChatPage and NewOrderPage
export interface CachedSession {
  id: string
  phone: string
  customerName: string | null
  lastMessageAt?: string
  assignedToId?: string | null
  assignedTo?: { id: string; name: string } | null
  unreadCount?: number
  activeOrder?: { id: string; orderNumber: number; status: string; total?: number } | null
  messages?: any[]
}

export let globalSessionsCache: CachedSession[] | null = null
export let globalActiveSessionIdCache: string | null = null

export function setGlobalSessionsCache(sessions: CachedSession[] | null) {
  globalSessionsCache = sessions
}

export function setGlobalActiveSessionIdCache(id: string | null) {
  globalActiveSessionIdCache = id
}

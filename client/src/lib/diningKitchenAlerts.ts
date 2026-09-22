import type { BasicUser, KitchenTicketSummary } from './tableTypes'

export const DINING_KITCHEN_DELAYS_CHANGED_EVENT = 'the-villa-dog-dining-kitchen-delays-changed'
export const DINING_KITCHEN_DELAY_MS = 15 * 60 * 1000

export interface DiningKitchenDelay {
  ticketId: string
  tableId: string
  tableLabel: string
  orderNumber?: number
  stationName: string
  startedAt: string
  minutes: number
  status: string
}

let currentDelays: DiningKitchenDelay[] = []

export function getCurrentDiningKitchenDelays() {
  return currentDelays
}

export function publishDiningKitchenDelays(delays: DiningKitchenDelay[]) {
  currentDelays = [...delays].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
  window.dispatchEvent(new CustomEvent<DiningKitchenDelay[]>(DINING_KITCHEN_DELAYS_CHANGED_EVENT, {
    detail: currentDelays,
  }))
}

export function isActiveDiningKitchenTicket(ticket: KitchenTicketSummary) {
  const tableId = ticket.tableId || ticket.order?.tableId || ticket.order?.diningTable?.id
  return Boolean(
    tableId
    && String(ticket.order?.orderType || '').toUpperCase() === 'LOCAL'
    && ['NEW', 'PREPARING'].includes(ticket.status),
  )
}

export function isDiningKitchenTicketForUser(ticket: KitchenTicketSummary, user: BasicUser) {
  if (!isActiveDiningKitchenTicket(ticket)) return false

  if (['ADMIN', 'SUPERADMIN'].includes(user.role || '')) {
    return true
  }

  if (user.role === 'WAITER') {
    return ticket.order?.waiter?.id === user.id
  }

  if (user.role === 'KITCHEN') {
    const assignedToId = ticket.assignedToId || ticket.assignedTo?.id
    if (assignedToId) return assignedToId === user.id
    return Boolean(ticket.station?.users?.some(member => member.id === user.id))
  }

  return false
}

export function toDiningKitchenDelay(ticket: KitchenTicketSummary, now = Date.now()): DiningKitchenDelay | null {
  if (!isActiveDiningKitchenTicket(ticket)) return null
  const startedAt = new Date(ticket.createdAt).getTime()
  if (!Number.isFinite(startedAt) || now - startedAt < DINING_KITCHEN_DELAY_MS) return null

  const tableId = ticket.tableId || ticket.order?.tableId || ticket.order?.diningTable?.id
  if (!tableId) return null

  return {
    ticketId: ticket.id,
    tableId,
    tableLabel: ticket.order?.diningTable?.label || ticket.order?.customerName || 'Mesa',
    orderNumber: ticket.order?.orderNumber,
    stationName: ticket.station?.name || 'Cocina',
    startedAt: ticket.createdAt,
    minutes: Math.max(15, Math.floor((now - startedAt) / 60_000)),
    status: ticket.status,
  }
}

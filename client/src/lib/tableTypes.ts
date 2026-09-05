export interface BasicUser {
  id: string
  name: string
  role?: string
  active?: boolean
}

export interface MenuCategorySummary {
  id: string
  name: string
}

export interface MenuItemSummary {
  id: string
  name: string
  price: number
  category?: MenuCategorySummary
}

export interface OrderItemSummary {
  id: string
  menuItemId: string
  quantity: number
  unitPrice?: number
  totalPrice?: number
  notes?: string
  nameSnapshot?: string
  menuItem?: MenuItemSummary
}

export interface KitchenStationSummary {
  id: string
  name: string
  active?: boolean
  priority?: number
  color?: string
  categories?: MenuCategorySummary[]
  users?: BasicUser[]
}

export interface KitchenTicketItemSummary {
  id: string
  quantity: number
  nameSnapshot: string
  notes?: string
  previousQty?: number
  previousNotes?: string
  changeType?: 'UNCHANGED' | 'ADDED' | 'MODIFIED' | 'REMOVED' | string
}

export interface DiningOrderSummary {
  id: string
  orderNumber?: number
  createdAt: string
  status: string
  customerName?: string
  notes?: string
  kitchenStatus?: string
  paymentStatus?: string
  total?: number
  tableId?: string
  diningTable?: { id?: string; label?: string }
  waiter?: BasicUser
  items?: OrderItemSummary[]
  kitchenTickets?: KitchenTicketSummary[]
  changeLogs?: { id: string; summary: string }[]
}

export interface KitchenTicketSummary {
  id: string
  orderId?: string
  stationId?: string
  status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | string
  changeSummary?: string
  isEdited?: boolean
  assignedToId?: string
  assignedTo?: BasicUser
  createdAt: string
  updatedAt?: string
  station?: KitchenStationSummary
  order?: DiningOrderSummary
  items?: KitchenTicketItemSummary[]
}

export interface DiningTableSummary {
  id: string
  label: string
  status?: string
  total?: number
  balance?: number
  kitchenStatus?: string
  paymentStatus?: string
  openedBy?: BasicUser
  orders?: DiningOrderSummary[]
  transferProofs?: TransferProofSummary[]
}

export interface TransferProofSummary {
  id: string
  status: string
  method: string
  amount: number
  rejectionReason?: string
  submittedBy?: BasicUser
}

export interface PaymentValidationSummary {
  id: string
  status: string
  method: string
  amount?: number
  paymentReference?: string
  order?: DiningOrderSummary
  transferProofs?: TransferProofSummary[]
}

export interface OfflineTableOrderPayload {
  clientMutationId: string
  tableId?: string
  tableLabel: string
  notes: string
  items: Array<{ menuItemId: string; quantity: number; notes?: string }>
  paymentMethod: string
  editOrderId?: string
  offline?: boolean
}

export function getErrorMessage(error: unknown, fallback = 'Error inesperado') {
  return error instanceof Error ? error.message : fallback
}

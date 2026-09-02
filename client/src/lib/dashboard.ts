export interface DashboardStats {
  range: { start: string; end: string }
  today: { orders: number; delivered: number; pending: number; cancelled: number; sales: number }
  operation: { openTables: number; kitchenPending: number; pendingPayments: number; activeDeliveries: number; openRegisters: number }
}

// Fail visibly on an incompatible API instead of showing invented zeros.
export function isDashboardStats(value: unknown): value is DashboardStats {
  if (!value || typeof value !== 'object') return false
  const data = value as DashboardStats
  return !!data.today && !!data.operation && !!data.range
    && typeof data.range.start === 'string' && typeof data.range.end === 'string'
    && ['orders', 'delivered', 'pending', 'cancelled', 'sales'].every(key => Number.isFinite(data.today[key as keyof DashboardStats['today']]))
    && ['openTables', 'kitchenPending', 'pendingPayments', 'activeDeliveries', 'openRegisters'].every(key => Number.isFinite(data.operation[key as keyof DashboardStats['operation']]))
}

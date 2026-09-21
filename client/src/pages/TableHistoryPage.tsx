import { ProtectedImage } from '@/components/ProtectedImage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock, Eye, RefreshCw, Search, UtensilsCrossed, Wallet, ChefHat, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { io } from '@/lib/socket'

function formatTableDate(dateVal?: string | Date | null): string {
  if (!dateVal) return '—'
  try {
    const d = new Date(dateVal)
    if (isNaN(d.getTime())) return '—'
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    return '—'
  }
}

function cleanStr(val: any): string {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function parseTablePayment(t: any): {
  cash: number
  transfer: number
  methodLabel: string
  hasRealImageProof: boolean
  proofId: string | null
} {
  const total = Number(t?.total) || 0
  const orders = (t?.orders || []).filter((o: any) => o && o.status !== 'CANCELLED')
  const proofs = t?.transferProofs || []

  // Buscar comprobante con foto real subida (evitar filas de auditoría en efectivo)
  const realProof = proofs.find((p: any) =>
    Boolean(p && (p.fileBase64 || p.filePath || (p.method !== 'CASH' && (p.fileSize > 0 || p.filePath))))
  )
  const proofId = realProof?.id || null
  const hasRealImageProof = Boolean(realProof)

  let cash = 0
  let transfer = 0
  let ordersWithMethodCount = 0

  for (const o of orders) {
    if (!o) continue
    const rawMethod = String(o.payment?.method || o.paymentMethod || '').toUpperCase().trim()
    const oTotal = Number(o.total || 0)
    const oCash = Number(o.cashAmount || o.payment?.cashAmount || 0)
    const oTransfer = Number(o.transferAmount || o.payment?.transferAmount || 0)

    if (rawMethod === 'CASH') {
      cash += oTotal
      ordersWithMethodCount++
    } else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(rawMethod)) {
      transfer += oTotal
      ordersWithMethodCount++
    } else if (rawMethod === 'MIXED') {
      ordersWithMethodCount++
      if (oCash > 0 || oTransfer > 0) {
        cash += oCash
        transfer += oTransfer
      } else {
        cash += oTotal / 2
        transfer += oTotal / 2
      }
    }
  }

  // 1. Si los pedidos de la mesa tienen métodos explícitos
  if (ordersWithMethodCount > 0 && (cash > 0 || transfer > 0)) {
    const sum = cash + transfer
    if (sum > 0 && Math.abs(sum - total) > 0.01) {
      const ratio = total / sum
      cash = Math.round(cash * ratio)
      transfer = Math.round(transfer * ratio)
    }
  } else if (proofs.length > 0) {
    // 2. Si no hay en pedidos, revisar proofs
    const validProofs = proofs.filter((p: any) => Boolean(p))
    const methods = validProofs.map((p: any) => String(p?.payment?.method || p?.method || '').toUpperCase().trim())
    const isMixed = methods.includes('MIXED')
    const hasTransfer = methods.some((m: string) => ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m))
    const isOnlyCash = methods.every((m: string) => m === 'CASH')

    if (isMixed) {
      const pCash = validProofs.reduce((sum: number, p: any) => sum + Number(p?.payment?.cashAmount || 0), 0)
      const pTransfer = validProofs.reduce((sum: number, p: any) => sum + Number(p?.payment?.transferAmount || 0), 0)
      if (pCash > 0 || pTransfer > 0) {
        cash = pCash
        transfer = pTransfer
      } else {
        cash = total / 2
        transfer = total / 2
      }
    } else if (hasTransfer) {
      cash = 0
      transfer = total
    } else if (isOnlyCash) {
      cash = total
      transfer = 0
    } else {
      cash = total
      transfer = 0
    }
  } else {
    // 3. Por defecto (efectivo estándar)
    cash = total
    transfer = 0
  }

  let methodLabel = '💵 Efectivo'
  if (cash > 0 && transfer > 0) {
    methodLabel = `🔀 Mixto (💵 ${formatCurrency(cash)} · 📲 ${formatCurrency(transfer)})`
  } else if (transfer > 0) {
    methodLabel = '📲 Transferencia'
  } else {
    methodLabel = '💵 Efectivo'
  }

  return {
    cash,
    transfer,
    methodLabel,
    hasRealImageProof,
    proofId,
  }
}

export default function TableHistoryPage() {
  const { user, hasRole } = useAuth()
  const canViewFinancials = hasRole('SUPERADMIN', 'ADMIN', 'CASHIER')
  const isWaiter = user?.role === 'WAITER' || !canViewFinancials
  const [tables, setTables] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [shiftFilter, setShiftFilter] = useState<'CURRENT' | 'ALL'>('CURRENT')
  const [scope, setScope] = useState<'MINE' | 'ALL'>(() => isWaiter ? 'MINE' : 'ALL')
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<any | null>(null)
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const q = new URLSearchParams()
      if (filterStatus) q.set('status', filterStatus)
      if (shiftFilter === 'CURRENT') q.set('currentShift', 'true')
      const res = await api.get<any[]>(`/tables?${q.toString()}`, { force: true })
      setTables(Array.isArray(res) ? res : [])
    } catch (err) {
      console.error(err)
      setTables([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filterStatus, shiftFilter])

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current !== null) return
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null
      load(true)
    }, 350)
  }, [load])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })
    socket.on('tableCreated', scheduleReload)
    socket.on('tableUpdated', scheduleReload)
    socket.on('tableClosed', scheduleReload)
    socket.on('paymentValidated', scheduleReload)
    socket.on('cashStatusChanged', scheduleReload)
    socket.on('cashRegistersChanged', scheduleReload)
    socket.on('newOrder', scheduleReload)
    socket.on('orderUpdated', scheduleReload)
    return () => {
      if (reloadTimerRef.current !== null) {
        clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      socket.disconnect()
    }
  }, [scheduleReload])

  const [selectedWaiter, setSelectedWaiter] = useState<string>('ALL')
  const [showWaitersDetail, setShowWaitersDetail] = useState(true)

  const myTablesCount = useMemo(() => {
    return tables.filter(t => t.openedBy?.id === user?.id || (t.orders || []).some((o: any) => o.waiter?.id === user?.id)).length
  }, [tables, user?.id])

  // Desglose de ventas por cada mesera a partir de las mesas
  const waiterStats = useMemo(() => {
    const map = new Map<string, {
      id: string
      name: string
      total: number
      tablesCount: number
      cashTotal: number
      transferTotal: number
      openTotal: number
      closedTotal: number
      openCount: number
      closedCount: number
    }>()

    for (const t of tables) {
      const rawName = t.openedBy?.name || (t.orders || []).find((o: any) => o.waiter?.name)?.waiter?.name || 'Sin Asignar'
      const rawId = t.openedBy?.id || (t.orders || []).find((o: any) => o.waiter?.id)?.waiter?.id || rawName
      const name = String(rawName).trim() || 'Sin Asignar'
      const id = String(rawId || name)

      const total = Number(t.total) || 0
      const isClosed = t.status === 'CLOSED'
      const paymentInfo = parseTablePayment(t)

      const existing = map.get(id) || {
        id,
        name,
        total: 0,
        tablesCount: 0,
        cashTotal: 0,
        transferTotal: 0,
        openTotal: 0,
        closedTotal: 0,
        openCount: 0,
        closedCount: 0,
      }

      existing.total += total
      existing.tablesCount += 1
      existing.cashTotal += paymentInfo.cash
      existing.transferTotal += paymentInfo.transfer
      if (isClosed) {
        existing.closedTotal += total
        existing.closedCount += 1
      } else {
        existing.openTotal += total
        existing.openCount += 1
      }

      map.set(id, existing)
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [tables])

  // Resumen global acumulado de mesas
  const globalSummary = useMemo(() => {
    const totalSales = tables.reduce((acc, t) => acc + (Number(t.total) || 0), 0)
    const totalTables = tables.length
    const openTables = tables.filter(t => t.status === 'OPEN')
    const closedTables = tables.filter(t => t.status === 'CLOSED')
    const openSales = openTables.reduce((acc, t) => acc + (Number(t.total) || 0), 0)
    const closedSales = closedTables.reduce((acc, t) => acc + (Number(t.total) || 0), 0)
    const cashSales = waiterStats.reduce((acc, w) => acc + w.cashTotal, 0)
    const transferSales = waiterStats.reduce((acc, w) => acc + w.transferTotal, 0)

    return {
      totalSales,
      totalTables,
      openCount: openTables.length,
      closedCount: closedTables.length,
      openSales,
      closedSales,
      cashSales,
      transferSales,
    }
  }, [tables, waiterStats])

  const filtered = useMemo(() => {
    let list = tables
    if (scope === 'MINE' && user?.id) {
      list = list.filter(t => t.openedBy?.id === user.id || (t.orders || []).some((o: any) => o.waiter?.id === user.id))
    }

    if (selectedWaiter !== 'ALL') {
      list = list.filter(t => {
        const rawName = t.openedBy?.name || (t.orders || []).find((o: any) => o.waiter?.name)?.waiter?.name || ''
        const rawId = t.openedBy?.id || (t.orders || []).find((o: any) => o.waiter?.id)?.waiter?.id || rawName
        return rawId === selectedWaiter || cleanStr(rawName) === cleanStr(selectedWaiter)
      })
    }

    const q = cleanStr(search)
    if (!q) return list

    return list.filter(t => {
      const label = cleanStr(t.label)
      const customer = cleanStr(t.customerName)
      const openedBy = cleanStr(t.openedBy?.name)
      const totalStr = String(t.total || '')
      const balanceStr = String(t.balance || '')
      const statusStr = t.status === 'OPEN' ? 'abierta open activo' : 'cerrada pagada closed liquidada'
      
      const orderWaiters = (t.orders || []).map((o: any) => cleanStr(o.waiter?.name)).join(' ')
      const orderNumbers = (t.orders || []).map((o: any) => `#${o.orderNumber} ${o.orderNumber}`).join(' ')
      const itemsNames = (t.orders || []).flatMap((o: any) => (o.items || []).map((i: any) => cleanStr(i.menuItem?.name || i.nameSnapshot || ''))).join(' ')
      const cooks = (t.orders || []).flatMap((o: any) => (o.kitchenTickets || []).map((k: any) => cleanStr(k.assignedTo?.name || ''))).join(' ')
      const paymentMethods = (t.orders || []).map((o: any) => {
        const m = cleanStr(o.paymentMethod || o.payment?.method || '')
        if (m.includes('cash')) return 'efectivo cash'
        if (m.includes('transfer')) return 'transferencia nequi daviplata bancolombia'
        if (m.includes('mixed')) return 'mixto mixed'
        return m
      }).join(' ')

      const haystack = `${label} ${customer} ${openedBy} ${orderWaiters} ${cooks} ${orderNumbers} ${itemsNames} ${paymentMethods} ${totalStr} ${balanceStr} ${statusStr}`
      
      const searchTokens = q.split(/\s+/).filter(Boolean)
      return searchTokens.every(tok => haystack.includes(tok))
    })
  }, [tables, scope, user?.id, search, selectedWaiter])

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon">
            <Link to="/tables"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Historial de Ventas de Mesa</h1>
            <p className="text-xs text-[var(--text-secondary)]">Registro exclusivo de pedidos, consumos y pagos de mesas en salón.</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <Button asChild size="sm" className="bg-[var(--accent)] text-[var(--accent-fg)] font-black text-xs gap-1 shadow-sm">
            <Link to="/tables/new"><UtensilsCrossed className="h-3.5 w-3.5" /> Nuevo Pedido Mesa</Link>
          </Button>
        </div>
      </div>

      {/* Filtros principales del historial */}
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <Search className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)]">Consulta de mesas</h2>
              <p className="text-[11px] text-[var(--text-secondary)]">Filtra por responsable, turno y estado antes de revisar las cuentas.</p>
            </div>
          </div>
          <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-black text-[var(--text-secondary)]">
            {filtered.length} resultado{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 border-t border-[var(--border-subtle)] pt-3 lg:grid-cols-[auto_auto_1fr]">
          <div>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Vista</p>
            <div className="flex w-fit rounded-xl bg-[var(--bg-elevated)] p-1">
              <button
                type="button"
                onClick={() => setScope('MINE')}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${scope === 'MINE' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-xs' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'}`}
              >
                Mis mesas ({myTablesCount})
              </button>
              <button
                type="button"
                onClick={() => setScope('ALL')}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${scope === 'ALL' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-xs' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'}`}
              >
                Todas ({tables.length})
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Periodo</p>
            <div className="flex w-fit rounded-xl bg-[var(--bg-elevated)] p-1">
              {[
                { id: 'CURRENT', label: 'Turno actual' },
                { id: 'ALL', label: 'Completo' },
              ].map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setShiftFilter(option.id as 'CURRENT' | 'ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${shiftFilter === option.id ? 'bg-[var(--text-primary)] text-[var(--bg-panel)] shadow-xs' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Estado de la mesa</p>
            <div className="flex flex-wrap rounded-xl bg-[var(--bg-elevated)] p-1">
              {[
                { id: 'ALL', label: 'Todas' },
                { id: 'OPEN', label: 'Abiertas' },
                { id: 'CLOSED', label: 'Cerradas y pagadas' },
              ].map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilterStatus(option.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${filterStatus === option.id ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-xs' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Resumen y rendimiento de las meseras */}
      {canViewFinancials && (
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <Wallet className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-black text-[var(--text-primary)]">Resumen del salón</h2>
                <p className="text-[11px] text-[var(--text-secondary)]">Ventas y cuentas agrupadas por mesera.</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWaitersDetail(prev => !prev)}
              className="h-8 gap-1.5 rounded-lg text-xs font-bold"
            >
              {showWaitersDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showWaitersDetail ? 'Ocultar meseras' : 'Ver meseras'}
            </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Ventas del salón</p>
              <p className="mt-1 text-lg font-black text-[var(--accent)]">{formatCurrency(globalSummary.totalSales)}</p>
              <p className="text-[10px] font-bold text-[var(--text-secondary)]">{globalSummary.totalTables} mesas registradas</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Efectivo</p>
              <p className="mt-1 text-lg font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(globalSummary.cashSales)}</p>
              <p className="text-[10px] font-bold text-[var(--text-secondary)]">Dinero físico en caja</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Transferencias</p>
              <p className="mt-1 text-lg font-black text-blue-600 dark:text-blue-400">{formatCurrency(globalSummary.transferSales)}</p>
              <p className="text-[10px] font-bold text-[var(--text-secondary)]">Nequi y Bancolombia</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Mesas abiertas</p>
              <p className="mt-1 text-lg font-black text-[var(--text-primary)]">{globalSummary.openCount}</p>
              <p className="text-[10px] font-bold text-[var(--text-secondary)]">{globalSummary.closedCount} cerradas y pagadas</p>
            </div>
          </div>

          {showWaitersDetail && (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <div className="mb-2.5 flex items-end justify-between gap-2">
                <div>
                  <h3 className="text-xs font-black text-[var(--text-primary)]">Rendimiento por mesera</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">Selecciona una para filtrar el historial de abajo.</p>
                </div>
                <span className="text-[10px] font-bold text-[var(--text-muted)]">{waiterStats.length} registradas</span>
              </div>
              {waiterStats.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {waiterStats.map(w => {
                    const isSelected = selectedWaiter === w.id
                    const percent = globalSummary.totalSales > 0 ? Math.round((w.total / globalSummary.totalSales) * 100) : 0
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setSelectedWaiter(prev => prev === w.id ? 'ALL' : w.id)}
                        className={`rounded-xl border p-3 text-left transition ${isSelected ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/20' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)]'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-panel)] text-xs font-black text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]">
                              {w.name.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black text-[var(--text-primary)]">{w.name}</p>
                              <p className="text-[10px] font-bold text-[var(--text-muted)]">{w.tablesCount} mesas · {percent}% del salón</p>
                            </div>
                          </div>
                          {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" />}
                        </div>
                        <p className="mt-3 text-base font-black text-[var(--accent)]">{formatCurrency(w.total)}</p>
                        <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-[10px] font-bold text-[var(--text-secondary)]">
                          <span>Ef. {formatCurrency(w.cashTotal)}</span>
                          <span>Tr. {formatCurrency(w.transferTotal)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-[var(--bg-elevated)] p-3 text-center text-xs text-[var(--text-muted)]">No hay ventas asignadas aún.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Búsqueda y filtro puntual */}
      <section className="grid gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs md:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Buscar en el historial</span>
          <Search className="absolute bottom-3 left-3 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Mesa, mesera, cocinero, producto o número de pedido..."
            className="h-10 rounded-xl pl-9 text-xs"
          />
        </label>
        {canViewFinancials && waiterStats.length > 1 && (
          <label className="block md:min-w-56">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Mesera responsable</span>
            <select
              value={selectedWaiter}
              onChange={event => setSelectedWaiter(event.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs font-bold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="ALL">Todas las meseras</option>
              {waiterStats.map(waiter => <option key={waiter.id} value={waiter.id}>{waiter.name}</option>)}
            </select>
          </label>
        )}
      </section>
      {/* Tables List */}
      {loading ? (
        <div className="p-12 text-center text-sm text-[var(--text-secondary)]">Cargando historial de mesas...</div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(table => {
            const allItems = (table.orders || []).flatMap((o: any) => o.items || [])
            const paymentInfo = parseTablePayment(table)
            const cookNames = Array.from(new Set(
              (table.orders || [])
                .flatMap((o: any) => o.kitchenTickets || [])
                .map((tk: any) => tk.assignedTo?.name)
                .filter(Boolean)
            )).join(', ')

            return (
              <div
                key={table.id}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm transition hover:border-[var(--accent)]/50"
              >
                {/* Header: Mesa, Mesero, Estado y Total */}
                <div className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-black text-[var(--text-primary)] leading-tight">{table.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        table.status === 'CLOSED'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                      }`}>
                        {table.status === 'CLOSED' ? '✓ Cerrada' : '⏳ Abierta'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-2 flex-wrap">
                      <span>Mesera: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong></span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="text-[var(--text-muted)] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTableDate(table.openedAt || table.createdAt)}
                      </span>
                    </div>
                    {cookNames && (
                      <div className="mt-1 flex w-fit items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-bold text-[var(--text-secondary)]">
                        <ChefHat className="h-3 w-3" />
                        <span>Preparado por: <strong>{cookNames}</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-base font-black text-[var(--accent)] block leading-tight">
                      {formatCurrency(table.total || 0)}
                    </span>
                    <span className="text-[11px] font-bold text-[var(--text-secondary)] mt-0.5 block">
                      {paymentInfo.methodLabel}
                    </span>
                  </div>
                </div>

                {/* Items consumed */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {allItems.map((item: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-lg bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                    >
                      <b className="text-[var(--accent)] mr-1">{item.quantity}x</b>
                      {item.menuItem?.name || item.nameSnapshot}
                    </span>
                  ))}
                  {allItems.length === 0 && (
                    <span className="text-xs text-[var(--text-muted)] italic">Sin productos registrados</span>
                  )}
                </div>

                {/* Footer with actions */}
                <div className="mt-2.5 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  {paymentInfo.hasRealImageProof && paymentInfo.proofId ? (
                    <button
                      type="button"
                      onClick={() => setZoomUrl(`/payment-validation/proofs/${paymentInfo.proofId}/image`)}
                      className="text-[var(--accent)] hover:underline inline-flex items-center gap-1 font-bold cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" /> Ver comprobante
                    </button>
                  ) : (
                    <span className="text-[var(--text-muted)] text-[11px]">Cuenta liquidada</span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedTable(table)}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-black text-[var(--text-primary)] transition hover:bg-[var(--text-primary)] hover:text-[var(--bg-panel)]"
                  >
                    Ver detalle
                  </button>
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="p-12 text-center text-sm text-[var(--text-muted)] border border-dashed rounded-2xl">
              {scope === 'MINE'
                ? 'No tienes ventas de mesa registradas en este filtro.'
                : 'No hay ventas de mesa registradas con los filtros seleccionados.'}
            </div>
          )}
        </div>
      )}

      {/* El detalle se abre sobre el historial para conservar filtros y contexto. */}
      <Dialog open={!!selectedTable} onOpenChange={isOpen => !isOpen && setSelectedTable(null)}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0 shadow-2xl">
          {selectedTable && (() => {
            const orders = selectedTable.orders || []
            const items = orders.flatMap((order: any) => order.items || [])
            const payment = parseTablePayment(selectedTable)
            const cooks = Array.from(new Set(
              orders.flatMap((order: any) => order.kitchenTickets || []).map((ticket: any) => ticket.assignedTo?.name).filter(Boolean)
            )).join(', ')
            const customerName = selectedTable.customerName || selectedTable.customer?.name || selectedTable.clientName

            return (
              <>
                <header className="border-b border-[var(--border-subtle)] px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <DialogTitle className="truncate text-lg font-black text-[var(--text-primary)]">Detalle de {selectedTable.label}</DialogTitle>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">Mesa registrada el {formatTableDate(selectedTable.openedAt || selectedTable.createdAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${selectedTable.status === 'CLOSED' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                      {selectedTable.status === 'CLOSED' ? 'Cerrada' : 'Abierta'}
                    </span>
                  </div>
                </header>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 custom-scrollbar">
                  <section className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Total</p>
                      <p className="mt-1 text-lg font-black text-[var(--accent)]">{formatCurrency(selectedTable.total || 0)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Pago</p>
                      <p className="mt-1 text-xs font-black text-[var(--text-primary)]">{payment.methodLabel}</p>
                      {payment.cash > 0 && payment.transfer > 0 && <p className="mt-1 text-[10px] text-[var(--text-muted)]">Ef. {formatCurrency(payment.cash)} · Tr. {formatCurrency(payment.transfer)}</p>}
                    </div>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Responsable</p>
                      <p className="mt-1 truncate text-xs font-black text-[var(--text-primary)]">{selectedTable.openedBy?.name || 'Sin asignar'}</p>
                      {customerName && <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">Cliente: {customerName}</p>}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                      <div>
                        <h3 className="text-sm font-black text-[var(--text-primary)]">Productos de la mesa</h3>
                        <p className="text-[10px] text-[var(--text-muted)]">{items.length} registro{items.length === 1 ? '' : 's'} de producto</p>
                      </div>
                      <UtensilsCrossed className="h-4 w-4 text-[var(--text-secondary)]" />
                    </div>
                    {items.length > 0 ? (
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {items.map((item: any, index: number) => (
                          <div key={`${item.id || item.menuItemId || item.nameSnapshot}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-xs font-black text-[var(--text-primary)]">{item.menuItem?.name || item.nameSnapshot || 'Producto'}</p>
                              {(item.notes || item.note) && <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">Nota: {item.notes || item.note}</p>}
                            </div>
                            <span className="shrink-0 rounded-lg bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-black text-[var(--text-secondary)]">{item.quantity}×</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="p-4 text-xs text-[var(--text-muted)]">No hay productos registrados.</p>}
                  </section>

                  <section className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Cocina</p>
                      <p className="mt-1 text-xs font-black text-[var(--text-primary)]">{cooks || 'Sin cocinero registrado'}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                      <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Cierre</p>
                      <p className="mt-1 text-xs font-black text-[var(--text-primary)]">{selectedTable.closedAt ? formatTableDate(selectedTable.closedAt) : selectedTable.status === 'CLOSED' ? 'Mesa cerrada' : 'Pendiente de cierre'}</p>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--border-subtle)]">
                    <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                      <h3 className="text-sm font-black text-[var(--text-primary)]">Pedidos registrados</h3>
                    </div>
                    {orders.length > 0 ? (
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {orders.map((order: any, index: number) => (
                          <div key={order.id || index} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                            <div className="min-w-0">
                              <p className="font-black text-[var(--text-primary)]">Pedido {order.orderNumber || order.number || String(order.id || index + 1).slice(-6)}</p>
                              <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{formatTableDate(order.createdAt)} · {(order.items || []).length} producto{(order.items || []).length === 1 ? '' : 's'}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-black text-[var(--text-primary)]">{formatCurrency(order.total || 0)}</p>
                              <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{order.status || 'Registrado'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="p-4 text-xs text-[var(--text-muted)]">No hay pedidos asociados.</p>}
                  </section>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-5 py-3">
                  {payment.hasRealImageProof && payment.proofId ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setZoomUrl(`/payment-validation/proofs/${payment.proofId}/image`)} className="gap-1.5 rounded-lg text-xs font-bold"><Eye className="h-3.5 w-3.5" /> Ver comprobante</Button>
                  ) : <span className="text-[11px] text-[var(--text-muted)]">No hay comprobante adjunto.</span>}
                  <Button type="button" size="sm" onClick={() => setSelectedTable(null)} className="rounded-lg bg-[var(--accent)] text-xs font-black text-[var(--accent-fg)]">Cerrar detalle</Button>
                </footer>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Proof Zoom Modal */}
      <Dialog open={!!zoomUrl} onOpenChange={v => !v && setZoomUrl(null)}>
        <DialogContent className="max-w-3xl bg-black/95 p-3 border-none flex flex-col items-center">
          <div className="flex w-full justify-between items-center text-white pb-2 px-1">
            <span className="text-sm font-black">Comprobante de Transferencia</span>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/20 h-8 text-xs" onClick={() => setZoomUrl(null)}>
              ✕ Cerrar
            </Button>
          </div>
          {zoomUrl && (
            <div className="max-h-[82vh] w-full flex items-center justify-center overflow-auto">
              <ProtectedImage endpoint={zoomUrl} alt="Comprobante" className="max-h-[78vh] max-w-full object-contain rounded-lg shadow-2xl" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

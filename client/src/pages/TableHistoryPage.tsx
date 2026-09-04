import { ProtectedImage } from '@/components/ProtectedImage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock, Eye, RefreshCw, Search, UtensilsCrossed, Wallet, ChefHat, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
  const total = Number(t.total) || 0
  const orders = (t.orders || []).filter((o: any) => o.status !== 'CANCELLED')
  const proofs = t.transferProofs || []

  // Buscar comprobante con foto real subida (evitar filas de auditoría en efectivo)
  const realProof = proofs.find((p: any) =>
    Boolean(p.fileBase64 || p.filePath || (p.method !== 'CASH' && (p.fileSize > 0 || p.filePath)))
  )
  const proofId = realProof?.id || null
  const hasRealImageProof = Boolean(realProof)

  let cash = 0
  let transfer = 0
  let ordersWithMethodCount = 0

  for (const o of orders) {
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
    const methods = proofs.map((p: any) => String(p.payment?.method || p.method || '').toUpperCase().trim())
    const isMixed = methods.includes('MIXED')
    const hasTransfer = methods.some((m: string) => ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m))
    const isOnlyCash = methods.every((m: string) => m === 'CASH')

    if (isMixed) {
      const pCash = proofs.reduce((sum: number, p: any) => sum + Number(p.payment?.cashAmount || 0), 0)
      const pTransfer = proofs.reduce((sum: number, p: any) => sum + Number(p.payment?.transferAmount || 0), 0)
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (filterStatus) q.set('status', filterStatus)
      if (shiftFilter === 'CURRENT') q.set('currentShift', 'true')
      const res = await api.get<any[]>(`/tables?${q.toString()}`)
      setTables(Array.isArray(res) ? res : [])
    } catch (err) {
      console.error(err)
      setTables([])
    } finally {
      setLoading(false)
    }
  }, [filterStatus, shiftFilter])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })
    socket.on('tableUpdated', () => load())
    socket.on('tableClosed', () => load())
    socket.on('paymentValidated', () => load())
    socket.on('cashStatusChanged', () => load())
    socket.on('cashRegistersChanged', () => load())
    return () => { socket.disconnect() }
  }, [load])

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

      {/* Scope Buttons: Mis Mesas vs Todas las Mesas */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-1 bg-[var(--bg-panel)] p-1 rounded-xl border border-[var(--border-subtle)] w-fit">
          <button
            type="button"
            onClick={() => setScope('MINE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
              scope === 'MINE'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span>Mis mesas ({myTablesCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setScope('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
              scope === 'ALL'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todas las mesas ({tables.length})
          </button>
        </div>

        <div className="flex gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl shrink-0 overflow-x-auto">
          {[
            { id: 'CURRENT', label: '📅 Turno Actual' },
            { id: 'ALL', label: '🗂️ Historial Completo' },
          ].map(sf => (
            <button
              key={sf.id}
              onClick={() => setShiftFilter(sf.id as any)}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                shiftFilter === sf.id
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {sf.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl shrink-0 overflow-x-auto">
          {[
            { id: 'ALL', label: 'Todos los Estados' },
            { id: 'OPEN', label: 'Mesas Abiertas' },
            { id: 'CLOSED', label: 'Cerradas y Pagadas' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id)}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                filterStatus === f.id
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel General de Ventas y Rendimiento por Mesera (Exclusivo para Administradores y Cajeros) */}
      {canViewFinancials && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[var(--accent)]" />
              <div>
                <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
                  Ventas y Cuentas por Mesera
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
                    {waiterStats.length} mesera{waiterStats.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <p className="text-[11px] text-[var(--text-secondary)]">Monitorea cuánto lleva vendido cada mesera, mesas atendidas y pagos recibidos.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2.5 py-1 rounded-lg border border-[var(--border-subtle)]">
                Total Salón: <strong className="text-[var(--accent)]">{formatCurrency(globalSummary.totalSales)}</strong>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWaitersDetail(prev => !prev)}
                className="h-7 px-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                title={showWaitersDetail ? 'Ocultar desglose' : 'Mostrar desglose'}
              >
                {showWaitersDetail ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {showWaitersDetail && (
            <div className="space-y-3 pt-1">
              {/* 4 Métricas Globales Rápidas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-xl border border-[var(--border-subtle)]">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Total Salón</p>
                  <p className="text-base font-black text-[var(--accent)]">{formatCurrency(globalSummary.totalSales)}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-bold">{globalSummary.totalTables} mesas registradas</p>
                </div>
                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-xl border border-[var(--border-subtle)]">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">En Efectivo</p>
                  <p className="text-base font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(globalSummary.cashSales)}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-bold">Dinero físico en caja</p>
                </div>
                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-xl border border-[var(--border-subtle)]">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">En Transferencia</p>
                  <p className="text-base font-black text-blue-600 dark:text-blue-400">{formatCurrency(globalSummary.transferSales)}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-bold">Nequi / Bancolombia</p>
                </div>
                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-xl border border-[var(--border-subtle)]">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Abiertas vs Cerradas</p>
                  <p className="text-base font-black text-amber-600 dark:text-amber-400">{formatCurrency(globalSummary.openSales)}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-bold">{globalSummary.openCount} activas · {globalSummary.closedCount} liquidadas</p>
                </div>
              </div>

              {/* Grid de Tarjetas Individuales por Mesera */}
              {waiterStats.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-1">
                  {waiterStats.map((w) => {
                    const isSelected = selectedWaiter === w.id
                    const percent = globalSummary.totalSales > 0 ? Math.round((w.total / globalSummary.totalSales) * 100) : 0
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setSelectedWaiter(prev => prev === w.id ? 'ALL' : w.id)}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 relative overflow-hidden ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] shadow-md'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] shadow-xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 w-full">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-8 w-8 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] font-black text-xs flex items-center justify-center shrink-0 border border-[var(--accent)]/20 shadow-xs">
                              {w.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-black text-xs text-[var(--text-primary)] truncate flex items-center gap-1">
                                {w.name}
                                {isSelected && <span className="text-[10px] text-[var(--accent)] font-black">✓</span>}
                              </p>
                              <p className="text-[10px] text-[var(--text-secondary)] font-bold">
                                {w.tablesCount} mesa{w.tablesCount === 1 ? '' : 's'} atendida{w.tablesCount === 1 ? '' : 's'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-black text-sm text-[var(--accent)] block leading-tight">
                              {formatCurrency(w.total)}
                            </span>
                            <span className="text-[9px] font-bold text-[var(--text-muted)] block mt-0.5">
                              {percent}% del salón
                            </span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-bold text-[var(--text-secondary)] w-full">
                          <span className="text-emerald-600 dark:text-emerald-400">💵 {formatCurrency(w.cashTotal)}</span>
                          <span className="text-blue-600 dark:text-blue-400">📲 {formatCurrency(w.transferTotal)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)] text-center py-2">No hay registros de ventas asignados aún.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chips de filtro rápido por mesera (Exclusivo para Administradores y Cajeros) */}
      {canViewFinancials && waiterStats.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-black text-[var(--text-muted)] uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Filtrar Mesera:
          </span>
          <button
            type="button"
            onClick={() => setSelectedWaiter('ALL')}
            className={`px-3 py-1.5 rounded-xl font-black transition cursor-pointer text-xs shrink-0 ${
              selectedWaiter === 'ALL'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todas ({tables.length})
          </button>
          {waiterStats.map(w => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedWaiter(prev => prev === w.id ? 'ALL' : w.id)}
              className={`px-3 py-1.5 rounded-xl font-black transition cursor-pointer text-xs shrink-0 flex items-center gap-1.5 ${
                selectedWaiter === w.id
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{w.name}</span>
              <span className="text-[10px] opacity-85 font-bold">({formatCurrency(w.total)})</span>
            </button>
          ))}
          {selectedWaiter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedWaiter('ALL')}
              className="px-2 py-1 rounded-lg text-[10px] font-black text-rose-500 hover:underline shrink-0 cursor-pointer"
            >
              ✕ Quitar filtro
            </button>
          )}
        </div>
      )}

      {/* Search Input */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por mesa, mesera, cocinero o producto..."
          className="pl-9 h-10 text-xs rounded-xl"
        />
      </div>

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
                      <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md w-fit">
                        <ChefHat className="h-3 w-3 text-amber-600" />
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

                  <Link
                    to={`/tables/${table.id}`}
                    className="font-bold text-[var(--accent)] hover:underline"
                  >
                    Ver detalle →
                  </Link>
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

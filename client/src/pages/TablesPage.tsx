import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { io } from '@/lib/socket'
import { PlusCircle, Search, UtensilsCrossed, Wallet, ChefHat, CheckCircle2, Clock, History, AlertCircle, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency, cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { DiningTableSummary } from '@/lib/tableTypes'
import { syncOfflineOrders } from '@/lib/offlineTableOrders'

const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)
type TableEventOverride = { table: DiningTableSummary; sequence: number }

function snapshotVersion(table: any): number {
  const version = Date.parse(String(table?.updatedAt || ''))
  return Number.isFinite(version) ? version : Number.NaN
}

function incomingSnapshotIsCurrent(current: any, incoming: any): boolean {
  const currentVersion = snapshotVersion(current)
  const incomingVersion = snapshotVersion(incoming)
  if (!Number.isFinite(incomingVersion)) return false
  return !Number.isFinite(currentVersion) || incomingVersion >= currentVersion
}

function extractTableSnapshot(payload: any): any | null {
  if (payload?.table && typeof payload.table === 'object') return payload.table
  // Los eventos de pagos de domicilios no contienen una mesa.
  if (payload?.payment || payload?.order || payload?.delivery === true) return null
  return payload && typeof payload === 'object' ? payload : null
}

function isCompleteTableSnapshot(table: any): table is DiningTableSummary {
  if (!table || typeof table.id !== 'string' || typeof table.label !== 'string' || typeof table.status !== 'string') return false
  if (!Number.isFinite(snapshotVersion(table))) return false
  if (!hasOwn(table, 'total') || table.total === null || table.total === '' || !Number.isFinite(Number(table.total))) return false
  if (!hasOwn(table, 'balance') || table.balance === null || table.balance === '' || !Number.isFinite(Number(table.balance))) return false
  if (!hasOwn(table, 'openedBy') || !Array.isArray(table.orders)) return false

  return table.orders.every((order: any) => (
    order &&
    typeof order.id === 'string' &&
    typeof order.status === 'string' &&
    hasOwn(order, 'total') &&
    hasOwn(order, 'paymentStatus') &&
    hasOwn(order, 'kitchenStatus') &&
    hasOwn(order, 'waiter') &&
    Array.isArray(order.kitchenTickets) &&
    order.kitchenTickets.every((ticket: any) => (
      ticket &&
      typeof ticket.id === 'string' &&
      typeof ticket.status === 'string' &&
      hasOwn(ticket, 'assignedTo')
    ))
  ))
}

export default function TablesPage() {
  const { user } = useAuth()
  const isWaiter = user?.role === 'WAITER'
  const [openTables, setOpenTables] = useState<DiningTableSummary[]>([])
  const [myHistoryTables, setMyHistoryTables] = useState<DiningTableSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'OPEN_ALL' | 'OPEN_MINE' | 'HISTORY_MINE'>(() => isWaiter ? 'OPEN_MINE' : 'OPEN_ALL')
  const [now, setNow] = useState(() => Date.now())
  const connectedOnceRef = useRef(false)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadRequestRef = useRef(0)
  const eventSequenceRef = useRef(0)
  const eventOverridesRef = useRef<Map<string, TableEventOverride>>(new Map())
  const latestVersionRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback((silent = false) => {
    const requestId = ++loadRequestRef.current
    const sequenceAtStart = eventSequenceRef.current
    if (!silent) setLoading(true)
    const pOpen = api.get<DiningTableSummary[]>('/tables?summary=true', { force: true })
    const pHistory = user?.id ? api.get<DiningTableSummary[]>(`/tables?status=ALL&waiterId=${user.id}&currentShift=true&summary=true`, { force: true }) : Promise.resolve([])

    Promise.all([pOpen, pHistory])
      .then(([openList, historyList]) => {
        if (requestId !== loadRequestRef.current) return
        const overlay = (
          response: DiningTableSummary[],
          belongsToQuery: (table: DiningTableSummary, existedInResponse: boolean) => boolean,
        ) => {
          const result = new Map(response.map(table => [table.id, table]))
          const orderedIds = response.map(table => table.id)
          for (const { table, sequence } of eventOverridesRef.current.values()) {
            const serverTable = result.get(table.id)
            const arrivedDuringRequest = sequence > sequenceAtStart
            const eventIsNewer = !serverTable || snapshotVersion(table) > snapshotVersion(serverTable)
            if (!arrivedDuringRequest && !eventIsNewer) continue
            if (serverTable && !incomingSnapshotIsCurrent(serverTable, table)) continue
            if (!belongsToQuery(table, Boolean(serverTable))) {
              result.delete(table.id)
              continue
            }
            result.set(table.id, table)
            if (!orderedIds.includes(table.id)) orderedIds.unshift(table.id)
          }
          return orderedIds.flatMap(id => result.has(id) ? [result.get(id)!] : []).slice(0, 200)
        }

        const nextOpen = overlay(
          Array.isArray(openList) ? openList : [],
          table => table.status === 'OPEN' && (table.orders?.length || 0) > 0,
        )
        const historyWithOverrides = overlay(
          Array.isArray(historyList) ? historyList : [],
          (table, existedInResponse) => {
            const belongsToUser = table.openedBy?.id === user?.id || (table.orders || []).some(order => order.waiter?.id === user?.id)
            const belongsToCurrentShift = table.status === 'OPEN' || existedInResponse
            return belongsToUser && belongsToCurrentShift && (table.orders?.length || 0) > 0
          },
        )

        setOpenTables(nextOpen)
        // Mesas que la mesera ya cobró o cerró (para que NUNCA se le desaparezcan tras validar en caja)
        const hist = historyWithOverrides.filter((t: any) =>
          t.status === 'CLOSED' ||
          t.balance === 0 ||
          t.orders?.some((o: any) => o.paymentStatus === 'PENDING_REVIEW' || o.paymentStatus === 'CONFIRMED')
        )
        setMyHistoryTables(hist)
        for (const table of [...nextOpen, ...hist]) {
          latestVersionRef.current.set(table.id, snapshotVersion(table))
        }
        const appliedSequence = eventSequenceRef.current
        for (const [id, event] of eventOverridesRef.current) {
          if (event.sequence <= appliedSequence) eventOverridesRef.current.delete(id)
        }
      })
      .catch(console.error)
      .finally(() => {
        if (requestId === loadRequestRef.current && !silent) setLoading(false)
      })
  }, [user?.id])

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current !== null) clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null
      load(true)
    }, 600)
  }, [load])

  const applyTableEvent = useCallback((payload: any) => {
    const candidate = extractTableSnapshot(payload)
    if (!candidate?.id) return
    if (!isCompleteTableSnapshot(candidate)) {
      scheduleReconcile()
      return
    }
    const table = candidate as DiningTableSummary
    const version = snapshotVersion(table)
    const latestVersion = latestVersionRef.current.get(table.id)
    if (latestVersion !== undefined && version < latestVersion) return
    const previousOverride = eventOverridesRef.current.get(table.id)
    if (previousOverride && !incomingSnapshotIsCurrent(previousOverride.table, table)) return
    const sequence = ++eventSequenceRef.current
    eventOverridesRef.current.set(table.id, { table, sequence })
    latestVersionRef.current.set(table.id, version)

    setOpenTables(previous => {
      const current = previous.find(item => item.id === table.id)
      const exists = Boolean(current)
      const belongsToOpenQuery = table.status === 'OPEN' && (table.orders?.length || 0) > 0
      if (!belongsToOpenQuery) {
        return current && incomingSnapshotIsCurrent(current, table)
          ? previous.filter(item => item.id !== table.id)
          : previous
      }
      return exists
        ? previous.map(item => item.id === table.id && incomingSnapshotIsCurrent(item, table) ? table : item)
        : [table, ...previous].slice(0, 200)
    })

    // La consulta de historial usa currentShift=true. Una mesa abierta siempre
    // pertenece al turno actual; para una cerrada el corte depende de caja, así
    // que actualizamos una fila ya conocida y reconciliamos la membresía.
    const inLocalHistory = myHistoryTables.some(item => item.id === table.id)
    const requiresShiftMembershipCheck = table.status !== 'OPEN' && !inLocalHistory
    if (requiresShiftMembershipCheck) scheduleReconcile()
    setMyHistoryTables(previous => {
      const belongsToUser = table.openedBy?.id === user?.id || (table.orders || []).some((order: any) => order.waiter?.id === user?.id)
      const belongsInHistory = belongsToUser && (
        table.status === 'CLOSED' ||
        Number(table.balance) === 0 ||
        (table.orders || []).some((order: any) => order.paymentStatus === 'PENDING_REVIEW' || order.paymentStatus === 'CONFIRMED')
      )
      const current = previous.find(item => item.id === table.id)
      const exists = Boolean(current)
      if (!belongsInHistory) {
        return current && incomingSnapshotIsCurrent(current, table)
          ? previous.filter(item => item.id !== table.id)
          : previous
      }
      if (requiresShiftMembershipCheck && !exists) return previous
      return exists
        ? previous.map(item => item.id === table.id && incomingSnapshotIsCurrent(item, table) ? table : item)
        : [table, ...previous].slice(0, 200)
    })
  }, [scheduleReconcile, user?.id])

  useEffect(() => () => {
    if (reconcileTimerRef.current !== null) {
      clearTimeout(reconcileTimerRef.current)
      reconcileTimerRef.current = null
    }
  }, [load])

  const handleEditTableName = async (e: React.MouseEvent, targetTable: DiningTableSummary) => {
    e.preventDefault()
    e.stopPropagation()
    const newLabel = await alerts.prompt(
      'Editar nombre de la mesa',
      'Ingresa el nuevo nombre o identificador para esta mesa:',
      targetTable.label,
      'Ej. Mesa 1, Mesa VIP, Barra 2...'
    )
    if (!newLabel || newLabel === targetTable.label) return

    try {
      await api.put(`/tables/${targetTable.id}`, { label: newLabel })
      setOpenTables(prev => prev.map(t => t.id === targetTable.id ? { ...t, label: newLabel } : t))
      setMyHistoryTables(prev => prev.map(t => t.id === targetTable.id ? { ...t, label: newLabel } : t))
      alerts.toast('Nombre de mesa actualizado')
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo actualizar el nombre de la mesa')
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load())

    // Sincronizar automáticamente pedidos tomados fuera de la señal
    const triggerSync = () => {
      syncOfflineOrders().then(res => {
        if (res.synced > 0) load(true)
      }).catch(console.error)
    }

    triggerSync()
    window.addEventListener('online', triggerSync)
    return () => window.removeEventListener('online', triggerSync)
  }, [load])

  useEffect(() => {
    connectedOnceRef.current = false
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })
    socket.on('connect', () => {
      if (connectedOnceRef.current) load(true)
      connectedOnceRef.current = true
    })
    socket.on('tableCreated', applyTableEvent)
    socket.on('tableUpdated', applyTableEvent)
    socket.on('tableClosed', applyTableEvent)
    socket.on('paymentValidated', applyTableEvent)
    socket.on('paymentRejected', applyTableEvent)
    socket.on('cashStatusChanged', scheduleReconcile)
    return () => { socket.disconnect() }
  }, [applyTableEvent, load, scheduleReconcile, user?.id, user?.name, user?.role])

  // Mesas abiertas de la mesera (aún pendientes de cobro)
  const myOpenTables = useMemo(() => {
    return openTables.filter(t => {
      const isMine = t.openedBy?.id === user?.id || (t.orders || []).some((o: any) => o.waiter?.id === user?.id)
      return isMine && (t.balance || 0) > 0
    })
  }, [openTables, user?.id])

  const filtered = useMemo(() => {
    let list: DiningTableSummary[] = []
    if (filterMode === 'OPEN_ALL') {
      list = openTables
    } else if (filterMode === 'OPEN_MINE') {
      list = myOpenTables
    } else if (filterMode === 'HISTORY_MINE') {
      list = myHistoryTables
    }

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(t => {
        const cookNames = (t.orders || [])
          .flatMap((o: any) => o.kitchenTickets || [])
          .map((tk: any) => tk.assignedTo?.name || '')
          .join(' ')
        return `${t.label} ${t.openedBy?.name || ''} ${cookNames}`.toLowerCase().includes(q)
      })
    }
    return list
  }, [openTables, myOpenTables, myHistoryTables, filterMode, search])

  return (
    <div className="space-y-4 pb-32">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Mesas de Salón</h1>
          <p className="text-sm text-[var(--text-secondary)]">Cuentas activas, pedidos y registro de mesas atendidas por mesera.</p>
        </div>
        {!isWaiter && (
          <div className="hidden md:flex gap-2">
            <Button type="button" variant="outline" onClick={() => load(true)} className="gap-1.5 border-[var(--border-default)] font-black text-xs">
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
            <Button asChild variant="outline" className="gap-1.5 border-[var(--border-default)] font-black text-xs">
              <Link to="/tables/history"><History className="h-4 w-4 text-[var(--accent)]" /> Historial Completo</Link>
            </Button>
            <Button asChild className="gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black">
              <Link to="/tables/new"><PlusCircle className="h-4 w-4" />Nuevo Pedido</Link>
            </Button>
          </div>
        )}
      </div>

      {/* Pestañas: Todas las mesas vs Mis mesas en atención vs Mis mesas cobradas (Historial que nunca se borra) */}
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 bg-[var(--bg-panel)] p-1 rounded-xl border border-[var(--border-subtle)] w-fit flex-wrap">
          <button
            type="button"
            onClick={() => setFilterMode('OPEN_ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
              filterMode === 'OPEN_ALL'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todas activas ({openTables.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('OPEN_MINE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
              filterMode === 'OPEN_MINE'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Mis mesas en atención ({myOpenTables.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('HISTORY_MINE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'HISTORY_MINE'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Mis mesas cobradas ({myHistoryTables.length})</span>
          </button>
        </div>

        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar mesa, mesera o cocinero..." className="pl-9 h-9 text-xs" />
        </div>
      </div>

      {loading ? <p className="text-sm text-[var(--text-secondary)]">Cargando mesas...</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(table => {
            const isClosed = table.status === 'CLOSED'
            const hasPendingReview = (table.orders || []).some((o: any) => o.paymentStatus === 'PENDING_REVIEW')
            const cookNames = Array.from(new Set(
              (table.orders || [])
                .flatMap((o: any) => o.kitchenTickets || [])
                .map((t: any) => t.assignedTo?.name)
                .filter(Boolean)
            )).join(', ')

            const activeOrders = (table.orders || []).filter((o: any) => o.status !== 'CANCELLED')
            const pendingOrders = activeOrders.filter((o: any) => o.kitchenStatus !== 'READY' && o.kitchenStatus !== 'SERVED')
            const targetOrder = pendingOrders[0] || activeOrders[activeOrders.length - 1]
            const elapsedMinutes = targetOrder?.createdAt
              ? Math.max(0, Math.floor((now - new Date(targetOrder.createdAt).getTime()) / 60000))
              : null

            return (
              <Link key={table.id} to={`/tables/${table.id}`} className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)] flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{table.label}</p>
                        <button
                          type="button"
                          title="Editar nombre de la mesa"
                          onClick={(e) => handleEditTableName(e, table)}
                          className="p-1 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-md flex items-center gap-1">
                          👤 Mesera: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong>
                        </span>
                        {table.openedBy?.id === user?.id && (
                          <span className="text-[10px] font-bold text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">Tú</span>
                        )}
                      </div>
                      {cookNames && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-md w-fit">
                          <ChefHat className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>Cocinero: <strong>{cookNames}</strong></span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      {isClosed ? (
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> CERRADA Y PAGADA
                        </span>
                      ) : hasPendingReview ? (
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-center gap-1 animate-pulse">
                          <Clock className="h-3 w-3" /> EN VALIDACIÓN DE CAJA
                        </span>
                      ) : table.balance === 0 ? (
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                          ✅ COBRADA
                        </span>
                      ) : (
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border bg-[var(--accent)]/10 border-[var(--accent)]/25 text-[var(--accent)]">
                          ABIERTA
                        </span>
                      )}

                      {elapsedMinutes !== null && !isClosed && (
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider flex items-center gap-1 border',
                          elapsedMinutes >= 20 ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/40 animate-pulse ring-1 ring-rose-500/25' :
                          elapsedMinutes >= 12 ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40' :
                          'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25'
                        )}>
                          <Clock className="h-3 w-3" />
                          <span>{elapsedMinutes >= 20 ? `🚨 ${elapsedMinutes} min` : `${elapsedMinutes} min`}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3.5 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-[var(--bg-elevated)] p-2">
                      <Wallet className="mb-1 h-4 w-4 text-[var(--accent)]" />
                      <b>{formatCurrency(table.total || 0)}</b>
                      <span className="block text-[var(--text-muted)]">Total</span>
                    </div>

                    <div className={`rounded-xl p-2 border ${table.kitchenStatus === 'READY' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-[var(--bg-elevated)] border-transparent'}`}>
                      <ChefHat className={`mb-1 h-4 w-4 ${table.kitchenStatus === 'READY' ? 'text-emerald-600 animate-bounce' : 'text-[var(--accent)]'}`} />
                      <b className="truncate block font-black">
                        {table.kitchenStatus === 'READY' ? '¡LISTO! 🏃' : table.kitchenStatus === 'ACTIVE' || table.kitchenStatus === 'SENT' ? 'COCINANDO' : table.kitchenStatus || 'SIN PEDIDO'}
                      </b>
                      <span className="block text-[10px] opacity-75">Cocina</span>
                    </div>

                    <div className="rounded-xl bg-[var(--bg-elevated)] p-2">
                      <UtensilsCrossed className="mb-1 h-4 w-4 text-[var(--accent)]" />
                      <b>{table.orders?.length || 0}</b>
                      <span className="block text-[var(--text-muted)]">Envíos</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span>
                    {isClosed
                      ? 'Cuenta finalizada y validada'
                      : hasPendingReview
                      ? 'Cobro enviado a revisión de caja'
                      : table.balance === 0
                      ? 'Cuenta pagada'
                      : 'Cuenta activa'}
                  </span>

                  {isClosed ? (
                    <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Ver en historial →
                    </span>
                  ) : hasPendingReview ? (
                    <span className="font-bold text-amber-700 dark:text-amber-300 group-hover:underline flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> En espera de Caja →
                    </span>
                  ) : table.balance === 0 ? (
                    table.kitchenStatus === 'READY' ? (
                      <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> ✅ Cobrada · ¡Listo para Servir! 🏃 →
                      </span>
                    ) : (
                      <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> ✅ Cobrada · En Cocina 👨‍🍳 →
                      </span>
                    )
                  ) : table.kitchenStatus === 'READY' ? (
                    <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> ¡Listo! Cobrar / Ver →
                    </span>
                  ) : (
                    <span className="font-bold text-[var(--accent)] group-hover:underline flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5" /> 💵 Cobrar / Ver mesa →
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
              {filterMode === 'HISTORY_MINE'
                ? 'Aún no tienes mesas cobradas registradas en tu turno de hoy.'
                : filterMode === 'OPEN_MINE'
                ? 'No tienes mesas en atención pendientes de cobro.'
                : 'No hay mesas abiertas en este filtro.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

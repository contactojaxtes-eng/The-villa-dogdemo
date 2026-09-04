import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { io } from '@/lib/socket'
import { PlusCircle, Search, UtensilsCrossed, Wallet, ChefHat, CheckCircle2, Clock, History, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { DiningTableSummary } from '@/lib/tableTypes'
import { syncOfflineOrders } from '@/lib/offlineTableOrders'

export default function TablesPage() {
  const { user } = useAuth()
  const isWaiter = user?.role === 'WAITER'
  const [openTables, setOpenTables] = useState<DiningTableSummary[]>([])
  const [myHistoryTables, setMyHistoryTables] = useState<DiningTableSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'OPEN_ALL' | 'OPEN_MINE' | 'HISTORY_MINE'>(() => isWaiter ? 'OPEN_MINE' : 'OPEN_ALL')

  const load = useCallback(() => {
    setLoading(true)
    const pOpen = api.get<DiningTableSummary[]>('/tables')
    const pHistory = user?.id ? api.get<DiningTableSummary[]>(`/tables?status=ALL&waiterId=${user.id}`) : Promise.resolve([])

    Promise.all([pOpen, pHistory])
      .then(([openList, historyList]) => {
        setOpenTables(Array.isArray(openList) ? openList : [])
        // Mesas que la mesera ya cobró o cerró (para que NUNCA se le desaparezcan tras validar en caja)
        const hist = (Array.isArray(historyList) ? historyList : []).filter((t: any) =>
          t.status === 'CLOSED' ||
          t.balance === 0 ||
          t.orders?.some((o: any) => o.paymentStatus === 'PENDING_REVIEW' || o.paymentStatus === 'CONFIRMED')
        )
        setMyHistoryTables(hist)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user?.id])

  useEffect(() => {
    void Promise.resolve().then(load)

    // Sincronizar automáticamente pedidos tomados fuera de la señal
    const triggerSync = () => {
      syncOfflineOrders().then(res => {
        if (res.synced > 0) load()
      }).catch(console.error)
    }

    triggerSync()
    window.addEventListener('online', triggerSync)
    return () => window.removeEventListener('online', triggerSync)
  }, [load])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })
    socket.on('tableCreated', load)
    socket.on('tableUpdated', load)
    socket.on('tableClosed', load)
    socket.on('paymentValidated', load)
    socket.on('paymentRejected', load)
    return () => { socket.disconnect() }
  }, [load, user?.id, user?.name, user?.role])

  // Mesas abiertas de la mesera (aún pendientes de cobro)
  const myOpenTables = useMemo(() => {
    return openTables.filter(t => {
      const isMine = t.openedBy?.id === user?.id || (t.orders || []).some((o: any) => o.waiter?.id === user?.id)
      return isMine && t.balance > 0
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
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-1.5 border-[var(--border-default)] font-black text-xs">
            <Link to="/tables/history"><History className="h-4 w-4 text-[var(--accent)]" /> Historial Completo</Link>
          </Button>
          <Button asChild className="gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black">
            <Link to="/tables/new"><PlusCircle className="h-4 w-4" />Nuevo Pedido</Link>
          </Button>
        </div>
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

            return (
              <Link key={table.id} to={`/tables/${table.id}`} className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)] flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{table.label}</p>
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

                    <div className="flex flex-col items-end gap-1">
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

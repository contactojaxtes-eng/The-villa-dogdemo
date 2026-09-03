import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { io } from '@/lib/socket'
import { PlusCircle, RefreshCw, Search, UtensilsCrossed, Wallet, ChefHat, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { DiningTableSummary } from '@/lib/tableTypes'

export default function TablesPage() {
  const { user } = useAuth()
  const [tables, setTables] = useState<DiningTableSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    api.get<DiningTableSummary[]>('/tables')
      .then(setTables)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
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

  const [filterMode, setFilterMode] = useState<'ALL' | 'MINE'>('ALL')

  const myTablesCount = useMemo(() => tables.filter(t => t.openedBy?.id === user?.id).length, [tables, user?.id])

  const filtered = useMemo(() => {
    let list = tables
    if (filterMode === 'MINE' && user?.id) {
      list = list.filter(t => t.openedBy?.id === user.id)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(t => `${t.label} ${t.openedBy?.name || ''}`.toLowerCase().includes(q))
    }
    return list
  }, [tables, filterMode, user?.id, search])

  return (
    <div className="space-y-4 pb-32">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Mesas abiertas</h1>
          <p className="text-sm text-[var(--text-secondary)]">Cuentas activas de salón. Cada pedido nuevo abre su propia mesa automáticamente.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
          <Button asChild className="gap-2 bg-[var(--accent)] text-[var(--accent-fg)]"><Link to="/tables/new"><PlusCircle className="h-4 w-4" />Nuevo Pedido</Link></Button>
        </div>
      </div>

      {/* Pestañas: Todas las mesas vs Mis mesas + Buscador */}
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 bg-[var(--bg-panel)] p-1 rounded-xl border border-[var(--border-subtle)] w-fit">
          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
              filterMode === 'ALL'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todas las mesas ({tables.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('MINE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
              filterMode === 'MINE'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Mis mesas ({myTablesCount})
          </button>
        </div>

        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar mesa o mesera..." className="pl-9 h-9 text-xs" />
        </div>
      </div>

      {loading ? <p className="text-sm text-[var(--text-secondary)]">Cargando mesas...</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(table => (
            <Link key={table.id} to={`/tables/${table.id}`} className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)] flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{table.label}</p>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-md flex items-center gap-1">
                        👤 Tomado por: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong>
                      </span>
                      {table.openedBy?.id === user?.id && (
                        <span className="text-[10px] font-bold text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">Tú</span>
                      )}
                    </div>
                  </div>
                  <span className="rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/25 px-2.5 py-0.5 text-[10px] font-bold text-[var(--accent)] tracking-wider">ABIERTA</span>
                </div>
                <div className="mt-3.5 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-[var(--bg-elevated)] p-2"><Wallet className="mb-1 h-4 w-4 text-[var(--accent)]" /><b>{formatCurrency(table.total || 0)}</b><span className="block text-[var(--text-muted)]">Total</span></div>
                  <div className={`rounded-xl p-2 border ${table.kitchenStatus === 'READY' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-[var(--bg-elevated)] border-transparent'}`}>
                    <ChefHat className={`mb-1 h-4 w-4 ${table.kitchenStatus === 'READY' ? 'text-emerald-600 animate-bounce' : 'text-[var(--accent)]'}`} />
                    <b className="truncate block font-black">
                      {table.kitchenStatus === 'READY' ? '¡LISTO! 🏃' : table.kitchenStatus === 'ACTIVE' || table.kitchenStatus === 'SENT' ? 'COCINANDO' : table.kitchenStatus || 'SIN PEDIDO'}
                    </b>
                    <span className="block text-[10px] opacity-75">Cocina</span>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] p-2"><UtensilsCrossed className="mb-1 h-4 w-4 text-[var(--accent)]" /><b>{table.orders?.length || 0}</b><span className="block text-[var(--text-muted)]">Envíos</span></div>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                <span>Cuenta activa</span>
                {table.kitchenStatus === 'READY' || table.balance === 0 ? (
                  <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> ¡Listo! Cobrar / Ver →
                  </span>
                ) : (
                  <span className="font-bold text-amber-600 dark:text-amber-400 group-hover:underline flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> En Cocina · Ver mesa →
                  </span>
                )}
              </div>
            </Link>
          ))}
          {filtered.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">No hay mesas abiertas en este filtro.</div>}
        </div>
      )}
    </div>
  )
}

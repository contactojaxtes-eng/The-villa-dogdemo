import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { io } from '@/lib/socket'
import { PlusCircle, RefreshCw, Search, UtensilsCrossed, Wallet, ChefHat } from 'lucide-react'
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tables
    return tables.filter(t => `${t.label} ${t.openedBy?.name || ''}`.toLowerCase().includes(q))
  }, [tables, search])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Mesas abiertas</h1>
          <p className="text-sm text-[var(--text-secondary)]">Cuentas activas de salon, cocina y cobro.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
          <Button asChild className="gap-2 bg-[var(--accent)] text-[var(--accent-fg)]"><Link to="/tables/new"><PlusCircle className="h-4 w-4" />Nuevo Pedido</Link></Button>
        </div>
      </div>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar mesa, carro, cliente o mesera..." className="pl-9" />
      </div>

      {loading ? <p className="text-sm text-[var(--text-secondary)]">Cargando mesas...</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(table => (
            <Link key={table.id} to={`/tables/${table.id}`} className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)] flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{table.label}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-500/10 px-2 py-0.5 rounded-lg w-fit">
                      <span>👤 Atendido por: {table.openedBy?.name || 'Mesero'}</span>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-600 tracking-wider">ABIERTA</span>
                </div>
                <div className="mt-3.5 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-[var(--bg-elevated)] p-2"><Wallet className="mb-1 h-4 w-4 text-[var(--accent)]" /><b>{formatCurrency(table.total || 0)}</b><span className="block text-[var(--text-muted)]">Total</span></div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] p-2"><ChefHat className="mb-1 h-4 w-4 text-[var(--accent)]" /><b>{table.kitchenStatus}</b><span className="block text-[var(--text-muted)]">Cocina</span></div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] p-2"><UtensilsCrossed className="mb-1 h-4 w-4 text-[var(--accent)]" /><b>{table.orders?.length || 0}</b><span className="block text-[var(--text-muted)]">Envios</span></div>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                <span>Cualquier mesero o cajero puede cobrar</span>
                <span className="font-bold text-[var(--accent)] group-hover:underline">Ver y cobrar →</span>
              </div>
            </Link>
          ))}
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">No hay mesas abiertas.</div>}
        </div>
      )}
    </div>
  )
}

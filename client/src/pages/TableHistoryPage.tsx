import { ProtectedImage } from '@/components/ProtectedImage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, Eye, RefreshCw, Search, UtensilsCrossed, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'

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

export default function TableHistoryPage() {
  const [tables, setTables] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('CLOSED')
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<any[]>(`/tables?status=${filterStatus}`)
      setTables(Array.isArray(res) ? res : [])
    } catch (err) {
      console.error(err)
      setTables([])
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tables.filter(t => {
      if (!q) return true
      const label = t.label?.toLowerCase() || ''
      const waiter = t.openedBy?.name?.toLowerCase() || ''
      const items = (t.orders || []).flatMap((o: any) => (o.items || []).map((i: any) => i.menuItem?.name || i.nameSnapshot || '')).join(' ').toLowerCase()
      return label.includes(q) || waiter.includes(q) || items.includes(q)
    })
  }, [tables, search])

  const stats = useMemo(() => {
    const totalSales = filtered.reduce((acc, t) => acc + (t.total || 0), 0)
    const count = filtered.length
    const avg = count > 0 ? totalSales / count : 0
    return { totalSales, count, avg }
  }, [filtered])

  return (
    <div className="space-y-4">
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </Button>
          <Button asChild size="sm" className="bg-[var(--accent)] text-[var(--accent-fg)] font-bold text-xs gap-1">
            <Link to="/tables/new"><UtensilsCrossed className="h-3.5 w-3.5" /> Nuevo Pedido Mesa</Link>
          </Button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por mesa, mesero o producto..."
            className="pl-9 h-10 text-xs rounded-xl"
          />
        </div>

        <div className="flex gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl shrink-0 overflow-x-auto">
          {[
            { id: 'CLOSED', label: 'Cerradas y Pagadas' },
            { id: 'ALL', label: 'Todas' },
            { id: 'OPEN', label: 'Abiertas' },
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

      {/* Tables List */}
      {loading ? (
        <div className="p-12 text-center text-sm text-[var(--text-secondary)]">Cargando historial de mesas...</div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(table => {
            const allItems = (table.orders || []).flatMap((o: any) => o.items || [])
            const hasTransfer = (table.transferProofs || []).length > 0
            const proofId = hasTransfer ? table.transferProofs[0]?.id : null

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
                    <p className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-1.5 flex-wrap">
                      <span>Mesera: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong></span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="text-[var(--text-muted)] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTableDate(table.openedAt || table.createdAt)}
                      </span>
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-base font-black text-[var(--accent)] block leading-tight">
                      {formatCurrency(table.total || 0)}
                    </span>
                    <span className="text-[11px] font-bold text-[var(--text-secondary)] mt-0.5 block">
                      {hasTransfer ? '📲 Transferencia' : '💵 Efectivo'}
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
                  {hasTransfer && proofId ? (
                    <button
                      type="button"
                      onClick={() => setZoomUrl(`/payment-validation/proofs/${proofId}/image`)}
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
              No hay ventas de mesa registradas con los filtros seleccionados.
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
            <div className="max-h-[80vh] w-full flex items-center justify-center overflow-auto rounded-xl bg-black/50 p-1">
              <ProtectedImage endpoint={zoomUrl} alt="Comprobante" className="max-h-[78vh] max-w-full object-contain rounded-lg shadow-2xl" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

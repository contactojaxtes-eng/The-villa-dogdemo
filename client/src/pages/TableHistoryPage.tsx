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

      {/* KPI Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm">
          <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Total Ventas Salón</p>
          <p className="text-xl font-black text-[var(--accent)] mt-1">{formatCurrency(stats.totalSales)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm">
          <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Mesas Atendidas</p>
          <p className="text-xl font-black text-[var(--text-primary)] mt-1">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm">
          <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Promedio por Mesa</p>
          <p className="text-xl font-black text-[var(--text-secondary)] mt-1">{formatCurrency(stats.avg)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por mesa, mesero o producto..."
            className="pl-9 h-10 text-xs"
          />
        </div>

        <div className="flex gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl w-full sm:w-auto">
          {[
            { id: 'CLOSED', label: 'Cerradas y Pagadas' },
            { id: 'ALL', label: 'Todas las Mesas' },
            { id: 'OPEN', label: 'Mesas Abiertas' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id)}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-black rounded-lg transition-all ${
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
        <div className="space-y-3">
          {filtered.map(table => {
            const allItems = (table.orders || []).flatMap((o: any) => o.items || [])
            const hasTransfer = (table.transferProofs || []).length > 0
            const proofId = hasTransfer ? table.transferProofs[0]?.id : null

            return (
              <div
                key={table.id}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm transition hover:border-[var(--accent)]/50"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[var(--text-primary)]">{table.label}</span>
                    <span className="text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-md">
                      👤 Atendido por: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong>
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider border ${
                      table.status === 'CLOSED'
                        ? 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]'
                        : 'bg-[var(--accent)]/10 border-[var(--accent)]/25 text-[var(--accent)]'
                    }`}>
                      {table.status === 'CLOSED' ? '✓ CERRADA Y LIBERADA' : 'ABIERTA'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {formatTableDate(table.openedAt || table.createdAt)}
                    </span>
                    <span className="text-base font-black text-[var(--accent)] ml-2">
                      {formatCurrency(table.total || 0)}
                    </span>
                  </div>
                </div>

                {/* Items consumed */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {allItems.map((item: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                    >
                      <b className="text-[var(--accent)] mr-1">{item.quantity}x</b>
                      {item.menuItem?.name || item.nameSnapshot}
                    </span>
                  ))}
                  {allItems.length === 0 && (
                    <span className="text-xs text-[var(--text-muted)] italic">Sin productos registrados</span>
                  )}
                </div>

                {/* Footer with Payment info & link */}
                <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-muted)]">Método de pago:</span>
                    {hasTransfer ? (
                      <span className="inline-flex items-center gap-1 font-bold text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded">
                        📲 Transferencia
                        {proofId && (
                          <button
                            type="button"
                            onClick={() => setZoomUrl(`/payment-validation/proofs/${proofId}/image`)}
                            className="ml-1 text-[var(--accent)] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                          >
                            <Eye className="h-3 w-3" /> Ver comprobante
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="font-bold text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded">
                        💵 Efectivo
                      </span>
                    )}
                  </div>

                  <Link
                    to={`/tables/${table.id}`}
                    className="font-bold text-[var(--accent)] hover:underline"
                  >
                    Ver detalle completo →
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

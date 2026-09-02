import { useCallback, useEffect, useMemo, useState } from 'react'
import { io } from '@/lib/socket'
import { Bell, CheckCircle2, ChefHat, Clock, Flame, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage, type KitchenTicketItemSummary, type KitchenTicketSummary } from '@/lib/tableTypes'

const columns = [
  { key: 'NEW', label: 'Nuevos', color: 'border-amber-500/40 bg-amber-500/5' },
  { key: 'PREPARING', label: 'Preparando', color: 'border-orange-500/40 bg-orange-500/5' },
  { key: 'READY', label: 'Listos', color: 'border-emerald-500/40 bg-emerald-500/5' },
]

export default function KitchenPage() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicketSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    api.get<KitchenTicketSummary[]>('/kitchen/tickets')
      .then(setTickets)
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
    socket.on('kitchenTicketCreated', (ticket: KitchenTicketSummary) => {
      alerts.toast(`Nuevo pedido para ${ticket.station?.name || 'cocina'}`)
      load()
    })
    socket.on('kitchenTicketUpdated', load)
    socket.on('kitchenTicketEdited', load)
    return () => { socket.disconnect() }
  }, [load, user?.id, user?.name, user?.role])

  const grouped = useMemo(() => {
    return columns.reduce<Record<string, KitchenTicketSummary[]>>((acc, col) => {
      acc[col.key] = tickets.filter(t => t.status === col.key)
      return acc
    }, {})
  }, [tickets])

  const setStatus = async (ticket: KitchenTicketSummary, status: string) => {
    try {
      await api.put(`/kitchen/tickets/${ticket.id}/status`, { status })
      load()
    } catch (err: unknown) {
      alerts.error('No se pudo actualizar', getErrorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--text-primary)]"><ChefHat className="h-7 w-7 text-[var(--accent)]" />Cocina</h1>
          <p className="text-sm text-[var(--text-secondary)]">Tickets por estacion, mesa y prioridad.</p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
      </div>

      {loading ? <p className="text-sm text-[var(--text-secondary)]">Cargando cocina...</p> : (
        <div className="grid gap-4 xl:grid-cols-3">
          {columns.map(col => (
            <section key={col.key} className={`min-h-[60vh] rounded-2xl border p-3 ${col.color}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-black">{col.label}</h2>
                <span className="rounded-full bg-[var(--bg-panel)] px-2 py-1 text-xs font-black">{grouped[col.key]?.length || 0}</span>
              </div>
              <div className="space-y-3">
                {(grouped[col.key] || []).map(ticket => {
                  const hasRemovedItems = ticket.items?.some(item => item.changeType === 'REMOVED')
                  return (
                  <article key={ticket.id} className={`rounded-2xl border bg-[var(--bg-panel)] p-4 shadow-sm ${hasRemovedItems ? 'border-rose-500 ring-2 ring-rose-500/20' : ticket.isEdited ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-[var(--border-subtle)]'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">#{ticket.order?.orderNumber} - {ticket.order?.diningTable?.label || 'Mesa'}</p>
                        <p className="text-xs text-[var(--text-secondary)]">Mesera: {ticket.order?.waiter?.name || 'Sin asignar'} - {ticket.station?.name}</p>
                      </div>
                      {hasRemovedItems ? (
                        <span className="rounded-full bg-rose-500/10 px-2 py-1 text-[10px] font-black text-rose-700"><XCircle className="mr-1 inline h-3 w-3" />CANCELADO</span>
                      ) : ticket.isEdited && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-600"><Bell className="mr-1 inline h-3 w-3" />EDITADO</span>
                      )}
                    </div>
                    {ticket.changeSummary && <div className={`mt-3 rounded-xl border p-2 text-xs font-bold ${hasRemovedItems ? 'border-rose-500/30 bg-rose-500/10 text-rose-700' : 'border-amber-500/30 bg-amber-500/10 text-amber-700'}`}>{ticket.changeSummary}</div>}
                    <div className="mt-3 space-y-2">
                      {ticket.items?.map((item: KitchenTicketItemSummary) => {
                        const isRemoved = item.changeType === 'REMOVED'
                        return (
                        <div key={item.id} className={`rounded-xl p-2 text-sm ${item.changeType === 'ADDED' ? 'bg-emerald-500/10 text-emerald-700' : item.changeType === 'MODIFIED' ? 'bg-amber-500/10 text-amber-700' : isRemoved ? 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30' : 'bg-[var(--bg-elevated)]'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            {isRemoved && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white"><XCircle className="mr-1 inline h-3 w-3" />QUITADO / CANCELADO</span>}
                            <b>{isRemoved ? 'Antes: ' : ''}{item.quantity} x {item.nameSnapshot}</b>
                          </div>
                          {item.notes && <p className="text-xs opacity-80">Nota: {item.notes}</p>}
                        </div>
                        )
                      })}
                    </div>
                    <div className="mt-4 flex gap-2">
                      {ticket.status === 'NEW' && <Button onClick={() => setStatus(ticket, 'PREPARING')} className="flex-1 gap-2 bg-orange-600 text-white hover:bg-orange-700"><Flame className="h-4 w-4" />Preparar</Button>}
                      {ticket.status === 'PREPARING' && <Button onClick={() => setStatus(ticket, 'READY')} className="flex-1 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" />Listo</Button>}
                      {ticket.status === 'READY' && <Button onClick={() => setStatus(ticket, 'SERVED')} variant="outline" className="flex-1 gap-2"><Clock className="h-4 w-4" />Servido</Button>}
                    </div>
                  </article>
                  )
                })}
                {(grouped[col.key] || []).length === 0 && <p className="rounded-xl border border-dashed border-[var(--border-default)] p-6 text-center text-sm text-[var(--text-muted)]">Sin tickets.</p>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

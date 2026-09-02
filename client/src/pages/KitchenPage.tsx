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

  const consolidatedTickets = useMemo(() => {
    // Garantizar UNA SOLA TARJETA por pedido y estación
    const map = new Map<string, KitchenTicketSummary>()
    for (const t of tickets) {
      const key = `${t.orderId || t.order?.id}_${t.stationId || t.station?.id}`
      if (!map.has(key)) {
        map.set(key, { ...t, items: [...(t.items || [])] })
      } else {
        const existing = map.get(key)!
        const existingNames = new Set(existing.items?.map(i => i.nameSnapshot))
        for (const item of (t.items || [])) {
          if (!existingNames.has(item.nameSnapshot)) {
            existing.items?.push(item)
          } else {
            const idx = existing.items?.findIndex(i => i.nameSnapshot === item.nameSnapshot)
            if (idx !== undefined && idx >= 0 && item.changeType !== 'UNCHANGED') {
              existing.items![idx] = item
            }
          }
        }
        if (t.isEdited) existing.isEdited = true
        if (t.changeSummary) existing.changeSummary = t.changeSummary
        if (t.status === 'PREPARING' && existing.status === 'NEW') existing.status = 'PREPARING'
      }
    }
    return Array.from(map.values())
  }, [tickets])

  const grouped = useMemo(() => {
    return columns.reduce<Record<string, KitchenTicketSummary[]>>((acc, col) => {
      acc[col.key] = consolidatedTickets.filter(t => t.status === col.key)
      return acc
    }, {})
  }, [consolidatedTickets])

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
          <p className="text-sm text-[var(--text-secondary)]">Tickets por estacion, mesa y prioridad (1 tarjeta por pedido).</p>
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
                  const hasActiveItems = ticket.items?.some(item => item.changeType !== 'REMOVED')
                  const isFullyCancelled = !hasActiveItems || ticket.status === 'CANCELLED'

                  return (
                  <article key={ticket.id} className={`rounded-2xl border bg-[var(--bg-panel)] p-4 shadow-sm ${isFullyCancelled ? 'border-rose-500/60 bg-rose-500/5' : ticket.isEdited ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-[var(--border-subtle)]'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">#{ticket.order?.orderNumber} - {ticket.order?.diningTable?.label || 'Mesa'}</p>
                        <p className="text-xs text-[var(--text-secondary)]">Mesera: {ticket.order?.waiter?.name || 'Sin asignar'} · {ticket.station?.name}</p>
                      </div>
                      {isFullyCancelled ? (
                        <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-black text-rose-700 flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> CANCELADO
                        </span>
                      ) : ticket.isEdited && (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-black text-emerald-700 flex items-center gap-1 border border-emerald-500/30">
                          <Bell className="h-3.5 w-3.5 text-emerald-600 animate-bounce" /> MODIFICADO
                        </span>
                      )}
                    </div>

                    {ticket.changeSummary && (
                      <div className={`mt-3 rounded-xl border p-2.5 text-xs font-bold ${isFullyCancelled ? 'border-rose-500/30 bg-rose-500/10 text-rose-800' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900'}`}>
                        {ticket.changeSummary}
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {ticket.items?.map((item: KitchenTicketItemSummary) => {
                        const isRemoved = item.changeType === 'REMOVED'
                        const isAdded = item.changeType === 'ADDED'
                        const isModified = item.changeType === 'MODIFIED'
                        const isTakeaway = (item.notes || '').toLowerCase().includes('para llevar') || (item.notes || '').toLowerCase().includes('llevar')
                        const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()

                        if (isRemoved) {
                          return (
                            <div key={item.id} className="rounded-xl border border-rose-300 bg-rose-500/10 p-2.5 text-rose-900">
                              <div className="flex items-center gap-1.5 text-xs font-black text-rose-700">
                                <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
                                <span>QUITADO / CANCELADO (NO PREPARAR)</span>
                              </div>
                              <p className="mt-1 text-sm font-bold line-through opacity-75">{item.quantity} x {item.nameSnapshot}</p>
                            </div>
                          )
                        }

                        if (isAdded) {
                          return (
                            <div key={item.id} className="rounded-xl border-2 border-emerald-500 bg-emerald-500/15 p-3 text-emerald-950 shadow-sm">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white tracking-wider">
                                  🟢 Nuevo a preparar
                                </span>
                                {isTakeaway ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm">
                                    🥡 PARA LLEVAR (EMPACAR)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 text-blue-800 px-2 py-0.5 text-[10px] font-black">
                                    🍽️ MESA
                                  </span>
                                )}
                              </div>
                              <p className="mt-1.5 text-base font-black text-emerald-950">{item.quantity} x {item.nameSnapshot}</p>
                              {cleanNotes && <p className="text-xs font-bold text-emerald-800 mt-0.5">Nota: {cleanNotes}</p>}
                            </div>
                          )
                        }

                        if (isModified) {
                          return (
                            <div key={item.id} className="rounded-xl border-2 border-amber-500 bg-amber-500/15 p-2.5 text-amber-950">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                                  ✏️ Cantidad modificada {item.previousQty ? `(Antes: ${item.previousQty})` : ''}
                                </span>
                                {isTakeaway ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm">
                                    🥡 PARA LLEVAR (EMPACAR)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 text-blue-800 px-2 py-0.5 text-[10px] font-black">
                                    🍽️ MESA
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm font-black text-amber-950">{item.quantity} x {item.nameSnapshot}</p>
                              {cleanNotes && <p className="text-xs text-amber-800 mt-0.5">Nota: {cleanNotes}</p>}
                            </div>
                          )
                        }

                        return (
                          <div key={item.id} className="rounded-xl bg-[var(--bg-elevated)] p-2.5 text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <b className="text-[var(--text-primary)]">{item.quantity} x {item.nameSnapshot}</b>
                              {isTakeaway ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shrink-0 shadow-sm">
                                  🥡 PARA LLEVAR
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 text-blue-700 px-2 py-0.5 text-[10px] font-bold shrink-0">
                                  🍽️ MESA
                                </span>
                              )}
                            </div>
                            {cleanNotes && <p className="text-xs opacity-80 text-[var(--text-secondary)] mt-0.5">Nota: {cleanNotes}</p>}
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-4 flex gap-2">
                      {isFullyCancelled ? (
                        <Button 
                          variant="outline" 
                          onClick={() => setStatus(ticket, 'CANCELLED')} 
                          className="flex-1 gap-2 border-rose-300 text-rose-700 hover:bg-rose-50 font-black text-xs"
                        >
                          <XCircle className="h-4 w-4 text-rose-600" />
                          Descartar pedido cancelado
                        </Button>
                      ) : (
                        <>
                          {ticket.status === 'NEW' && (
                            <Button onClick={() => setStatus(ticket, 'PREPARING')} className="flex-1 gap-2 bg-orange-600 text-white hover:bg-orange-700 font-bold">
                              <Flame className="h-4 w-4" />Preparar
                            </Button>
                          )}
                          {ticket.status === 'PREPARING' && (
                            <Button onClick={() => setStatus(ticket, 'READY')} className="flex-1 gap-2 bg-emerald-600 text-white hover:bg-emerald-700 font-bold">
                              <CheckCircle2 className="h-4 w-4" />Listo
                            </Button>
                          )}
                          {ticket.status === 'READY' && (
                            <Button onClick={() => setStatus(ticket, 'SERVED')} variant="outline" className="flex-1 gap-2 font-bold">
                              <Clock className="h-4 w-4" />Servido
                            </Button>
                          )}
                        </>
                      )}
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

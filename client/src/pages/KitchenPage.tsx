import { useCallback, useEffect, useMemo, useState } from 'react'
import { io } from '@/lib/socket'
import { Bell, CheckCircle2, ChefHat, Clock, Flame, History, RefreshCw, Undo2, UtensilsCrossed, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage, type KitchenTicketItemSummary, type KitchenTicketSummary } from '@/lib/tableTypes'

export default function KitchenPage() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE')
  const [stationFilter, setStationFilter] = useState<string>('ALL')

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

  const stations = useMemo(() => {
    const set = new Set<string>()
    const list: { id: string; name: string }[] = []
    for (const t of consolidatedTickets) {
      if (t.station?.id && !set.has(t.station.id)) {
        set.add(t.station.id)
        list.push({ id: t.station.id, name: t.station.name })
      }
    }
    return list
  }, [consolidatedTickets])

  // Activos: NUEVO o PREPARANDO (los que cocina debe despachar)
  const activeTickets = useMemo(() => {
    return consolidatedTickets.filter(t => {
      const isPending = t.status === 'NEW' || t.status === 'PREPARING'
      if (!isPending) return false
      if (stationFilter !== 'ALL' && t.stationId !== stationFilter && t.station?.id !== stationFilter) return false
      return true
    })
  }, [consolidatedTickets, stationFilter])

  // Historial: LISTOS o SERVIDOS (los ya completados)
  const historyTickets = useMemo(() => {
    return consolidatedTickets.filter(t => {
      const isDone = t.status === 'READY' || t.status === 'SERVED'
      if (!isDone) return false
      if (stationFilter !== 'ALL' && t.stationId !== stationFilter && t.station?.id !== stationFilter) return false
      return true
    })
  }, [consolidatedTickets, stationFilter])

  const setStatus = async (ticket: KitchenTicketSummary, status: string) => {
    try {
      await api.put(`/kitchen/tickets/${ticket.id}/status`, { status })
      if (status === 'READY') {
        alerts.success('¡Listo para entregar!', `Pedido #${ticket.order?.orderNumber} despachado a mesera.`)
      }
      load()
    } catch (err: unknown) {
      alerts.error('No se pudo actualizar', getErrorMessage(err))
    }
  }

  // Cálculo de minutos transcurridos
  const getMinutesAgo = (dateStr?: string) => {
    if (!dateStr) return null
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    return diff < 0 ? 0 : diff
  }

  return (
    <div className="space-y-4">
      {/* Cabecera limpia */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--text-primary)]">
            <ChefHat className="h-7 w-7 text-[var(--accent)]" /> Cocina Rápida
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Un solo toque: marca <strong>Listo</strong> y el pedido se despacha al mesero y se guarda en el historial.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} className="gap-2 font-bold h-9">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </Button>
        </div>
      </div>

      {/* Pestañas: Activos vs Historial + Filtro por Estación */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'ACTIVE' ? 'default' : 'outline'}
            onClick={() => setActiveTab('ACTIVE')}
            className={`font-black gap-2 h-9 text-xs sm:text-sm ${activeTab === 'ACTIVE' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow' : ''}`}
          >
            <Flame className="h-4 w-4" />
            En Cocina
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-black ${activeTab === 'ACTIVE' ? 'bg-white text-[var(--accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
              {activeTickets.length}
            </span>
          </Button>

          <Button
            variant={activeTab === 'HISTORY' ? 'default' : 'outline'}
            onClick={() => setActiveTab('HISTORY')}
            className={`font-bold gap-2 h-9 text-xs sm:text-sm ${activeTab === 'HISTORY' ? 'bg-[var(--text-primary)] text-white shadow' : ''}`}
          >
            <History className="h-4 w-4" />
            Historial Despachados
            <span className="ml-1 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-secondary)]">
              {historyTickets.length}
            </span>
          </Button>
        </div>

        {/* Filtro de estaciones si hay más de 1 */}
        {stations.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-xs font-bold text-[var(--text-muted)] shrink-0">Estación:</span>
            <Button
              size="sm"
              variant={stationFilter === 'ALL' ? 'secondary' : 'ghost'}
              className="h-7 text-xs font-bold"
              onClick={() => setStationFilter('ALL')}
            >
              Todas
            </Button>
            {stations.map(st => (
              <Button
                key={st.id}
                size="sm"
                variant={stationFilter === st.id ? 'secondary' : 'ghost'}
                className="h-7 text-xs font-bold shrink-0"
                onClick={() => setStationFilter(st.id)}
              >
                {st.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)] py-8 text-center">Cargando pedidos de cocina...</p>
      ) : activeTab === 'ACTIVE' ? (
        /* VISTA PRINCIPAL: PEDIDOS ACTIVOS EN GRILLA COMPACTA */
        activeTickets.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-[var(--border-default)] p-12 text-center">
            <UtensilsCrossed className="h-12 w-12 text-emerald-500 mx-auto mb-2 opacity-80" />
            <h3 className="text-lg font-black text-[var(--text-primary)]">¡Cocina al día!</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-1">No hay pedidos pendientes en este momento.</p>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-start">
            {activeTickets.map(ticket => {
              const hasActiveItems = ticket.items?.some(item => item.changeType !== 'REMOVED')
              const isFullyCancelled = !hasActiveItems || ticket.status === 'CANCELLED'
              const minutesAgo = getMinutesAgo(ticket.order?.createdAt)
              const isDelayed = minutesAgo !== null && minutesAgo >= 15
              const isWarning = minutesAgo !== null && minutesAgo >= 10 && !isDelayed

              return (
                <article
                  key={ticket.id}
                  className={`rounded-2xl border bg-[var(--bg-panel)] p-3.5 shadow-sm transition-all flex flex-col justify-between ${
                    isFullyCancelled
                      ? 'border-rose-300 bg-rose-50/60 dark:bg-rose-950/20'
                      : ticket.isEdited
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'border-[var(--border-subtle)] hover:border-[var(--accent)] hover:shadow-md'
                  }`}
                >
                  <div>
                    {/* Cabecera del ticket */}
                    <div className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-lg font-black text-[var(--text-primary)] leading-tight">
                            #{ticket.order?.orderNumber || '0'} · {ticket.order?.diningTable?.label || ticket.order?.customerName || 'Mesa'}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                          Mesera: <strong className="text-[var(--text-primary)]">{ticket.order?.waiter?.name || 'Sin asignar'}</strong>
                          {ticket.station?.name && <span> · {ticket.station.name}</span>}
                        </p>
                      </div>

                      {/* Tiempo o Cancelado badge */}
                      {isFullyCancelled ? (
                        <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-700 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> CANCELADO
                        </span>
                      ) : (
                        <div className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black flex items-center gap-1 ${
                          isDelayed ? 'bg-rose-500/15 text-rose-700 animate-pulse' :
                          isWarning ? 'bg-amber-500/15 text-amber-700' :
                          'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        }`}>
                          <Clock className="h-3 w-3" />
                          {minutesAgo !== null ? `${minutesAgo} min` : 'Reciente'}
                        </div>
                      )}
                    </div>

                    {/* Alerta de modificación si el mesero quitó/agregó algo */}
                    {ticket.isEdited && ticket.changeSummary && !isFullyCancelled && (
                      <div className="mt-2 rounded-lg border border-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                        <Bell className="h-3.5 w-3.5 text-emerald-600 shrink-0 animate-bounce" />
                        <span className="truncate">{ticket.changeSummary}</span>
                      </div>
                    )}

                    {/* Lista compacta de items */}
                    <div className="mt-2.5 space-y-1.5">
                      {ticket.items?.map((item: KitchenTicketItemSummary) => {
                        const isRemoved = item.changeType === 'REMOVED'
                        const isAdded = item.changeType === 'ADDED'
                        const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')
                        const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()

                        if (isRemoved) {
                          return (
                            <div key={item.id} className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs text-rose-800 line-through opacity-75">
                              ❌ Quitado: {item.quantity}x {item.nameSnapshot}
                            </div>
                          )
                        }

                        return (
                          <div
                            key={item.id}
                            className={`rounded-xl p-2 text-xs border ${
                              isAdded
                                ? 'border-emerald-400 bg-emerald-500/10 text-emerald-950 font-bold'
                                : 'border-transparent bg-[var(--bg-elevated)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-sm font-black text-[var(--text-primary)]">
                                {item.quantity}x {item.nameSnapshot}
                              </span>
                              {isTakeaway ? (
                                <span className="shrink-0 rounded-full bg-amber-500 text-slate-950 px-1.5 py-0.2 text-[10px] font-black uppercase tracking-wider shadow-sm">
                                  🥡 LLEVAR
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-blue-500/10 text-blue-700 px-1.5 py-0.2 text-[10px] font-bold">
                                  🍽️ MESA
                                </span>
                              )}
                            </div>
                            {cleanNotes && (
                              <p className="text-[11px] font-semibold text-[var(--text-secondary)] mt-0.5 pl-1 border-l-2 border-[var(--accent)]">
                                {cleanNotes}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Botón rápido y directo de acción */}
                  <div className="mt-3.5 pt-2 border-t border-[var(--border-subtle)]">
                    {isFullyCancelled ? (
                      <Button
                        variant="outline"
                        onClick={() => setStatus(ticket, 'CANCELLED')}
                        className="w-full h-9 border-rose-300 text-rose-700 hover:bg-rose-50 font-black text-xs gap-1.5"
                      >
                        <XCircle className="h-4 w-4" /> Descartar pedido cancelado
                      </Button>
                    ) : (
                      <div className="flex gap-2 items-center">
                        {/* Botón para marcar en preparación opcional */}
                        {ticket.status === 'NEW' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStatus(ticket, 'PREPARING')}
                            className="h-10 px-3 text-orange-600 border-orange-300 hover:bg-orange-50 font-bold text-xs"
                            title="Marcar que se empezó a preparar"
                          >
                            <Flame className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Botón principal de LISTO (1 solo toque y sale al historial) */}
                        <Button
                          onClick={() => setStatus(ticket, 'READY')}
                          className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm gap-2 shadow-md transition-all active:scale-95"
                        >
                          <CheckCircle2 className="h-5 w-5" /> ¡LISTO / DESPACHAR!
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )
      ) : (
        /* VISTA DE HISTORIAL: PEDIDOS YA DESPACHADOS */
        historyTickets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-muted)]">
            Aún no hay pedidos despachados en este turno.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {historyTickets.map(ticket => (
              <article key={ticket.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 opacity-85 shadow-sm">
                <div className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                  <div>
                    <p className="text-base font-black text-[var(--text-primary)]">
                      #{ticket.order?.orderNumber || '0'} · {ticket.order?.diningTable?.label || ticket.order?.customerName || 'Mesa'}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Mesera: {ticket.order?.waiter?.name || 'Sin asignar'}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-black text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Despachado
                  </span>
                </div>

                <div className="mt-2 space-y-1">
                  {ticket.items?.filter(i => i.changeType !== 'REMOVED').map(item => (
                    <p key={item.id} className="text-xs text-[var(--text-primary)] font-medium">
                      • {item.quantity}x {item.nameSnapshot}
                    </p>
                  ))}
                </div>

                <div className="mt-3 pt-2 border-t border-[var(--border-subtle)] flex justify-between items-center text-xs">
                  <span className="text-[var(--text-muted)]">Completado</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setStatus(ticket, 'PREPARING')}
                    className="h-7 text-xs font-bold gap-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                    title="Si se marcó listo por error, devolver a cocina"
                  >
                    <Undo2 className="h-3 w-3" /> Reabrir
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </div>
  )
}

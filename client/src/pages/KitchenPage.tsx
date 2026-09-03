import { useCallback, useEffect, useMemo, useState } from 'react'
import { io } from '@/lib/socket'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Flame,
  History,
  RefreshCw,
  Undo2,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage, type KitchenTicketItemSummary, type KitchenTicketSummary } from '@/lib/tableTypes'
import { playUrgentBell } from '@/lib/sound'

type KitchenTab = 'ALL_ACTIVE' | 'NEW' | 'PREPARING' | 'READY' | 'HISTORY'

export default function KitchenPage() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<KitchenTab>('ALL_ACTIVE')
  const [stationFilter, setStationFilter] = useState<string>('ALL')
  const [showPrevious, setShowPrevious] = useState<Record<string, boolean>>({})
  const toggleShowPrevious = (ticketId: string) => setShowPrevious(p => ({ ...p, [ticketId]: !p[ticketId] }))

  // Carga inicial (silenciosa en segundo plano para no hacer parpadear la pantalla)
  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true)
    api.get<KitchenTicketSummary[]>('/kitchen/tickets')
      .then(setTickets)
      .catch(console.error)
      .finally(() => {
        if (showSpinner) setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(true)
  }, [load])

  // Determinar si un ticket pertenece específicamente a este cocinero / estación
  const isTicketForThisCook = useCallback((ticket: KitchenTicketSummary) => {
    // Si es Admin, Superadmin o Cajero en la pantalla de cocina, ve todo
    if (['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user?.role || '')) {
      return true
    }
    // Si es cocinero (KITCHEN):
    if (user?.role === 'KITCHEN') {
      const assignedId = ticket.assignedToId || ticket.assignedTo?.id
      // 1. Asignado específicamente a este cocinero
      if (assignedId && assignedId === user?.id) return true
      // 2. Si no tiene cocinero asignado directamente, pero la estación está asignada a este usuario
      const stationUsers = ticket.station?.users || []
      if (!assignedId && stationUsers.some(u => u.id === user?.id)) return true
      return false
    }
    return false
  }, [user?.id, user?.role])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })

    // NUEVO TICKET CREADO: Cero polling, reactivo 100% por WebSockets
    socket.on('kitchenTicketCreated', (ticket: KitchenTicketSummary) => {
      // Filtrar estrictamente: solo alertar y sonar si es para la estación de este cocinero
      if (!isTicketForThisCook(ticket)) return

      alerts.toast(`🔔 Nuevo pedido #${ticket.order?.orderNumber || ''} para ${ticket.station?.name || 'cocina'}`)
      playUrgentBell()

      // Actualización directa en memoria (cero recarga de pantalla)
      setTickets(prev => {
        const without = prev.filter(t => t.id !== ticket.id)
        return [ticket, ...without]
      })
    })

    // TICKET ACTUALIZADO
    socket.on('kitchenTicketUpdated', (ticket: KitchenTicketSummary) => {
      setTickets(prev => {
        const exists = prev.some(t => t.id === ticket.id)
        if (!exists) {
          return isTicketForThisCook(ticket) ? [ticket, ...prev] : prev
        }
        return prev.map(t => t.id === ticket.id ? ticket : t)
      })
    })

    // TICKET EDITADO (modificaciones de mesera)
    socket.on('kitchenTicketEdited', (ticket: KitchenTicketSummary) => {
      if (!isTicketForThisCook(ticket)) return

      alerts.toast(`✏️ Pedido editado #${ticket.order?.orderNumber || ''} (${ticket.station?.name || 'cocina'})`)
      playUrgentBell()

      setTickets(prev => {
        const exists = prev.some(t => t.id === ticket.id)
        if (!exists) return [ticket, ...prev]
        return prev.map(t => t.id === ticket.id ? ticket : t)
      })
    })

    return () => { socket.disconnect() }
  }, [isTicketForThisCook, user?.id, user?.name, user?.role])

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
        if (t.status === 'READY' && ['NEW', 'PREPARING'].includes(existing.status)) existing.status = 'READY'
        if (t.status === 'SERVED') existing.status = 'SERVED'
        if (t.status === 'CANCELLED') existing.status = 'CANCELLED'
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

  // Tickets filtrados por usuario/rol y estación
  const scopedTickets = useMemo(() => {
    return consolidatedTickets.filter(t => {
      if (stationFilter !== 'ALL' && t.stationId !== stationFilter && t.station?.id !== stationFilter) return false
      // Si el usuario logueado es cocinero (KITCHEN), mostrar ÚNICAMENTE sus tickets asignados
      if (user?.role === 'KITCHEN') {
        const assignedId = t.assignedToId || t.assignedTo?.id
        if (assignedId && assignedId !== user.id) return false
        const stationUsers = t.station?.users || []
        if (!assignedId && stationUsers.length > 0 && !stationUsers.some(u => u.id === user.id)) return false
      }
      return true
    })
  }, [consolidatedTickets, stationFilter, user?.id, user?.role])

  // Contadores vivos precisos
  const countNew = useMemo(() => scopedTickets.filter(t => t.status === 'NEW').length, [scopedTickets])
  const countPreparing = useMemo(() => scopedTickets.filter(t => t.status === 'PREPARING').length, [scopedTickets])
  const countReady = useMemo(() => scopedTickets.filter(t => t.status === 'READY').length, [scopedTickets])
  const countCancelled = useMemo(() => scopedTickets.filter(t => t.status === 'CANCELLED').length, [scopedTickets])
  // En Cocina (Activos en preparación): los que requieren atención inmediata del cocinero
  const countAllActive = countNew + countPreparing + countCancelled
  const countHistory = useMemo(() => scopedTickets.filter(t => ['SERVED', 'CANCELLED', 'READY'].includes(t.status)).length, [scopedTickets])

  // Lista de tickets según la pestaña activa (orden FIFO: el más antiguo primero arriba)
  // Exactamente 2 pasos en cocina: Preparar -> Listo y pasa a Listos/Historial
  const displayTickets = useMemo(() => {
    let list: KitchenTicketSummary[] = []
    if (activeTab === 'ALL_ACTIVE') {
      list = scopedTickets.filter(t => ['NEW', 'PREPARING', 'CANCELLED'].includes(t.status))
    } else if (activeTab === 'NEW') {
      list = scopedTickets.filter(t => t.status === 'NEW')
    } else if (activeTab === 'PREPARING') {
      list = scopedTickets.filter(t => t.status === 'PREPARING')
    } else if (activeTab === 'READY') {
      list = scopedTickets.filter(t => t.status === 'READY')
    } else if (activeTab === 'HISTORY') {
      list = scopedTickets.filter(t => ['SERVED', 'CANCELLED', 'READY'].includes(t.status))
    }
    return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [scopedTickets, activeTab])

  // Cambio de estado sin modales bloqueantes
  const setStatus = async (ticket: KitchenTicketSummary, newStatus: string) => {
    try {
      // Actualización optimista inmediata en memoria
      setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, status: newStatus } : t))
      await api.put(`/kitchen/tickets/${ticket.id}/status`, { status: newStatus })

      // Notificación discreta sin popup modal bloqueante
      if (newStatus === 'READY') {
        alerts.toast(`¡Pedido #${ticket.order?.orderNumber} listo para entrega! Avisado a mesera.`)
      } else if (newStatus === 'PREPARING') {
        alerts.toast(`Iniciada preparación #${ticket.order?.orderNumber}`)
      } else if (newStatus === 'SERVED') {
        alerts.toast(`Pedido #${ticket.order?.orderNumber} archivado a historial`)
      }
    } catch (err: unknown) {
      alerts.error('No se pudo actualizar', getErrorMessage(err))
      load(false)
    }
  }

  // Cálculo de minutos transcurridos
  const getMinutesAgo = (dateStr?: string) => {
    if (!dateStr) return null
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    return diff < 0 ? 0 : diff
  }

  return (
    <div className="space-y-3">
      {/* Barra de control superior con Filtros de Estado y Estación */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--bg-panel)] p-2.5 sm:p-3 rounded-2xl border border-[var(--border-subtle)] shadow-xs">
        {/* Pestañas de estado: Todos Activos, Nuevos, En Preparación, Listos, Historial */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <Button
            size="sm"
            variant={activeTab === 'ALL_ACTIVE' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('ALL_ACTIVE')}
            className={`font-black gap-1.5 h-8 text-xs shrink-0 ${activeTab === 'ALL_ACTIVE' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-xs' : ''}`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>En Cocina</span>
            <span className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-black ${activeTab === 'ALL_ACTIVE' ? 'bg-white text-[var(--accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
              {countAllActive}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === 'NEW' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('NEW')}
            className={`font-black gap-1.5 h-8 text-xs shrink-0 ${activeTab === 'NEW' ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs' : ''}`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Nuevos</span>
            <span className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-black ${activeTab === 'NEW' ? 'bg-white text-blue-600' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
              {countNew}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === 'PREPARING' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('PREPARING')}
            className={`font-black gap-1.5 h-8 text-xs shrink-0 ${activeTab === 'PREPARING' ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs' : ''}`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>En Preparación</span>
            <span className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-black ${activeTab === 'PREPARING' ? 'bg-slate-950 text-amber-400' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
              {countPreparing}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === 'READY' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('READY')}
            className={`font-black gap-1.5 h-8 text-xs shrink-0 ${activeTab === 'READY' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : ''}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Listos</span>
            <span className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-black ${activeTab === 'READY' ? 'bg-white text-emerald-600' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
              {countReady}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === 'HISTORY' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('HISTORY')}
            className={`font-bold gap-1.5 h-8 text-xs shrink-0 ${activeTab === 'HISTORY' ? 'bg-[var(--text-primary)] text-white shadow-xs' : ''}`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Historial</span>
            <span className="ml-1 rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.2 text-[10px] font-bold text-[var(--text-secondary)]">
              {countHistory}
            </span>
          </Button>
        </div>

        {/* Filtro de estaciones + botón actualizar */}
        <div className="flex items-center gap-2">
          {stations.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto">
              <Button
                size="sm"
                variant={stationFilter === 'ALL' ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-[11px] font-bold"
                onClick={() => setStationFilter('ALL')}
              >
                Todas
              </Button>
              {stations.map(st => (
                <Button
                  key={st.id}
                  size="sm"
                  variant={stationFilter === st.id ? 'secondary' : 'ghost'}
                  className="h-7 px-2 text-[11px] font-bold shrink-0"
                  onClick={() => setStationFilter(st.id)}
                >
                  {st.name}
                </Button>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => load(true)} className="gap-1.5 font-bold h-8 text-xs cursor-pointer">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        </div>
      </div>

      {loading && tickets.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-8 text-center">Cargando pedidos de cocina...</p>
      ) : displayTickets.length === 0 ? (
        /* VISTA VACÍA */
        <div className="rounded-2xl border-2 border-dashed border-[var(--border-default)] p-12 text-center bg-[var(--bg-panel)]">
          {activeTab === 'HISTORY' ? (
            <>
              <History className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-2 opacity-70" />
              <h3 className="text-lg font-black text-[var(--text-primary)]">Sin pedidos despachados</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Aún no hay pedidos marcados como despachados o cancelados en este turno.</p>
            </>
          ) : activeTab === 'READY' ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-2 opacity-80" />
              <h3 className="text-lg font-black text-[var(--text-primary)]">Sin pedidos esperando recogida</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Cuando marques un pedido como listo, se mostrará aquí para que la mesera lo retire.</p>
            </>
          ) : (
            <>
              <UtensilsCrossed className="h-12 w-12 text-emerald-500 mx-auto mb-2 opacity-80" />
              <h3 className="text-lg font-black text-[var(--text-primary)]">¡Cocina al día!</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1">No hay pedidos pendientes en esta sección.</p>
            </>
          )}
        </div>
      ) : (
        /* GRILLA DE TICKETS */
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 items-start">
          {displayTickets.map(ticket => {
            const hasActiveItems = ticket.items?.some(i => i.changeType !== 'REMOVED')
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
                    ? 'border-amber-500 ring-2 ring-amber-500/20'
                    : ticket.status === 'READY'
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
                        {ticket.isEdited && (
                          <span className="rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black flex items-center gap-1 shadow-xs animate-pulse">
                            <AlertTriangle className="h-3 w-3" /> PEDIDO EDITADO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span>Mesera: <strong className="text-[var(--text-primary)]">{ticket.order?.waiter?.name || 'Sin asignar'}</strong></span>
                        {ticket.assignedTo?.name && (
                          <span className="text-[10px] font-bold bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-1.5 py-0.2 rounded text-[var(--text-primary)]">
                            👨‍🍳 {ticket.assignedTo.name}
                          </span>
                        )}
                        {ticket.station?.name && <span className="opacity-75">· {ticket.station.name}</span>}
                      </p>
                    </div>

                    {/* Tiempo, Listo o Cancelado badge */}
                    {isFullyCancelled ? (
                      <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-700 dark:text-rose-400 flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> CANCELADO
                      </span>
                    ) : ticket.status === 'READY' ? (
                      <span className="shrink-0 rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-black flex items-center gap-1 shadow-xs">
                        <CheckCircle2 className="h-3 w-3" /> ¡LISTO!
                      </span>
                    ) : ticket.status === 'SERVED' ? (
                      <span className="shrink-0 rounded-full bg-slate-700 text-white px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Despachado
                      </span>
                    ) : (
                      <div className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black flex items-center gap-1 ${
                        isDelayed ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 animate-pulse' :
                        isWarning ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                        'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      }`}>
                        <Clock className="h-3 w-3" />
                        {minutesAgo !== null ? `${minutesAgo} min` : 'Reciente'}
                      </div>
                    )}
                  </div>

                  {/* Nota general del pedido */}
                  {ticket.order?.notes && (
                    <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-950 dark:text-amber-200">
                      <span className="block text-[10px] uppercase font-black tracking-wider text-amber-700 dark:text-amber-400">
                        📝 Nota del pedido:
                      </span>
                      <span className="font-bold">{ticket.order.notes}</span>
                    </div>
                  )}

                  {/* Lista de items: si el pedido fue editado, mostrar SOLO lo nuevo a preparar y lo quitado en letra GRANDE */}
                  {(() => {
                    const actionItems = ticket.isEdited
                      ? (ticket.items || []).filter(i => i.changeType === 'ADDED' || i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && ((i.previousQty ?? i.quantity) !== i.quantity || i.notes !== i.previousNotes)))
                      : []
                    const unchangedItems = ticket.isEdited
                      ? (ticket.items || []).filter(i => !i.changeType || i.changeType === 'UNCHANGED' || (i.changeType === 'MODIFIED' && (i.previousQty ?? i.quantity) === i.quantity && i.notes === i.previousNotes))
                      : []

                    // Si fue editado y hay acciones específicas (agregados / quitados), mostrar modo enfocado en cocina
                    if (ticket.isEdited && actionItems.length > 0 && !isFullyCancelled) {
                      return (
                        <div className="mt-2.5 space-y-2">
                          {/* Banner limpio y directo */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-[11px] font-black uppercase tracking-wider">
                            <Flame className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 animate-pulse" />
                            <span>LO NUEVO A PREPARAR:</span>
                          </div>

                          {/* Items agregados o modificados con letra GRANDE y clara */}
                          <div className="space-y-2">
                            {actionItems.map((item: KitchenTicketItemSummary) => {
                              const isRemoved = item.changeType === 'REMOVED' || (item.changeType === 'MODIFIED' && (item.previousQty ?? item.quantity) > item.quantity)
                              const isAdded = item.changeType === 'ADDED' || (item.changeType === 'MODIFIED' && (item.previousQty ?? item.quantity) < item.quantity)
                              const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')
                              const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()

                              if (isRemoved) {
                                const removedQty = item.changeType === 'REMOVED' ? item.quantity : ((item.previousQty ?? item.quantity) - item.quantity)
                                return (
                                  <div key={item.id} className="rounded-2xl border-2 border-rose-400 bg-rose-500/15 p-3 shadow-xs">
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="font-black px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] tracking-wider uppercase">
                                        SE ELIMINÓ ❌
                                      </span>
                                      <span className="text-[11px] font-black text-rose-600 dark:text-rose-400">
                                        ¡NO PREPARAR!
                                      </span>
                                    </div>
                                    <div className="text-base sm:text-lg font-black text-rose-800 dark:text-rose-300 line-through leading-tight">
                                      -{removedQty}x {item.nameSnapshot}
                                    </div>
                                    {cleanNotes && (
                                      <p className="text-xs text-rose-700/80 dark:text-rose-400 mt-1 line-through">
                                        ({cleanNotes})
                                      </p>
                                    )}
                                  </div>
                                )
                              }

                              const addedQty = item.changeType === 'ADDED' ? item.quantity : (item.quantity - (item.previousQty ?? 0))

                              return (
                                <div key={item.id} className="rounded-2xl border-2 border-emerald-500 bg-emerald-500/15 p-3 shadow-sm">
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className="font-black px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] tracking-wider uppercase animate-pulse">
                                      ¡SE AGREGÓ! ✨
                                    </span>
                                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider ${isTakeaway ? 'bg-amber-500 text-slate-950' : 'bg-blue-600 text-white'}`}>
                                      {isTakeaway ? '🥡 LLEVAR' : '🍽️ MESA'}
                                    </span>
                                  </div>

                                  {/* Nombre y cantidad con letra GRANDE y destacada */}
                                  <div className="text-base sm:text-lg font-black text-[var(--text-primary)] leading-tight mt-0.5">
                                    +{addedQty}x {item.nameSnapshot}
                                  </div>

                                  {item.changeType === 'MODIFIED' && item.previousQty && (
                                    <div className="text-[11px] font-extrabold text-emerald-800 dark:text-emerald-300 mt-0.5">
                                      (Total en cuenta: {item.quantity} un.)
                                    </div>
                                  )}

                                  {cleanNotes && (
                                    <p className="text-xs sm:text-sm font-black text-amber-800 dark:text-amber-200 mt-1.5 pl-2 border-l-3 border-amber-500 bg-amber-500/10 py-1 rounded-r leading-tight">
                                      👉 {cleanNotes}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Acordeón opcional para ver lo que ya se preparó anteriormente sin estorbar */}
                          {unchangedItems.length > 0 && (
                            <div className="pt-2 border-t border-[var(--border-subtle)]">
                              <button
                                type="button"
                                onClick={() => toggleShowPrevious(ticket.id)}
                                className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-1.5 px-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
                              >
                                <span>📋 Pedido anterior ya preparado ({unchangedItems.length} producto{unchangedItems.length > 1 ? 's' : ''})</span>
                                <span className="text-[10px] uppercase font-mono">{showPrevious[ticket.id] ? '▲ Ocultar' : '▼ Ver'}</span>
                              </button>
                              {showPrevious[ticket.id] && (
                                <div className="mt-2 space-y-1 opacity-75">
                                  {unchangedItems.map(item => {
                                    const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')
                                    const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()
                                    return (
                                      <div key={item.id} className="rounded-xl p-2 text-xs bg-[var(--bg-elevated)] flex items-center justify-between">
                                        <span className="font-bold text-[var(--text-primary)]">{item.quantity}x {item.nameSnapshot}</span>
                                        <div className="flex items-center gap-1.5">
                                          {cleanNotes && <span className="text-[10px] text-amber-600 font-semibold truncate">({cleanNotes})</span>}
                                          <span className={`rounded-full px-1.5 py-0.2 text-[9px] font-black ${isTakeaway ? 'bg-amber-500 text-slate-950' : 'bg-blue-500/10 text-blue-700'}`}>
                                            {isTakeaway ? '🥡 Llevar' : '🍽️ Mesa'}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    }

                    // MODO NORMAL (pedidos nuevos o sin cambios de productos): "ya lo demás normal"
                    return (
                      <div className="mt-2.5 space-y-1.5">
                        {ticket.items?.map((item: KitchenTicketItemSummary) => {
                          const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')
                          const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()

                          return (
                            <div key={item.id} className="rounded-xl p-2 text-xs border border-transparent bg-[var(--bg-elevated)]">
                              <div className="flex items-start justify-between gap-1">
                                <div className="min-w-0 flex-1">
                                  <span className="text-sm font-black text-[var(--text-primary)] leading-tight">
                                    {item.quantity}x {item.nameSnapshot}
                                  </span>
                                  {cleanNotes && (
                                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mt-1 pl-1.5 border-l-2 border-amber-500 bg-amber-500/10 py-0.5 rounded-r">
                                      👉 {cleanNotes}
                                    </p>
                                  )}
                                </div>
                                <span className={`shrink-0 rounded-full px-1.5 py-0.2 text-[10px] font-black tracking-wider ${isTakeaway ? 'bg-amber-500 text-slate-950' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>
                                  {isTakeaway ? '🥡 LLEVAR' : '🍽️ MESA'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>

                {/* EXACTAMENTE 2 PASOS: 1. PREPARAR -> 2. LISTO (Y YA QUEDA COMPLETO) */}
                <div className="mt-3.5 pt-2 border-t border-[var(--border-subtle)]">
                  {isFullyCancelled ? (
                    <Button
                      variant="outline"
                      onClick={() => setStatus(ticket, 'SERVED')}
                      className="w-full h-11 border-rose-300 text-rose-700 hover:bg-rose-50 font-black text-xs gap-1.5 cursor-pointer rounded-xl"
                    >
                      <XCircle className="h-4 w-4" /> Descartar y archivar a historial
                    </Button>
                  ) : ticket.status === 'NEW' ? (
                    /* PASO 1: SOLO PREPARAR (ÁMBAR) */
                    <Button
                      size="sm"
                      onClick={() => setStatus(ticket, 'PREPARING')}
                      className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs gap-2 rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
                    >
                      <Flame className="h-4 w-4" /> 1. Empezar a Preparar
                    </Button>
                  ) : ticket.status === 'PREPARING' ? (
                    /* PASO 2: EN PREPARACIÓN -> BOTÓN LISTO (ESMERALDA) + OPCIÓN REVERTIR */
                    <div className="flex gap-2 items-center w-full">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(ticket, 'NEW')}
                        className="h-11 px-3 border-amber-400 text-amber-700 dark:text-amber-300 font-bold text-xs gap-1 rounded-xl shrink-0 hover:bg-amber-500/10 cursor-pointer"
                        title="Regresar a Pendiente si se presionó por error"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Revertir
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setStatus(ticket, 'READY')}
                        className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs gap-2 rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" /> 2. ¡Listo para Entrega!
                      </Button>
                    </div>
                  ) : ticket.status === 'READY' ? (
                    /* ESTADO LISTO (EN PESTAÑA LISTOS): AVISADO A MESERA CON OPCIÓN DE REABRIR */
                    <div className="w-full rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" /> ¡Listo! Esperando recogida
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus(ticket, 'PREPARING')}
                        className="h-8 px-2 text-[11px] font-bold text-[var(--text-muted)] hover:text-amber-600 cursor-pointer"
                        title="Reabrir a preparación si se marcó listo por error"
                      >
                        <Undo2 className="h-3 w-3" /> Reabrir
                      </Button>
                    </div>
                  ) : (
                    /* ESTADO SERVIDO / HISTORIAL */
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="font-bold text-[var(--text-muted)]">
                        {ticket.status === 'CANCELLED' ? 'Pedido Cancelado' : 'Pedido Despachado'}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus(ticket, 'PREPARING')}
                        className="h-7 text-xs font-bold gap-1 text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer"
                        title="Reabrir pedido a cocina"
                      >
                        <Undo2 className="h-3 w-3" /> Reabrir
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

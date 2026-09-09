import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { io } from '@/lib/socket'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Eye,
  Flame,
  History,
  RefreshCw,
  Undo2,
  UtensilsCrossed,
  XCircle,
  Coffee,
  PauseCircle,
  UserCheck,
  BarChart3,
  ChefHat,
  Copy,
  Check,
  Layers,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage, type KitchenTicketItemSummary, type KitchenTicketSummary } from '@/lib/tableTypes'
import { playUrgentBell } from '@/lib/sound'
import { cn } from '@/lib/utils'

type KitchenTab = 'ALL_ACTIVE' | 'NEW' | 'PREPARING' | 'READY' | 'HISTORY'

export default function KitchenPage() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<KitchenTab>('ALL_ACTIVE')
  const [searchParams, setSearchParams] = useSearchParams()
  const [stationFilter, setStationFilter] = useState<string>(() => searchParams.get('station') || 'ALL')
  const [cookFilter, setCookFilter] = useState<string>(() => searchParams.get('cook') || 'ALL')
  const [showPrevious, setShowPrevious] = useState<Record<string, boolean>>({})
  const toggleShowPrevious = (ticketId: string) => setShowPrevious(p => ({ ...p, [ticketId]: !p[ticketId] }))

  // Modal de resumen de producción y platos por cocinero (exclusivo Admin / SuperAdmin)
  const [showProductionModal, setShowProductionModal] = useState(false)
  const [selectedProductionCookId, setSelectedProductionCookId] = useState<string>('ALL')
  const [copiedReport, setCopiedReport] = useState(false)
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')

  // Estado de cena / pausa para cocineros en su tablet
  const [cookStatus, setCookStatus] = useState<{ active?: boolean; onBreak?: boolean; breakUntil?: number | null; breakReason?: string; breakMinutes?: number } | null>(null)
  const [breakRemaining, setBreakRemaining] = useState<string>('')
  const [deliveryStationIds, setDeliveryStationIds] = useState<Set<string>>(new Set())
  const [isDeliveryCook, setIsDeliveryCook] = useState(false)

  // Cargar estado inicial de cena/pausa del cocinero
  useEffect(() => {
    if (user?.role !== 'KITCHEN' || !user?.id) return
    Promise.all([
      api.get<Record<string, any>>('/kitchen/cooks/status').catch(() => ({})),
      api.get<Record<string, any>>('/kitchen/delivery/cooks/status').catch(() => ({})),
      api.get<any>('/kitchen/settings').catch(() => ({ stationChannels: {} })),
      api.get<any[]>('/kitchen/stations').catch(() => []),
    ]).then(([diningStatuses, deliveryStatuses, settings, stations]) => {
      const diningStatusMap = diningStatuses as Record<string, any>
      const deliveryStatusMap = deliveryStatuses as Record<string, any>
      const ids = new Set<string>(Object.entries(settings?.stationChannels || {}).filter(([, channel]) => channel === 'DELIVERY').map(([id]) => id))
      const belongsToDelivery = stations.some(station => ids.has(station.id) && (station.users || []).some((member: any) => member.id === user.id))
      setDeliveryStationIds(ids)
      setIsDeliveryCook(belongsToDelivery)
      setCookStatus(belongsToDelivery ? (deliveryStatusMap[user.id] || { active: true, onBreak: false }) : (diningStatusMap[user.id] || { active: true, onBreak: false }))
    }).catch(() => {})
  }, [user?.id, user?.role])

  // Temporizador en vivo para la tablet del cocinero
  useEffect(() => {
    if (!cookStatus?.onBreak || !cookStatus?.breakUntil) {
      setBreakRemaining('')
      return
    }
    const update = () => {
      const diff = Math.max(0, Math.floor((cookStatus.breakUntil! - Date.now()) / 1000))
      const m = Math.floor(diff / 60)
      const s = diff % 60
      setBreakRemaining(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [cookStatus?.onBreak, cookStatus?.breakUntil])

  // Sincronizar filtros si cambia la URL
  useEffect(() => {
    const s = searchParams.get('station')
    if (s && s !== stationFilter) setStationFilter(s)
    const c = searchParams.get('cook')
    if (c && c !== cookFilter) setCookFilter(c)
  }, [searchParams])

  const handleStationFilter = (id: string) => {
    setStationFilter(id)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id === 'ALL') next.delete('station')
      else next.set('station', id)
      return next
    })
  }

  const handleCookFilter = (id: string) => {
    setCookFilter(id)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id === 'ALL') next.delete('cook')
      else next.set('cook', id)
      return next
    })
  }

  const clearFilters = () => {
    setStationFilter('ALL')
    setCookFilter('ALL')
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('station')
      next.delete('cook')
      return next
    })
  }

  // Carga inicial (silenciosa en segundo plano para no hacer parpadear la pantalla)
  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true)
    api.get<KitchenTicketSummary[]>('/kitchen/tickets?currentShift=true')
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
      const stationUsers = ticket.station?.users || []
      if (deliveryStationIds.has(ticket.stationId || ticket.station?.id || '') && stationUsers.some(u => u.id === user?.id)) {
        return true
      }
      // 1. Si el ticket está asignado a un cocinero: SOLO pertenece a ese cocinero
      if (assignedId) {
        return assignedId === user?.id
      }
      // 2. Solo si el ticket NO tiene cocinero asignado aún, verificar si pertenece a su estación
      return stationUsers.some(u => u.id === user?.id)
    }
    return false
  }, [deliveryStationIds, user?.id, user?.role])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })

    // TICKET CREADO
    socket.on('kitchenTicketCreated', (ticket: KitchenTicketSummary) => {
      if (!isTicketForThisCook(ticket)) return
      playUrgentBell()

      setTickets(prev => {
        const without = prev.filter(t => t.id !== ticket.id)
        return [ticket, ...without]
      })
    })

    // TICKET ACTUALIZADO
    socket.on('kitchenTicketUpdated', (ticket: KitchenTicketSummary) => {
      setTickets(prev => {
        const belongsToMe = isTicketForThisCook(ticket)
        const exists = prev.some(t => t.id === ticket.id)
        if (!exists) {
          return belongsToMe ? [ticket, ...prev] : prev
        }
        // Si ya no me pertenece (ej: reasignado a otro cocinero), retirarlo de mi pantalla
        if (!belongsToMe) {
          return prev.filter(t => t.id !== ticket.id)
        }
        return prev.map(t => t.id === ticket.id ? ticket : t)
      })
    })

    // TICKET EDITADO (modificaciones de mesera)
    socket.on('kitchenTicketEdited', (ticket: KitchenTicketSummary) => {
      if (!isTicketForThisCook(ticket)) {
        // Asegurar que si este cocinero tenía este ticket por error en memoria, lo retire
        setTickets(prev => prev.filter(t => t.id !== ticket.id))
        return
      }

      alerts.toast(`✏️ Pedido editado #${ticket.order?.orderNumber || ''} (${ticket.station?.name || 'cocina'})`)
      playUrgentBell()

      setTickets(prev => {
        const exists = prev.some(t => t.id === ticket.id)
        if (!exists) return [ticket, ...prev]
        return prev.map(t => t.id === ticket.id ? ticket : t)
      })
    })

    // CAMBIO DE ESTADO DE COCINEROS (activo/inactivo/cena)
    socket.on('kitchenCookStatusChanged', (statuses: Record<string, any>) => {
      if (!isDeliveryCook && user?.id && statuses && statuses[user.id]) {
        setCookStatus(statuses[user.id])
      }
    })

    socket.on('deliveryKitchenCookStatusChanged', (statuses: Record<string, any>) => {
      if (isDeliveryCook && user?.id) setCookStatus(statuses?.[user.id] || { active: true, onBreak: false })
    })

    socket.on('cookBreakStarted', (payload: any) => {
      if (payload?.userId === user?.id && (payload?.channel === 'DELIVERY') === isDeliveryCook) {
        setCookStatus(prev => ({
          ...(prev || {}),
          onBreak: true,
          breakUntil: payload.breakUntil,
          breakReason: payload.breakReason,
          breakMinutes: payload.breakMinutes,
        }))
      }
    })

    socket.on('cookBreakFinished', (payload: any) => {
      if (payload?.userId === user?.id && (payload?.channel === 'DELIVERY') === isDeliveryCook) {
        setCookStatus(prev => ({ ...(prev || {}), onBreak: false, breakUntil: null }))
      }
    })

    socket.on('cookBreakReincorporated', (payload: any) => {
      if (payload?.userId === user?.id && (payload?.channel === 'DELIVERY') === isDeliveryCook) {
        setCookStatus(prev => ({ ...(prev || {}), onBreak: false, breakUntil: null }))
      }
    })

    // Cuando se abre o cierra la caja, recargar comandas para reiniciar contadores e historial a 0
    socket.on('cashStatusChanged', () => load(false))

    return () => { socket.disconnect() }
  }, [isDeliveryCook, isTicketForThisCook, user?.id, user?.name, user?.role])

  const consolidatedTickets = useMemo(() => {
    // Mantener cada ticket por su ID único para nunca borrar tickets previos del historial
    const map = new Map<string, KitchenTicketSummary>()
    const sorted = [...tickets].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    for (const t of sorted) {
      if (t?.id && !map.has(t.id)) {
        map.set(t.id, t)
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

  const availableCooks = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of consolidatedTickets) {
      const cook = t.assignedTo
      if (cook?.id && cook?.name && !map.has(cook.id)) {
        map.set(cook.id, cook.name)
      }
      for (const u of t.station?.users || []) {
        if (u.id && u.name && !map.has(u.id)) {
          map.set(u.id, u.name)
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [consolidatedTickets])

  const selectedCookName = useMemo(() => {
    if (cookFilter === 'ALL') return null
    return availableCooks.find(c => c.id === cookFilter)?.name || 'Cocinero'
  }, [cookFilter, availableCooks])

  const cookStats = useMemo(() => {
    const stats: Record<string, { active: number; history: number; total: number }> = {}
    for (const cook of availableCooks) {
      const cookTickets = consolidatedTickets.filter(t => (t.assignedToId || t.assignedTo?.id) === cook.id)
      const active = cookTickets.filter(t => ['NEW', 'PREPARING'].includes(t.status)).length
      const history = cookTickets.filter(t => ['SERVED', 'READY', 'CANCELLED'].includes(t.status)).length
      stats[cook.id] = { active, history, total: cookTickets.length }
    }
    return stats
  }, [availableCooks, consolidatedTickets])

  // Producción acumulada de platos por cocinero (exclusivo para Admin / Superadmin)
  const cookProduction = useMemo(() => {
    const result: Record<string, {
      id: string
      name: string
      totalItems: number
      completedItems: number
      activeItems: number
      products: { name: string; count: number; completed: number; active: number }[]
    }> = {}

    for (const cook of availableCooks) {
      result[cook.id] = {
        id: cook.id,
        name: cook.name,
        totalItems: 0,
        completedItems: 0,
        activeItems: 0,
        products: []
      }
    }

    const productMaps: Record<string, Map<string, { count: number; completed: number; active: number }>> = {}

    for (const t of consolidatedTickets) {
      const cookId = t.assignedToId || t.assignedTo?.id
      if (!cookId) continue

      if (!result[cookId]) {
        result[cookId] = {
          id: cookId,
          name: t.assignedTo?.name || 'Cocinero',
          totalItems: 0,
          completedItems: 0,
          activeItems: 0,
          products: []
        }
      }

      if (!productMaps[cookId]) {
        productMaps[cookId] = new Map()
      }

      const isCompleted = ['SERVED', 'READY'].includes(t.status)
      const isActive = ['NEW', 'PREPARING'].includes(t.status)

      for (const item of t.items || []) {
        const qty = Number(item.quantity || 1)
        const name = (item.nameSnapshot || 'Producto').trim()

        result[cookId].totalItems += qty
        if (isCompleted) result[cookId].completedItems += qty
        if (isActive) result[cookId].activeItems += qty

        const current = productMaps[cookId].get(name) || { count: 0, completed: 0, active: 0 }
        current.count += qty
        if (isCompleted) current.completed += qty
        if (isActive) current.active += qty
        productMaps[cookId].set(name, current)
      }
    }

    for (const [cId, pMap] of Object.entries(productMaps)) {
      if (result[cId]) {
        result[cId].products = Array.from(pMap.entries())
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.count - a.count)
      }
    }

    return result
  }, [availableCooks, consolidatedTickets])

  // Total global de producción de la cocina en el turno actual
  const globalKitchenProduction = useMemo(() => {
    const map = new Map<string, { count: number; completed: number; active: number }>()
    let totalItems = 0
    let completedItems = 0
    let activeItems = 0

    for (const t of consolidatedTickets) {
      const isCompleted = ['SERVED', 'READY'].includes(t.status)
      const isActive = ['NEW', 'PREPARING'].includes(t.status)

      for (const item of t.items || []) {
        const qty = Number(item.quantity || 1)
        const name = (item.nameSnapshot || 'Producto').trim()

        totalItems += qty
        if (isCompleted) completedItems += qty
        if (isActive) activeItems += qty

        const current = map.get(name) || { count: 0, completed: 0, active: 0 }
        current.count += qty
        if (isCompleted) current.completed += qty
        if (isActive) current.active += qty
        map.set(name, current)
      }
    }

    const products = Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)

    return { totalItems, completedItems, activeItems, products }
  }, [consolidatedTickets])

  // Generador de texto para compartir el reporte del turno por WhatsApp
  const generateReportText = () => {
    let text = `📊 *RESUMEN DE PRODUCCIÓN COCINA - THE VILLA DOG*\n`
    text += `📅 Turno Actual · ${new Date().toLocaleDateString('es-CO')}\n`
    text += `🍽️ *Total Platos Preparados:* ${globalKitchenProduction.totalItems} (${globalKitchenProduction.completedItems} despachados, ${globalKitchenProduction.activeItems} en curso)\n`
    text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`

    for (const cook of availableCooks) {
      const prod = cookProduction[cook.id]
      if (!prod || prod.totalItems === 0) continue
      text += `👨‍🍳 *${cook.name}* (${prod.totalItems} platos en total):\n`
      for (const p of prod.products) {
        text += `   • ${p.count}x ${p.name} ${p.completed > 0 ? `(${p.completed} desp.)` : ''}\n`
      }
      text += `\n`
    }

    if (globalKitchenProduction.products.length > 0) {
      text += `━━━━━━━━━━━━━━━━━━━━━━\n`
      text += `🏆 *RANKING PRODUCTOS DEL TURNO:*\n`
      globalKitchenProduction.products.slice(0, 7).forEach((p, idx) => {
        text += `${idx + 1}. ${p.name}: ${p.count} unidad(es)\n`
      })
    }

    return text
  }

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(generateReportText())
      setCopiedReport(true)
      alerts.toast('📋 Reporte de producción copiado al portapapeles listo para enviar por WhatsApp')
      setTimeout(() => setCopiedReport(false), 3000)
    } catch {
      alerts.error('No se pudo copiar el reporte')
    }
  }

  // Tickets filtrados por usuario/rol, estación y cocinero
  const scopedTickets = useMemo(() => {
    return consolidatedTickets.filter(t => {
      if (stationFilter !== 'ALL' && t.stationId !== stationFilter && t.station?.id !== stationFilter) return false
      // Si el usuario logueado es cocinero (KITCHEN), mostrar ÚNICAMENTE sus tickets asignados
      if (user?.role === 'KITCHEN') {
        const assignedId = t.assignedToId || t.assignedTo?.id
        if (assignedId) {
          return assignedId === user.id
        }
        const stationUsers = t.station?.users || []
        return stationUsers.some(u => u.id === user.id)
      }
      // Para admin/cajero: filtro opcional por cocinero
      if (cookFilter !== 'ALL') {
        const assignedId = t.assignedToId || t.assignedTo?.id
        if (assignedId !== cookFilter) return false
      }
      return true
    })
  }, [consolidatedTickets, stationFilter, cookFilter, user?.id, user?.role])

  // Contadores vivos precisos
  const countNew = useMemo(() => scopedTickets.filter(t => t.status === 'NEW').length, [scopedTickets])
  const countPreparing = useMemo(() => scopedTickets.filter(t => t.status === 'PREPARING').length, [scopedTickets])
  const countReady = useMemo(() => scopedTickets.filter(t => t.status === 'READY').length, [scopedTickets])
  const countCancelled = useMemo(() => scopedTickets.filter(t => t.status === 'CANCELLED').length, [scopedTickets])
  // En Cocina (Activos en preparación): los que requieren atención inmediata del cocinero
  const countAllActive = countNew + countPreparing + countCancelled
  const countHistory = useMemo(() => scopedTickets.filter(t => ['SERVED', 'CANCELLED', 'READY'].includes(t.status)).length, [scopedTickets])

  // Lista de tickets según la pestaña activa (orden FIFO para activos; más recientes primero en HISTORIAL)
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
    if (activeTab === 'HISTORY') {
      return list.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
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

  const delayedActiveCount = useMemo(() => {
    const now = Date.now()
    return scopedTickets.filter(ticket => {
      if (!['NEW', 'PREPARING'].includes(ticket.status)) return false
      const createdAt = new Date(ticket.order?.createdAt || ticket.createdAt || '').getTime()
      return Number.isFinite(createdAt) && now - createdAt >= 15 * 60 * 1000
    }).length
  }, [scopedTickets])

  return (
    <div className="space-y-3">
      {/* Encabezado operativo: deja claro que esta pantalla corresponde a las mesas del salón. */}
      <header className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/20">
            <ChefHat className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">Operación de salón</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> En vivo
              </span>
            </div>
            <h1 className="truncate text-xl font-black text-[var(--text-primary)] sm:text-2xl">Cocina de mesas</h1>
            <p className="truncate text-xs text-[var(--text-secondary)]">Comandas del salón ordenadas por llegada y estación.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-center sm:min-w-[88px]">
            <p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Activas</p>
            <p className="text-lg font-black leading-none text-[var(--text-primary)]">{countAllActive}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-center sm:min-w-[88px]">
            <p className="text-[9px] font-black uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">Listas</p>
            <p className="text-lg font-black leading-none text-emerald-700 dark:text-emerald-300">{countReady}</p>
          </div>
          <div className={cn(
            'rounded-xl border px-2.5 py-1.5 text-center sm:min-w-[88px]',
            delayedActiveCount > 0
              ? 'border-rose-500/30 bg-rose-500/10'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
          )}>
            <p className={cn('text-[9px] font-black uppercase tracking-wide', delayedActiveCount > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--text-muted)]')}>+15 min</p>
            <p className={cn('text-lg font-black leading-none', delayedActiveCount > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--text-primary)]')}>{delayedActiveCount}</p>
          </div>
        </div>
      </header>

      {/* Banner de Cocinero Individual */}
      {user?.role === 'KITCHEN' && (
        <div className="space-y-2">
          {cookStatus?.onBreak && breakRemaining ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-500/20 border-2 border-amber-500/50 text-amber-900 dark:text-amber-200 shadow-sm animate-pulse">
              <div className="flex items-center gap-2.5">
                <Coffee className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    🍽️ En tiempo de {cookStatus.breakReason || 'cena'} — {isDeliveryCook ? 'Pausa personal' : 'Estación en pausa'}
                  </p>
                  <p className="text-xs text-amber-900/90 dark:text-amber-200/90 font-medium">
                    {isDeliveryCook ? 'La tablet sigue activa y los pedidos pasan a tus compañeros disponibles.' : 'Mientras descansas no te entrarán nuevos pedidos; se reparten entre tus compañeros.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-amber-500 text-slate-950 px-3.5 py-1.5 rounded-xl font-black text-sm tracking-wider shadow-xs">
                <Clock className="h-4 w-4" />
                <span>Restan: {breakRemaining}</span>
              </div>
            </div>
          ) : cookStatus?.active === false ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-rose-500/15 border-2 border-rose-500/40 text-rose-900 dark:text-rose-200 shadow-sm">
              <div className="flex items-center gap-2.5">
                <PauseCircle className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <p className="text-sm font-black uppercase tracking-wider text-rose-700 dark:text-rose-300">
                     ⏸️ {isDeliveryCook ? 'Fuera del reparto' : 'Estación pausada / inactiva'}
                  </p>
                  <p className="text-xs text-rose-900/90 dark:text-rose-200/90 font-medium">
                     {isDeliveryCook ? 'No recibirás asignaciones; la tablet y tus compañeros continúan trabajando.' : 'El administrador te marcó como inactivo. No recibirás nuevos pedidos hasta que seas reactivado.'}
                  </p>
                </div>
              </div>
              <span className="text-xs font-black uppercase px-2.5 py-1 rounded-lg bg-rose-500 text-white shadow-xs">
                Pausado
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-blue-500/10 border border-blue-500/25 text-xs text-blue-700 dark:text-blue-300 shadow-xs">
              <span className="font-bold flex items-center gap-1.5">
                👨‍🍳 Pantalla personal de cocinero: <strong className="font-black text-sm">{user.name}</strong>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-black text-[10px]">
                  ● En servicio activo
                </span>
              </span>
              <span className="text-[11px] opacity-80">
                Mostrando únicamente tus comandas asignadas (división equitativa 50/50)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Barra de control superior con Filtros de Estado, Estación y Cocinero */}
      <div className="sticky top-2 z-20 space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/95 p-2.5 shadow-md backdrop-blur sm:p-3.5">
        {/* Fila 1: Pestañas de estado + Botón Actualizar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
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
              <span className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-bold ${activeTab === 'HISTORY' ? 'bg-white text-slate-900' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
                {countHistory}
              </span>
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedProductionCookId(cookFilter !== 'ALL' ? cookFilter : 'ALL')
                  setShowProductionModal(true)
                }}
                className="gap-1.5 font-black h-8 text-xs shrink-0 cursor-pointer bg-gradient-to-r from-amber-500/10 to-orange-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 shadow-xs"
                title="Ver desglose y conteo de productos preparados por cada cocinero hoy"
              >
                <BarChart3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="hidden sm:inline">📊 Platos del Día</span>
                <span className="sm:hidden">📊 Platos</span>
                <span className="rounded-full px-1.5 py-0.2 text-[10px] font-black bg-amber-500 text-slate-950">
                  {globalKitchenProduction.totalItems}
                </span>
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => load(true)} className="gap-1.5 font-bold h-8 text-xs shrink-0 cursor-pointer">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          </div>
        </div>

        {/* Fila 2: Filtros de Estación (si hay más de 1) */}
        {stations.length > 1 && (
          <div className="flex items-center gap-1 pt-2 border-t border-[var(--border-subtle)] overflow-x-auto pb-0.5 no-scrollbar">
            <span className="text-[11px] font-bold text-[var(--text-muted)] shrink-0 mr-1 flex items-center gap-1">
              Estación:
            </span>
            <Button
              size="sm"
              variant={stationFilter === 'ALL' ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg"
              onClick={() => handleStationFilter('ALL')}
            >
              Todas
            </Button>
            {stations.map(st => (
              <Button
                key={st.id}
                size="sm"
                variant={stationFilter === st.id ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg"
                onClick={() => handleStationFilter(st.id)}
              >
                {st.name}
              </Button>
            ))}
          </div>
        )}

        {/* Fila 3: Filtro de Cocineros e Historial individual (para Admin / Superadmin / Cajero) */}
        {['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user?.role || '') && availableCooks.length > 0 && (
          <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--border-subtle)] overflow-x-auto pb-0.5 no-scrollbar">
            <span className="text-[11px] font-bold text-[var(--text-muted)] shrink-0 mr-1 flex items-center gap-1">
              👨‍🍳 Cocinero:
            </span>
            <Button
              size="sm"
              variant={cookFilter === 'ALL' ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg"
              onClick={() => handleCookFilter('ALL')}
            >
              Todos ({consolidatedTickets.length})
            </Button>
            {availableCooks.map(cook => {
              const stats = cookStats[cook.id] || { active: 0, history: 0, total: 0 }
              const isSelected = cookFilter === cook.id
              return (
                <Button
                  key={cook.id}
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  className={`h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg gap-1.5 transition ${
                    isSelected
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs border-blue-600'
                      : 'text-[var(--text-secondary)] bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => handleCookFilter(cook.id)}
                >
                  <span>👨‍🍳 {cook.name}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                    isSelected ? 'bg-white text-blue-700' : 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                  }`}>
                    {activeTab === 'HISTORY'
                      ? `${stats.history} desp.`
                      : isAdmin && cookProduction[cook.id]?.totalItems > 0
                      ? `${cookProduction[cook.id].totalItems} platos`
                      : `${stats.history} hist. · ${stats.active} act.`}
                  </span>
                </Button>
              )
            })}
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg gap-1 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 cursor-pointer"
                onClick={() => {
                  setSelectedProductionCookId('ALL')
                  setShowProductionModal(true)
                }}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Ver Platos por Cocinero</span>
              </Button>
            )}
          </div>
        )}

        {(stationFilter !== 'ALL' || cookFilter !== 'ALL') && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="font-black uppercase tracking-wide text-[var(--text-muted)]">Filtro activo:</span>
              {stationFilter !== 'ALL' && (
                <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2 py-0.5 font-bold text-[var(--accent)]">
                  {stations.find(station => station.id === stationFilter)?.name || 'Estación'}
                </span>
              )}
              {cookFilter !== 'ALL' && selectedCookName && (
                <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 font-bold text-blue-700 dark:text-blue-300">
                  {selectedCookName}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3 w-3" /> Quitar filtros
            </button>
          </div>
        )}
      </div>

      {/* Banner de contexto cuando se filtra por un cocinero específico (Admin / Cajero) */}
      {['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user?.role || '') && cookFilter !== 'ALL' && selectedCookName && (
        <div className="flex flex-col gap-2 p-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-900 dark:text-blue-200 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <div>
                <p className="text-xs font-black">
                  Comandas de: <strong>{selectedCookName}</strong>
                </p>
                <p className="text-[11px] opacity-85">
                  {activeTab === 'HISTORY'
                    ? `Mostrando ${displayTickets.length} pedido(s) despachado(s) en su historial de este turno.`
                    : `Tiene ${countAllActive} comanda(s) activa(s) y ${countHistory} en su historial.`
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeTab !== 'HISTORY' && countHistory > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs font-bold bg-white dark:bg-slate-900 border-blue-400 text-blue-700 dark:text-blue-300 hover:bg-blue-50 cursor-pointer"
                  onClick={() => setActiveTab('HISTORY')}
                >
                  <History className="h-3 w-3 mr-1" /> Ver su Historial ({countHistory})
                </Button>
              )}
              {activeTab === 'HISTORY' && countAllActive > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs font-bold bg-white dark:bg-slate-900 border-blue-400 text-blue-700 dark:text-blue-300 hover:bg-blue-50 cursor-pointer"
                  onClick={() => setActiveTab('ALL_ACTIVE')}
                >
                  <Flame className="h-3 w-3 mr-1" /> Ver sus Activos ({countAllActive})
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-200/50 cursor-pointer"
                onClick={() => handleCookFilter('ALL')}
              >
                ✕ Ver todos
              </Button>
            </div>
          </div>

          {/* Desglose rápido de producción del cocinero seleccionado (solo Admin) */}
          {isAdmin && cookProduction[cookFilter] && cookProduction[cookFilter].totalItems > 0 && (
            <div className="w-full pt-2 border-t border-blue-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-extrabold text-blue-950 dark:text-blue-100 flex items-center gap-1">
                  🌭 Platos hoy:
                  <span className="px-1.5 py-0.2 rounded bg-blue-600 text-white font-black text-[11px]">
                    {cookProduction[cookFilter].totalItems}
                  </span>
                </span>
                {cookProduction[cookFilter].products.slice(0, 4).map(p => (
                  <span key={p.name} className="px-2 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 font-bold border border-blue-400/40 text-blue-900 dark:text-blue-200 text-[11px]">
                    {p.count}x {p.name}
                  </span>
                ))}
                {cookProduction[cookFilter].products.length > 4 && (
                  <span className="text-[11px] font-medium opacity-75">
                    +{cookProduction[cookFilter].products.length - 4} más
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] font-black text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 cursor-pointer ml-auto"
                onClick={() => {
                  setSelectedProductionCookId(cookFilter)
                  setShowProductionModal(true)
                }}
              >
                Ver desglose completo ➔
              </Button>
            </div>
          )}
        </div>
      )}

      {loading && tickets.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-8 text-center">Cargando pedidos de cocina...</p>
      ) : displayTickets.length === 0 ? (
        /* VISTA VACÍA */
        <div className="rounded-2xl border-2 border-dashed border-[var(--border-default)] p-8 sm:p-12 text-center bg-[var(--bg-panel)]">
          {activeTab === 'HISTORY' ? (
            <>
              <History className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-2 opacity-70" />
              <h3 className="text-lg font-black text-[var(--text-primary)]">
                {cookFilter !== 'ALL' && selectedCookName ? `Sin historial para ${selectedCookName}` : 'Sin pedidos despachados'}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-md mx-auto">
                {cookFilter !== 'ALL' && selectedCookName
                  ? `Este cocinero no tiene comandas despachadas en este turno aún.`
                  : 'Aún no hay pedidos marcados como despachados o cancelados en este turno.'}
              </p>
              {cookFilter !== 'ALL' && (
                <Button size="sm" variant="outline" className="mt-3 font-bold text-xs cursor-pointer" onClick={() => handleCookFilter('ALL')}>
                  Ver historial de todos los cocineros
                </Button>
              )}
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
              <h3 className="text-lg font-black text-[var(--text-primary)]">
                {cookFilter !== 'ALL' && selectedCookName ? `¡${selectedCookName} está al día!` : '¡Cocina al día!'}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-md mx-auto">
                {cookFilter !== 'ALL' && selectedCookName ? (
                  countHistory > 0 ? (
                    <span>
                      No tiene pedidos pendientes en esta sección. Tiene <strong>{countHistory} pedido(s) despachado(s)</strong> en su historial.
                    </span>
                  ) : (
                    <span>No tiene pedidos pendientes asignados en este momento.</span>
                  )
                ) : (
                  'No hay pedidos pendientes en esta sección.'
                )}
              </p>
              {cookFilter !== 'ALL' && countHistory > 0 && (
                <Button size="sm" variant="outline" className="mt-3 font-bold gap-1 text-xs cursor-pointer" onClick={() => setActiveTab('HISTORY')}>
                  <History className="h-3.5 w-3.5" /> Ver su Historial ({countHistory})
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        /* GRILLA DE TICKETS */
        <div className="grid items-start gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {displayTickets.map(ticket => {
            const hasActiveItems = ticket.items?.some(i => i.changeType !== 'REMOVED')
            const isEditedDelta = Boolean(ticket.isEdited)
            const isFullyCancelled = ticket.status === 'CANCELLED' || (!hasActiveItems && !isEditedDelta)
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
                          (() => {
                            const actionItems = (ticket.items || []).filter(i => i.changeType === 'ADDED' || i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && ((i.previousQty ?? i.quantity) !== i.quantity || i.notes !== i.previousNotes)))
                            const hasRemoved = actionItems.some(i => i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && (i.quantity < (i.previousQty ?? i.quantity))))
                            const hasAdded = actionItems.some(i => i.changeType === 'ADDED' || (i.changeType === 'MODIFIED' && (i.quantity > (i.previousQty ?? i.quantity))))
                            if (hasRemoved && !hasAdded) {
                              return (
                                <span className="rounded-full bg-rose-600 text-white px-2 py-0.5 text-[10px] font-black flex items-center gap-1 shadow-xs animate-pulse">
                                  <XCircle className="h-3 w-3" /> SE CANCELÓ / REDUJO
                                </span>
                              )
                            }
                            if (hasAdded && !hasRemoved) {
                              return (
                                <span className="rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-black flex items-center gap-1 shadow-xs animate-pulse">
                                  <Flame className="h-3 w-3" /> ¡SE AGREGÓ AL PEDIDO!
                                </span>
                              )
                            }
                            return (
                              <span className="rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black flex items-center gap-1 shadow-xs animate-pulse">
                                <AlertTriangle className="h-3 w-3" /> PEDIDO EDITADO
                              </span>
                            )
                          })()
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span>Mesera: <strong className="text-[var(--text-primary)]">{ticket.order?.waiter?.name || 'Sin asignar'}</strong></span>
                        {ticket.assignedTo?.name && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                            ticket.assignedTo.id === user?.id
                              ? 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300'
                              : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]'
                          }`}>
                            👨‍🍳 {ticket.assignedTo.name}{ticket.assignedTo.id === user?.id ? ' (Tú)' : ''}
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

                  {/* Las ediciones llegan como una comanda nueva con solo los cambios del pedido. */}
                  {(() => {
                    const isEditedTicket = ticket.isEdited || (ticket.items || []).some(i => i.changeType === 'ADDED' || i.changeType === 'REMOVED' || i.changeType === 'MODIFIED')
                    const actionItems = isEditedTicket
                      ? (ticket.items || []).filter(i => i.changeType === 'ADDED' || i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && ((i.previousQty ?? i.quantity) !== i.quantity || i.notes !== i.previousNotes)))
                      : []

                    if (isEditedTicket && !isFullyCancelled && activeTab !== 'HISTORY') {
                      const deltaItems = actionItems.length > 0 ? actionItems : (ticket.items || [])
                      const hasAdded = deltaItems.some(item => item.changeType === 'ADDED' || (item.changeType === 'MODIFIED' && item.quantity > (item.previousQty ?? 0)))
                      const hasReduced = deltaItems.some(item => item.changeType === 'REMOVED' || (item.changeType === 'MODIFIED' && item.previousQty !== null && item.previousQty !== undefined && item.quantity < item.previousQty))
                      const hasNoteChange = deltaItems.some(item => item.changeType === 'MODIFIED' && item.notes !== item.previousNotes)

                      return (
                        <div className="mt-2.5 space-y-2.5">
                          <div className={cn(
                            'flex items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 text-xs font-black uppercase tracking-wider',
                            hasAdded
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-200'
                              : hasReduced
                              ? 'border-rose-500/40 bg-rose-500/10 text-rose-950 dark:text-rose-200'
                              : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200',
                          )}>
                            <Flame className={cn('h-4 w-4', hasAdded ? 'text-emerald-600 dark:text-emerald-400' : hasReduced ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')} />
                            <span>PEDIDO EDITADO · SOLO CAMBIOS</span>
                          </div>

                          {hasAdded && <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Lo verde se agregó al pedido #{ticket.order?.orderNumber || ''}.</p>}
                          {hasReduced && <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-800 dark:text-rose-300">Lo rojo se retiró del pedido. No prepares esas unidades.</p>}
                          {hasNoteChange && <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">La indicación de preparación fue actualizada.</p>}

                          <div className="space-y-1.5">
                            {deltaItems.map((item: KitchenTicketItemSummary) => {
                              const previousQty = item.previousQty ?? 0
                              const quantityDiff = item.changeType === 'ADDED' || item.changeType === 'REMOVED'
                                ? item.quantity
                                : item.quantity - previousQty
                              const isRemoved = item.changeType === 'REMOVED' || quantityDiff < 0
                              const isAdded = !isRemoved && (item.changeType === 'ADDED' || quantityDiff > 0)
                              const noteChanged = item.changeType === 'MODIFIED' && item.notes !== item.previousNotes
                              const displayQuantity = item.changeType === 'MODIFIED' && quantityDiff !== 0 ? Math.abs(quantityDiff) : item.quantity
                              const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()
                              const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')

                              return (
                                <div key={item.id} className={cn('rounded-xl border p-2.5', isAdded ? 'border-emerald-500/50 bg-emerald-500/15' : isRemoved ? 'border-rose-500/50 bg-rose-500/10' : noteChanged ? 'border-amber-500/40 bg-amber-500/10' : 'border-transparent bg-[var(--bg-elevated)]')}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-base font-black leading-tight text-[var(--text-primary)]">{isAdded ? '+' : isRemoved ? '-' : ''}{displayQuantity}x {item.nameSnapshot}</span>
                                        {isAdded && <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black text-white">AGREGADO · ANTES {previousQty}</span>}
                                        {isRemoved && <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white">RETIRADO · ANTES {previousQty}</span>}
                                        {noteChanged && !isAdded && !isRemoved && <span className="rounded-md bg-amber-600 px-1.5 py-0.5 text-[9px] font-black text-white">NOTA ACTUALIZADA</span>}
                                      </div>
                                      {cleanNotes && <p className="mt-1 border-l-2 border-amber-500 bg-amber-500/10 py-0.5 pl-1.5 text-xs font-bold text-amber-700 dark:text-amber-300">👉 {cleanNotes}</p>}
                                    </div>
                                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black tracking-wider', isTakeaway ? 'bg-amber-500 text-slate-950' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300')}>{isTakeaway ? '🥡 LLEVAR' : '🍽️ MESA'}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    }

                    // En historial los tickets editados muestran solo su diferencia.
                    // Los tickets normales siguen mostrando el pedido completo.
                    const visibleItems = isEditedTicket
                      ? (actionItems.length > 0 ? actionItems : (ticket.items || []))
                      : (ticket.items || []).filter((i: KitchenTicketItemSummary) => i.changeType !== 'REMOVED')

                    return (
                      <div className="mt-2.5 space-y-1.5">
                        {activeTab === 'HISTORY' && isEditedTicket && (
                          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-800 dark:text-blue-300 text-xs font-black mb-2">
                            <span>📝 PEDIDO EDITADO · SOLO CAMBIOS</span>
                            <span className="text-[10px] font-extrabold bg-blue-500/15 px-2 py-0.5 rounded-full">Pedido #{ticket.order?.orderNumber || '—'}</span>
                          </div>
                        )}
                        {visibleItems.map((item: KitchenTicketItemSummary) => {
                          const isTakeaway = (item.notes || '').toLowerCase().includes('llevar')
                          const cleanNotes = (item.notes || '').replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()
                          const previousQty = item.previousQty ?? 0
                          const quantityDiff = item.changeType === 'ADDED' || item.changeType === 'REMOVED'
                            ? item.quantity
                            : item.quantity - previousQty
                          const isRemoved = item.changeType === 'REMOVED' || quantityDiff < 0
                          const isAdded = !isRemoved && (item.changeType === 'ADDED' || quantityDiff > 0)
                          const noteChanged = item.changeType === 'MODIFIED' && item.notes !== item.previousNotes
                          const displayQuantity = item.changeType === 'MODIFIED' && quantityDiff !== 0 ? Math.abs(quantityDiff) : item.quantity

                          return (
                            <div key={item.id} className={cn('rounded-xl p-2 text-xs border', isAdded ? 'border-emerald-500/40 bg-emerald-500/10' : isRemoved ? 'border-rose-500/40 bg-rose-500/10' : noteChanged ? 'border-amber-500/40 bg-amber-500/10' : 'border-transparent bg-[var(--bg-elevated)]')}>
                              <div className="flex items-start justify-between gap-1">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-black text-[var(--text-primary)] leading-tight">
                                      {isAdded ? '+' : isRemoved ? '-' : ''}{displayQuantity}x {item.nameSnapshot}
                                    </span>
                                    {isAdded && isEditedTicket && (
                                      <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                        AGREGADO · ANTES {previousQty}
                                      </span>
                                    )}
                                    {isRemoved && isEditedTicket && (
                                      <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                        RETIRADO · ANTES {previousQty}
                                      </span>
                                    )}
                                    {noteChanged && !isAdded && !isRemoved && (
                                      <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                        NOTA ACTUALIZADA
                                      </span>
                                    )}
                                  </div>
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
                  {(() => {
                    const isCancellationOnly = isFullyCancelled || (ticket.isEdited && (ticket.items || []).length > 0 && (ticket.items || []).every(i => i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && (i.quantity < (i.previousQty ?? i.quantity)))))
                    if (isCancellationOnly) {
                      return (
                        <Button
                          variant="outline"
                          onClick={() => setStatus(ticket, 'SERVED')}
                          className="w-full h-11 border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300 font-black text-xs gap-1.5 cursor-pointer rounded-xl shadow-xs"
                        >
                          <CheckCircle2 className="h-4 w-4" /> ✓ Entendido (Descartar aviso de cancelación)
                        </Button>
                      )
                    }

                    if (ticket.status === 'NEW') {
                      return (
                        <Button
                          size="sm"
                          onClick={() => setStatus(ticket, 'PREPARING')}
                          className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs gap-2 rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                          <Flame className="h-4 w-4" /> {ticket.isEdited ? '1. Empezar a Preparar lo Nuevo' : '1. Empezar a Preparar'}
                        </Button>
                      )
                    }

                    return null
                  })()}
                  {ticket.status === 'PREPARING' && !isFullyCancelled && !(ticket.isEdited && (ticket.items || []).length > 0 && (ticket.items || []).every(i => i.changeType === 'REMOVED' || (i.changeType === 'MODIFIED' && (i.quantity < (i.previousQty ?? i.quantity))))) ? (
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
                        <CheckCircle2 className="h-4 w-4" /> {ticket.isEdited ? '2. ¡Listo para Entrega! (Lo editado)' : '2. ¡Listo para Entrega!'}
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

      {/* Modal de Resumen de Producción y Platos por Cocinero (Exclusivo Admin / Superadmin) */}
      {isAdmin && (
        <Dialog open={showProductionModal} onOpenChange={setShowProductionModal}>
          <DialogContent className="max-w-3xl w-[95vw] max-h-[92vh] flex flex-col p-0 overflow-hidden bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl [&>button.absolute]:hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-panel)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 shrink-0">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-black text-[var(--text-primary)] flex items-center gap-2">
                    Resumen de Producción por Cocinero
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500 text-slate-950">
                      Turno Actual
                    </span>
                  </DialogTitle>
                  <p className="text-[11px] text-[var(--text-secondary)] font-medium">
                    Conteo exacto de platos y productos preparados por cada cocinero hoy.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-xs font-bold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                  onClick={handleCopyReport}
                  title="Copiar reporte en formato texto para enviar por WhatsApp"
                >
                  {copiedReport ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copiedReport ? '¡Copiado!' : 'Copiar WhatsApp'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setShowProductionModal(false)}
                  className="p-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* KPIs Rápidos del Turno */}
            <div className="grid grid-cols-3 gap-2 p-3 bg-[var(--bg-elevated)]/50 border-b border-[var(--border-subtle)] text-center text-xs">
              <div className="p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-xs">
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Total Platos Turno</p>
                <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">
                  {globalKitchenProduction.totalItems}
                </p>
              </div>
              <div className="p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-xs">
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Despachados / Listos</p>
                <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {globalKitchenProduction.completedItems}
                </p>
              </div>
              <div className="p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-xs">
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Cocineros Activos</p>
                <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-0.5">
                  {availableCooks.length}
                </p>
              </div>
            </div>

            {/* Pestañas de Cocineros / Consolidado */}
            <div className="flex items-center gap-1.5 p-2 border-b border-[var(--border-subtle)] overflow-x-auto no-scrollbar bg-[var(--bg-panel)]">
              <Button
                size="sm"
                variant={selectedProductionCookId === 'ALL' ? 'default' : 'ghost'}
                className={`h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg ${
                  selectedProductionCookId === 'ALL'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                    : 'text-[var(--text-secondary)]'
                }`}
                onClick={() => setSelectedProductionCookId('ALL')}
              >
                <span>👥 Todos los Cocineros</span>
              </Button>
              <Button
                size="sm"
                variant={selectedProductionCookId === 'GLOBAL' ? 'default' : 'ghost'}
                className={`h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg ${
                  selectedProductionCookId === 'GLOBAL'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                    : 'text-[var(--text-secondary)]'
                }`}
                onClick={() => setSelectedProductionCookId('GLOBAL')}
              >
                <span>🏆 Consolidado General Cocina</span>
              </Button>
              {availableCooks.map(cook => {
                const prod = cookProduction[cook.id]
                const count = prod?.totalItems || 0
                const isSel = selectedProductionCookId === cook.id
                return (
                  <Button
                    key={cook.id}
                    size="sm"
                    variant={isSel ? 'default' : 'outline'}
                    className={`h-7 px-2.5 text-xs font-bold shrink-0 rounded-lg gap-1.5 transition ${
                      isSel
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                        : 'text-[var(--text-secondary)] bg-[var(--bg-elevated)] border-[var(--border-subtle)]'
                    }`}
                    onClick={() => setSelectedProductionCookId(cook.id)}
                  >
                    <span>👨‍🍳 {cook.name}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                      isSel ? 'bg-white text-blue-700' : 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                    }`}>
                      {count}
                    </span>
                  </Button>
                )
              })}
            </div>

            {/* Contenido Desplazable con Tarjetas y Desglose */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* VISTA 1: Consolidado General de la Cocina */}
              {selectedProductionCookId === 'GLOBAL' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
                      🏆 Ranking de Platos Más Preparados en el Turno
                    </h3>
                    <span className="text-xs font-bold text-[var(--text-secondary)]">
                      {globalKitchenProduction.products.length} productos distintos
                    </span>
                  </div>

                  {globalKitchenProduction.products.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-elevated)] rounded-xl border border-dashed border-[var(--border-subtle)]">
                      No hay platos registrados en este turno aún.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {globalKitchenProduction.products.map((p, idx) => (
                        <div
                          key={p.name}
                          className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                              idx === 0 ? 'bg-amber-500 text-slate-950' : idx === 1 ? 'bg-slate-300 text-slate-900' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-[var(--bg-panel)] text-[var(--text-muted)]'
                            }`}>
                              #{idx + 1}
                            </span>
                            <span className="font-bold text-xs text-[var(--text-primary)] truncate">
                              {p.name}
                            </span>
                          </div>
                          <span className="font-black text-sm px-2.5 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0 ml-2">
                            {p.count}x
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* VISTA 2: Por Cocinero (Uno específico o Todos) */
                <div className="space-y-4">
                  {(selectedProductionCookId === 'ALL' ? availableCooks : availableCooks.filter(c => c.id === selectedProductionCookId)).map(cook => {
                    const prod = cookProduction[cook.id]
                    const total = prod?.totalItems || 0
                    const products = prod?.products || []

                    return (
                      <div
                        key={cook.id}
                        className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4 shadow-xs space-y-3"
                      >
                        {/* Cabecera del Cocinero */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-sm shrink-0">
                              👨‍🍳
                            </div>
                            <div>
                              <h4 className="text-sm font-black text-[var(--text-primary)]">
                                {cook.name}
                              </h4>
                              <p className="text-[11px] text-[var(--text-secondary)] font-medium">
                                {prod?.completedItems || 0} despachados · {prod?.activeItems || 0} en curso
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black px-3 py-1 rounded-xl bg-amber-500 text-slate-950 shadow-xs">
                              {total} platos preparados
                            </span>
                          </div>
                        </div>

                        {/* Desglose de Productos del Cocinero */}
                        {products.length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)] italic py-2">
                            Este cocinero no tiene platos registrados en el turno actual.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {products.map(p => (
                              <div
                                key={p.name}
                                className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-xs shadow-2xs hover:border-amber-500/50 transition-colors"
                              >
                                <span className="font-bold text-[var(--text-primary)] truncate mr-2">
                                  {p.name}
                                </span>
                                <span className="font-black text-xs px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20 shrink-0">
                                  {p.count}x
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-bold border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                onClick={handleCopyReport}
              >
                {copiedReport ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedReport ? '¡Reporte Copiado!' : 'Copiar Reporte para WhatsApp'}</span>
              </Button>

              <Button
                size="sm"
                variant="default"
                className="bg-[var(--text-primary)] text-white hover:opacity-90 text-xs font-bold px-4 cursor-pointer"
                onClick={() => setShowProductionModal(false)}
              >
                Cerrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { io } from '@/lib/socket'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAuth } from './useAuth'
import { Bike, Bell, CheckCircle2, XCircle, MessageCircle, UserPlus, UtensilsCrossed } from 'lucide-react'
import { getUsbDevice, printUsb, buildEscPosBuffer } from '@/lib/useUsbPrinter'
import { playUrgentBell } from '@/lib/sound'
import { cacheWhatsappMessage } from '@/lib/chatCache'
import type { DiningTableSummary, KitchenTicketSummary } from '@/lib/tableTypes'
import {
  isDiningKitchenTicketForUser,
  publishDiningKitchenDelays,
  toDiningKitchenDelay,
} from '@/lib/diningKitchenAlerts'
import { hasUserPermission } from '@/lib/permissions'
import { alerts } from '@/lib/alerts'
import { formatCurrency } from '@/lib/utils'

// Simple notification sound using Web Audio API
function playNotificationSound(type: 'message' | 'urgent' = 'message') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.onended = () => { void ctx.close().catch(() => {}) };
    osc.connect(gain)
    gain.connect(ctx.destination)
    
    if (type === 'urgent') {
      // Two-tone urgent alert
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
    } else {
      // Soft ding for messages
      osc.frequency.setValueAtTime(600, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    }
  } catch {
    // Audio context may fail in some browsers, ignore silently
  }
}

// Request browser notification permission on load
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

const activeNotifications = new Map<string, Notification>()

function closeBrowserNotification(tag: string) {
  const notification = activeNotifications.get(tag)
  if (!notification) return
  try { notification.close() } catch {}
  activeNotifications.delete(tag)
}

function showBrowserNotification(
  title: string,
  body: string,
  url?: string,
  options: { tag?: string; persistent?: boolean } = {},
) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const tag = options.tag || 'niche-wa-notif'
      closeBrowserNotification(tag)

      const notification = new Notification(title, {
        body,
        icon: '/favicon.png',
        requireInteraction: options.persistent === true,
        tag,
      })
      activeNotifications.set(tag, notification)
      notification.onclose = () => activeNotifications.delete(tag)

      notification.onclick = (e) => {
        e.preventDefault()
        window.focus()
        if (url) {
          window.location.href = url
        }
        try { notification.close() } catch {}
      }

      if (!options.persistent) {
        setTimeout(() => closeBrowserNotification(tag), 3000)
      }
    } catch {
      // Fallback: some browsers don't support Notification constructor
    }
  }
}

export function useNotifications() {
  const { user, isAuthenticated, refreshProfile } = useAuth()
  const permissionRequested = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !user) return

    // El portal del domiciliario mantiene su propia sincronización y no debe
    // recibir alertas globales de pedidos, chats, caja o impresión ajenos.
    if (user.role === 'DELIVERY_DRIVER') return

    // Request permission once
    if (!permissionRequested.current) {
      requestNotificationPermission()
      permissionRequested.current = true
    }

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user.id, userName: user.name, userRole: user.role },
      transports: ['websocket', 'polling'],
    })

    const isMuted = () => localStorage.getItem('the_villa_dog_mute_notifications') === 'true'

    // Alertas exclusivas de comandas de salón demoradas. Se conservan en el
    // shell global para que la mesera y el administrador las vean a tiempo.
    const tracksDiningDelays = user.role === 'WAITER' || user.role === 'KITCHEN' || ['ADMIN', 'SUPERADMIN'].includes(user.role || '')
    const trackedDiningTickets = new Map<string, KitchenTicketSummary>()
    const openDiningDelayToasts = new Set<string>()
    const notifiedDiningTickets = new Set<string>()

    const browserDelayTag = (ticketId: string) => `dining-kitchen-delay:${user.id}:${ticketId}`
    const toastDelayId = (ticketId: string) => `dining-kitchen-delay:${user.id}:${ticketId}`

    const clearDiningDelay = (ticketId: string) => {
      const toastId = toastDelayId(ticketId)
      if (openDiningDelayToasts.has(ticketId)) {
        toast.dismiss(toastId)
        openDiningDelayToasts.delete(ticketId)
      }
      closeBrowserNotification(browserDelayTag(ticketId))
      notifiedDiningTickets.delete(ticketId)
    }

    const evaluateDiningDelays = () => {
      if (!tracksDiningDelays) return
      const now = Date.now()
      const activeDelays = []

      for (const [ticketId, ticket] of trackedDiningTickets) {
        if (!isDiningKitchenTicketForUser(ticket, user)) {
          trackedDiningTickets.delete(ticketId)
          clearDiningDelay(ticketId)
          continue
        }

        const delay = toDiningKitchenDelay(ticket, now)
        if (!delay) continue
        activeDelays.push(delay)

        if (isMuted()) continue
        if (notifiedDiningTickets.has(ticketId)) continue
        notifiedDiningTickets.add(ticketId)
        const orderLabel = delay.orderNumber ? `#${delay.orderNumber}` : 'sin número'
        const title = user.role === 'WAITER'
          ? `🚨 ${delay.tableLabel} lleva 15 min en cocina`
          : `🚨 Comanda ${orderLabel} demorada`
        const description = user.role === 'WAITER'
          ? `El pedido ${orderLabel} sigue ${ticket.status === 'NEW' ? 'pendiente' : 'en preparación'} en ${delay.stationName}.`
          : `${delay.tableLabel} · ${delay.stationName} · sigue ${ticket.status === 'NEW' ? 'pendiente' : 'en preparación'}.`
        const targetUrl = user.role === 'WAITER' ? `/tables/${delay.tableId}` : '/kitchen'

        toast.error(title, {
          id: toastDelayId(ticketId),
          description,
          icon: <Bell className="h-5 w-5 animate-pulse text-rose-600" />,
          duration: Infinity,
          closeButton: true,
          action: {
            label: user.role === 'WAITER' ? 'Ver mesa' : 'Ver comanda',
            onClick: () => { window.location.href = targetUrl },
          },
        })
        openDiningDelayToasts.add(ticketId)
        if (localStorage.getItem('niche_mute_sounds') !== 'true') playUrgentBell()
        showBrowserNotification(title, description, targetUrl, {
          tag: browserDelayTag(ticketId),
          persistent: true,
        })
      }

      publishDiningKitchenDelays(activeDelays)
    }

    const trackDiningTicket = (ticket: KitchenTicketSummary) => {
      if (!tracksDiningDelays || !ticket?.id) return
      if (isDiningKitchenTicketForUser(ticket, user)) {
        trackedDiningTickets.set(ticket.id, ticket)
      } else {
        trackedDiningTickets.delete(ticket.id)
        clearDiningDelay(ticket.id)
      }
      evaluateDiningDelays()
    }

    const trackDiningTable = (table: DiningTableSummary) => {
      if (!tracksDiningDelays || !table?.orders) return
      for (const order of table.orders) {
        for (const ticket of order.kitchenTickets || []) trackDiningTicket(ticket)
      }
    }

    if (tracksDiningDelays) {
      const initialRequest = user.role === 'WAITER'
        ? api.get<DiningTableSummary[]>(`/tables?status=ALL&waiterId=${user.id}&currentShift=true&summary=true`)
        : api.get<KitchenTicketSummary[]>('/kitchen/tickets?currentShift=true')

      void initialRequest.then(result => {
        if (user.role === 'WAITER') {
          for (const table of result as DiningTableSummary[]) trackDiningTable(table)
        } else {
          for (const ticket of result as KitchenTicketSummary[]) trackDiningTicket(ticket)
        }
        evaluateDiningDelays()
      }).catch(() => {})
    }

    socket.on('diningKitchenTicketDelayed', trackDiningTicket)
    socket.on('kitchenTicketCreated', trackDiningTicket)
    socket.on('kitchenTicketUpdated', trackDiningTicket)
    socket.on('kitchenTicketEdited', trackDiningTicket)
    socket.on('tableUpdated', trackDiningTable)
    socket.on('tableClosed', trackDiningTable)
    // Este socket global ya está abierto para las notificaciones. Reutilizarlo
    // para el perfil evita una segunda conexión permanente por cada usuario.
    socket.on('usersChanged', refreshProfile)

    const diningDelayInterval = setInterval(evaluateDiningDelays, 5000)
    const handleMuteChanged = () => {
      if (!isMuted()) return
      for (const ticketId of openDiningDelayToasts) clearDiningDelay(ticketId)
    }
    window.addEventListener('the-villa-dog-mute-changed', handleMuteChanged)

    socket.on('newOrder', (order: { orderNumber?: number; customerName?: string; orderType?: string; tableId?: string; source?: string }) => {
      if (isMuted()) return
      // Cocineros, meseros y administradores NO deben recibir la alerta emergente de nuevos pedidos
      if (['KITCHEN', 'WAITER', 'ADMIN', 'SUPERADMIN'].includes(user.role || '')) return

      const isTableOrder = Boolean(order?.tableId || order?.orderType === 'LOCAL' || order?.orderType === 'DINE_IN' || order?.source === 'TABLE' || order?.source === 'OFFLINE_TABLE')

      // Los gestores de domicilios y despachadores NO deben recibir ninguna alerta de mesas ni de meseras
      if (['DELIVERY_MANAGER', 'DISPATCHER'].includes(user.role || '') && isTableOrder) return

      if (isTableOrder) {
        // Alerta exclusiva de salón para Administrador o Cajero
        toast.info(`Nuevo pedido en mesa`, {
          description: `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Mesa'}`,
          icon: <UtensilsCrossed className="h-4 w-4 text-[#F97316]" />,
          duration: 4000,
        })
        playNotificationSound('message')
        return
      }

      toast.success('Nuevo pedido domicilio', {
        description: `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`,
        icon: <Bike className="h-4 w-4 text-[#F97316]" />,
        duration: 6000,
      })
      playNotificationSound('urgent')
      showBrowserNotification('🛵 Nuevo Pedido Domicilio', `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`, '/dispatch')
    })

    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: any }) => {
      if (isMuted()) return
      // Cocineros y administradores NO reciben alertas de cambio de estado de pedidos ni domicilios
      if (['KITCHEN', 'ADMIN', 'SUPERADMIN'].includes(user.role || '')) return

      const isTableOrder = Boolean(data.order?.tableId || data.order?.orderType === 'LOCAL' || data.order?.orderType === 'DINE_IN' || data.order?.source === 'TABLE' || data.order?.source === 'OFFLINE_TABLE')

      // Los gestores de domicilios y despachadores NO reciben cambios de estado de mesas ni de salón
      if (['DELIVERY_MANAGER', 'DISPATCHER'].includes(user.role || '') && isTableOrder) return

      const labels: Record<string, string> = {
        READY: 'Listo para despacho',
        IN_ROUTE: 'En ruta',
        DELIVERED: 'Entregado',
        CANCELLED: 'Cancelado',
      }
      const label = labels[data.status]
      if (!label) return
      const isCancel = data.status === 'CANCELLED'
      const isDone = data.status === 'DELIVERED'
      const isReady = data.status === 'READY'
      
      if (isReady) {
        // ÚNICAMENTE el mesero (WAITER) que atiende la mesa recibe la orden de ir a recoger platos
        if (user.role !== 'WAITER') return
        const order = data.order
        const waiterId = order?.waiterId || order?.waiter?.id
        const isMyOrder = waiterId === user.id || (order?.waiter?.name && order?.waiter?.name === user.name)

        // Estricto: Solo al mesero asignado a la mesa
        if (!isMyOrder) return

        const tableLabel = order?.diningTable?.label || order?.customerName || 'Mesa'
        const orderNum = order?.orderNumber ? `#${order.orderNumber}` : ''
        toast.success(`🏃 ¡Ve a recoger el pedido! (${tableLabel})`, {
          description: `Tu pedido ${orderNum} de ${tableLabel} está listo en Cocina. Pasa a recogerlo para llevarlo a la mesa.`,
          icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
          duration: 5000,
        })
        playUrgentBell()
        return
      }

      // No saturar con cancelados o entregados de mesas a los perfiles de gestión
      if (isTableOrder) return

      // Para domicilios: solo notificar si es domicilio o recogida
      if (['ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER'].includes(user.role || '') && !data.order?.deliveryZone && data.order?.orderType !== 'DELIVERY' && data.order?.orderType !== 'PICKUP') return

      toast(isCancel ? 'Pedido cancelado' : label, {
        description: `Pedido #${data.order?.orderNumber ?? ''}`,
        icon: isCancel
          ? <XCircle className="h-4 w-4 text-[#EF4444]" />
          : isDone
            ? <CheckCircle2 className="h-4 w-4 text-[#F97316]" />
            : <Bell className="h-4 w-4 text-[#F59E0B]" />,
        duration: 4000,
      })
    })

    socket.on('kitchenTicketReady', (ticket: any) => {
      if (isMuted()) return
      // ÚNICAMENTE el mesero (WAITER) que atiende la mesa recibe el aviso de "Ve a recoger el pedido"
      if (user.role !== 'WAITER') return

      const tableLabel = ticket?.order?.diningTable?.label || ticket?.table?.label || ticket?.order?.customerName || 'Mesa'
      const stationName = ticket?.station?.name || 'Cocina'
      const orderNum = ticket?.order?.orderNumber ? `#${ticket.order.orderNumber}` : ''
      const waiterId = ticket?.order?.waiterId || ticket?.order?.waiter?.id
      const isMyOrder = waiterId === user.id || (ticket?.order?.waiter?.name && ticket?.order?.waiter?.name === user.name)

      // Estricto: Solo al mesero que tomó el pedido
      if (!isMyOrder) return

      toast.success(`🏃 ¡VE A RECOGER EL PEDIDO! (${tableLabel})`, {
        description: `El pedido ${orderNum} de ${tableLabel} ya está listo en ${stationName}. Pasa a la cocina a recogerlo para servirlo a la mesa.`,
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
        duration: 5000,
      })
      playUrgentBell()
      showBrowserNotification(
        `🏃 ¡Ve a recoger el pedido de ${tableLabel}!`,
        `${stationName} terminó ${orderNum}. Pasa a la cocina para llevarlo a la mesa.`,
        '/tables'
      )
    })

    socket.on('paymentSubmitted', (payload: any) => {
      if (isMuted()) return
      if (!['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user.role || '')) return
      // Excluir cobros de domicilios: su liquidación ocurre en Despachos/Domicilios, no en mesas
      if (payload?.source === 'DELIVERY_DRIVER' || payload?.order?.orderType === 'DELIVERY' || !payload?.table?.id) return

      const tableLabel = payload?.table?.label || payload?.table?.name || 'Mesa'
      const waiterName = payload?.waiterName || payload?.table?.openedBy?.name || ''
      const totalAmount = Number(payload?.amount ?? payload?.payment?.amount ?? payload?.table?.total ?? 0)
      const method = String(payload?.method || payload?.payment?.method || '').toUpperCase()

      let methodText = ''
      if (method === 'CASH') {
        methodText = '💵 Efectivo'
      } else if (method === 'MIXED') {
        const cash = Number(payload?.cashAmount ?? payload?.payment?.cashAmount ?? 0)
        const transf = Number(payload?.transferAmount ?? payload?.payment?.transferAmount ?? Math.max(0, totalAmount - cash))
        methodText = `🔀 Mixto (Efectivo: ${formatCurrency(cash)} · Transf: ${formatCurrency(transf)})`
      } else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) {
        methodText = `📲 Transferencia (${method === 'TRANSFER' ? 'Tr.' : method})`
      } else {
        methodText = method || 'Por validar'
      }

      const desc = `${tableLabel}${waiterName ? ` · ${waiterName}` : ''}: ${formatCurrency(totalAmount)} · ${methodText} - revisa caja`

      toast.warning('💰 Pago registrado por mesera', {
        description: desc,
        icon: <Bell className="h-4 w-4 text-[#F59E0B]" />,
        duration: 9000,
        action: {
          label: 'Validar en Caja',
          onClick: () => {
            window.location.href = '/payment-validation'
          },
        },
      })
      playNotificationSound('urgent')
      showBrowserNotification(
        `💰 Pago registrado: ${tableLabel}`,
        `${formatCurrency(totalAmount)} · ${methodText}`,
        '/payment-validation'
      )
    })

    socket.on('paymentRejected', (payload: any) => {
      // Alertas de rechazo de pago para meseros y cajeros (los administradores solo reciben los eventos solicitados)
      if (['ADMIN', 'SUPERADMIN'].includes(user.role || '')) return

      const tableLabel = payload?.table?.label || payload?.order?.diningTable?.label || payload?.order?.customerName || 'Mesa'
      const orderNum = payload?.order?.orderNumber || payload?.payment?.order?.orderNumber || payload?.table?.orders?.[0]?.orderNumber || '—'
      const reason = payload?.reason || payload?.rejectionReason || payload?.payment?.rejectionReason || 'Rechazado por caja'
      const waiterName = payload?.order?.waiter?.name || payload?.table?.openedBy?.name || ''
      const targetUrl = '/payment-validation'

      // 1. Campana sonora urgente (audible incluso con notificaciones desactivadas)
      playUrgentBell()

      // 2. Notificación del sistema en navegador / escritorio
      showBrowserNotification(
        `⚠️ Cobro Rechazado: ${tableLabel} (Pedido #${orderNum})`,
        `Motivo: "${reason}"${waiterName ? ` · Mesera: ${waiterName}` : ''}`,
        targetUrl,
        { persistent: true, tag: `rejected-payment-${payload?.payment?.id || orderNum}` }
      )

      // 3. Toast flotante persistente que no se quita solo (duration: Infinity)
      toast.error(`⚠️ Cobro Rechazado: ${tableLabel} (Pedido #${orderNum})`, {
        id: `reject-toast-${payload?.payment?.id || orderNum}`,
        description: `Motivo: "${reason}"${waiterName ? ` · Mesera: ${waiterName}` : ''}`,
        icon: <XCircle className="h-5 w-5 text-rose-500 animate-pulse shrink-0" />,
        duration: Infinity,
        closeButton: true,
        action: {
          label: 'Ver en Caja',
          onClick: () => {
            window.location.href = targetUrl
          },
        },
      })

      // 4. Modal emergente destacado con el motivo y acción directa
      alerts.rejectedPaymentAlert({
        title: `⚠️ Cobro Rechazado (${tableLabel})`,
        tableLabel,
        orderNumber: orderNum,
        reason,
        waiterName,
        onAction: () => {
          window.location.href = targetUrl
        },
      })
    })

    socket.on('cancellationRequested', (payload: any) => {
      // Exclusivo ÚNICAMENTE para Admin y SuperAdmin (ningún otro perfil debe recibir esta alerta)
      if (!['ADMIN', 'SUPERADMIN'].includes(user.role || '')) return

      const order = payload?.order || {}
      const orderNum = order.orderNumber || payload?.orderNumber || '—'
      const tableLabel = order.diningTable?.label || order.customerName || 'Mesa'
      const waiterName = order.waiter?.name || payload?.requestedBy?.name || 'Mesera'
      const reason = payload?.reason || order.cancellationReason || 'Cancelación solicitada por mesera'
      const targetUrl = '/payment-validation'

      // 1. Campana sonora urgente (audible incluso con notificaciones desactivadas)
      playUrgentBell()

      // 2. Notificación del sistema en navegador / escritorio
      showBrowserNotification(
        `⚠️ Cancelación solicitada: Pedido #${orderNum}`,
        `${tableLabel} · Mesera: ${waiterName}\nMotivo: "${reason}"`,
        targetUrl,
        { persistent: true, tag: `cancel-order-${order.id || orderNum}` }
      )

      // 3. Toast flotante persistente que no se quita solo (duration: Infinity)
      toast.error(`⚠️ Solicitud de cancelación: ${tableLabel} (Pedido #${orderNum})`, {
        id: `cancel-toast-${order.id || orderNum}`,
        description: `Mesera: ${waiterName} · Motivo: "${reason}"`,
        icon: <XCircle className="h-5 w-5 text-rose-500 animate-pulse shrink-0" />,
        duration: Infinity,
        closeButton: true,
        action: {
          label: 'Ir a Validar Pagos',
          onClick: () => {
            window.location.href = targetUrl
          },
        },
      })

      // 4. Modal emergente destacado con el motivo y acción directa
      alerts.rejectedPaymentAlert({
        title: `⚠️ Solicitud de Cancelación: Pedido #${orderNum}`,
        tableLabel,
        orderNumber: orderNum,
        reason,
        waiterName,
        onAction: () => {
          window.location.href = targetUrl
        },
      })
    })

    // Sistema global de seguimiento de descansos y cenas de cocineros
    const activeBreaks = new Map<string, { userName: string; breakUntil: number; breakMinutes: number; breakReason: string }>()
    const notifiedBreaks = new Set<string>()

    const triggerCookBreakAlert = (payload: { userId: string; userName: string; breakReason?: string; breakMinutes?: number }) => {
      const key = `${payload.userId}:${payload.breakMinutes || 15}`
      if (notifiedBreaks.has(key)) return
      notifiedBreaks.add(key)

      const isSoundMuted = isMuted() || localStorage.getItem('niche_mute_sounds') === 'true'
      if (!isSoundMuted) {
        playUrgentBell()
      }

      toast.warning(`⏰ ¡Tiempo de ${payload.breakReason || 'cena'} terminado!`, {
        description: `El cocinero "${payload.userName}" cumplió sus ${payload.breakMinutes || 15} minutos. Ya puedes llamarlo o reactivarlo en cocina.`,
        icon: <Bell className="h-5 w-5 text-orange-500 animate-bounce" />,
        duration: 15000,
        action: {
          label: 'Ver Cocina',
          onClick: () => { window.location.href = '/kitchen/stations' },
        },
      })

      showBrowserNotification(
        `⏰ ¡Tiempo de ${payload.breakReason || 'cena'} terminado!`,
        `El cocinero "${payload.userName}" finalizó sus ${payload.breakMinutes || 15} min de descanso.`,
        '/kitchen/stations'
      )
    }

    socket.on('cookBreakFinished', (payload: { userId: string; userName: string; finishedAt: number; breakReason?: string; breakMinutes?: number }) => {
      // Cocineros, meseros y gestoras de WhatsApp no gestionan las alertas de relevo de cocina
      if (['WAITER', 'KITCHEN', 'DELIVERY_MANAGER'].includes(user.role || '')) return
      activeBreaks.delete(payload.userId)
      triggerCookBreakAlert(payload)
    })

    socket.on('cookBreakStarted', (payload: { userId: string; userName: string; breakUntil: number; breakMinutes: number; breakReason: string }) => {
      if (['WAITER', 'KITCHEN', 'DELIVERY_MANAGER'].includes(user.role || '')) return
      if (payload.userId && payload.breakUntil) {
        activeBreaks.set(payload.userId, payload)
      }
    })

    socket.on('cookBreakReincorporated', (payload: { userId: string }) => {
      activeBreaks.delete(payload.userId)
    })

    // Alerta de fin de descanso de domiciliarios
    socket.on('driverBreakFinished', (payload: { driverId: string; driverName: string; finishedAt: number; breakReason?: string; breakMinutes?: number }) => {
      // Notificar a administradores, cajeros y gestores/despachadores de domicilios
      if (!['ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER'].includes(user.role || '')) return

      const isSoundMuted = isMuted() || localStorage.getItem('niche_mute_sounds') === 'true'
      if (!isSoundMuted) {
        playUrgentBell()
      }

      const driverName = payload?.driverName || 'El repartidor'
      const title = `⏰ ¡Fin de descanso: ${driverName}!`
      const desc = `${driverName} cumplió su tiempo de descanso y se reincorporó al final de la fila de turnos.`

      toast.warning(title, {
        description: desc,
        icon: <Bell className="h-5 w-5 text-amber-500 animate-bounce" />,
        duration: 12000,
        action: {
          label: 'Ver Despachos',
          onClick: () => { window.location.href = '/dispatch' },
        },
      })

      showBrowserNotification(
        title,
        desc,
        '/dispatch'
      )
    })

    socket.on('kitchenCookStatusChanged', (statuses: Record<string, any>) => {
      if (['WAITER', 'KITCHEN', 'DELIVERY_MANAGER'].includes(user.role || '')) return
      if (!statuses) return
      const now = Date.now()
      Object.entries(statuses).forEach(([uid, st]) => {
        if (st && st.onBreak && st.breakUntil && now < st.breakUntil) {
          activeBreaks.set(uid, {
            userName: st.userName || 'Cocinero',
            breakUntil: st.breakUntil,
            breakMinutes: st.breakMinutes || 15,
            breakReason: st.breakReason || 'Cena',
          })
        } else if (st && !st.onBreak) {
          activeBreaks.delete(uid)
        }
      })
    })

    // Sincronizar descansos activos al iniciar sesión o cargar la página
    if (user && !['WAITER', 'KITCHEN', 'DELIVERY_MANAGER'].includes(user.role || '')) {
      api.get<Record<string, any>>('/kitchen/cooks/status').then((res) => {
        const statuses = res.data || res
        if (!statuses || typeof statuses !== 'object') return
        const now = Date.now()
        Object.entries(statuses).forEach(([uid, st]: [string, any]) => {
          if (st && st.onBreak && st.breakUntil && now < st.breakUntil) {
            activeBreaks.set(uid, {
              userName: st.userName || 'Cocinero',
              breakUntil: st.breakUntil,
              breakMinutes: st.breakMinutes || 15,
              breakReason: st.breakReason || 'Cena',
            })
          }
        })
      }).catch(() => {})
    }

    const breakInterval = setInterval(() => {
      const now = Date.now()
      for (const [userId, brk] of activeBreaks.entries()) {
        if (brk && brk.breakUntil && now >= brk.breakUntil) {
          activeBreaks.delete(userId)
          triggerCookBreakAlert({
            userId,
            userName: brk.userName,
            breakReason: brk.breakReason,
            breakMinutes: brk.breakMinutes,
          })
        }
      }
    }, 1000)

    // WhatsApp: nuevo mensaje entrante
    socket.on('whatsappMessage', (payload: {
      id?: string
      waMessageId?: string
      sessionId?: string
      phone: string
      customerName: string
      direction: 'IN' | 'OUT'
      content: string
      messageType?: string
      status?: string
      createdAt?: string
      assignedToId?: string | null
      assignedTo?: { id: string; name: string } | null
    }) => {
      // Cocineros, meseros y gestores de domicilios/despachadores NO reciben alertas emergentes ni sonoras de mensajes de WhatsApp
      if (['KITCHEN', 'WAITER', 'DELIVERY_MANAGER', 'DISPATCHER'].includes(user.role || '')) return
      if (!hasUserPermission(user, 'whatsapp.view')) return

      // Mantiene la bandeja y los mensajes calientes incluso mientras el usuario
      // trabaja en otra pantalla. Al volver a WhatsApp aparecen de inmediato.
      cacheWhatsappMessage(payload)

      // Solo notificar mensajes entrantes (del cliente)
      if (payload.direction !== 'IN') return

      // Si el usuario silenció los mensajes emergentes, no mostrar popup ni sonido
      if (isMuted() || localStorage.getItem('niche_mute_wa_toasts') === 'true') return

      const msgPreview = payload.messageType === 'image' ? '📷 Foto'
        : payload.messageType === 'audio' ? '🎙️ Audio'
        : payload.messageType === 'document' ? '📄 Documento'
        : (payload.content || '').substring(0, 50)

      toast('💬 Nuevo mensaje de WhatsApp', {
        description: `${payload.customerName}: ${msgPreview}`,
        icon: <MessageCircle className="h-4 w-4 text-[#25D366]" />,
        duration: 4000,
      })
      
      const isSoundMuted = localStorage.getItem('niche_mute_sounds') === 'true'
      if (!isSoundMuted) {
        playNotificationSound('message')
      }
      
      showBrowserNotification(
        `💬 ${payload.customerName}`,
        msgPreview,
        '/chat'
      )
    })

    // WhatsApp: cliente solicita asesor (opción 4)
    socket.on('whatsappAgentRequest', (data: {
      phone: string
      customerName: string
      sessionId: string
    }) => {
      // Cocineros, meseros y gestores de domicilios NO gestionan solicitudes de asesor
      if (['KITCHEN', 'WAITER', 'DELIVERY_MANAGER', 'DISPATCHER'].includes(user.role || '')) return
      if (!hasUserPermission(user, 'whatsapp.view')) return

      toast.warning('🙋 Cliente solicita asesor', {
        description: `${data.customerName} (${data.phone}) necesita hablar con un asesor. ¡Reclama el chat!`,
        icon: <UserPlus className="h-4 w-4 text-[#F59E0B]" />,
        duration: 3500,
        action: {
          label: 'Ir al Chat',
          onClick: () => {
            window.location.href = '/chat'
          }
        }
      })
      playNotificationSound('urgent')
      showBrowserNotification(
        '🙋 ¡Cliente necesita asesor!',
        `${data.customerName} (${data.phone}) quiere hablar con un asesor`,
        '/chat'
      )
    })

    // Impresión automática WebUSB desde cualquier dispositivo
    socket.on('printJob', async (job: {
      target: 'caja' | 'cocina'
      text: string
      mode: 'browser' | 'network' | 'usb' | 'local_bridge'
      ip: string
      port: number
      paper: '58' | '80'
    }) => {
      // Solo imprimir de forma automática en computadores con rol de Cajero o Administrador
      if (!['CASHIER', 'ADMIN', 'SUPERADMIN'].includes(user.role || '')) return

      // Si el trabajo está configurado para WebUSB
      if (job.mode === 'usb') {
        const device = getUsbDevice(job.target)
        if (device) {
          try {
            const buffer = buildEscPosBuffer(job.text, job.paper)
            await printUsb(buffer, job.target)
            console.log(`[WebUSB Auto-Print] Impreso con éxito en target: ${job.target}`)
          } catch (err) {
            console.error('[WebUSB Auto-Print] Error:', err)
          }
        }
      }
    })

    // Refresco instantáneo forzado por el SuperAdmin: recarga la página del cliente automáticamente
    socket.on('forceRefresh', (payload: { triggeredBy?: string; triggeredByName?: string }) => {
      // El SuperAdmin que lo disparó no necesita recargar su propia página
      if (payload?.triggeredBy && payload.triggeredBy === user.id) return

      toast.info('Actualizando sistema...', {
        description: 'Se aplicará una actualización en unos segundos.',
        icon: <Bell className="h-4 w-4 text-[#F97316]" />,
        duration: 2500,
      })
      setTimeout(() => {
        window.location.reload()
      }, 2500)
    })

    return () => {
      clearInterval(breakInterval)
      clearInterval(diningDelayInterval)
      window.removeEventListener('the-villa-dog-mute-changed', handleMuteChanged)
      for (const ticketId of openDiningDelayToasts) clearDiningDelay(ticketId)
      publishDiningKitchenDelays([])
      socket.disconnect()
    }
  }, [isAuthenticated, refreshProfile, user])
}

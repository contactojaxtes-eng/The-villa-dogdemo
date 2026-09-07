import { useEffect, useRef } from 'react'
import { io } from '@/lib/socket'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAuth } from './useAuth'
import { Bike, Bell, CheckCircle2, XCircle, MessageCircle, UserPlus } from 'lucide-react'
import { getUsbDevice, printUsb, buildEscPosBuffer } from '@/lib/useUsbPrinter'
import { playUrgentBell } from '@/lib/sound'
import { cacheWhatsappMessage } from '@/lib/chatCache'

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

let activeNotification: Notification | null = null

function showBrowserNotification(title: string, body: string, url?: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (activeNotification) {
        try { activeNotification.close() } catch {}
      }

      const notification = new Notification(title, {
        body,
        icon: '/favicon.png',
        requireInteraction: false,
        tag: 'niche-wa-notif',
      })
      activeNotification = notification

      notification.onclick = (e) => {
        e.preventDefault()
        window.focus()
        if (url) {
          window.location.href = url
        }
        try { notification.close() } catch {}
      }

      setTimeout(() => {
        try {
          notification.close()
        } catch {}
      }, 3000)
    } catch {
      // Fallback: some browsers don't support Notification constructor
    }
  }
}

export function useNotifications() {
  const { user, isAuthenticated } = useAuth()
  const permissionRequested = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !user) return

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

    socket.on('newOrder', (order: { orderNumber?: number; customerName?: string }) => {
      if (isMuted()) return
      // Cocineros y meseros NO deben recibir la alerta con bicicleta de domicilios
      if (['KITCHEN', 'WAITER'].includes(user.role || '')) return

      toast.success('Nuevo pedido', {
        description: `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`,
        icon: <Bike className="h-4 w-4 text-[#F97316]" />,
        duration: 6000,
      })
      playNotificationSound('urgent')
      showBrowserNotification('🍔 Nuevo Pedido', `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`, '/orders')
    })

    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: any }) => {
      if (isMuted()) return
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

      // No saturar al admin con cancelados o entregados si no son domicilios
      if (['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user.role || '') && !data.order?.deliveryZone) return

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
      toast.warning('Pago pendiente por validar', {
        description: `${payload?.table?.label || 'Mesa'} - revisa caja`,
        icon: <Bell className="h-4 w-4 text-[#F59E0B]" />,
        duration: 6000,
      })
    })

    socket.on('paymentRejected', (payload: any) => {
      if (isMuted()) return
      toast.error('Pago rechazado', {
        description: payload?.reason || payload?.table?.label || 'Revisar mesa',
        icon: <XCircle className="h-4 w-4 text-[#EF4444]" />,
        duration: 6000,
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
      // Cocineros y meseros no gestionan las alertas de relevo de cocina
      if (['WAITER', 'KITCHEN'].includes(user.role || '')) return
      activeBreaks.delete(payload.userId)
      triggerCookBreakAlert(payload)
    })

    socket.on('cookBreakStarted', (payload: { userId: string; userName: string; breakUntil: number; breakMinutes: number; breakReason: string }) => {
      if (payload.userId && payload.breakUntil) {
        activeBreaks.set(payload.userId, payload)
      }
    })

    socket.on('cookBreakReincorporated', (payload: { userId: string }) => {
      activeBreaks.delete(payload.userId)
    })

    socket.on('kitchenCookStatusChanged', (statuses: Record<string, any>) => {
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
    if (user && !['WAITER', 'KITCHEN'].includes(user.role || '')) {
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
      socket.disconnect()
    }
  }, [isAuthenticated, user])
}

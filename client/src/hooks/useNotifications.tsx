import { useEffect, useRef } from 'react'
import { io } from '@/lib/socket'
import { toast } from 'sonner'
import { useAuth } from './useAuth'
import { Bike, Bell, CheckCircle2, XCircle, MessageCircle, UserPlus } from 'lucide-react'
import { getUsbDevice, printUsb, buildEscPosBuffer } from '@/lib/useUsbPrinter'

// Simple notification sound using Web Audio API
function playNotificationSound(type: 'message' | 'urgent' = 'message') {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.onended = () => { void ctx.close() };
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

    socket.on('newOrder', (order: { orderNumber?: number; customerName?: string }) => {
      toast.success('Nuevo pedido', {
        description: `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`,
        icon: <Bike className="h-4 w-4 text-[#F97316]" />,
        duration: 6000,
      })
      playNotificationSound('urgent')
      showBrowserNotification('🍔 Nuevo Pedido', `#${order?.orderNumber ?? '—'} · ${order?.customerName ?? 'Cliente'}`, '/orders')
    })

    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: { orderNumber?: number } }) => {
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
      toast(isCancel ? 'Pedido cancelado' : label, {
        description: `Pedido #${data.order?.orderNumber ?? ''}`,
        icon: isCancel
          ? <XCircle className="h-4 w-4 text-[#EF4444]" />
          : isDone
            ? <CheckCircle2 className="h-4 w-4 text-[#F97316]" />
            : <Bell className="h-4 w-4 text-[#F59E0B]" />,
        duration: 5000,
      })
    })

    socket.on('kitchenTicketReady', (ticket: any) => {
      toast.success('Pedido listo en cocina', {
        description: `${ticket?.order?.diningTable?.label || 'Mesa'} - ${ticket?.station?.name || 'Cocina'}`,
        icon: <CheckCircle2 className="h-4 w-4 text-[#10B981]" />,
        duration: 6000,
      })
      playNotificationSound('urgent')
      showBrowserNotification('Pedido listo en cocina', `${ticket?.order?.diningTable?.label || 'Mesa'} - ${ticket?.station?.name || 'Cocina'}`, '/tables')
    })

    socket.on('paymentSubmitted', (payload: any) => {
      if (!['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user.role || '')) return
      toast.warning('Pago pendiente por validar', {
        description: `${payload?.table?.label || 'Mesa'} - revisa caja`,
        icon: <Bell className="h-4 w-4 text-[#F59E0B]" />,
        duration: 6000,
      })
    })

    socket.on('paymentRejected', (payload: any) => {
      toast.error('Pago rechazado', {
        description: payload?.reason || payload?.table?.label || 'Revisar mesa',
        icon: <XCircle className="h-4 w-4 text-[#EF4444]" />,
        duration: 6000,
      })
    })

    // WhatsApp: nuevo mensaje entrante
    socket.on('whatsappMessage', (payload: {
      phone: string
      customerName: string
      direction: 'IN' | 'OUT'
      content: string
      messageType?: string
    }) => {
      // Solo notificar mensajes entrantes (del cliente)
      if (payload.direction !== 'IN') return

      // Si el usuario silenció los mensajes emergentes de WhatsApp, no mostrar popup ni sonido
      const isMuted = localStorage.getItem('niche_mute_wa_toasts') === 'true'
      if (isMuted) return

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

    return () => { socket.disconnect() }
  }, [isAuthenticated, user])
}

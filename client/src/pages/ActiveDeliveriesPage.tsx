import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { statusAccent, statusOrder } from '@/lib/brand'
import { formatCurrency, formatDate, getStatusColor, getStatusLabel, cleanNotes, groupOrderItems, formatThousandsInput, parseThousandsInput } from '@/lib/utils'
import { 
  Plus, 
  Search, 
  RefreshCw, 
  Clock, 
  User, 
  MapPin, 
  Phone, 
  MessageCircle, 
  Copy, 
  Eye, 
  CalendarDays, 
  Loader2, 
  Timer, 
  Bike, 
  Package, 
  Truck, 
  Headphones, 
  Radio, 
  Printer, 
  UtensilsCrossed,
  XCircle, 
  CheckCircle2, 
  DollarSign, 
  Edit,
  ClipboardList,
  Key,
  AlertTriangle
} from 'lucide-react'
import { type Socket } from 'socket.io-client'
import { io } from '@/lib/socket'
import { printComandaSmart, openCashDrawer } from '@/lib/printer'
import { alerts } from '@/lib/alerts'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface Order {
  id: string
  orderNumber: number
  customerName: string
  customerPhone: string
  customerAddress: string
  subtotal: number
  tax: number
  deliveryFee: number
  total: number
  status: string
  paymentMethod: string
  paymentStatus: string
  notes: string | null
  createdAt: string
  waiter: { id: string; name: string }
  assignee: { id: string; name: string } | null
  zone: { name: string; zoneGroup?: string } | null
  addressReference?: string | null
  items?: { quantity: number; menuItem: { name: string }; notes?: string | null; price?: number; unitPrice?: number }[]
  cancellationReason?: string | null
  cancelledAt?: string | null
  cancelledBy?: { id: string; name: string } | null
  cashRegister?: { name: string } | null
  orderType: string
  tableId?: string | null
  diningTable?: { id: string; label: string } | null
  source?: string | null
  deliveryDriverId?: string | null
  deliveryDriver?: { id: string; name: string; phone: string } | null
}

const IMPOCONSUMO_RATE = 0.08
const activeStatuses = ['PENDING', 'READY', 'IN_ROUTE']

const statusIcons: Record<string, any> = {
  PENDING: Clock,
  READY: Package,
  IN_ROUTE: Truck,
  DELIVERED: CheckCircle2,
  CANCELLED: XCircle,
}

const operatorColors = [
  '#F97316', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
]

function getOperatorColor(index: number): string {
  return operatorColors[index % operatorColors.length]
}

const estimatedDeliveryTimes: Record<string, string> = {
  PENDING: '15-20 min',
  PREPARING: '10-15 min',
  READY: '5-10 min',
  IN_ROUTE: '3-5 min',
}

function getElapsedTime(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
}

export default function ActiveDeliveriesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '')
  const [submittedSearch, setSubmittedSearch] = useState(() => searchParams.get('search') || '')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'IN_PREPARATION' | 'READY' | 'IN_ROUTE'>('ALL')
  const [, setTick] = useState(0)
  const [activeOperators, setActiveOperators] = useState<Record<string, { userId: string; userName: string }>>({})
  const [cancelDialog, setCancelDialog] = useState<{ id: string; orderNumber: number } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmStep, setCancelConfirmStep] = useState(false)
  const [collectDialog, setCollectDialog] = useState<any | null>(null)
  const [collectMethod, setCollectMethod] = useState<string>('CASH')
  const [collectReference, setCollectReference] = useState<string>('')
  const [collectCashAmount, setCollectCashAmount] = useState<string>('')
  const [collectTransferAmount, setCollectTransferAmount] = useState<string>('')
  const [courtesyItemIds, setCourtesyItemIds] = useState<string[]>([])
  const [isSubmittingPayment, setIsSubmittingPayment] = useState<boolean>(false)
  const [printInvoiceOnCollect, setPrintInvoiceOnCollect] = useState<boolean>(true)
  const [kickDrawerOnCollect, setKickDrawerOnCollect] = useState<boolean>(true)
  const [dispatchDialog, setDispatchDialog] = useState<{ order: any; shouldKick: boolean } | null>(null)
  const [drivers, setDrivers] = useState<any[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string>('')
  const [inlineDriverName, setInlineDriverName] = useState('')
  const [inlineDriverPhone, setInlineDriverPhone] = useState('')
  const [registeringDriverInline, setRegisteringDriverInline] = useState(false)
  const [dispatchError, setDispatchError] = useState('')
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [markingPickupReadyId, setMarkingPickupReadyId] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  const loadDrivers = useCallback(async () => {
    try {
      const data = await api.get<any[]>('/delivery-drivers?activeOnly=true')
      setDrivers(data)
    } catch (err) {
      console.error('Error al cargar repartidores:', err)
    }
  }, [])

  useEffect(() => {
    loadDrivers()
  }, [loadDrivers])

  useEffect(() => {
    if (collectDialog) {
      setCollectMethod(collectDialog.paymentMethod || 'CASH')
      setCollectReference('')
      setCourtesyItemIds([])
      const tot = collectDialog.total || 0
      const half = Math.round(tot / 2)
      setCollectCashAmount(String(half))
      setCollectTransferAmount(String(tot - half))
    }
  }, [collectDialog])

  const calculatedCollectTotal = useMemo(() => {
    if (!collectDialog) return 0
    if (collectMethod === 'CORTESIA' && courtesyItemIds.length === 0) return 0
    if (!collectDialog.items || collectDialog.items.length === 0) return collectDialog.total || 0

    let itemsSum = 0
    for (const item of collectDialog.items) {
      if (!courtesyItemIds.includes(item.id) && item.unitPrice !== 0) {
        itemsSum += (item.unitPrice || item.menuItem?.price || 0) * item.quantity
      }
    }
    return itemsSum + (collectDialog.deliveryFee || 0)
  }, [collectDialog, collectMethod, courtesyItemIds])

  const handleCollectPayment = async () => {
    if (!collectDialog) return
    setIsSubmittingPayment(true)
    try {
      const effectiveMethod = (collectMethod === 'CORTESIA' && courtesyItemIds.length > 0 && calculatedCollectTotal > 0)
        ? 'CASH'
        : collectMethod

      const updatedOrder = await api.put<any>(`/orders/${collectDialog.id}/payment`, {
        method: effectiveMethod,
        paymentStatus: 'CONFIRMED',
        reference: collectReference || null,
        courtesyItemIds: courtesyItemIds.length > 0 ? courtesyItemIds : undefined,
        cashAmount: effectiveMethod === 'MIXED' ? (parseFloat(collectCashAmount) || 0) : undefined,
        transferAmount: effectiveMethod === 'MIXED' ? (parseFloat(collectTransferAmount) || 0) : undefined,
      })
      const shouldKick = collectMethod === 'CASH'
      if (printInvoiceOnCollect) {
        await printComandaSmart(updatedOrder, 'caja', user?.role, false, shouldKick)
      } else if (shouldKick) {
        await openCashDrawer()
      }
      setCollectDialog(null)
      setCollectMethod('CASH')
      setCollectReference('')
      alerts.success('Cobro registrado', 'El pago ha sido registrado correctamente y la comanda ha sido cobrada y entregada.')
      loadOrders()
    } catch (err: any) {
      alerts.error('Error al cobrar', err.message || 'No se pudo registrar el pago')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  // Marcar pedido Pasar a Recoger como LISTO, imprimir factura de entrega y notificar por WhatsApp
  const handleMarkPickupReady = async (order: Order) => {
    if (markingPickupReadyId) return

    const confirm = await alerts.confirm(
      `¿Marcar Pedido #${order.orderNumber} como LISTO?`,
      `Al confirmar:\n1. El pedido pasará al estado LISTO para recoger.\n2. Se imprimirá la factura de entrega en caja.\n3. Se enviará automáticamente la notificación por WhatsApp al cliente.`,
      'Sí, Marcar Listo e Imprimir',
      'Cancelar'
    )
    if (!confirm) return

    setMarkingPickupReadyId(order.id)
    try {
      // 1. Actualizar estado a READY (el backend envía automáticamente el WhatsApp de pedido listo)
      const updatedOrder = await api.put<any>(`/orders/${order.id}/status`, { status: 'READY' })

      // 2. Imprimir factura en caja inmediatamente
      try {
        await printComandaSmart(updatedOrder || order, 'caja', user?.role, false, false)
      } catch (printErr) {
        console.error('Error al imprimir factura de pedido listo:', printErr)
      }

      alerts.success('Pedido Listo', `El pedido #${order.orderNumber} se marcó como LISTO, se envió la notificación a WhatsApp y se imprimió la factura.`)
      loadOrders()
    } catch (err: any) {
      console.error('Error al marcar pedido listo:', err)
      alerts.error('Error', err.message || 'No se pudo marcar el pedido como listo.')
    } finally {
      setMarkingPickupReadyId(null)
    }
  }

  const handleConfirmDispatch = async () => {
    if (!dispatchDialog) return
    setDispatchError('')
    let driverId = selectedDriverId

    try {
      if (registeringDriverInline) {
        if (!inlineDriverName.trim()) {
          setDispatchError('El nombre del nuevo repartidor es obligatorio')
          return
        }
        if (!inlineDriverPhone.trim()) {
          setDispatchError('El teléfono es obligatorio')
          return
        }
        const phoneClean = inlineDriverPhone.replace(/\D/g, '')
        if (phoneClean.length !== 10 || !phoneClean.startsWith('3')) {
          setDispatchError('El celular debe tener 10 dígitos y empezar con 3')
          return
        }

        const newDriver = await api.post<any>('/delivery-drivers', {
          name: inlineDriverName.trim(),
          phone: phoneClean,
        })
        driverId = newDriver.id
        loadDrivers()
      }

      if (!driverId) {
        setDispatchError('Debes seleccionar un repartidor o registrar uno nuevo')
        return
      }

      // Check workload limit
      const orderToUpdate = dispatchDialog.order
      const selectedDriverObj = drivers.find(d => d.id === driverId)
      if (selectedDriverObj && orderToUpdate.deliveryDriverId !== driverId && selectedDriverObj.activeDeliveries >= 5) {
        setDispatchError('Este repartidor ha alcanzado el límite máximo de 5 pedidos activos. Registra el cobro de alguno antes de asignarle más.')
        return
      }
      const isPending = orderToUpdate.status === 'PENDING'
      const nextStatus = isPending ? 'IN_ROUTE' : orderToUpdate.status

      const updatedOrder = await api.put<any>(`/orders/${orderToUpdate.id}/status`, {
        status: nextStatus,
        deliveryDriverId: driverId
      })

      if (isPending) {
        await printComandaSmart(updatedOrder, 'caja', user?.role, false, dispatchDialog.shouldKick)
      }

      setDispatchDialog(null)
      loadOrders()
      alerts.success('Pedido despachado', `Pedido #${orderToUpdate.orderNumber} asignado a repartidor correctamente.`)
    } catch (err: any) {
      setDispatchError(err.message || 'No se pudo despachar el pedido')
    }
  }

  const loadOrders = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    const params = new URLSearchParams()
    if (submittedSearch) params.set('search', submittedSearch)
    api.get<Order[]>(`/orders/active?${params.toString()}`)
      .then(data => {
        const deliveryOnly = (data || []).filter(o => !o.tableId && o.orderType !== 'LOCAL' && o.source !== 'TABLE' && o.source !== 'OFFLINE_TABLE')
        setOrders(deliveryOnly)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [submittedSearch])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name },
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('getActiveOperators')
    })

    socket.on('activeOperators', (ops: Record<string, { userId: string; userName: string }>) => {
      setActiveOperators(ops)
    })

    socket.on('orderClaimed', (data: { orderId: string; operatorId: string; operatorName: string }) => {
      setActiveOperators(prev => ({ ...prev, [data.orderId]: { userId: data.operatorId, userName: data.operatorName } }))
      setOrders(prev => prev.map(o => o.id === data.orderId ? {
        ...o,
        assignee: { id: data.operatorId, name: data.operatorName }
      } : o))
    })

    socket.on('orderReleased', (data: { orderId: string }) => {
      setActiveOperators(prev => {
        const next = { ...prev }
        delete next[data.orderId]
        return next
      })
      setOrders(prev => prev.map(o => o.id === data.orderId ? {
        ...o,
        assignee: null
      } : o))
    })

    socket.on('newOrder', () => { 
      loadOrders(true)
      loadDrivers()
    })
    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: any }) => {
      if (data && data.orderId) {
        if (data.order?.tableId || data.order?.orderType === 'LOCAL' || data.order?.source === 'TABLE' || data.order?.source === 'OFFLINE_TABLE') {
          setOrders(prev => prev.filter(o => o.id !== data.orderId))
        } else {
          setOrders(prev => prev.map(o => o.id === data.orderId ? {
            ...o,
            status: data.status,
            ...(data.order || {}),
          } : o))
        }

        setDetailOrder(prev => (prev && prev.id === data.orderId) ? { ...prev, status: data.status, ...(data.order || {}) } : prev)

        setCancelDialog(prev => {
          if (prev && prev.id === data.orderId && data.status === 'CANCELLED') {
            alerts.info('Pedido Cancelado', `El pedido #${data.order?.orderNumber || ''} ya fue cancelado por otro usuario.`)
            setCancelReason('')
            setCancelConfirmStep(false)
            return null
          }
          return prev
        })
      }
      loadOrders(true)
      loadDrivers()
    })

    socket.on('orderUpdated', (updatedOrder: any) => {
      if (updatedOrder && updatedOrder.id) {
        if (updatedOrder.tableId || updatedOrder.orderType === 'LOCAL' || updatedOrder.source === 'TABLE' || updatedOrder.source === 'OFFLINE_TABLE') {
          setOrders(prev => prev.filter(o => o.id !== updatedOrder.id))
        } else {
          setOrders(prev => prev.map(o => o.id === updatedOrder.id ? { ...o, ...updatedOrder } : o))
        }
        setDetailOrder(prev => (prev && prev.id === updatedOrder.id) ? { ...prev, ...updatedOrder } : prev)
      }
      loadOrders(true)
      loadDrivers()
    })

    socket.on('paymentUpdated', () => {
      loadOrders(true)
      loadDrivers()
    })

    socket.on('driversChanged', () => {
      loadDrivers()
    })

    return () => { socket.disconnect() }
  }, [user, loadOrders, loadDrivers])

  useEffect(() => {
    const params = new URLSearchParams()
    if (submittedSearch) params.set('search', submittedSearch)
    setSearchParams(params, { replace: true })
    loadOrders()
  }, [loadOrders, setSearchParams, submittedSearch])

  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const handleSearch = () => {
    setSubmittedSearch(searchQuery.trim())
  }

  const updateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id)
    try {
      await api.put(`/orders/${id}/status`, { status: newStatus })
      alerts.success('Estado actualizado', 'La comanda ha cambiado de estado.')
      loadOrders()
    } catch (err: any) {
      alerts.error('Error al actualizar estado', err.message || 'No se pudo cambiar el estado de la comanda.')
    } finally {
      setUpdatingId(null)
    }
  }

  const claimOrder = async (orderId: string) => {
    if (!user) return
    socketRef.current?.emit('claimOrder', { orderId, userId: user.id, userName: user.name })
    try {
      await api.put(`/orders/${orderId}/assign`, { operatorId: user.id, operatorName: user.name })
    } catch { /* socket handles UI */ }
  }

  const releaseOrder = async (orderId: string) => {
    if (!user) return
    socketRef.current?.emit('releaseOrder', { orderId, userId: user.id })
    try {
      await api.put(`/orders/${orderId}/assign`, { operatorId: null, operatorName: null })
    } catch { /* ignore */ }
  }

  const cancelOrder = async () => {
    if (!cancelDialog) return
    if (!cancelConfirmStep) {
      if (cancelReason.trim().length < 3) {
        alerts.error('Motivo requerido', 'Escribe el motivo de cancelación (mínimo 3 caracteres).')
        return
      }
      setCancelConfirmStep(true)
      return
    }
    setUpdatingId(cancelDialog.id)
    try {
      await api.put(`/orders/${cancelDialog.id}/cancel`, { reason: cancelReason || 'Cancelado' })
      alerts.success('Pedido Cancelado', 'El pedido ha sido cancelado y los ingredientes han sido devueltos al inventario.')
      setCancelDialog(null)
      setCancelReason('')
      setCancelConfirmStep(false)
      loadOrders()
    } catch (err: any) {
      alerts.error('Error al cancelar', err.message || 'No se pudo cancelar el pedido.')
    } finally {
      setUpdatingId(null)
    }
  }

  const nextStatus: Record<string, string> = {
    PENDING: 'READY',
    READY: 'IN_ROUTE',
    IN_ROUTE: 'DELIVERED',
  }
  const nextLabel: Record<string, string> = {
    PENDING: 'Listo',
    READY: 'En Ruta',
    IN_ROUTE: 'Entregado',
  }

  const buildWhatsAppMessage = (order: Order) => {
    const message = `Hola ${order.customerName}! Tu pedido #${order.orderNumber} en The Villa Dog esta confirmado\n\n` +
      `Valor del pedido: ${formatCurrency(order.subtotal)}\n` +
      (order.deliveryFee > 0 ? `Domicilio: ${formatCurrency(order.deliveryFee)}\n` : '') +
      `Total a pagar: ${formatCurrency(order.total)}`
    return encodeURIComponent(message)
  }

  const summary = useMemo(() => {
    const total = orders.reduce((sum, order) => sum + order.total, 0)
    return {
      total,
      active: orders.filter(order => activeStatuses.includes(order.status)).length,
      delivered: orders.filter(order => order.status === 'DELIVERED').length,
      transfer: orders.filter(order => order.paymentMethod === 'TRANSFER').length,
    }
  }, [orders])

  const statusCounts = useMemo(() => {
    return statusOrder.reduce<Record<string, number>>((acc, status) => {
      acc[status] = orders.filter(order => order.status === status).length
      return acc
    }, {})
  }, [orders])

  const uniqueOperators = useMemo(() => {
    const ops = new Map<string, { userId: string; userName: string }>()
    for (const op of Object.values(activeOperators)) {
      ops.set(op.userId, op)
    }
    return Array.from(ops.values())
  }, [activeOperators])

  const today = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  })();

  if (loading && orders.length === 0) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando pedidos en tiempo real...</p>
    </div>
  )

  return (
    <motion.div className="space-y-4" initial="hidden" animate="visible" variants={stagger}>
      {/* ── Compact Header ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-3" variants={fadeUp}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg shadow-[var(--accent)]/10"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
            <Bike className="h-5 w-5 text-[var(--accent-fg)]" />
          </div>
          <div>
            <h2 className="antifont text-2xl md:text-3xl tracking-wider text-[var(--text-primary)] leading-none uppercase">Despachos Activos</h2>
            <p className="text-xs text-[var(--text-secondary)]">{orders.length} pedidos en curso</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-3 mr-3">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[var(--text-muted)]">Pendientes:</span>
              <span className="text-amber-500">{summary.active}</span>
            </div>
            {user?.role !== 'DELIVERY_MANAGER' && (
              <>
                <div className="h-4 w-px bg-[var(--border-subtle)]" />
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <DollarSign className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-blue-500">{formatCurrency(summary.total)}</span>
                </div>
              </>
            )}
          </div>
          {(user?.role === 'CASHIER' || user?.role === 'ADMIN' || user?.role === 'SUPERADMIN') && (
            <Button size="sm" onClick={async () => { const res = await openCashDrawer(); if (res.ok) alerts.success('Cajón Abierto', 'Señal enviada.'); else alerts.error('Error', res.error || 'No se pudo abrir.'); }}
              className="bg-zinc-800 text-white font-bold hover:bg-zinc-700 rounded-xl h-9 px-3 gap-1.5 border border-zinc-700 cursor-pointer text-xs">
              <Key className="h-3.5 w-3.5 text-amber-400" /> Cajón
            </Button>
          )}
          <Link to="/orders/new">
            <Button size="sm" className="bg-[var(--accent)] text-[var(--accent-fg)] font-bold hover:bg-[var(--accent-hover)] rounded-xl h-9 px-3 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Nuevo
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={() => { setSearchQuery(''); setSubmittedSearch(''); }}
            className="rounded-xl h-9 px-2 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </motion.div>

      {/* ── Compact Search & Status Filter Tabs ── */}
      <motion.div variants={fadeUp} className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input placeholder="Buscar cliente, teléfono..." className="pl-9 h-9 bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs rounded-xl"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'Todos', count: orders.length },
            { id: 'PENDING', label: 'Pendientes', count: orders.filter(o => o.status === 'RECEIVED' || o.status === 'PENDING').length },
            { id: 'IN_PREPARATION', label: 'En Cocina', count: orders.filter(o => o.status === 'IN_PREPARATION').length },
            { id: 'READY', label: 'Listos', count: orders.filter(o => o.status === 'READY').length },
            { id: 'IN_ROUTE', label: 'En Ruta', count: orders.filter(o => o.status === 'IN_ROUTE').length },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer select-none ${
                statusFilter === tab.id
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] shadow-sm'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                statusFilter === tab.id ? 'bg-black/20 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── Compact Table ── */}
      <motion.div variants={fadeUp}>
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl overflow-hidden">
          {orders.length === 0 ? (
            <CardContent className="py-12 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="text-[var(--text-primary)] font-bold text-sm">¡Todo al día!</p>
              <p className="text-xs text-[var(--text-secondary)]">No hay pedidos activos en este momento.</p>
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">#</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Estado</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Cliente</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Dirección</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Repartidor</th>
                    <th className="text-right px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Total</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Tiempo</th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Pago</th>
                    <th className="text-center px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {orders
                      .filter(o => {
                        if (statusFilter === 'PENDING') return o.status === 'RECEIVED' || o.status === 'PENDING'
                        if (statusFilter === 'IN_PREPARATION') return o.status === 'IN_PREPARATION'
                        if (statusFilter === 'READY') return o.status === 'READY'
                        if (statusFilter === 'IN_ROUTE') return o.status === 'IN_ROUTE'
                        return true
                      })
                      .map((order) => {
                      const phoneDigits = order.customerPhone.replace(/\D/g, '')
                      const whatsappMsg = buildWhatsAppMessage(order)
                      const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
                      const elapsed = getElapsedTime(order.createdAt)
                      const isUrgent = (Date.now() - new Date(order.createdAt).getTime()) > 45 * 60000
                      return (
                        <motion.tr key={order.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-hover)] transition-colors">
                          <td className="px-3 py-2.5">
                            <button onClick={() => setDetailOrder(order)} className="font-black text-[var(--accent)] hover:underline text-sm cursor-pointer bg-transparent border-0">#{order.orderNumber}</button>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                              style={{ color: getStatusColor(order.status), backgroundColor: `${getStatusColor(order.status)}15`, border: `1px solid ${getStatusColor(order.status)}25` }}>
                              {getStatusLabel(order.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-[var(--text-primary)] text-xs truncate max-w-[140px]">{order.customerName}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{order.customerPhone}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[160px]" title={order.zone?.name || order.customerAddress}>{order.zone ? order.zone.name : order.customerAddress}</div>
                            {order.zone && order.customerAddress && <span className="text-[9px] text-[var(--text-muted)] font-semibold truncate max-w-[160px] block" title={order.customerAddress}>{order.customerAddress}</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {order.orderType === 'PICKUP' || order.orderType === 'LOCAL' ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold text-blue-600 bg-blue-500/10 border-blue-500/30">
                                  {order.orderType === 'PICKUP' ? 'Pasar a Recoger' : 'Mostrador'}
                                </span>
                                {order.orderType === 'PICKUP' && order.status !== 'READY' && order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleMarkPickupReady(order)}
                                    disabled={markingPickupReadyId === order.id}
                                    className="h-6 px-2 text-[10px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg gap-1 border-0 cursor-pointer shadow-sm animate-pulse"
                                    title="Marcar pedido listo, imprimir factura y notificar por WhatsApp al cliente"
                                  >
                                    {markingPickupReadyId === order.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-3 w-3" />
                                    )}
                                    <span>Listo</span>
                                  </Button>
                                )}
                              </div>
                            ) : ['DELIVERED', 'CANCELLED'].includes(order.status) ? (
                              <span
                                className="text-[10px] font-bold px-2 py-0.5 rounded-lg border text-emerald-600 bg-emerald-500/10 border-emerald-500/30 cursor-default inline-flex items-center gap-1 opacity-85"
                                title="Pedido finalizado"
                              >
                                <Bike className="h-3 w-3" />
                                <span>{order.deliveryDriver ? order.deliveryDriver.name : 'Sin Repartidor'}</span>
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedDriverId(order.deliveryDriverId || '')
                                  setRegisteringDriverInline(false)
                                  setInlineDriverName('')
                                  setInlineDriverPhone('')
                                  setDispatchError('')
                                  setDispatchDialog({ order, shouldKick: false })
                                }}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-colors cursor-pointer inline-flex items-center gap-1 ${
                                  order.deliveryDriver
                                    ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
                                    : 'text-amber-600 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20'
                                }`}
                                title={order.deliveryDriver ? 'Hacer clic para cambiar repartidor' : 'Hacer clic para asignar repartidor'}
                              >
                                <Bike className="h-3 w-3" />
                                <span>{order.deliveryDriver ? order.deliveryDriver.name : '⚠ Asignar'}</span>
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="font-black text-sm text-[var(--text-primary)]">{formatCurrency(order.total)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-[11px] font-bold ${isUrgent ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                              {isUrgent && '🔥 '}{elapsed}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${order.paymentStatus === 'CONFIRMED' ? 'text-emerald-600 bg-emerald-500/10' : 'text-amber-600 bg-amber-500/10'}`}>
                              {order.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              {order.paymentStatus !== 'CONFIRMED' && order.status !== 'CANCELLED' && ['SUPERADMIN', 'ADMIN', 'CASHIER'].includes(user?.role || '') && (
                                <Button size="sm" className="h-7 px-2 text-[10px] font-extrabold bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-lg gap-1 border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  onClick={() => setCollectDialog(order)}
                                  disabled={order.orderType !== 'PICKUP' && order.orderType !== 'LOCAL' && !order.deliveryDriverId}
                                  title={order.orderType !== 'PICKUP' && order.orderType !== 'LOCAL' && !order.deliveryDriverId ? 'Debe asignar un domiciliario primero' : 'Cobrar pedido'}
                                >
                                  <DollarSign className="h-3 w-3" /> Cobrar
                                </Button>
                              )}
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                title="Imprimir Factura Domicilio"
                                className="h-7 w-7 p-0 rounded-lg text-blue-500 hover:bg-blue-500/10 cursor-pointer"
                                onClick={() => {
                                  const orderWithDriver = {
                                    ...order,
                                    deliveryDriver: order.deliveryDriver || (order.deliveryDriverId ? drivers.find(d => d.id === order.deliveryDriverId) : undefined)
                                  };
                                  printComandaSmart(orderWithDriver, 'caja', user?.role, false, false);
                                }}
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                               {order.status !== 'CANCELLED' && order.status !== 'DELIVERED' && (
                                 <Button 
                                   size="sm" 
                                   variant="ghost" 
                                   title="Editar Pedido"
                                   className="h-7 w-7 p-0 rounded-lg text-amber-500 hover:bg-amber-500/10 cursor-pointer"
                                   onClick={() => navigate(`/orders/new?edit=${order.id}`)}
                                 >
                                   <Edit className="h-3.5 w-3.5" />
                                 </Button>
                               )}
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                                onClick={() => setDetailOrder(order)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {activeStatuses.includes(order.status) && ['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER'].includes(user?.role || '') && (
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg text-red-400 hover:bg-red-500/10 cursor-pointer" title="Cancelar Pedido"
                                  onClick={() => { setCancelDialog({ id: order.id, orderNumber: order.orderNumber }); setCancelConfirmStep(false); setCancelReason('') }}>
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {/* ── Cancel Dialog ── */}
      <Dialog open={!!cancelDialog} onOpenChange={() => { setCancelDialog(null); setCancelReason(''); setCancelConfirmStep(false) }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-md">
          <DialogHeader><DialogTitle className="text-lg font-black text-[var(--text-primary)]">Cancelar Pedido #{cancelDialog?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!cancelConfirmStep ? (
              <div className="space-y-3">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">Motivo de cancelación *</Label>
                <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Escribe el motivo..." className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs min-h-[80px]" />
                <Button className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl cursor-pointer" onClick={cancelOrder}>Continuar</Button>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
                <p className="text-sm font-bold text-[var(--text-primary)]">¿Estás seguro?</p>
                <p className="text-xs text-[var(--text-secondary)]">Motivo: &quot;{cancelReason}&quot;</p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-10 rounded-xl cursor-pointer" onClick={() => setCancelConfirmStep(false)}>Volver</Button>
                  <Button className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold cursor-pointer" onClick={cancelOrder} disabled={!!updatingId}>
                    {updatingId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Collect Payment Dialog ── */}
      <Dialog open={!!collectDialog} onOpenChange={() => setCollectDialog(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-md">
          <DialogHeader><DialogTitle className="text-lg font-black text-[var(--text-primary)]">Cobrar Pedido #{collectDialog?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase">Total a cobrar</span>
              <span className="text-xl font-black text-[var(--accent)]">
                {calculatedCollectTotal === 0 ? '$ 0 (Cortesía Exonerado)' : formatCurrency(calculatedCollectTotal)}
              </span>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">Método de pago</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { val: 'CASH', label: '💵 Efectivo' },
                  { val: 'TRANSFER', label: '📱 Transferencia' },
                  { val: 'MIXED', label: '🔀 Pago Mixto' },
                  { val: 'CREDIT', label: '💳 Crédito (Fiado)' },
                  { val: 'CORTESIA', label: '🎁 Cortesía' }
                ].map(m => (
                  <button key={m.val} onClick={() => {
                    setCollectMethod(m.val)
                    if (m.val === 'MIXED') {
                      const tot = calculatedCollectTotal || collectDialog?.total || 0
                      const half = Math.round(tot / 2)
                      setCollectCashAmount(String(half))
                      setCollectTransferAmount(String(tot - half))
                    }
                  }}
                    className={`p-2.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${collectMethod === m.val ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] shadow-md' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent)]/30'}`}>
                    {m.label}
                  </button>
                ))}
              </div>

              {collectMethod === 'MIXED' && (
                <div className="grid grid-cols-2 gap-2 mt-2 p-3 bg-[var(--bg-subtle)] rounded-xl border border-[var(--border-subtle)] shadow-inner">
                  <div>
                    <Label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase">💵 Efectivo ($)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatThousandsInput(collectCashAmount)}
                      onChange={e => {
                        const num = parseThousandsInput(e.target.value)
                        setCollectCashAmount(num > 0 ? String(num) : '')
                        const rest = Math.max(0, (calculatedCollectTotal || collectDialog?.total || 0) - num)
                        setCollectTransferAmount(rest > 0 ? String(rest) : '0')
                      }}
                      className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-9 text-xs font-bold text-emerald-500 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase">📱 Transferencia ($)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatThousandsInput(collectTransferAmount)}
                      onChange={e => {
                        const num = parseThousandsInput(e.target.value)
                        setCollectTransferAmount(num > 0 ? String(num) : '')
                        const rest = Math.max(0, (calculatedCollectTotal || collectDialog?.total || 0) - num)
                        setCollectCashAmount(rest > 0 ? String(rest) : '0')
                      }}
                      className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-9 text-xs font-bold text-blue-500 mt-1"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Selector de Cortesía por Producto Individual (Solo visible al seleccionar Cortesía) */}
            {collectMethod === 'CORTESIA' && collectDialog?.items && collectDialog.items.length > 0 && (
              <div className="space-y-2 border-t border-b border-[var(--border-subtle)] py-3 my-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">Marcar Cortesía por Producto</span>
                  <button 
                    type="button" 
                    onClick={() => {
                      if (courtesyItemIds.length === collectDialog.items.length) {
                        setCourtesyItemIds([])
                      } else {
                        setCourtesyItemIds(collectDialog.items.map((i: any) => i.id))
                      }
                    }}
                    className="text-[10px] text-[var(--accent)] font-bold hover:underline cursor-pointer"
                  >
                    {courtesyItemIds.length === collectDialog.items.length ? 'Desmarcar todos' : 'Marcar todo como Cortesía'}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {collectDialog.items.map((item: any) => {
                    const isCourtesy = courtesyItemIds.includes(item.id) || item.unitPrice === 0
                    const itemTotal = (item.unitPrice || item.menuItem?.price || 0) * item.quantity
                    return (
                      <div key={item.id} className="flex items-center justify-between bg-[var(--bg-subtle)] p-2 rounded-xl text-xs">
                        <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--text-primary)] min-w-0">
                          <input 
                            type="checkbox" 
                            checked={isCourtesy} 
                            onChange={() => {
                              setCourtesyItemIds(prev => 
                                prev.includes(item.id) 
                                  ? prev.filter(id => id !== item.id) 
                                  : [...prev, item.id]
                              )
                            }}
                            className="rounded border-[var(--border-default)]" 
                          />
                          <span className="truncate">{item.quantity}x {item.menuItem?.name || item.name}</span>
                        </label>
                        <span className={isCourtesy ? 'text-emerald-500 font-extrabold text-[10px]' : 'text-[var(--text-secondary)] font-semibold'}>
                          {isCourtesy ? '🎁 Cortesía ($0)' : formatCurrency(itemTotal)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {collectMethod === 'CREDIT' && (
              <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs space-y-1">
                <p className="font-bold text-[var(--accent)]">📋 Venta a Crédito (Cartera)</p>
                <p className="text-[11px] text-[var(--text-secondary)]">El saldo de este pedido se sumará a la cuenta deudora del cliente y el cliente se creará o actualizará automáticamente en Clientes.</p>
              </div>
            )}
            {collectMethod === 'CORTESIA' && courtesyItemIds.length === 0 && (
              <div className="p-3 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] text-xs space-y-1">
                <p className="font-bold">🎁 Venta de Cortesía Completa</p>
                <p className="text-[11px] text-[var(--text-secondary)]">El valor cobrado será $0. No suma a ingresos de caja pero sí descuenta los productos en cocina e inventario.</p>
              </div>
            )}
            {collectMethod !== 'CASH' && collectMethod !== 'CORTESIA' && collectMethod !== 'CREDIT' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">Referencia (opcional)</Label>
                <Input value={collectReference} onChange={e => setCollectReference(e.target.value)} placeholder="# de transacción..." className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10" />
              </div>
            )}
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              <input type="checkbox" checked={printInvoiceOnCollect} onChange={e => setPrintInvoiceOnCollect(e.target.checked)} className="rounded" />
              <span className="text-[11px] font-bold text-[var(--text-secondary)]">Imprimir factura al cobrar</span>
            </div>
            <Button className="w-full h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold rounded-xl text-sm shadow-md border-0 cursor-pointer"
              onClick={handleCollectPayment} disabled={isSubmittingPayment}>
              {isSubmittingPayment ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
              Confirmar Cobro
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dispatch Dialog ── */}
      <Dialog open={!!dispatchDialog} onOpenChange={() => setDispatchDialog(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-md">
          <DialogHeader><DialogTitle className="text-lg font-black text-[var(--text-primary)]"><Bike className="inline h-5 w-5 mr-2 text-[var(--accent)]" />Asignar Repartidor — #{dispatchDialog?.order?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!registeringDriverInline ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Seleccionar repartidor</Label>
                  <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                    <SelectTrigger className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 focus:border-[var(--accent)]">
                      <SelectValue placeholder="Elige un repartidor..." />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      {drivers.map(d => {
                        const isOverwork = (d.activeDeliveries || 0) >= 5
                        const isCurrent = dispatchDialog?.order?.deliveryDriverId === d.id
                        const disableOption = isOverwork && !isCurrent
                        return (
                          <SelectItem key={d.id} value={d.id} disabled={disableOption}>
                            <div className="flex items-center justify-between gap-2 w-full text-xs font-semibold">
                              <span>{d.name}</span>
                              {d.activeDeliveries > 0 ? (
                                <span className={`text-[10px] font-bold ${disableOption ? 'text-red-500' : 'text-amber-500'}`}>
                                  ({d.activeDeliveries}/5 {disableOption ? '🚫 Límite' : 'activos'})
                                </span>
                              ) : (
                                <span className="text-[10px] text-emerald-500 font-bold">(Libre)</span>
                              )}
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <button type="button" onClick={() => setRegisteringDriverInline(true)} className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] font-bold cursor-pointer border-0 bg-transparent">+ Registrar nuevo repartidor</button>
              </>
            ) : (
              <div className="space-y-3 p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <p className="text-xs font-bold text-[var(--text-primary)]">Registrar Nuevo Repartidor</p>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Nombre *</Label>
                  <Input value={inlineDriverName} onChange={e => setInlineDriverName(e.target.value)} placeholder="Ej: David" className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Celular *</Label>
                  <Input value={inlineDriverPhone} onChange={e => setInlineDriverPhone(e.target.value)} placeholder="3201234567" className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10" />
                </div>
                <button type="button" onClick={() => setRegisteringDriverInline(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-bold cursor-pointer border-0 bg-transparent">← Volver a la lista</button>
              </div>
            )}
            {dispatchError && (
              <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-2.5 text-[10px] text-[var(--destructive)] font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{dispatchError}</span>
              </div>
            )}
            <div className="flex gap-3 pt-2 border-t border-[var(--border-subtle)]/40">
              <Button variant="outline" className="flex-1 h-11 rounded-xl font-bold text-sm cursor-pointer" onClick={() => setDispatchDialog(null)}>Cancelar</Button>
              <Button className="flex-1 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md border-0 cursor-pointer" onClick={handleConfirmDispatch}>
                {dispatchDialog?.order?.status === 'PENDING' ? 'Despachar e Imprimir' : 'Confirmar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Order Detail Dialog (inline, no navigation) ── */}
      <Dialog open={!!detailOrder} onOpenChange={() => setDetailOrder(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto">
          {detailOrder && (() => {
            const o = detailOrder
            const phoneDigits = o.customerPhone.replace(/\D/g, '')
            const whatsappMsg = buildWhatsAppMessage(o)
            const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between">
                    <span className="text-xl font-black text-[var(--text-primary)]">Pedido #{o.orderNumber}</span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold uppercase"
                      style={{ color: getStatusColor(o.status), backgroundColor: `${getStatusColor(o.status)}15`, border: `1px solid ${getStatusColor(o.status)}25` }}>
                      {getStatusLabel(o.status)}
                    </span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  {/* Client Info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2">
                      <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><User className="h-3 w-3" /> Cliente</p>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{o.customerName}</p>
                      <a href={`tel:${o.customerPhone}`} className="text-xs text-[var(--accent)] font-semibold flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {o.customerPhone}
                      </a>
                      <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" /> {o.zone ? o.zone.name : o.customerAddress}
                      </p>
                      {o.zone && o.customerAddress && <p className="text-[10px] text-[var(--text-muted)] font-semibold">{o.customerAddress}</p>}
                    </div>
                    <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2">
                      <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Detalles</p>
                      <p className="text-xs text-[var(--text-secondary)]">Registrado: <span className="font-bold text-[var(--text-primary)]">{o.waiter?.name}</span></p>
                      {o.deliveryDriver && (
                        <p className="text-xs text-[var(--text-secondary)]">Domiciliario: <span className="font-bold text-emerald-600">{o.deliveryDriver.name} ({o.deliveryDriver.phone})</span></p>
                      )}
                      <p className="text-xs text-[var(--text-secondary)]">Método: <span className="font-bold">{getStatusLabel(o.paymentMethod)}</span></p>
                      <p className="text-xs text-[var(--text-secondary)]">Pago: <span className={`font-bold ${o.paymentStatus === 'CONFIRMED' ? 'text-emerald-600' : 'text-amber-600'}`}>{o.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : 'Pendiente'}</span></p>
                      <p className="text-xs text-[var(--text-secondary)]">Creado: <span className="font-semibold">{formatDate(o.createdAt)}</span></p>
                      <p className="text-xs text-[var(--text-secondary)]">Tiempo: <span className="font-bold">{getElapsedTime(o.createdAt)}</span></p>
                    </div>
                  </div>

                  {/* Products */}
                  {o.items && o.items.length > 0 && (
                    <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2">
                      <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" /> Productos</p>
                      <div className="space-y-2">
                        {groupOrderItems(o.items).map((item: any, idx: number) => {
                          const cleaned = cleanNotes(item.notes)
                          const notesText = item.notes && cleaned && !item.notes.startsWith('Adición para:') ? cleaned : ''
                          const itemTotal = (item.unitPrice || item.price || 0) * item.quantity
                          return (
                            <div key={idx} className="border-b border-[var(--border-subtle)]/40 pb-1.5 last:border-0 last:pb-0">
                              <div className="flex items-center justify-between text-xs font-bold text-[var(--text-primary)]">
                                <span>
                                  {item.quantity}x {item.menuItem?.name || item.name}
                                  {notesText && <span className="text-[10px] text-[var(--text-secondary)] font-normal italic ml-1">({notesText})</span>}
                                </span>
                                <span className="font-semibold text-[var(--text-secondary)]">{formatCurrency(itemTotal)}</span>
                              </div>
                              {item.additions && item.additions.map((a: any, aIdx: number) => {
                                const aCleaned = cleanNotes(a.notes)
                                const aNotesText = a.notes && aCleaned && !a.notes.startsWith('Adición para:') ? aCleaned : ''
                                const aTotal = (a.unitPrice || a.price || 0) * a.quantity
                                return (
                                  <div key={aIdx} className="flex items-center justify-between text-[11px] text-[var(--accent)] font-bold pl-3 mt-1">
                                    <span>
                                      + {a.quantity}x {a.menuItem?.name || a.name}
                                      {aNotesText && <span className="text-[9px] opacity-80 font-normal italic ml-1">({aNotesText})</span>}
                                    </span>
                                    <span className="font-semibold">{formatCurrency(aTotal)}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Totals */}
                  <div className="p-3 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>Subtotal</span><span className="font-bold">{formatCurrency(o.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>Domicilio</span><span className="font-bold">{formatCurrency(o.deliveryFee)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>Impuesto (8%)</span><span className="font-bold">{formatCurrency(o.tax)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-black text-[var(--text-primary)] mt-2 pt-2 border-t border-[var(--accent)]/20">
                      <span>TOTAL</span><span className="text-[var(--accent)]">{formatCurrency(o.total)}</span>
                    </div>
                  </div>

                  {(() => {
                    const cleanNote = (o.notes || '').replace(/\[\/?(PICKUP|BIG|BOLD|CENTER)\]/gi, '').trim()
                    return cleanNote ? (
                      <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-700 font-semibold">
                        📝 {cleanNote}
                      </div>
                    ) : null
                  })()}

                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-subtle)]/50">
                    {o.paymentStatus !== 'CONFIRMED' && o.status !== 'CANCELLED' && ['SUPERADMIN', 'ADMIN', 'CASHIER'].includes(user?.role || '') && (
                      <Button size="sm" className="h-9 px-4 text-xs font-extrabold bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl gap-1.5 border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => { setDetailOrder(null); setCollectDialog(o); }}
                        disabled={o.orderType !== 'PICKUP' && o.orderType !== 'LOCAL' && !o.deliveryDriverId}
                        title={o.orderType !== 'PICKUP' && o.orderType !== 'LOCAL' && !o.deliveryDriverId ? 'Debe asignar un domiciliario primero' : 'Cobrar pedido'}
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Cobrar
                      </Button>
                    )}
                    {o.orderType !== 'PICKUP' && o.orderType !== 'LOCAL' && activeStatuses.includes(o.status) && (
                      <Button size="sm" variant="outline" className={`h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer ${o.deliveryDriver ? 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10' : 'border-amber-500/30 text-amber-600 hover:bg-amber-500/10'}`}
                        onClick={() => { setDetailOrder(null); setSelectedDriverId(o.deliveryDriverId || ''); setRegisteringDriverInline(false); setDispatchError(''); setDispatchDialog({ order: o, shouldKick: false }); }}
                        title={o.deliveryDriver ? 'Cambiar repartidor' : 'Asignar repartidor'}>
                        <Bike className="h-3.5 w-3.5" />
                        {o.deliveryDriver ? `Repartidor: ${o.deliveryDriver.name}` : 'Asignar Repartidor'}
                      </Button>
                    )}
                    {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
                      <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                        onClick={() => { setDetailOrder(null); navigate(`/orders/new?edit=${o.id}`) }}
                        title="Editar pedido">
                        <Edit className="h-3.5 w-3.5" /> Editar Pedido
                      </Button>
                    )}
                    <a href={whatsapp} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10">
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </Button>
                    </a>
                    {activeStatuses.includes(o.status) && ['SUPERADMIN', 'ADMIN'].includes(user?.role || '') && (
                      <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-red-500/30 text-red-500 hover:bg-red-500/10"
                        onClick={() => { setDetailOrder(null); setCancelDialog({ id: o.id, orderNumber: o.orderNumber }); setCancelConfirmStep(false); setCancelReason(''); }}>
                        <XCircle className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

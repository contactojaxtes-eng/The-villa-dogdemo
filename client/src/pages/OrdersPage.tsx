import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { statusAccent, statusOrder } from '@/lib/brand'
import { cn, formatCurrency, formatDate, getStatusColor, getStatusLabel, cleanNotes, groupOrderItems, formatThousandsInput, parseThousandsInput, getLocalDateString } from '@/lib/utils'
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
  Printer, 
  UtensilsCrossed,
  XCircle,
  X, 
  CheckCircle2, 
  DollarSign, 
  Edit,
  ClipboardList,
  AlertTriangle,
  Store
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
  invoiceNumber?: number | null
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

interface DeliveryHistoryResponse {
  orders: Order[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    total: number
    listed: number
    active: number
    delivered: number
    cancelled: number
    billed: number
    statusCounts: Record<string, number>
  }
}

const IMPOCONSUMO_RATE = 0.08
const activeStatuses = ['PENDING', 'READY', 'IN_ROUTE']
const HISTORY_PAGE_SIZE = 20

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

export default function OrdersPage() {
  const { user, hasPermission } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'ALL')
  const [orderTypeFilter, setOrderTypeFilter] = useState<'ALL' | 'DELIVERY' | 'PICKUP'>(() => {
    const value = searchParams.get('type')
    return value === 'DELIVERY' || value === 'PICKUP' ? value : 'ALL'
  })
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [submittedSearch, setSubmittedSearch] = useState(() => searchParams.get('search') || '')

  const handleSearch = () => {
    setCurrentPage(1)
    setSubmittedSearch(search.trim())
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmittedSearch(search.trim())
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  const todayStr = useMemo(() => getLocalDateString(), [])
  const [startDate, setStartDate] = useState(todayStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'range' | 'all'>('today')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [activeOperators, setActiveOperators] = useState<Record<string, { userId: string; userName: string }>>({})
  const [cancelDialog, setCancelDialog] = useState<{ id: string; orderNumber: number } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmStep, setCancelConfirmStep] = useState(false)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [collectDialog, setCollectDialog] = useState<{ id: string; orderNumber: number; total: number; method: string } | null>(null)
  const [collectMethod, setCollectMethod] = useState<string>('CASH')
  const [collectCashAmount, setCollectCashAmount] = useState<string>('')
  const [collectTransferAmount, setCollectTransferAmount] = useState<string>('')
  const [collectReference, setCollectReference] = useState<string>('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState<boolean>(false)
  const [printInvoiceOnCollect, setPrintInvoiceOnCollect] = useState<boolean>(true)
  const [dispatchDialog, setDispatchDialog] = useState<{ order: any; shouldKick: boolean } | null>(null)
  const [drivers, setDrivers] = useState<any[]>([])
  const [driverSearch, setDriverSearch] = useState('')
  const [selectedDriverId, setSelectedDriverId] = useState<string>('')
  const [inlineDriverName, setInlineDriverName] = useState('')
  const [inlineDriverPhone, setInlineDriverPhone] = useState('')
  const [registeringDriverInline, setRegisteringDriverInline] = useState(false)
  const [dispatchError, setDispatchError] = useState('')

  const filteredDrivers = useMemo(() => {
    if (!driverSearch.trim()) return drivers
    const q = driverSearch.trim().toLowerCase()
    return drivers.filter(d => 
      (d.name && d.name.toLowerCase().includes(q)) || 
      (d.phone && d.phone.includes(q))
    )
  }, [drivers, driverSearch])
  const [currentPage, setCurrentPage] = useState(1)
  const [historyPagination, setHistoryPagination] = useState({ page: 1, pageSize: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 })
  const [historySummary, setHistorySummary] = useState<DeliveryHistoryResponse['summary']>({
    total: 0,
    listed: 0,
    active: 0,
    delivered: 0,
    cancelled: 0,
    billed: 0,
    statusCounts: {},
  })
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
      setCollectMethod(collectDialog.method || 'CASH')
      setCollectReference('')
      const tot = collectDialog.total || 0
      const half = Math.round(tot / 2)
      setCollectCashAmount(String(half))
      setCollectTransferAmount(String(tot - half))
    }
  }, [collectDialog])

  const handleCollectPayment = async () => {
    if (!collectDialog) return
    setIsSubmittingPayment(true)
    try {
      const updatedOrder = await api.put<any>(`/orders/${collectDialog.id}/payment`, {
        method: collectMethod,
        paymentStatus: 'CONFIRMED',
        reference: collectReference || null,
        cashAmount: collectMethod === 'MIXED' ? (parseFloat(collectCashAmount) || 0) : undefined,
        transferAmount: collectMethod === 'MIXED' ? (parseFloat(collectTransferAmount) || 0) : undefined,
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
      loadOrders(false, true)
    } catch (err: any) {
      alerts.error('Error al cobrar', err.message || 'No se pudo registrar el pago')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const handleConfirmDispatch = async () => {
    if (!dispatchDialog?.order) return
    const orderToUpdate = dispatchDialog.order
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
      loadOrders(false, true)
      alerts.success('Pedido despachado', `Pedido #${orderToUpdate.orderNumber} asignado a repartidor correctamente.`)
    } catch (err: any) {
      setDispatchError(err.message || 'No se pudo despachar el pedido')
    }
  }

  const applyDatePreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'range' | 'all') => {
    setCurrentPage(1)
    setDatePreset(preset)
    const now = new Date()
    if (preset === 'today') {
      const t = getLocalDateString(now)
      setStartDate(t)
      setEndDate(t)
    } else if (preset === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      const yStr = getLocalDateString(y)
      setStartDate(yStr)
      setEndDate(yStr)
    } else if (preset === 'week') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(now.setDate(diff))
      setStartDate(getLocalDateString(monday))
      setEndDate(getLocalDateString(new Date()))
    } else if (preset === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(getLocalDateString(first))
      setEndDate(getLocalDateString(new Date()))
    } else if (preset === 'range') {
      const today = getLocalDateString(now)
      if (!startDate) setStartDate(today)
      if (!endDate) setEndDate(today)
    } else if (preset === 'all') {
      setStartDate('')
      setEndDate('')
    }
  }

  const loadOrders = useCallback((silent = false, force = false) => {
    if (!silent) setIsRefreshing(true)
    const params = new URLSearchParams()
    params.set('orderType', orderTypeFilter === 'ALL' ? 'DELIVERY,PICKUP' : orderTypeFilter)
    if (statusFilter !== 'ALL') params.set('status', statusFilter)
    if (submittedSearch) params.set('search', submittedSearch)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    params.set('page', String(currentPage))
    params.set('limit', String(HISTORY_PAGE_SIZE))
    api.get<DeliveryHistoryResponse>(`/orders/history?${params.toString()}`, { force })
      .then(result => {
        setOrders(result.orders)
        setHistoryPagination(result.pagination)
        setHistorySummary(result.summary)
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false)
        setIsRefreshing(false)
      })
  }, [currentPage, endDate, orderTypeFilter, startDate, statusFilter, submittedSearch])

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

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        loadOrders(true, true)
        loadDrivers()
      }, 1200)
    }

    socket.on('newOrder', () => { 
      debouncedRefresh()
    })
    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: any }) => {
      if (data && data.orderId) {
        setOrders(prev => prev.map(o => o.id === data.orderId ? {
          ...o,
          status: data.status,
          ...(data.order || {}),
        } : o))
        
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
      debouncedRefresh()
    })

    socket.on('orderUpdated', (updatedOrder: any) => {
      if (updatedOrder && updatedOrder.id) {
        setOrders(prev => prev.map(o => o.id === updatedOrder.id ? { ...o, ...updatedOrder } : o))
        setDetailOrder(prev => (prev && prev.id === updatedOrder.id) ? { ...prev, ...updatedOrder } : prev)
      }
      debouncedRefresh()
    })

    socket.on('paymentUpdated', () => {
      debouncedRefresh()
    })

    socket.on('driversChanged', () => {
      debouncedRefresh()
    })

    return () => { 
      if (refreshTimer) clearTimeout(refreshTimer)
      socket.disconnect() 
    }
  }, [user, loadOrders, loadDrivers])

  useEffect(() => {
    const params = new URLSearchParams()
    if (statusFilter !== 'ALL') params.set('status', statusFilter)
    if (orderTypeFilter !== 'ALL') params.set('type', orderTypeFilter)
    if (submittedSearch) params.set('search', submittedSearch)
    setSearchParams(params, { replace: true })
  }, [setSearchParams, statusFilter, orderTypeFilter, submittedSearch])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])



  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])


  const updateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id)
    try {
      await api.put(`/orders/${id}/status`, { status: newStatus })
      alerts.success('Estado actualizado', 'La comanda ha cambiado de estado.')
      loadOrders(false, true)
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
      loadOrders(false, true)
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

  const totalPages = historyPagination.totalPages
  const safeCurrentPage = historyPagination.page
  const displayedOrders = orders
  const statusCounts = historySummary.statusCounts

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
    <motion.div className="space-y-5" initial="hidden" animate="visible" variants={stagger}>
      
      {/* ── Header ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/10"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
            <ClipboardList className="h-5 w-5 text-[var(--accent-fg)]" />
          </div>
          <div>
            <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none uppercase">Historial Domicilios</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Domicilios y pedidos para recoger, separados de las mesas del salón.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasPermission('orders.create') && (
            <Link to="/orders/new">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Button className="bg-[var(--accent)] text-[var(--accent-fg)] font-bold hover:bg-[var(--accent-hover)] shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 gap-2">
                  <Plus className="h-4 w-4" /> Nuevo Pedido
                </Button>
              </motion.div>
            </Link>
          )}
        </div>
      </motion.div>

      {/* ── KPI Cards Grid ── */}
      <motion.div className="grid grid-cols-2 gap-4 md:grid-cols-4" variants={stagger}>
        {(user?.role === 'DELIVERY_MANAGER'
          ? [
              { label: 'Pedidos Listados', value: historySummary.listed, color: '#10B981', icon: Package, sub: 'En esta consulta' },
              { label: 'Pedidos Activos', value: historySummary.active, color: '#F59E0B', icon: Timer, sub: 'Pendientes de despacho' },
              { label: 'Entregados', value: historySummary.delivered, color: '#F97316', icon: Bike, sub: 'En el período elegido' },
              { label: 'Cancelados', value: historySummary.cancelled, color: '#EF4444', icon: XCircle, sub: 'Pedidos cancelados' },
            ]
          : [
              { label: 'Pedidos Listados', value: historySummary.listed, color: '#10B981', icon: Package, sub: 'En esta consulta' },
              { label: 'Pedidos Activos', value: historySummary.active, color: '#F59E0B', icon: Timer, sub: 'Pendientes de despacho' },
              { label: 'Entregados', value: historySummary.delivered, color: '#F97316', icon: Bike, sub: 'En el período elegido' },
              { label: 'Facturación cobrada', value: formatCurrency(historySummary.billed), color: '#3B82F6', icon: DollarSign, sub: 'Entregados y pagos confirmados' },
            ]
        ).map(stat => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5"
              style={{ boxShadow: `0 4px 24px -8px ${stat.color}25` }}
              whileHover={{ y: -3, boxShadow: `0 12px 36px -8px ${stat.color}35` }}
              transition={{ duration: 0.25 }}
            >
              {/* Orb blur background */}
              <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full blur-2xl opacity-40"
                style={{ background: `radial-gradient(circle, ${stat.color}22, transparent)` }} />
              <div className="relative flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-inner"
                  style={{ background: `linear-gradient(135deg, ${stat.color}25, ${stat.color}10)`, border: `1px solid ${stat.color}30` }}>
                  <Icon className="h-6 w-6" style={{ color: stat.color }} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{stat.label}</p>
                  <p className="text-xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{stat.value}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{stat.sub}</p>
                </div>
              </div>
            </motion.div>
          )
        })}
      </motion.div>

      {/* ── Filters Card ── */}
      <motion.div variants={fadeUp}>
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
              <div>
                <p className="text-sm font-black text-[var(--text-primary)]">Buscar en el historial</p>
                <p className="text-xs text-[var(--text-muted)]">Filtra por fecha, tipo de entrega, estado, cliente, barrio, producto o repartidor.</p>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)]">
                {historySummary.listed} resultado{historySummary.listed === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <Input 
                  placeholder="Buscar por cliente, celular, #pedido, barrio, plato, domiciliario..." 
                  className="pl-10 pr-9 h-10.5 bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 text-sm rounded-xl transition-all" 
                  value={search} 
                  onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} 
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setSubmittedSearch(''); setCurrentPage(1) }}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer text-xs font-bold"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Select value={orderTypeFilter} onValueChange={value => { setOrderTypeFilter(value as 'ALL' | 'DELIVERY' | 'PICKUP'); setCurrentPage(1) }}>
                <SelectTrigger className="w-48 h-10.5 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50">
                  <SelectValue placeholder="Tipo de entrega" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                  <SelectItem value="ALL">Domicilio y recoger</SelectItem>
                  <SelectItem value="DELIVERY">Solo domicilios</SelectItem>
                  <SelectItem value="PICKUP">Solo para recoger</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex flex-wrap items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-default)] p-1 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => applyDatePreset('today')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'today' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('yesterday')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'yesterday' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Ayer
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('week')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'week' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Esta Semana
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('month')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'month' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Este Mes
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('range')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'range' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  📅 Rango Fechas
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('all')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${datePreset === 'all' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Todos
                </button>
              </div>

              {datePreset === 'range' && (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] block mb-0.5">Desde</span>
                    <Input 
                      type="date" 
                      className="w-36 h-9 bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs rounded-xl" 
                      value={startDate} 
                      onChange={e => { setStartDate(e.target.value); setDatePreset('range'); setCurrentPage(1) }}
                    />
                  </div>
                  <div className="relative">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] block mb-0.5">Hasta</span>
                    <Input 
                      type="date" 
                      className="w-36 h-9 bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs rounded-xl" 
                      value={endDate} 
                      onChange={e => { setEndDate(e.target.value); setDatePreset('range'); setCurrentPage(1) }}
                    />
                  </div>
                </div>
              )}
              <Button 
                variant="ghost" 
                onClick={handleSearch}
                disabled={isRefreshing}
                className="h-10.5 text-sm hover:bg-[var(--bg-hover)] rounded-xl font-bold gap-1.5 cursor-pointer"
              >
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" /> : <Search className="h-4 w-4" />} Buscar
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => loadOrders()}
                disabled={isRefreshing}
                className="h-10.5 text-sm hover:bg-[var(--bg-hover)] rounded-xl text-[var(--text-secondary)] gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-[var(--accent)]' : ''}`} /> Actualizar
              </Button>
            </div>

            {/* Horizontal scroll pills */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              <button
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${statusFilter === 'ALL' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-primary)] bg-[var(--bg-base)]'}`}
                onClick={() => { setStatusFilter('ALL'); setCurrentPage(1) }}
              >
                Todos · {historySummary.total}
              </button>
              {statusOrder.map(status => (
                <button
                  key={status}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${statusFilter === status ? 'text-[#0D0D0D] shadow-sm' : 'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-primary)] bg-[var(--bg-base)]'}`}
                  style={statusFilter === status ? { backgroundColor: statusAccent[status] } : {}}
                  onClick={() => { setStatusFilter(status); setCurrentPage(1) }}
                >
                  {getStatusLabel(status)} · {statusCounts[status] || 0}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Orders List ── */}
      <div className="space-y-4">
        {displayedOrders.length === 0 && (
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl shadow-md">
            <CardContent className="py-16 text-center space-y-2">
              <Package className="mx-auto h-12 w-12 text-[var(--text-muted)] animate-pulse" />
              <p className="text-[var(--text-primary)] font-bold text-sm">No se encontraron pedidos</p>
              <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">Intenta ajustar los filtros de búsqueda, cambiar la fecha del filtro o refrescar el listado.</p>
              {datePreset !== 'all' && (
                <div className="pt-2">
                  <Button 
                    variant="outline"
                    onClick={() => applyDatePreset('all')}
                    className="text-xs font-black border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-xl cursor-pointer"
                  >
                    🔍 Buscar en todo el historial sin límite de fecha
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <AnimatePresence>
          {displayedOrders.map((order, index) => {
            const phoneDigits = (order.customerPhone || '').replace(/\D/g, '')
            const whatsappMsg = buildWhatsAppMessage(order)
            const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
            const StatusIcon = statusIcons[order.status] || Clock
            const estimatedTime = estimatedDeliveryTimes[order.status] || ''
            const isPickup = order.orderType === 'PICKUP'
            const dbAssignee = order.assignee
            const assignedOp = activeOperators[order.id] || (dbAssignee ? { userId: dbAssignee.id, userName: dbAssignee.name } : null)
            const isAssignedToMe = !!user?.id && assignedOp?.userId === user.id
            const assignedColorIndex = uniqueOperators.findIndex(op => op.userId === assignedOp?.userId)
            const assignedColor = assignedColorIndex >= 0 ? getOperatorColor(assignedColorIndex) : '#999999'

            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ delay: index * 0.03, duration: 0.3 }}
              >
                <Card
                  className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl hover:border-[var(--accent)]/30 transition-all duration-200 shadow-md relative overflow-hidden group"
                  style={assignedOp ? { borderLeftWidth: '5px', borderLeftColor: assignedColor } : {}}
                >
                  <CardContent className="p-4 md:p-5">
                    {/* Top Row: Number, Badges, Total Price */}
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3 mb-3 gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button onClick={() => setDetailOrder(order)} className="antifont text-xl text-[var(--accent)] hover:underline leading-none font-black cursor-pointer border-0 bg-transparent p-0 text-left" title="Ver detalle completo del pedido">
                            Factura #{order.invoiceNumber || order.orderNumber}
                          </button>
                          <span className="text-[10px] font-extrabold text-[var(--text-muted)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full border border-[var(--border-subtle)]" title="Turno del Día">
                            Turno #{order.orderNumber}
                          </span>
                        </div>
                        <Badge 
                          variant="outline" 
                          className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider"
                          style={{ 
                            borderColor: `${getStatusColor(order.status)}30`, 
                            color: getStatusColor(order.status),
                            backgroundColor: `${getStatusColor(order.status)}08`
                          }}
                        >
                          {getStatusLabel(order.status)}
                        </Badge>
                        {isPickup ? (
                          <Badge className="bg-purple-600 text-white text-xs px-2.5 py-1 font-black rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-wide">
                            <Store className="h-3.5 w-3.5" /> PASAR A RECOGER
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-600 text-white text-xs px-2.5 py-1 font-black rounded-lg shadow-sm flex items-center gap-1.5 uppercase tracking-wide">
                            <Bike className="h-3.5 w-3.5" /> DOMICILIO
                          </Badge>
                        )}
                        <Badge variant="secondary" className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)] px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                          {getStatusLabel(order.paymentMethod)}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider animate-fade-in"
                          style={{ 
                            borderColor: `${getStatusColor(order.paymentStatus)}30`, 
                            color: getStatusColor(order.paymentStatus),
                            backgroundColor: `${getStatusColor(order.paymentStatus)}08`
                          }}
                        >
                          {getStatusLabel(order.paymentStatus)}
                        </Badge>
                      </div>
                      
                      {user?.role !== 'DELIVERY_MANAGER' && (
                        <div className="text-right shrink-0">
                          <span className="text-2xl font-black text-[var(--text-primary)] tracking-tight tabular-nums">{formatCurrency(order.total)}</span>
                        </div>
                      )}
                    </div>

                    {/* Middle Section: Customer info & Items Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      {/* Left: Customer Info */}
                      <div className="lg:col-span-7 space-y-2.5 min-w-0">
                        <div>
                          <p className="font-black text-[var(--text-primary)] text-lg leading-snug">{order.customerName}</p>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-2.5">
                          {order.customerPhone && (
                            <a 
                              className="inline-flex items-center gap-1.5 text-sm font-black text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 px-3 py-1 rounded-lg transition-colors border border-[var(--accent)]/20 shadow-sm" 
                              href={`tel:${order.customerPhone}`}
                              title="Llamar al cliente"
                            >
                              <Phone className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                              <span>{order.customerPhone}</span>
                            </a>
                          )}
                          <div className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[var(--text-primary)] bg-[var(--bg-elevated)] px-3 py-1 rounded-lg border border-[var(--border-default)] shadow-sm max-w-full flex-wrap">
                            <MapPin className="h-4 w-4 text-[var(--accent)] shrink-0" />
                            {isPickup ? (
                              <span className="text-purple-600 dark:text-purple-400 font-black uppercase">Retira en restaurante</span>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-extrabold text-sm">{order.customerAddress || 'Sin dirección registrada'}</span>
                                {order.zone && (
                                  <Badge variant="secondary" className="bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-black uppercase px-2 py-0.5 border border-[var(--accent)]/30">
                                    {order.zone.name}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {order.addressReference && (
                          <p className="text-xs text-[var(--text-secondary)] font-semibold italic flex items-center gap-1">
                            <span>📍 Ref:</span> {order.addressReference}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)] font-medium">
                          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" /> {formatDate(order.createdAt)}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 text-[var(--text-muted)]" /> Atiende: {order.waiter?.name || order.assignee?.name || '—'}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <ClipboardList className="h-3.5 w-3.5 text-[var(--text-muted)]" /> 
                            {order.cashRegister ? (
                              <span className="font-bold">{order.cashRegister.name}</span>
                            ) : (
                              <span className="text-amber-500 font-bold text-[10px] uppercase bg-amber-500/5 px-2 py-0.5 rounded-full border border-amber-500/20">Fuera de Caja (Manual)</span>
                            )}
                          </span>
                          
                          {activeStatuses.includes(order.status) && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[var(--accent)] font-semibold">
                                <Timer className="h-3 w-3" /> {getElapsedTime(order.createdAt)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="pt-1 flex flex-wrap gap-2 items-center">
                          {assignedOp && (
                            <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase shrink-0" style={{ backgroundColor: `${assignedColor}15`, color: assignedColor, border: `1px solid ${assignedColor}30` }}>
                              <Headphones className="h-3 w-3" />
                              <span>Operador: {assignedOp.userName}</span>
                              {isAssignedToMe && <span className="text-[9px] opacity-75 ml-1">(Tú)</span>}
                            </div>
                          )}

                          {order.orderType === 'DELIVERY' && (
                            <div 
                              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase border transition-all shrink-0 ${
                                ['DELIVERED', 'CANCELLED'].includes(order.status)
                                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30 cursor-default opacity-85'
                                  : order.deliveryDriver 
                                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30 cursor-pointer hover:bg-[var(--accent)]/15'
                                    : 'bg-amber-500/10 text-amber-500 border-amber-500/20 cursor-pointer hover:bg-amber-500/15'
                              }`}
                              title={
                                ['DELIVERED', 'CANCELLED'].includes(order.status)
                                  ? 'Pedido finalizado - Repartidor asignado'
                                  : order.deliveryDriver 
                                    ? 'Hacer clic para re-asignar repartidor' 
                                    : 'Hacer clic para asignar repartidor'
                              }
                              onClick={() => {
                                if (['DELIVERED', 'CANCELLED'].includes(order.status)) return
                                setSelectedDriverId(order.deliveryDriverId || '')
                                setInlineDriverName('')
                                setInlineDriverPhone('')
                                setDispatchError('')
                                setDriverSearch('')
                                setDispatchDialog({ order, shouldKick: false })
                              }}
                            >
                              <Bike className="h-3 w-3" />
                              <span>Repartidor: {order.deliveryDriver ? `${order.deliveryDriver.name}` : 'Sin Asignar ⚠'}</span>
                            </div>
                          )}
                        </div>

                        {order.status === 'CANCELLED' && order.cancellationReason && (
                          <div className="pt-1">
                            <div className="flex flex-col gap-1 rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 px-3 py-2 text-xs font-semibold text-[var(--destructive)]">
                              <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-85">Motivo de Anulación:</span>
                              <span className="italic">"{order.cancellationReason}"</span>
                              {order.cancelledAt && (
                                <span className="text-[9px] opacity-75 font-normal">
                                  Anulado el {formatDate(order.cancelledAt)}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Items Preview (Saves Navigation to detail) */}
                      <div className="lg:col-span-5 flex flex-col justify-between">
                        {order.items && order.items.length > 0 ? (
                          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/70 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Productos:</p>
                            {groupOrderItems(order.items || []).map((i: any, idx: number) => (
                              <div key={idx} className="flex flex-col text-xs border-b border-[var(--border-subtle)]/30 pb-1 last:border-0 last:pb-0">
                                <div className="flex items-start justify-between font-bold text-[var(--text-primary)]">
                                  <span>{i.quantity}x {i.menuItem.name}</span>
                                  {i.notes && cleanNotes(i.notes) && !i.notes.startsWith('Adición para:') && (
                                    <span className="text-[10px] text-[var(--text-secondary)] italic font-normal ml-2">({cleanNotes(i.notes)})</span>
                                  )}
                                </div>
                                {i.additions && i.additions.map((a: any, aIdx: number) => (
                                  <div key={aIdx} className="text-[10px] text-[var(--accent)] font-extrabold pl-3 flex items-center gap-0.5 mt-0.5">
                                    <span>+ {a.quantity}x {a.menuItem.name} <span className="text-[8px] opacity-80">[Adición]</span></span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)] italic">
                            Sin productos detallados
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Action Buttons */}
                    <div className="border-t border-[var(--border-subtle)]/50 pt-3 mt-4 flex flex-wrap gap-3 items-center justify-between">
                        {/* Operator Claim / Assignment */}
                      <div className="flex items-center gap-2">
                        {activeStatuses.includes(order.status) && !assignedOp && !order.assignee && !['SUPERADMIN', 'CASHIER'].includes(user?.role || '') && (
                          <Button
                            size="sm"
                            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl text-xs h-9 px-3 gap-1.5 shadow-sm"
                            onClick={() => claimOrder(order.id)}
                          >
                            <Headphones className="h-3.5 w-3.5" /> Tomar Pedido
                          </Button>
                        )}
                      </div>

                      {/* Operations and Tools */}
                      <div className="flex flex-wrap items-center gap-2 ml-auto">
                        {/* Botón Cobrar Pedido (Visible si no está cobrado) */}
                        {order.paymentStatus !== 'CONFIRMED' && order.status !== 'CANCELLED' && (
                          <Button 
                            size="sm" 
                            className="h-9 px-3 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-1 border-0 cursor-pointer shadow-md active:scale-95 transition-all"
                            onClick={() => setCollectDialog({ id: order.id, orderNumber: order.orderNumber, total: order.total, method: order.paymentMethod || 'CASH' })}
                            title="Registrar Cobro del Pedido"
                          >
                            <DollarSign className="h-4 w-4" /> Cobrar
                          </Button>
                        )}

                        {/* Action Tools: Un solo botón de impresión para Comanda/Factura unificada */}
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-9 w-9 p-0 rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-emerald-500 hover:text-emerald-600 active:scale-95 transition-all cursor-pointer"
                          title="Imprimir Factura / Comanda"
                          onClick={async () => {
                            const shouldKick = order.paymentMethod === 'CASH';
                            const orderWithDriver = {
                              ...order,
                              deliveryDriver: order.deliveryDriver || (order.deliveryDriverId ? drivers.find(d => d.id === order.deliveryDriverId) : undefined)
                            };
                            alerts.toast(`Enviando pedido #${order.orderNumber} a impresión...`, 'info');
                            const res = await printComandaSmart(orderWithDriver, 'caja', user?.role, false, shouldKick);
                            if (res?.error) {
                              alerts.error('Error al imprimir', res.error);
                            } else {
                              alerts.toast(`Pedido #${order.orderNumber} enviado a la impresora`, 'success');
                            }
                          }}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {order.status !== 'CANCELLED' && (
                          <>
                            <Link
                              to={order.tableId ? `/tables/new?tableId=${order.tableId}&editOrderId=${order.id}` : `/orders/new?edit=${order.id}`}
                              title="Editar Pedido"
                            >
                              <Button size="sm" variant="ghost" className="h-9 w-9 p-0 rounded-xl border border-[var(--accent)]/20 text-[var(--accent)] bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10 active:scale-95 transition-all cursor-pointer">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                            {user?.role !== 'DELIVERY_MANAGER' && (
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-9 w-9 p-0 rounded-xl border border-red-500/20 text-red-500 hover:bg-red-500/10 active:scale-95 transition-all shadow-sm"
                                title="Cancelar Pedido"
                                onClick={() => { setCancelDialog({ id: order.id, orderNumber: order.orderNumber }); setCancelConfirmStep(false); setCancelReason('') }}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                        <Button size="sm" variant="ghost" title="Ver Detalle del Pedido" onClick={() => setDetailOrder(order)} className="h-9 w-9 p-0 rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] active:scale-95 transition-all">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {historyPagination.total > HISTORY_PAGE_SIZE && (
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold text-[var(--text-muted)]">
              Mostrando {(safeCurrentPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(safeCurrentPage * HISTORY_PAGE_SIZE, historyPagination.total)} de {historyPagination.total} pedidos
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-xl px-3 text-xs font-bold"
                disabled={safeCurrentPage === 1}
                onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              >
                Anterior
              </Button>
              <span className="min-w-20 text-center text-xs font-black text-[var(--text-primary)]">
                {safeCurrentPage} de {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-xl px-3 text-xs font-bold"
                disabled={safeCurrentPage === totalPages}
                onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel Order Dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={open => { if (!open) { setCancelDialog(null); setCancelConfirmStep(false); setCancelReason('') } }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="h-1.5 w-full bg-[var(--destructive)]" />
          <div className="p-6">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <XCircle className="h-5.5 w-5.5 text-[var(--destructive)]" />
                {cancelConfirmStep ? `¿Confirmar cancelación #${cancelDialog?.orderNumber}?` : `Cancelar Pedido #${cancelDialog?.orderNumber}`}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Esta acción liberará insumos y cancelará la facturación del pedido</p>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {!cancelConfirmStep ? (
                <>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Esta acción anulará la comanda de forma permanente, restablecerá los ingredientes al inventario y eliminará el registro de venta diaria. Debes especificar el motivo de la cancelación.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Motivo de Cancelación *</Label>
                    <Textarea 
                      value={cancelReason} 
                      onChange={e => setCancelReason(e.target.value)} 
                      placeholder="Ej: Cliente canceló, dirección incorrecta, pedido duplicado..." 
                      rows={3} 
                      className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-[var(--destructive)]/50 focus:ring-1 focus:ring-[var(--destructive)]/50 transition-all font-semibold"
                    />
                  </div>
                  <Button variant="destructive" className="w-full h-12 rounded-xl font-bold shadow-md shadow-[var(--destructive)]/10 transition-all mt-3" onClick={cancelOrder}>
                    Continuar
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4 text-sm text-[var(--destructive)] space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider opacity-85">Motivo especificado:</p>
                    <p className="font-semibold italic">"{cancelReason}"</p>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    ¿Estás seguro de que deseas proceder? Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-3 mt-3">
                    <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-sm border-[var(--border-default)] hover:bg-[var(--bg-hover)]" onClick={() => setCancelConfirmStep(false)}>Volver</Button>
                    <Button variant="destructive" className="flex-1 h-12 rounded-xl font-bold text-sm shadow-md shadow-[var(--destructive)]/10 transition-all" onClick={cancelOrder} disabled={!!updatingId}>
                      {updatingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Confirmar Anulación
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogo de Cobro de Pedido */}
      <Dialog open={!!collectDialog} onOpenChange={open => { if (!open) setCollectDialog(null) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="h-1.5 w-full bg-emerald-600" />
          <div className="p-6">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <DollarSign className="h-5.5 w-5.5 text-emerald-500" />
                Registrar Cobro - Pedido #{collectDialog?.orderNumber}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Confirma el cobro de la comanda con el repartidor</p>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Total a Cobrar</p>
                <p className="text-3xl font-black text-[var(--text-primary)] tracking-tight mt-1">{collectDialog ? formatCurrency(collectDialog.total) : '$ 0'}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Método de Pago *</Label>
                <Select value={collectMethod} onValueChange={val => {
                  setCollectMethod(val)
                  if (val === 'MIXED' && collectDialog) {
                    const tot = collectDialog.total || 0
                    const half = Math.round(tot / 2)
                    setCollectCashAmount(String(half))
                    setCollectTransferAmount(String(tot - half))
                  }
                }}>
                  <SelectTrigger className="w-full h-11 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 font-bold">
                    <SelectValue placeholder="Selecciona un método" />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                    <SelectItem value="CASH">Efectivo</SelectItem>
                    <SelectItem value="TRANSFER">Transferencia</SelectItem>
                    <SelectItem value="MIXED">🔀 Mixto (Efectivo + Transferencia)</SelectItem>
                    <SelectItem value="CREDIT">Crédito</SelectItem>
                    <SelectItem value="CORTESIA">Cortesía</SelectItem>
                  </SelectContent>
                </Select>

                {collectMethod === 'MIXED' && collectDialog && (
                  <div className="grid grid-cols-2 gap-2 mt-2 p-3 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-default)] shadow-inner">
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
                          const rest = Math.max(0, (collectDialog.total || 0) - num)
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
                          const rest = Math.max(0, (collectDialog.total || 0) - num)
                          setCollectCashAmount(rest > 0 ? String(rest) : '0')
                        }}
                        className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-9 text-xs font-bold text-blue-500 mt-1"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Referencia de Pago (Opcional)</Label>
                <Input
                  value={collectReference}
                  onChange={e => setCollectReference(e.target.value)}
                  placeholder="Número de aprobación, comprobante, etc."
                  className="h-11 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 transition-all font-semibold"
                />
              </div>

              {/* Checkbox to print invoice */}
              <div className="flex items-center gap-2.5 py-1 px-1">
                <input
                  type="checkbox"
                  id="printInvoiceOnCollect"
                  checked={printInvoiceOnCollect}
                  onChange={e => setPrintInvoiceOnCollect(e.target.checked)}
                  className="h-4.5 w-4.5 accent-[var(--accent)] rounded cursor-pointer shrink-0"
                />
                <Label htmlFor="printInvoiceOnCollect" className="text-xs font-bold text-[var(--text-secondary)] cursor-pointer select-none leading-none">
                  Imprimir factura de caja (Caja)
                </Label>
              </div>

              <div className="flex gap-3 mt-3">
                <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-sm border-[var(--border-default)] hover:bg-[var(--bg-hover)]" onClick={() => setCollectDialog(null)}>
                  Cancelar
                </Button>
                <Button className="flex-1 h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer transition-all" onClick={handleCollectPayment} disabled={isSubmittingPayment}>
                  {isSubmittingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirmar Cobro
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogo de Despacho (Asignación de Domiciliario) */}
      <Dialog open={!!dispatchDialog} onOpenChange={open => { if (!open) { setDispatchDialog(null); setDriverSearch(''); } }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="h-1.5 w-full bg-[var(--accent)]" />
          <div className="p-6">
            <DialogHeader className="pb-3 border-b border-[var(--border-subtle)]/60">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-black flex items-center gap-2">
                <Bike className="h-5.5 w-5.5 text-[var(--accent)] animate-pulse" />
                {dispatchDialog?.order?.status === 'PENDING' ? 'Despachar Domicilio' : 'Asignar Repartidor'}
              </DialogTitle>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-semibold">
                Asigna el domiciliario para el pedido #{dispatchDialog?.order?.orderNumber}
              </p>
            </DialogHeader>

            <div className="space-y-4 pt-4">
              {/* Order quick overview */}
              <div className="bg-[var(--bg-elevated)]/60 border border-[var(--border-subtle)] p-3.5 rounded-2xl text-xs space-y-1.5">
                <p className="font-extrabold text-[var(--text-primary)]">Cliente: {dispatchDialog?.order?.customerName}</p>
                {dispatchDialog?.order?.zone && (
                  <p className="text-[var(--text-muted)] font-medium">
                    Barrio: <span className="font-bold text-[var(--text-secondary)]">{dispatchDialog?.order?.zone.name}</span> (Tarifa flete: {formatCurrency(dispatchDialog?.order?.zone.rate)})
                  </p>
                )}
                <p className="text-[var(--text-secondary)] font-medium truncate">Dirección: {dispatchDialog?.order?.customerAddress}</p>
              </div>

              {!registeringDriverInline ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Selecciona Repartidor *</Label>
                      <span className="text-[10px] text-[var(--text-muted)] font-bold">{filteredDrivers.length} repartidor(es)</span>
                    </div>

                    {/* Buscador en tiempo real de repartidores */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                      <Input
                        value={driverSearch}
                        onChange={e => {
                          const val = e.target.value
                          setDriverSearch(val)
                          const q = val.trim().toLowerCase()
                          if (q) {
                            const auto = drivers.find(d => d.name.toLowerCase().startsWith(q))
                            if (auto) setSelectedDriverId(auto.id)
                          }
                        }}
                        placeholder="Escribe una letra o nombre (ej: p, juan, cristian)..."
                        className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 pl-9 pr-8 focus:border-[var(--accent)] font-semibold"
                        autoFocus
                      />
                      {driverSearch && (
                        <button
                          type="button"
                          onClick={() => setDriverSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Lista interactiva con scroll rápido */}
                    {drivers.length === 0 ? (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500 font-bold">
                        No hay repartidores registrados en este momento. Registra uno nuevo a continuación.
                      </div>
                    ) : (
                      <div className="max-h-52 overflow-y-auto space-y-1 border border-[var(--border-subtle)] rounded-xl p-1 bg-[var(--bg-input)]/50">
                        {filteredDrivers.map(d => {
                          const isSelected = selectedDriverId === d.id
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setSelectedDriverId(d.id)}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer text-left border",
                                isSelected 
                                  ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] shadow-xs" 
                                  : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-transparent"
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <Bike className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-[var(--accent-fg)]" : "text-[var(--accent)]")} />
                                <span>{d.name}</span>
                              </div>
                              {d.activeDeliveries > 0 ? (
                                <span className={cn(
                                  "text-[10px] font-extrabold px-2 py-0.5 rounded-full",
                                  isSelected ? "bg-black/20 text-white" : "text-amber-500 bg-amber-500/10"
                                )}>
                                  ({d.activeDeliveries} activos)
                                </span>
                              ) : (
                                <span className={cn(
                                  "text-[10px] font-extrabold px-2 py-0.5 rounded-full",
                                  isSelected ? "bg-black/20 text-white" : "text-emerald-500 bg-emerald-500/10"
                                )}>
                                  ✓ Libre
                                </span>
                              )}
                            </button>
                          )
                        })}
                        {filteredDrivers.length === 0 && (
                          <div className="p-3 text-center text-xs text-[var(--text-muted)] font-semibold">
                            No se encontró ningún repartidor con "{driverSearch}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {(() => {
                    const selectedDriver = drivers.find(d => d.id === selectedDriverId);
                    if (!selectedDriver) return null;
                    return (
                      <div className="animate-fade-in mt-1">
                        {selectedDriver.activeDeliveries > 0 ? (
                          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] text-blue-400 font-bold flex items-center gap-1.5">
                            <Clock className="h-4 w-4 shrink-0 text-blue-400" />
                            <span>Lleva {selectedDriver.activeDeliveries} pedido(s) asignado(s).</span>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-emerald-500 font-bold flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            <span>Repartidor libre. Listo para despacho.</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <button 
                    type="button"
                    onClick={() => { setRegisteringDriverInline(true); setDispatchError('') }}
                    className="text-xs text-[var(--accent)] hover:underline font-bold text-left block w-full border-0 bg-transparent cursor-pointer"
                  >
                    + ¿Es un repartidor nuevo? Registralo aquí rápido
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5 p-3.5 border border-[var(--accent)]/20 bg-[var(--accent)]/5 rounded-2xl animate-fade-in">
                  <p className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider">Registrar Repartidor Nuevo</p>
                  
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre Completo *</Label>
                    <Input
                      value={inlineDriverName}
                      onChange={e => setInlineDriverName(e.target.value)}
                      placeholder="Ej: David Domicilios"
                      className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 focus:border-[var(--accent)] font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Celular *</Label>
                    <Input
                      value={inlineDriverPhone}
                      onChange={e => setInlineDriverPhone(e.target.value)}
                      placeholder="Ej: 3201234567"
                      className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 focus:border-[var(--accent)] font-semibold"
                    />
                  </div>

                  <button 
                    type="button"
                    onClick={() => setRegisteringDriverInline(false)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-bold text-left block w-full border-0 bg-transparent cursor-pointer"
                  >
                    ← Volver a la lista de repartidores existentes
                  </button>
                </div>
              )}

              {dispatchError && (
                <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-2.5 text-[10px] text-[var(--destructive)] font-semibold leading-relaxed flex items-center gap-1.5 animate-fade-in">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{dispatchError}</span>
                </div>
              )}

              <div className="flex gap-3 mt-4 pt-2 border-t border-[var(--border-subtle)]/40">
                <Button 
                  variant="outline" 
                  className="flex-1 h-12 rounded-xl font-bold text-sm border-[var(--border-default)] hover:bg-[var(--bg-hover)] cursor-pointer" 
                  onClick={() => setDispatchDialog(null)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1 h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer" 
                  onClick={handleConfirmDispatch}
                >
                  {dispatchDialog?.order?.status === 'PENDING' ? 'Despachar e Imprimir' : 'Confirmar'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Order Detail Dialog ── */}
      <Dialog open={!!detailOrder} onOpenChange={() => setDetailOrder(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto p-6">
          {detailOrder && (() => {
            const o = detailOrder
            const phoneDigits = (o.customerPhone || '').replace(/\D/g, '')
            const whatsappMsg = encodeURIComponent(`Hola ${o.customerName}! Tu pedido en The Villa Dog está registrado. Total: ${formatCurrency(o.total)}`)
            const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
            return (
              <div className="space-y-4">
                <DialogHeader className="pb-2 border-b border-[var(--border-subtle)]">
                  <DialogTitle className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="text-2xl font-black text-[var(--text-primary)]">Factura #{o.invoiceNumber || o.orderNumber}</span>
                      <span className="text-xs text-[var(--text-muted)] font-bold ml-2">(Turno #{o.orderNumber})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.orderType === 'PICKUP' ? (
                        <Badge className="bg-purple-600 text-white text-xs px-2.5 py-1 font-black rounded-lg uppercase tracking-wide flex items-center gap-1">
                          <Store className="h-3.5 w-3.5" /> PASAR A RECOGER
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-600 text-white text-xs px-2.5 py-1 font-black rounded-lg uppercase tracking-wide flex items-center gap-1">
                          <Bike className="h-3.5 w-3.5" /> DOMICILIO
                        </Badge>
                      )}
                      <Badge className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
                        style={{ color: getStatusColor(o.status), backgroundColor: `${getStatusColor(o.status)}15`, border: `1px solid ${getStatusColor(o.status)}25` }}>
                        {getStatusLabel(o.status)}
                      </Badge>
                    </div>
                  </DialogTitle>
                </DialogHeader>

                {/* Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2">
                    <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><User className="h-3 w-3" /> Datos del Cliente</p>
                    <p className="text-base font-black text-[var(--text-primary)]">{o.customerName}</p>
                    <a href={`tel:${o.customerPhone}`} className="text-sm font-black text-[var(--accent)] flex items-center gap-1.5 hover:underline bg-[var(--accent)]/10 px-2.5 py-1 rounded-lg w-fit">
                      <Phone className="h-4 w-4" /> {o.customerPhone}
                    </a>
                    <div className="text-sm font-extrabold text-[var(--text-primary)] flex items-start gap-1.5 pt-0.5">
                      <MapPin className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" /> 
                      <div>
                        {o.orderType === 'PICKUP' ? (
                          <span className="text-purple-600 dark:text-purple-400 font-black">Retira en restaurante</span>
                        ) : (
                          <>
                            <span>{o.customerAddress || 'Sin dirección'}</span>
                            {o.zone && <span className="text-xs font-black text-[var(--accent)] ml-1">({o.zone.name})</span>}
                          </>
                        )}
                      </div>
                    </div>
                    {o.addressReference && <p className="text-xs text-[var(--text-secondary)] font-medium italic">Ref: {o.addressReference}</p>}
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-1.5">
                    <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Información de Caja</p>
                    <p className="text-xs text-[var(--text-secondary)]">Atendió: <span className="font-bold text-[var(--text-primary)]">{o.waiter?.name || 'Cajero'}</span></p>
                    <p className="text-xs text-[var(--text-secondary)]">Método de pago: <span className="font-bold">{getStatusLabel(o.paymentMethod)}</span></p>
                    <p className="text-xs text-[var(--text-secondary)]">Estado pago: <span className={`font-bold ${o.paymentStatus === 'CONFIRMED' ? 'text-emerald-600' : 'text-amber-600'}`}>{o.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : 'Pendiente'}</span></p>
                    <p className="text-xs text-[var(--text-secondary)]">Fecha: <span className="font-semibold">{formatDate(o.createdAt)}</span></p>
                  </div>
                </div>

                {/* Cancelled Alert if applicable */}
                {o.status === 'CANCELLED' && (
                  <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-600 space-y-1">
                    <p className="text-xs font-black uppercase flex items-center gap-1"><XCircle className="h-4 w-4" /> Pedido Cancelado</p>
                    {o.cancellationReason && <p className="text-xs italic">Motivo: "{o.cancellationReason}"</p>}
                    {o.cancelledAt && <p className="text-[10px] opacity-80">Fecha anulación: {formatDate(o.cancelledAt)}</p>}
                  </div>
                )}

                {/* Products */}
                {o.items && o.items.length > 0 && (
                  <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2">
                    <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" /> Productos y Adiciones</p>
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

                {/* Financial Totals */}
                <div className="p-3.5 rounded-2xl bg-[var(--accent)]/5 border border-[var(--accent)]/20 space-y-1">
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>Subtotal</span><span className="font-bold">{formatCurrency(o.subtotal)}</span>
                  </div>
                  {o.deliveryFee > 0 && (
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>Domicilio</span><span className="font-bold">{formatCurrency(o.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-[var(--text-primary)] pt-1.5 border-t border-[var(--accent)]/20">
                    <span>TOTAL FACTURA</span><span className="text-[var(--accent)] text-base">{formatCurrency(o.total)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl h-10 font-bold text-xs cursor-pointer" onClick={() => setDetailOrder(null)}>
                    Cerrar
                  </Button>
                  {o.paymentStatus !== 'CONFIRMED' && o.status !== 'CANCELLED' && (
                    <Button 
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl h-10 px-4 text-xs gap-1.5 cursor-pointer shadow-md shadow-emerald-600/15"
                      onClick={() => {
                        const target = o;
                        setDetailOrder(null);
                        setCollectDialog({ id: target.id, orderNumber: target.orderNumber, total: target.total, method: target.paymentMethod || 'CASH' });
                      }}
                    >
                      <DollarSign className="h-4 w-4" /> Cobrar Pedido
                    </Button>
                  )}
                  {o.status !== 'CANCELLED' && (
                    <Link to={o.tableId ? `/tables/new?tableId=${o.tableId}&editOrderId=${o.id}` : `/orders/new?edit=${o.id}`}>
                      <Button variant="outline" className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10 font-bold rounded-xl h-10 px-4 text-xs gap-1.5 cursor-pointer">
                        <Edit className="h-4 w-4" /> Editar Pedido
                      </Button>
                    </Link>
                  )}
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl h-10 px-4 text-xs gap-1.5 cursor-pointer shadow-md shadow-blue-600/15"
                    onClick={async () => {
                      const orderWithDriver = {
                        ...o,
                        deliveryDriver: o.deliveryDriver || (o.deliveryDriverId ? drivers.find(d => d.id === o.deliveryDriverId) : undefined)
                      };
                      alerts.toast(`Enviando pedido #${o.orderNumber} a impresión...`, 'info');
                      const res = await printComandaSmart(orderWithDriver, 'caja', user?.role, false, false);
                      if (res?.error) {
                        alerts.error('Error al imprimir', res.error);
                      } else {
                        alerts.toast(`Pedido #${o.orderNumber} enviado a la impresora`, 'success');
                      }
                    }}>
                    <Printer className="h-4 w-4" /> Imprimir Factura
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

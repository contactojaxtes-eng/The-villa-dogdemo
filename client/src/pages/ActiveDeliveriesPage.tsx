import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { statusAccent, statusOrder } from '@/lib/brand'
import { formatCurrency, formatDate, formatTimeOnly, getStatusColor, getStatusLabel, cleanNotes, groupOrderItems, formatThousandsInput, parseThousandsInput, cn } from '@/lib/utils'
import { 
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
  AlertTriangle,
  Send,
  Store,
  MessageSquare,
  ChevronDown,
  Check,
  ListFilter
} from 'lucide-react'
import { type Socket } from 'socket.io-client'
import { io } from '@/lib/socket'
import { printComandaSmart, openCashDrawer } from '@/lib/printer'
import { alerts } from '@/lib/alerts'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import OrderWhatsAppModal from '@/components/orders/OrderWhatsAppModal'

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
  updatedAt?: string
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
  cashAmount?: number | null
  transferAmount?: number | null
}

const IMPOCONSUMO_RATE = 0.08
const activeStatuses = ['PENDING', 'READY', 'IN_ROUTE']
const DISPATCH_WARNING_MINUTES = 10
const DISPATCH_ALERT_MINUTES = 15

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
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function getElapsedMinutes(createdAt: string): number {
  const timestamp = new Date(createdAt).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
}

function isWaitingForDispatch(order: Order): boolean {
  return ['RECEIVED', 'PENDING', 'READY'].includes(order.status)
}

function isReadyForCollection(order: Order): boolean {
  if (order.orderType === 'DELIVERY') return order.status === 'IN_ROUTE'
  if (order.orderType === 'PICKUP') return order.status === 'READY'
  return false
}

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
}

function getOrderBreakdown(order: Order) {
  const method = (order.paymentMethod || 'CASH').toUpperCase()
  const total = Number(order.total) || 0
  let cash = 0
  let transfer = 0

  if (method === 'CASH') {
    cash = total
    transfer = 0
  } else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) {
    transfer = total
    cash = 0
  } else if (method === 'MIXED') {
    const rawCash = typeof order.cashAmount === 'number' && order.cashAmount > 0 ? order.cashAmount : Math.round(total / 2)
    cash = Math.min(total, Math.max(0, rawCash))
    transfer = typeof order.transferAmount === 'number' && order.transferAmount > 0
      ? order.transferAmount
      : Math.max(0, total - cash)
  }
  return { cash, transfer, total }
}

export default function ActiveDeliveriesPage() {
  const { user, hasPermission } = useAuth()
  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(user?.role || '')
  const isDeliveryStaff = !isAdmin && (
    ['DELIVERY_MANAGER', 'DISPATCHER'].includes(user?.role || '') ||
    Boolean(user?.role && /dispatch|domicil/i.test(user.role))
  )
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '')
  const [submittedSearch, setSubmittedSearch] = useState(() => searchParams.get('search') || '')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'READY' | 'IN_ROUTE'>('ALL')
  const [clockTick, setTick] = useState(0)
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
  const [dispatchDialog, setDispatchDialog] = useState<{ order: any; shouldKick: boolean } | null>(null)
  const [drivers, setDrivers] = useState<any[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string>('')
  const [selectedDriverFilter, setSelectedDriverFilter] = useState<string>('ALL')
  const [driverFilterOpen, setDriverFilterOpen] = useState(false)
  const [driverFilterQuery, setDriverFilterQuery] = useState('')
  const [driverSearch, setDriverSearch] = useState<string>('')
  const [inlineDriverName, setInlineDriverName] = useState('')
  const [inlineDriverPhone, setInlineDriverPhone] = useState('')
  const [registeringDriverInline, setRegisteringDriverInline] = useState(false)
  const [dispatchError, setDispatchError] = useState('')

  const allAvailableDrivers = useMemo(() => {
    const list = [...drivers]
    for (const ord of orders) {
      if (ord.deliveryDriver && !list.some(d => d.id === ord.deliveryDriver!.id)) {
        list.push(ord.deliveryDriver)
      }
    }
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [drivers, orders])

  const selectedFilterDriver = useMemo(
    () => allAvailableDrivers.find(driver => driver.id === selectedDriverFilter),
    [allAvailableDrivers, selectedDriverFilter]
  )

  const driverOrderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const order of orders) {
      const driverId = order.deliveryDriverId || order.deliveryDriver?.id
      if (driverId) counts.set(driverId, (counts.get(driverId) || 0) + 1)
    }
    return counts
  }, [orders])

  const unassignedOrdersCount = useMemo(
    () => orders.filter(order => !order.deliveryDriverId && !order.deliveryDriver).length,
    [orders]
  )

  const driverFilterResults = useMemo(() => {
    const query = driverFilterQuery.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (!query) return allAvailableDrivers
    return allAvailableDrivers.filter(driver => {
      const haystack = `${driver.name || ''} ${driver.phone || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
      return haystack.includes(query)
    })
  }, [allAvailableDrivers, driverFilterQuery])

  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [batchDispatchOpen, setBatchDispatchOpen] = useState(false)
  const [batchDriverId, setBatchDriverId] = useState('')
  const [batchDriverSearch, setBatchDriverSearch] = useState('')
  const [batchAutoPrint, setBatchAutoPrint] = useState(true)
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false)
  const [batchError, setBatchError] = useState('')

  const [batchCollectOpen, setBatchCollectOpen] = useState(false)
  const [batchCollectMode, setBatchCollectMode] = useState<'AS_IS' | 'CASH' | 'TRANSFER' | 'MANUAL'>('AS_IS')
  const [batchCollectReference, setBatchCollectReference] = useState('')
  const [batchCollectDrawerKick, setBatchCollectDrawerKick] = useState(true)
  const [isSubmittingBatchCollect, setIsSubmittingBatchCollect] = useState(false)
  const [batchCollectError, setBatchCollectError] = useState('')
  const [manualItemMethods, setManualItemMethods] = useState<Record<string, { method: string; cashAmount?: number; transferAmount?: number }>>({})
  const [reviewedTransferIds, setReviewedTransferIds] = useState<string[]>([])

  const filteredDrivers = useMemo(() => {
    if (!driverSearch.trim()) return drivers
    const q = driverSearch.trim().toLowerCase()
    return drivers.filter(d => 
      (d.name && d.name.toLowerCase().includes(q)) || 
      (d.phone && d.phone.includes(q))
    )
  }, [driverSearch, drivers])

  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [chatModalOrder, setChatModalOrder] = useState<Order | null>(null)
  const [markingPickupReadyId, setMarkingPickupReadyId] = useState<string | null>(null)
  const [paymentEditDialog, setPaymentEditDialog] = useState<Order | null>(null)
  const [editMethod, setEditMethod] = useState<string>('CASH')
  const [editCashAmount, setEditCashAmount] = useState<string>('')
  const [editTransferAmount, setEditTransferAmount] = useState<string>('')
  const [editReference, setEditReference] = useState<string>('')
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const driverFilterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeDriverFilter = (event: MouseEvent) => {
      if (driverFilterRef.current && !driverFilterRef.current.contains(event.target as Node)) {
        setDriverFilterOpen(false)
      }
    }

    const closeDriverFilterWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDriverFilterOpen(false)
    }

    document.addEventListener('mousedown', closeDriverFilter)
    document.addEventListener('keydown', closeDriverFilterWithEscape)
    return () => {
      document.removeEventListener('mousedown', closeDriverFilter)
      document.removeEventListener('keydown', closeDriverFilterWithEscape)
    }
  }, [])

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
      if (shouldKick) {
        await openCashDrawer().catch(() => {})
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

  useEffect(() => {
    if (paymentEditDialog) {
      const m = paymentEditDialog.paymentMethod || 'CASH'
      setEditMethod(m)
      setEditReference('')
      const tot = paymentEditDialog.total || 0
      if (m === 'MIXED') {
        const cash = (paymentEditDialog as any).cashAmount || Math.round(tot / 2)
        setEditCashAmount(String(cash))
        setEditTransferAmount(String(tot - cash))
      } else {
        const half = Math.round(tot / 2)
        setEditCashAmount(String(half))
        setEditTransferAmount(String(tot - half))
      }
    }
  }, [paymentEditDialog])

  const handleSavePaymentMethod = async () => {
    if (!paymentEditDialog || isDeliveryStaff) return
    setIsSavingPaymentMethod(true)
    try {
      const isMixed = editMethod === 'MIXED'
      const cashVal = isMixed ? (parseFloat(editCashAmount) || 0) : undefined
      const transferVal = isMixed ? (parseFloat(editTransferAmount) || 0) : undefined

      await api.put(`/orders/${paymentEditDialog.id}/payment`, {
        method: editMethod,
        paymentStatus: paymentEditDialog.paymentStatus,
        reference: editReference || undefined,
        cashAmount: cashVal,
        transferAmount: transferVal,
      })

      alerts.success(
        'Método de Pago Actualizado',
        `Pedido #${paymentEditDialog.orderNumber} ahora está configurado como ${getStatusLabel(editMethod)}.`
      )
      setPaymentEditDialog(null)
      loadOrders(false, true)
    } catch (err: any) {
      alerts.error('Error al actualizar método de pago', err.message || 'No se pudo actualizar.')
    } finally {
      setIsSavingPaymentMethod(false)
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
      loadOrders(false, true)
    } catch (err: any) {
      console.error('Error al marcar pedido listo:', err)
      alerts.error('Error', err.message || 'No se pudo marcar el pedido como listo.')
    } finally {
      setMarkingPickupReadyId(null)
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

      const orderToUpdate = dispatchDialog.order
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

  const loadOrders = useCallback((silent = false, force = false) => {
    if (!silent) setLoading(true)
    const params = new URLSearchParams()
    if (submittedSearch) params.set('search', submittedSearch)
    api.get<Order[]>(`/orders/active?${params.toString()}`, { force })
      .then(data => {
        const deliveryOnly = (data || []).filter(o => 
          !o.tableId && 
          o.orderType !== 'LOCAL' && 
          o.source !== 'TABLE' && 
          o.source !== 'OFFLINE_TABLE' &&
          (!isDeliveryStaff || o.orderType !== 'PICKUP')
        )
        setOrders(deliveryOnly)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [submittedSearch, isDeliveryStaff])

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
      loadOrders(true, true)
      loadDrivers()
    })
    socket.on('orderStatusChanged', (data: { orderId: string; status: string; order?: any }) => {
      if (data && data.orderId) {
        if (
          data.order?.tableId || 
          data.order?.orderType === 'LOCAL' || 
          data.order?.source === 'TABLE' || 
          data.order?.source === 'OFFLINE_TABLE' ||
          (isDeliveryStaff && data.order?.orderType === 'PICKUP')
        ) {
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
      loadOrders(true, true)
      loadDrivers()
    })

    socket.on('orderUpdated', (updatedOrder: any) => {
      if (updatedOrder && updatedOrder.id) {
        if (
          updatedOrder.tableId || 
          updatedOrder.orderType === 'LOCAL' || 
          updatedOrder.source === 'TABLE' || 
          updatedOrder.source === 'OFFLINE_TABLE' ||
          (isDeliveryStaff && updatedOrder.orderType === 'PICKUP')
        ) {
          setOrders(prev => prev.filter(o => o.id !== updatedOrder.id))
        } else {
          setOrders(prev => prev.map(o => o.id === updatedOrder.id ? { ...o, ...updatedOrder } : o))
        }
        setDetailOrder(prev => (prev && prev.id === updatedOrder.id) ? { ...prev, ...updatedOrder } : prev)
      }
      loadOrders(true, true)
      loadDrivers()
    })

    socket.on('paymentUpdated', () => {
      loadOrders(true, true)
      loadDrivers()
    })

    socket.on('driversChanged', () => {
      loadDrivers()
    })

    return () => { socket.disconnect() }
  }, [user, loadOrders, loadDrivers])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmittedSearch(searchQuery.trim())
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

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

  // Búsqueda instantánea y filtro por repartidor en tiempo real.
  // Incluye nombre de cliente, teléfono, barrio, dirección, domiciliario y productos.
  const visibleOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const matchingOrders = orders.filter(order => {
      // 0. Si es personal de domicilio, ocultar SIEMPRE pasar a recoger (solo admin)
      if (isDeliveryStaff && order.orderType === 'PICKUP') return false

      // 1. Filtro por dropdown de repartidor
      if (selectedDriverFilter === 'UNASSIGNED') {
        if (order.deliveryDriverId || order.deliveryDriver) return false
      } else if (selectedDriverFilter !== 'ALL') {
        const dId = order.deliveryDriverId || order.deliveryDriver?.id
        if (dId !== selectedDriverFilter) return false
      }

      // 2. Buscador en tiempo real por texto (cliente, teléfono, dirección, barrio, domiciliario, producto)
      if (query) {
        const itemText = (order.items || []).map(item => item.menuItem?.name || '').join(' ')
        const haystack = [
          order.orderNumber,
          order.customerName,
          order.customerPhone,
          order.customerAddress,
          order.addressReference,
          order.zone?.name,
          order.deliveryDriver?.name,
          order.deliveryDriver?.phone,
          itemText,
        ].filter(Boolean).join(' ').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (!haystack.includes(query)) return false
      }

      return true
    })

    // Cola FIFO: el pedido que entró primero permanece arriba y cada pedido
    // nuevo se agrega al final, incluso después de refrescos por Socket.IO.
    return matchingOrders.sort((a, b) => {
      const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return byTime || a.orderNumber - b.orderNumber
    })
  }, [orders, searchQuery, selectedDriverFilter, isDeliveryStaff])

  const statusVisibleOrders = useMemo(() => {
    if (statusFilter === 'PENDING') return visibleOrders.filter(o => o.status === 'RECEIVED' || o.status === 'PENDING')
    if (statusFilter === 'READY') return visibleOrders.filter(o => o.status === 'READY')
    if (statusFilter === 'IN_ROUTE') return visibleOrders.filter(o => o.status === 'IN_ROUTE')
    return visibleOrders
  }, [visibleOrders, statusFilter])

  const filteredBatchDrivers = useMemo(() => {
    if (!batchDriverSearch.trim()) return drivers
    const q = batchDriverSearch.trim().toLowerCase()
    return drivers.filter(d => 
      (d.name && d.name.toLowerCase().includes(q)) || 
      (d.phone && d.phone.includes(q))
    )
  }, [batchDriverSearch, drivers])

  const selectableOrders = useMemo(() => {
    return statusVisibleOrders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status))
  }, [statusVisibleOrders])

  const handleToggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleToggleSelectAll = () => {
    const allIds = selectableOrders.map(o => o.id)
    if (allIds.length > 0 && allIds.every(id => selectedOrderIds.includes(id))) {
      setSelectedOrderIds(prev => prev.filter(id => !allIds.includes(id)))
    } else {
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...allIds])))
    }
  }

  const handleConfirmBatchDispatch = async () => {
    if (!batchDriverId) {
      setBatchError('Debes seleccionar un repartidor para asignar los pedidos.')
      return
    }
    if (selectedOrderIds.length === 0) return

    setIsSubmittingBatch(true)
    setBatchError('')

    try {
      const selectedOrdersList = orders.filter(o => selectedOrderIds.includes(o.id))
      
      try {
        await api.put<any>('/orders/batch-dispatch', {
          orderIds: selectedOrderIds,
          deliveryDriverId: batchDriverId,
        })
      } catch (endpointErr) {
        await Promise.all(selectedOrdersList.map(o => {
          const nextStatus = (o.status === 'PENDING' || o.status === 'READY') ? 'IN_ROUTE' : o.status
          return api.put(`/orders/${o.id}/status`, {
            status: nextStatus,
            deliveryDriverId: batchDriverId
          })
        }))
      }

      if (batchAutoPrint) {
        for (const ord of selectedOrdersList) {
          if (ord.status === 'PENDING') {
            try {
              await printComandaSmart({
                ...ord,
                status: 'IN_ROUTE',
                deliveryDriver: drivers.find(driver => driver.id === batchDriverId) || ord.deliveryDriver,
              }, 'caja', user?.role, false, false)
            } catch (pErr) {
              console.warn('Error imprimiendo comanda en lote:', pErr)
            }
          }
        }
      }

      alerts.success(
        'Pedidos Asignados',
        `Se asignaron ${selectedOrderIds.length} pedidos al domiciliario correctamente.`
      )

      setSelectedOrderIds([])
      setBatchDispatchOpen(false)
      setBatchDriverId('')
      setBatchDriverSearch('')
      loadOrders(false, true)
      loadDrivers()
    } catch (err: any) {
      setBatchError(err.message || 'Error al despachar pedidos en lote')
    } finally {
      setIsSubmittingBatch(false)
    }
  }

  const selectedOrdersList = useMemo(() => {
    return orders.filter(o => selectedOrderIds.includes(o.id))
  }, [orders, selectedOrderIds])

  const getBatchOrderMethod = useCallback((order: Order) => {
    return (manualItemMethods[order.id]?.method || order.paymentMethod || 'CASH').toUpperCase()
  }, [manualItemMethods])

  const batchOrdersByPayment = useMemo(() => {
    const cash: Order[] = []
    const transfer: Order[] = []
    const mixedOrOther: Order[] = []

    for (const order of selectedOrdersList) {
      const method = getBatchOrderMethod(order)
      if (method === 'CASH') cash.push(order)
      else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) transfer.push(order)
      else mixedOrOther.push(order)
    }

    return { cash, transfer, mixedOrOther }
  }, [getBatchOrderMethod, selectedOrdersList])

  const transferOrdersRequiringReview = useMemo(() => {
    return selectedOrdersList.filter(order => {
      const method = getBatchOrderMethod(order)
      if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) return true
      if (method !== 'MIXED') return false
      const custom = manualItemMethods[order.id]
      return Number(custom?.transferAmount ?? order.transferAmount ?? 0) > 0
    })
  }, [getBatchOrderMethod, manualItemMethods, selectedOrdersList])

  const unreviewedTransferOrders = useMemo(() => {
    return transferOrdersRequiringReview.filter(order => !reviewedTransferIds.includes(order.id))
  }, [reviewedTransferIds, transferOrdersRequiringReview])

  const batchCollectTotals = useMemo(() => {
    let cash = 0
    let transfer = 0
    let total = 0

    for (const ord of selectedOrdersList) {
      const ordTotal = ord.total || 0
      total += ordTotal

      const custom = manualItemMethods[ord.id]
      if (custom) {
        const m = (custom.method || ord.paymentMethod || 'CASH').toUpperCase()
        if (m === 'CASH') {
          cash += ordTotal
        } else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m)) {
          transfer += ordTotal
        } else if (m === 'MIXED') {
          const c = typeof custom.cashAmount === 'number' ? custom.cashAmount : (ord.cashAmount || Math.round(ordTotal / 2))
          cash += c
          transfer += typeof custom.transferAmount === 'number' ? custom.transferAmount : Math.max(0, ordTotal - c)
        }
      } else if (batchCollectMode === 'CASH') {
        cash += ordTotal
      } else if (batchCollectMode === 'TRANSFER') {
        transfer += ordTotal
      } else if (batchCollectMode === 'MANUAL') {
        const custom = manualItemMethods[ord.id]
        const m = (custom?.method || ord.paymentMethod || 'CASH').toUpperCase()
        if (m === 'CASH') {
          cash += ordTotal
        } else if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m)) {
          transfer += ordTotal
        } else if (m === 'MIXED') {
          const c = typeof custom?.cashAmount === 'number' ? custom.cashAmount : (ord.cashAmount || Math.round(ordTotal / 2))
          cash += c
          transfer += (ordTotal - c)
        }
      } else {
        // 'AS_IS'
        const b = getOrderBreakdown(ord)
        cash += b.cash
        transfer += b.transfer
      }
    }

    return { cash, transfer, total, count: selectedOrdersList.length }
  }, [selectedOrdersList, batchCollectMode, manualItemMethods])

  const handleConfirmBatchCollect = async () => {
    if (selectedOrderIds.length === 0) return
    if (unreviewedTransferOrders.length > 0) {
      setBatchCollectError(`Falta validar ${unreviewedTransferOrders.length} transferencia${unreviewedTransferOrders.length === 1 ? '' : 's'}. Abre el chat/comprobante y marca cada una como revisada.`)
      return
    }
    setIsSubmittingBatchCollect(true)
    setBatchCollectError('')

    try {
      const itemsPayload = selectedOrdersList.map(ord => {
        const custom = manualItemMethods[ord.id]
        const method = custom?.method || (batchCollectMode === 'CASH'
          ? 'CASH'
          : batchCollectMode === 'TRANSFER'
            ? 'TRANSFER'
            : (ord.paymentMethod || 'CASH'))
        const ordTotal = Number(ord.total) || 0
        const isCash = method === 'CASH'
        const isTransfer = ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)
        const hasTransferPart = isTransfer || (method === 'MIXED' && Number(custom?.transferAmount ?? ord.transferAmount ?? 0) > 0)
        return {
          id: ord.id,
          method,
          reference: batchCollectReference || undefined,
          cashAmount: isCash ? ordTotal : method === 'MIXED' ? (custom?.cashAmount ?? ord.cashAmount ?? Math.round(ordTotal / 2)) : 0,
          transferAmount: isTransfer ? ordTotal : method === 'MIXED' ? (custom?.transferAmount ?? ord.transferAmount ?? Math.round(ordTotal / 2)) : 0,
          transferReviewed: !hasTransferPart || reviewedTransferIds.includes(ord.id),
        }
      })

      const batchResult = await api.put<any>('/orders/batch-collect', {
        orders: itemsPayload,
        globalMethod: 'AS_IS',
        globalReference: batchCollectReference || undefined,
      })

      if (batchResult && Number(batchResult?.collectedCount ?? itemsPayload.length) !== itemsPayload.length) {
        const collectedCount = Number(batchResult?.collectedCount || 0)
        const failedCount = Number(batchResult?.failedCount ?? (itemsPayload.length - collectedCount))
        loadOrders(false, true)
        throw new Error(`Se cobraron ${collectedCount} pedidos, pero ${failedCount} no pudieron liquidarse. Revisa la lista actualizada antes de reintentar.`)
      }

      const hadCash = batchCollectTotals.cash > 0
      if (batchCollectDrawerKick && hadCash) {
        try {
          await openCashDrawer()
        } catch (cErr) {
          console.warn('No se pudo abrir el cajón:', cErr)
        }
      }

      alerts.success(
        'Cobro Masivo Exitoso',
        `Se cobraron ${selectedOrdersList.length} pedidos por un total de ${formatCurrency(batchCollectTotals.total)}.`
      )

      setSelectedOrderIds([])
      setBatchCollectOpen(false)
      setBatchCollectMode('AS_IS')
      setBatchCollectReference('')
      setManualItemMethods({})
      setReviewedTransferIds([])
      loadOrders(false, true)
    } catch (err: any) {
      console.error('Error en cobro masivo:', err)
      setBatchCollectError(err.message || 'Error al procesar el cobro masivo.')
      loadOrders(false, true)
    } finally {
      setIsSubmittingBatchCollect(false)
    }
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
    let cash = 0
    let transfer = 0
    let total = 0

    for (const order of visibleOrders) {
      const breakdown = getOrderBreakdown(order)
      cash += breakdown.cash
      transfer += breakdown.transfer
      total += breakdown.total
    }

    return {
      total,
      cash,
      transfer,
      active: visibleOrders.filter(order => activeStatuses.includes(order.status)).length,
      delivered: visibleOrders.filter(order => order.status === 'DELIVERED').length,
      urgent: visibleOrders.filter(order => isWaitingForDispatch(order) && getElapsedMinutes(order.createdAt) >= DISPATCH_ALERT_MINUTES).length,
    }
  }, [visibleOrders, clockTick])

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

  const setBatchPaymentMethod = (order: Order, method: 'CASH' | 'TRANSFER') => {
    const total = Number(order.total) || 0
    setManualItemMethods(previous => ({
      ...previous,
      [order.id]: {
        method,
        cashAmount: method === 'CASH' ? total : 0,
        transferAmount: method === 'TRANSFER' ? total : 0,
      },
    }))
    if (method === 'CASH') {
      setReviewedTransferIds(previous => previous.filter(id => id !== order.id))
    }
    setBatchCollectError('')
  }

  const renderBatchPaymentRow = (order: Order, requiresTransferReview = false) => {
    const method = getBatchOrderMethod(order)
    const reviewed = reviewedTransferIds.includes(order.id)
    return (
      <div key={order.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-black text-[var(--accent)]">#{order.orderNumber}</span>
              <span className="truncate text-xs font-bold text-[var(--text-primary)]">{order.customerName || 'Cliente'}</span>
            </div>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-[var(--text-muted)]">
              {order.deliveryDriver?.name ? `Domiciliario: ${order.deliveryDriver.name}` : 'Sin domiciliario asignado'}
            </p>
          </div>
          <span className="shrink-0 text-sm font-black tabular-nums text-[var(--text-primary)]">{formatCurrency(order.total)}</span>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setBatchPaymentMethod(order, 'CASH')}
            className={cn(
              'h-8 rounded-lg border text-[10px] font-black transition-all cursor-pointer',
              method === 'CASH'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:border-emerald-500/50'
            )}
          >
            💵 Efectivo
          </button>
          <button
            type="button"
            onClick={() => setBatchPaymentMethod(order, 'TRANSFER')}
            className={cn(
              'h-8 rounded-lg border text-[10px] font-black transition-all cursor-pointer',
              ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:border-blue-500/50'
            )}
          >
            📱 Transferencia
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
          <button
            type="button"
            onClick={() => setChatModalOrder(order)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 px-2.5 text-[10px] font-black text-emerald-600 transition-colors hover:bg-emerald-500/10 cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Ver chat y comprobante
          </button>
          {requiresTransferReview && (
            <label className={cn(
              'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-black transition-colors',
              reviewed
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700'
            )}>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={event => {
                  setReviewedTransferIds(previous => event.target.checked
                    ? Array.from(new Set([...previous, order.id]))
                    : previous.filter(id => id !== order.id))
                  setBatchCollectError('')
                }}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              {reviewed ? 'Validada' : 'Validar'}
            </label>
          )}
        </div>
      </div>
    )
  }

  const renderAdminOrderCard = (order: Order, queueIndex: number) => {
    const elapsed = getElapsedTime(order.createdAt)
    const elapsedMinutes = getElapsedMinutes(order.createdAt)
    const routeElapsed = getElapsedTime(order.updatedAt || order.createdAt)
    const waitingForDispatch = isWaitingForDispatch(order)
    const isUrgent = waitingForDispatch && elapsedMinutes >= DISPATCH_ALERT_MINUTES
    const isWarning = waitingForDispatch && !isUrgent && elapsedMinutes >= DISPATCH_WARNING_MINUTES
    const queuePosition = visibleOrders.findIndex(item => item.id === order.id) + 1
    const isSelected = selectedOrderIds.includes(order.id)
    const isSelectable = order.orderType === 'DELIVERY' && !['DELIVERED', 'CANCELLED'].includes(order.status)
    const paymentLabel = order.paymentMethod === 'CASH' ? '💵 Efectivo' :
      order.paymentMethod === 'TRANSFER' ? '📱 Transferencia' :
      order.paymentMethod === 'NEQUI' ? '💜 Nequi' :
      order.paymentMethod === 'BANCOLOMBIA' ? '💛 Bancolombia' :
      order.paymentMethod === 'DAVIPLATA' ? '❤️ Daviplata' :
      order.paymentMethod === 'MIXED' ? '🔀 Mixto' :
      order.paymentMethod === 'CREDIT' ? '💳 Crédito' :
      order.paymentMethod === 'CORTESIA' ? '🎁 Cortesía' :
      getStatusLabel(order.paymentMethod)

    const openDriverAssignment = () => {
      setSelectedDriverId(order.deliveryDriverId || '')
      setRegisteringDriverInline(false)
      setInlineDriverName('')
      setInlineDriverPhone('')
      setDispatchError('')
      setDispatchDialog({ order, shouldKick: false })
    }

    const printOrder = async () => {
      const orderWithDriver = {
        ...order,
        deliveryDriver: order.deliveryDriver || (order.deliveryDriverId ? drivers.find(driver => driver.id === order.deliveryDriverId) : undefined),
      }
      alerts.toast(`Enviando pedido #${order.orderNumber} a impresión...`)
      const result = await printComandaSmart(orderWithDriver, 'caja', user?.role, false, false)
      if (result?.error) alerts.error('Error al imprimir', result.error)
      else alerts.toast(`Pedido #${order.orderNumber} enviado a la impresora`)
    }

    return (
      <motion.article
        key={order.id}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          'overflow-hidden rounded-2xl border bg-[var(--bg-panel)] shadow-sm',
          isSelected
            ? 'border-[var(--accent)]/45 bg-[var(--accent)]/[0.04]'
            : isUrgent
              ? 'border-red-500/30 bg-red-500/[0.04]'
              : isWarning
                ? 'border-amber-500/25 bg-amber-500/[0.03]'
                : 'border-[var(--border-subtle)]'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {isSelectable ? (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggleSelectOrder(order.id)}
                className="h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
                title={`Seleccionar pedido #${order.orderNumber}`}
              />
            ) : <span className="w-4 shrink-0 text-center text-[var(--text-muted)]">—</span>}
            <span className={cn(
              'flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-1 text-[10px] font-black',
              isUrgent ? 'bg-red-600 text-white' : isWarning ? 'bg-amber-500 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
            )}>{queuePosition || queueIndex + 1}º</span>
            <button
              type="button"
              onClick={() => setChatModalOrder(order)}
              className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-sm font-black text-[var(--accent)] hover:underline"
              title={`Abrir WhatsApp del pedido #${order.orderNumber}`}
            >
              #{order.orderNumber}<MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
            </button>
          </div>
          <div className="shrink-0 text-right">
            <p className="whitespace-nowrap text-base font-black tabular-nums text-[var(--text-primary)]">{formatCurrency(order.total)}</p>
            <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Total</p>
          </div>
        </div>

        <div className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(
              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase',
              order.orderType === 'PICKUP'
                ? 'border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                : 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300'
            )}>{order.orderType === 'PICKUP' ? '🏠 Recoger' : '🛵 Domicilio'}</span>
            <span
              className="inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-extrabold uppercase"
              style={{ color: getStatusColor(order.status), backgroundColor: `${getStatusColor(order.status)}15`, borderColor: `${getStatusColor(order.status)}25` }}
            >{getStatusLabel(order.status)}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl bg-[var(--bg-subtle)] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Cliente</p>
              <p className="mt-1 truncate text-sm font-black text-[var(--text-primary)]">{order.customerName}</p>
              <a href={`tel:${order.customerPhone}`} className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--accent)]/15 bg-[var(--accent)]/[0.06] px-2 py-1 text-xs font-black tracking-wide text-[var(--accent)] hover:underline">
                <Phone className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{order.customerPhone}</span>
              </a>
            </section>

            <section className="rounded-xl bg-[var(--bg-subtle)] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Entrega</p>
              {order.orderType === 'PICKUP' ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-black uppercase text-purple-700 dark:text-purple-300">
                  <Store className="h-4 w-4" /> Retira en restaurante
                </p>
              ) : (
                <div className="mt-1 space-y-1">
                  {order.zone && <p className="flex items-center gap-1 text-[10px] font-black uppercase text-[var(--accent)]"><MapPin className="h-3.5 w-3.5" />{order.zone.name}</p>}
                  <p className="text-[13px] font-extrabold leading-snug text-[var(--text-primary)]">{order.customerAddress || 'Sin dirección'}</p>
                  {order.addressReference && <p className="truncate text-[11px] font-semibold italic text-[var(--text-muted)]">Ref: {order.addressReference}</p>}
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <section className="rounded-xl border border-[var(--border-subtle)] p-2.5">
              <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Domiciliario</p>
              <div className="mt-1.5">
                {order.orderType === 'PICKUP' || order.orderType === 'LOCAL' ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-700">{order.orderType === 'PICKUP' ? 'Pasar a recoger' : 'Mostrador'}</span>
                    {hasPermission('dispatch.change_status') && order.orderType === 'PICKUP' && !['READY', 'DELIVERED', 'CANCELLED'].includes(order.status) && (
                      <Button size="sm" onClick={() => handleMarkPickupReady(order)} disabled={markingPickupReadyId === order.id} className="h-7 gap-1 rounded-lg border-0 bg-emerald-600 px-2 text-[10px] font-extrabold text-white hover:bg-emerald-700">
                        {markingPickupReadyId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Listo
                      </Button>
                    )}
                  </div>
                ) : hasPermission('dispatch.change_status') ? (
                  <button
                    type="button"
                    onClick={openDriverAssignment}
                    className={cn(
                      'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black',
                      order.deliveryDriver
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                    )}
                  ><Bike className="h-3.5 w-3.5" /><span className="truncate">{order.deliveryDriver?.name || 'Asignar'}</span></button>
                ) : <span className="text-xs font-bold text-[var(--text-secondary)]">{order.deliveryDriver?.name || 'Sin domiciliario'}</span>}
                {order.deliveryDriver && order.updatedAt && <p className="mt-1 text-[9px] font-bold text-emerald-600">Salió: {formatTimeOnly(order.updatedAt)}</p>}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border-subtle)] p-2.5">
              <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Tiempo</p>
              <div className="mt-1.5">
                <span className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black',
                  order.status === 'IN_ROUTE' || order.deliveryDriver
                    ? 'border-blue-500/25 bg-blue-500/10 text-blue-700'
                    : order.orderType === 'PICKUP'
                      ? 'border-purple-500/25 bg-purple-500/10 text-purple-700'
                      : isUrgent
                        ? 'border-red-600 bg-red-600 text-white'
                        : isWarning ? 'border-amber-500/25 bg-amber-500/10 text-amber-700' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                )}>
                  <Clock className="h-3 w-3" />
                  {order.status === 'IN_ROUTE' || order.deliveryDriver
                    ? `En ruta · ${routeElapsed}`
                    : order.orderType === 'PICKUP'
                      ? order.status === 'READY' ? 'Listo' : `Espera · ${elapsed}`
                      : isUrgent ? `Debe salir · ${elapsed}` : isWarning ? `Por salir · ${elapsed}` : `Espera · ${elapsed}`}
                </span>
                <p className="mt-1 text-[9px] font-semibold text-[var(--text-muted)]">{order.status === 'IN_ROUTE' || order.deliveryDriver ? `Salió ${formatTimeOnly(order.updatedAt)}` : `Pedido ${formatTimeOnly(order.createdAt)}`}</p>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border-subtle)] p-2.5">
              <p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Pago</p>
              <button type="button" onClick={() => setPaymentEditDialog(order)} className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-extrabold text-[var(--text-primary)]">
                <span className="truncate">{paymentLabel}</span><Edit className="h-2.5 w-2.5 shrink-0 text-[var(--accent)]" />
              </button>
              <p className={cn(
                'mt-1 w-fit rounded-md px-1.5 py-0.5 text-[9px] font-bold',
                order.paymentStatus === 'CONFIRMED'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : order.paymentStatus === 'DRIVER_CASH_PENDING'
                    ? 'bg-purple-500/10 text-purple-600'
                    : 'bg-amber-500/10 text-amber-600'
              )}>{order.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : order.paymentStatus === 'DRIVER_CASH_PENDING' ? 'Con domiciliario' : 'Pendiente'}</p>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/45 px-3.5 py-3">
          {order.paymentStatus !== 'CONFIRMED' && isReadyForCollection(order) && (
            <Button size="sm" onClick={() => setCollectDialog(order)} className="h-9 gap-1 rounded-xl border-0 bg-[var(--accent)] px-3 text-[11px] font-black text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]">
              <DollarSign className="h-3.5 w-3.5" /> Cobrar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={printOrder} className="h-9 gap-1 rounded-xl px-3 text-[11px] font-bold text-blue-600"><Printer className="h-3.5 w-3.5" /> Imprimir</Button>
          {order.status !== 'CANCELLED' && (
            <Button size="sm" variant="outline" onClick={() => navigate(order.tableId ? `/tables/new?tableId=${order.tableId}&editOrderId=${order.id}` : `/orders/new?edit=${order.id}`)} className="h-9 gap-1 rounded-xl px-3 text-[11px] font-bold text-amber-600"><Edit className="h-3.5 w-3.5" /> Editar</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDetailOrder(order)} className="h-9 gap-1 rounded-xl px-3 text-[11px] font-bold"><Eye className="h-3.5 w-3.5" /> Detalle</Button>
          {activeStatuses.includes(order.status) && ['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER'].includes(user?.role || '') && (
            <Button size="sm" variant="ghost" onClick={() => { setCancelDialog({ id: order.id, orderNumber: order.orderNumber }); setCancelConfirmStep(false); setCancelReason('') }} className="ml-auto h-9 w-9 rounded-xl p-0 text-red-500 hover:bg-red-500/10" title="Cancelar pedido"><XCircle className="h-4 w-4" /></Button>
          )}
        </div>
      </motion.article>
    )
  }

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
      {/* ── Operations overview and filters ── */}
      {isDeliveryStaff ? (
        <>
          <motion.div className="flex flex-wrap items-center justify-between gap-3" variants={fadeUp}>
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg shadow-[var(--accent)]/10"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
              >
                <Bike className="h-5 w-5 text-[var(--accent-fg)]" />
              </div>
              <div>
                <h2 className="antifont text-2xl leading-none tracking-wider text-[var(--text-primary)] uppercase md:text-3xl">Despachos Activos</h2>
                <p className="text-xs text-[var(--text-secondary)]">Cola por orden de llegada · el más antiguo se atiende primero</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="mr-3 hidden items-center gap-3 md:flex">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
                  <span className="text-[var(--text-muted)]">Pendientes:</span>
                  <span className="text-amber-500">{summary.active}</span>
                </div>
                {summary.urgent > 0 && (
                  <>
                    <div className="h-4 w-px bg-[var(--border-subtle)]" />
                    <div className="flex items-center gap-1.5 text-xs font-black text-red-500">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>{summary.urgent} fuera de tiempo</span>
                    </div>
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearchQuery('')
                  setSubmittedSearch('')
                  setSelectedDriverFilter('ALL')
                  setStatusFilter('ALL')
                }}
                title="Limpiar búsqueda y filtros"
                aria-label="Limpiar búsqueda y filtros"
                className="h-9 rounded-xl border-[var(--border-subtle)] px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="flex flex-col items-stretch justify-between gap-3 lg:flex-row lg:items-center">
            <div className="flex max-w-2xl flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <Input
                  placeholder="Buscar cliente, teléfono, domiciliario..."
                  className="h-9 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-panel)] pl-9 pr-7 text-xs"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && setSubmittedSearch(searchQuery.trim())}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setSubmittedSearch('') }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    title="Borrar búsqueda"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="w-full shrink-0 sm:w-56">
                <Select value={selectedDriverFilter} onValueChange={setSelectedDriverFilter}>
                  <SelectTrigger className="h-9 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-bold">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Bike className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                      <span className="truncate">
                        {selectedDriverFilter === 'ALL'
                          ? 'Todos los repartidores'
                          : selectedDriverFilter === 'UNASSIGNED'
                            ? '⚠️ Sin repartidor'
                            : selectedFilterDriver?.name || 'Repartidor'}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="ALL" className="text-xs font-bold">🛵 Todos los repartidores ({orders.length})</SelectItem>
                    <SelectItem value="UNASSIGNED" className="text-xs font-bold text-amber-600">⚠️ Sin repartidor ({unassignedOrdersCount})</SelectItem>
                    {allAvailableDrivers.map(driver => {
                      const count = driverOrderCounts.get(driver.id) || 0
                      return (
                        <SelectItem key={driver.id} value={driver.id} className="text-xs font-medium">
                          🛵 {driver.name} {driver.phone ? `(${driver.phone})` : ''} · {count} {count === 1 ? 'ped' : 'peds'}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none lg:pb-0">
              {[
                { id: 'ALL', label: 'Todos', count: visibleOrders.length },
                { id: 'PENDING', label: 'En cocina', count: visibleOrders.filter(order => order.status === 'RECEIVED' || order.status === 'PENDING').length },
                { id: 'READY', label: 'Listos', count: visibleOrders.filter(order => order.status === 'READY').length },
                { id: 'IN_ROUTE', label: 'En ruta', count: visibleOrders.filter(order => order.status === 'IN_ROUTE').length },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id as any)}
                  className={cn(
                    'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all',
                    statusFilter === tab.id
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  <span>{tab.label}</span>
                  <span className={cn(
                    'rounded-full px-1.5 text-[10px] font-extrabold',
                    statusFilter === tab.id ? 'bg-black/20 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                  )}>{tab.count}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      ) : (
      <motion.section
        variants={fadeUp}
        className="relative z-20 overflow-visible rounded-[26px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm"
      >
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3.5">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/10"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
              >
                <Bike className="h-6 w-6 text-[var(--accent-fg)]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="antifont text-2xl leading-none tracking-wider text-[var(--text-primary)] uppercase md:text-3xl">Despachos Activos</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> En vivo
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Pedidos organizados por llegada, estado y domiciliario.</p>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearchQuery('')
                setSubmittedSearch('')
                setSelectedDriverFilter('ALL')
                setStatusFilter('ALL')
                setDriverFilterQuery('')
                loadOrders(false, true)
              }}
              title="Actualizar datos y limpiar filtros"
              className="h-10 w-full gap-2 rounded-xl border-[var(--border-subtle)] px-3 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] sm:w-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Actualizar
            </Button>
          </div>

          <div className={cn(
            'mt-5 grid gap-2.5',
            user?.role !== 'DELIVERY_MANAGER' && !isDeliveryStaff ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-1'
          )}>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">Pedidos activos</span>
                <span className="h-2 w-2 rounded-full bg-amber-400" />
              </div>
              <div className="mt-1 flex items-end gap-2">
                <span className="text-2xl font-black tabular-nums text-[var(--text-primary)]">{summary.active}</span>
                {summary.urgent > 0 && <span className="mb-1 text-[10px] font-black text-red-500">{summary.urgent} retrasados</span>}
              </div>
            </div>

            {user?.role !== 'DELIVERY_MANAGER' && !isDeliveryStaff && (
              <>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3.5 py-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400">Efectivo</span>
                  <p className="mt-1 text-xl font-black tabular-nums text-emerald-600">{formatCurrency(summary.cash)}</p>
                </div>
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] px-3.5 py-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-blue-700 dark:text-blue-400">Transferencias</span>
                  <p className="mt-1 text-xl font-black tabular-nums text-blue-600">{formatCurrency(summary.transfer)}</p>
                </div>
                <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.06] px-3.5 py-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">Total pendiente</span>
                  <p className="mt-1 text-xl font-black tabular-nums text-[var(--text-primary)]">{formatCurrency(summary.total)}</p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/35 p-3 sm:p-4">
          <div className="grid gap-2.5 lg:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                placeholder="Buscar cliente, teléfono, dirección o domiciliario..."
                className="h-11 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-panel)] pl-10 pr-9 text-sm shadow-none"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && setSubmittedSearch(searchQuery.trim())}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSubmittedSearch('') }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  title="Borrar búsqueda"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>

            <div ref={driverFilterRef} className={cn('relative', driverFilterOpen && 'z-[90]')}>
              <button
                type="button"
                onClick={() => {
                  setDriverFilterQuery('')
                  setDriverFilterOpen(open => !open)
                }}
                aria-haspopup="listbox"
                aria-expanded={driverFilterOpen}
                className={cn(
                  'flex h-11 w-full items-center justify-between gap-3 rounded-xl border bg-[var(--bg-panel)] px-3.5 text-left transition-all cursor-pointer',
                  driverFilterOpen
                    ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/10'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Bike className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Domiciliario</span>
                    <span className="block truncate text-xs font-black text-[var(--text-primary)]">
                      {selectedDriverFilter === 'ALL'
                        ? 'Todos los domiciliarios'
                        : selectedDriverFilter === 'UNASSIGNED'
                          ? 'Sin domiciliario asignado'
                          : selectedFilterDriver?.name || 'Domiciliario'}
                    </span>
                  </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform', driverFilterOpen && 'rotate-180')} />
              </button>

              {driverFilterOpen && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[100] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-panel)] shadow-2xl sm:right-auto sm:w-[380px]">
                  <div className="border-b border-[var(--border-subtle)] p-2.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        value={driverFilterQuery}
                        onChange={event => setDriverFilterQuery(event.target.value)}
                        placeholder="Buscar por nombre o celular..."
                        autoFocus
                        className="h-9 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] pl-9 pr-3 text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </div>

                  <div className="max-h-72 space-y-1 overflow-y-auto p-2 custom-scrollbar" role="listbox" aria-label="Filtrar por domiciliario">
                    {[
                      { id: 'ALL', name: 'Todos los domiciliarios', detail: `${orders.length} pedidos`, tone: 'default' },
                      { id: 'UNASSIGNED', name: 'Sin domiciliario asignado', detail: `${unassignedOrdersCount} pedidos`, tone: 'warning' },
                    ].map(option => {
                      const selected = selectedDriverFilter === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSelectedDriverFilter(option.id)
                            setDriverFilterOpen(false)
                            setDriverFilterQuery('')
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer',
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
                              : option.tone === 'warning'
                                ? 'border-transparent text-amber-700 hover:bg-amber-500/10'
                                : 'border-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-black">{option.name}</span>
                            <span className={cn('text-[10px] font-semibold', selected ? 'text-white/75' : 'text-[var(--text-muted)]')}>{option.detail}</span>
                          </span>
                          {selected && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      )
                    })}

                    <div className="my-1 border-t border-[var(--border-subtle)]" />

                    {driverFilterResults.map(driver => {
                      const selected = selectedDriverFilter === driver.id
                      const count = driverOrderCounts.get(driver.id) || 0
                      return (
                        <button
                          key={driver.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSelectedDriverFilter(driver.id)
                            setDriverFilterOpen(false)
                            setDriverFilterQuery('')
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer',
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
                              : 'border-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-black">{driver.name}</span>
                            <span className={cn('block truncate text-[10px] font-semibold', selected ? 'text-white/75' : 'text-[var(--text-muted)]')}>
                              {driver.phone || 'Sin celular registrado'}
                            </span>
                          </span>
                          <span className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black',
                            selected ? 'bg-black/15 text-white' : count > 0 ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-700'
                          )}>
                            {count > 0 ? `${count} activos` : 'Libre'}
                          </span>
                        </button>
                      )
                    })}

                    {driverFilterResults.length === 0 && (
                      <div className="px-3 py-6 text-center text-xs font-semibold text-[var(--text-muted)]">No encontramos ese domiciliario.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none sm:grid sm:grid-cols-4">
            {[
              { id: 'ALL', label: 'Todos', count: visibleOrders.length },
              { id: 'PENDING', label: 'En cocina', count: visibleOrders.filter(order => order.status === 'RECEIVED' || order.status === 'PENDING').length },
              { id: 'READY', label: 'Listos', count: visibleOrders.filter(order => order.status === 'READY').length },
              { id: 'IN_ROUTE', label: 'En ruta', count: visibleOrders.filter(order => order.status === 'IN_ROUTE').length },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as any)}
                className={cn(
                  'flex h-10 min-w-[112px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition-all cursor-pointer select-none sm:min-w-0',
                  statusFilter === tab.id
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <span>{tab.label}</span>
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums',
                  statusFilter === tab.id ? 'bg-black/20 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                )}>{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.section>
      )}

      {/* Active Driver Filter Indicator Banner */}
      {selectedDriverFilter !== 'ALL' && (
        isDeliveryStaff ? (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-gradient-to-r from-emerald-500/10 via-blue-500/10 to-purple-500/10 px-3.5 py-2.5 text-xs shadow-sm"
          >
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-emerald-500/20 p-1.5 text-emerald-600"><Bike className="h-4 w-4" /></div>
              <span className="text-[var(--text-secondary)]">
                Viendo comandas de:{' '}
                <strong className="text-sm font-black text-[var(--text-primary)]">
                  {selectedDriverFilter === 'UNASSIGNED' ? 'Sin repartidor asignado' : selectedFilterDriver?.name || 'Repartidor'}
                </strong>
              </span>
              <Badge variant="outline" className="border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[10px] font-extrabold">
                {visibleOrders.length} {visibleOrders.length === 1 ? 'pedido' : 'pedidos'}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDriverFilter('ALL')}
              className="flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-muted)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <XCircle className="h-3.5 w-3.5" /> Ver todos
            </button>
          </motion.div>
        ) : (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 rounded-2xl border border-[var(--accent)]/20 bg-[var(--bg-panel)] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <ListFilter className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Filtro activo</p>
              <p className="truncate text-sm font-black text-[var(--text-primary)]">
                {selectedDriverFilter === 'UNASSIGNED'
                  ? 'Pedidos sin domiciliario asignado'
                  : `Pedidos de ${selectedFilterDriver?.name || 'domiciliario'}`}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[10px] font-black">
              {visibleOrders.length} {visibleOrders.length === 1 ? 'pedido' : 'pedidos'}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user?.role !== 'DELIVERY_MANAGER' && !isDeliveryStaff && visibleOrders.some(order => order.status === 'IN_ROUTE') && (
              <Button
                size="sm"
                type="button"
                onClick={() => {
                  const driverOrderIds = visibleOrders.filter(order => order.status === 'IN_ROUTE').map(order => order.id)
                  setSelectedOrderIds(driverOrderIds)
                  setBatchCollectError('')
                  setBatchCollectMode('AS_IS')
                  setReviewedTransferIds([])
                  setBatchCollectOpen(true)
                }}
                className="h-9 flex-1 gap-1.5 rounded-xl border-0 bg-emerald-600 px-3 text-[11px] font-black text-white shadow-sm hover:bg-emerald-700 sm:flex-none"
              >
                <DollarSign className="h-3.5 w-3.5" />
                <span>Liquidar en ruta</span>
              </Button>
            )}
            <button
              type="button"
              onClick={() => setSelectedDriverFilter('ALL')}
              className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] sm:flex-none"
            >
              <XCircle className="h-3.5 w-3.5" /> Ver todos
            </button>
          </div>
        </motion.div>
        )
      )}

      <motion.div
        variants={fadeUp}
        className="flex flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-black text-[var(--text-primary)]">{isDeliveryStaff ? 'Cola FIFO activa' : 'Orden de atención'}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {isDeliveryStaff
                ? 'Los nuevos pedidos aparecen abajo. Atiende siempre la primera fila.'
                : 'El más antiguo permanece arriba; los nuevos pedidos entran al final.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold">
          <span className="inline-flex items-center gap-1 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> En tiempo</span>
          <span className="inline-flex items-center gap-1 text-amber-600"><span className="h-2 w-2 rounded-full bg-amber-500" /> Por salir: 10 min</span>
          <span className="inline-flex items-center gap-1 text-red-600"><span className="h-2 w-2 rounded-full bg-red-500" /> Debe salir: 15 min</span>
        </div>
      </motion.div>

      {/* ── Selection Action Bar (Asignación Múltiple / en Lote) ── */}
      {selectedOrderIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between bg-[var(--accent)] text-[var(--accent-fg)] p-3.5 rounded-2xl shadow-xl gap-3 flex-wrap border-2 border-white/20"
        >
          <div className="flex items-center gap-3">
            <span className="bg-black/20 px-3 py-1 rounded-xl text-sm font-black flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {selectedOrderIds.length} {selectedOrderIds.length === 1 ? 'pedido seleccionado' : 'pedidos seleccionados'}
            </span>
            <span className="text-xs font-bold opacity-90 hidden md:inline">
              Pedidos: {orders.filter(o => selectedOrderIds.includes(o.id)).map(o => `#${o.orderNumber}`).join(', ')}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedOrderIds([])}
              className="h-9 px-3 text-xs font-extrabold rounded-xl bg-black/20 hover:bg-black/30 text-white border-0 cursor-pointer"
            >
              Deseleccionar
            </Button>
            {user?.role !== 'DELIVERY_MANAGER' && !isDeliveryStaff && (
              <Button
                size="sm"
                onClick={() => {
                  const inRouteIds = selectedOrdersList.filter(order => order.status === 'IN_ROUTE').map(order => order.id)
                  if (inRouteIds.length === 0) {
                    alerts.warning('Sin pedidos en ruta', 'Solo se pueden liquidar pedidos que ya salieron con el domiciliario.')
                    return
                  }
                  setSelectedOrderIds(inRouteIds)
                  setBatchCollectError('')
                  setBatchCollectMode('AS_IS')
                  setReviewedTransferIds([])
                  setBatchCollectOpen(true)
                }}
                className="h-9 px-4 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center gap-2 cursor-pointer border border-emerald-400/40"
              >
                <DollarSign className="h-4 w-4" />
                <span>Liquidar pedidos en ruta</span>
              </Button>
            )}
            {hasPermission('dispatch.change_status') && (
              <Button
                size="sm"
                onClick={() => {
                  setBatchDriverId('')
                  setBatchDriverSearch('')
                  setBatchError('')
                  setBatchDispatchOpen(true)
                }}
                className="h-9 px-4 text-xs font-black rounded-xl bg-white text-[var(--accent)] hover:bg-white/90 shadow-md border-0 cursor-pointer flex items-center gap-1.5"
              >
                <Bike className="h-4 w-4" />
                Asignar Repartidor a los {selectedOrderIds.length} pedidos
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Compact Table ── */}
      <motion.div variants={fadeUp}>
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl overflow-hidden">
          {!isDeliveryStaff && (
            <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-black text-[var(--text-primary)]">Pedidos visibles</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Ordenados del más antiguo al más reciente.</p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1 text-[10px] font-black text-[var(--text-secondary)]">
                {statusVisibleOrders.length} {statusVisibleOrders.length === 1 ? 'pedido' : 'pedidos'}
              </span>
            </div>
          )}
          {statusVisibleOrders.length === 0 ? (
            <CardContent className="py-12 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="text-[var(--text-primary)] font-bold text-sm">{orders.length === 0 ? '¡Todo al día!' : (visibleOrders.length === 0 ? 'Sin coincidencias' : 'No hay pedidos en este estado')}</p>
              <p className="text-xs text-[var(--text-secondary)]">{orders.length === 0 ? 'No hay pedidos activos en este momento.' : (visibleOrders.length === 0 ? 'Prueba con otro cliente, teléfono, producto o número de pedido.' : 'Cambia el filtro para ver los demás pedidos activos.')}</p>
            </CardContent>
          ) : (
            <>
              {!isDeliveryStaff && (
                <div className="grid gap-3 p-3 md:grid-cols-2 min-[1780px]:hidden">
                  <AnimatePresence>
                    {statusVisibleOrders.map((order, queueIndex) => renderAdminOrderCard(order, queueIndex))}
                  </AnimatePresence>
                </div>
              )}
            <div className={cn('overflow-x-auto', !isDeliveryStaff && 'hidden custom-scrollbar pb-1 min-[1780px]:block')}>
              <table className={cn(
                'w-full text-xs',
                !isDeliveryStaff && 'min-w-[1240px] table-fixed [&_th]:px-2.5 [&_th]:py-3.5 [&_td]:px-2.5 [&_td]:py-3.5 [&_td]:align-middle'
              )}>
                {!isDeliveryStaff && (
                  <colgroup>
                    <col className="w-[32px]" />
                    <col className="w-[92px]" />
                    <col className="w-[105px]" />
                    <col className="w-[160px]" />
                    <col className="w-[230px]" />
                    <col className="w-[125px]" />
                    <col className="w-[78px]" />
                    <col className="w-[105px]" />
                    <col className="w-[105px]" />
                    <col className="w-[190px]" />
                  </colgroup>
                )}
                <thead className={cn(!isDeliveryStaff && 'sticky top-0 z-10')}>
                  <tr className={cn(
                    'border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]',
                    !isDeliveryStaff && 'shadow-[0_1px_0_var(--border-subtle)]'
                  )}>
                    <th className="w-10 text-center px-2 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer"
                        checked={selectableOrders.length > 0 && selectableOrders.every(o => selectedOrderIds.includes(o.id))}
                        onChange={handleToggleSelectAll}
                        title="Seleccionar todos los pedidos activos"
                      />
                    </th>
                    <th className="text-left px-3 py-2.5 font-extrabold text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Cola / Pedido</th>
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
                    {statusVisibleOrders
                      .map((order, queueIndex) => {
                      const phoneDigits = order.customerPhone.replace(/\D/g, '')
                      const whatsappMsg = buildWhatsAppMessage(order)
                      const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
                      const elapsed = getElapsedTime(order.createdAt)
                      const elapsedMinutes = getElapsedMinutes(order.createdAt)
                      const routeElapsed = getElapsedTime(order.updatedAt || order.createdAt)
                      const waitingForDispatch = isWaitingForDispatch(order)
                      const isUrgent = waitingForDispatch && elapsedMinutes >= DISPATCH_ALERT_MINUTES
                      const isWarning = waitingForDispatch && !isUrgent && elapsedMinutes >= DISPATCH_WARNING_MINUTES
                      const queuePosition = visibleOrders.findIndex(item => item.id === order.id) + 1
                      const isSelectedRow = selectedOrderIds.includes(order.id)
                      const isSelectable = order.orderType === 'DELIVERY' && !['DELIVERED', 'CANCELLED'].includes(order.status)
                      return (
                        <motion.tr key={order.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className={`border-b transition-colors ${!isDeliveryStaff ? 'last:border-b-0' : ''} ${
                            isSelectedRow
                              ? 'bg-[var(--accent)]/10 border-[var(--accent)]/40 hover:bg-[var(--accent)]/15'
                              : isUrgent
                                ? 'border-red-500/30 bg-red-500/[0.07] hover:bg-red-500/[0.11]'
                                : isWarning
                                  ? 'border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                                  : 'border-[var(--border-subtle)]/50 hover:bg-[var(--bg-hover)]'
                          }`}>
                          <td className="w-10 text-center px-2 py-2.5">
                            {isSelectable ? (
                              <input
                                type="checkbox"
                                checked={isSelectedRow}
                                onChange={() => handleToggleSelectOrder(order.id)}
                                className="h-4.5 w-4.5 rounded accent-[var(--accent)] cursor-pointer"
                                title={`Seleccionar pedido #${order.orderNumber}`}
                              />
                            ) : (
                              <span className="text-[10px] text-[var(--text-muted)] opacity-30">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={cn('flex items-center gap-2', !isDeliveryStaff && 'gap-2.5')}>
                              <span className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-[10px] font-black ${
                                isUrgent ? 'bg-red-600 text-white' : isWarning ? 'bg-amber-500 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                              }`} title={`Posición ${queuePosition || queueIndex + 1} en la cola`}>
                                {queuePosition || queueIndex + 1}º
                              </span>
                              <button
                                type="button"
                                onClick={() => isDeliveryStaff ? setDetailOrder(order) : setChatModalOrder(order)}
                                className="font-black text-[var(--accent)] hover:underline text-sm cursor-pointer bg-transparent border-0 inline-flex items-center gap-1 group"
                                title={isDeliveryStaff ? `Ver detalle de pedido #${order.orderNumber}` : `Abrir WhatsApp de pedido #${order.orderNumber} para ver chat real, comprobantes y rectificar pago`}
                              >
                                <span>#{order.orderNumber}</span>
                                {!isDeliveryStaff && (
                                  <MessageSquare className="h-3.5 w-3.5 text-emerald-500 opacity-85 group-hover:opacity-100 group-hover:scale-115 transition-all shrink-0" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={cn('flex flex-col items-start', isDeliveryStaff ? 'gap-1' : 'gap-1.5')}>
                              <span className={cn(
                                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide',
                                isDeliveryStaff
                                  ? order.orderType === 'PICKUP'
                                    ? 'border-purple-600 bg-purple-600 text-white shadow-sm'
                                    : 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                  : order.orderType === 'PICKUP'
                                    ? 'border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                                    : 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                              )}>
                                {order.orderType === 'PICKUP' ? '🏠 Recoger' : '🛵 Domicilio'}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase"
                                style={{ color: getStatusColor(order.status), backgroundColor: `${getStatusColor(order.status)}15`, border: `1px solid ${getStatusColor(order.status)}25` }}>
                                {getStatusLabel(order.status)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={cn(
                              'truncate text-sm font-black tracking-tight text-[var(--text-primary)]',
                              isDeliveryStaff ? 'max-w-[160px]' : 'max-w-[185px]'
                            )}>{order.customerName}</div>
                            <a href={`tel:${order.customerPhone}`} className={cn(
                              'mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg font-black text-[var(--accent)] hover:underline',
                              isDeliveryStaff
                                ? 'bg-[var(--accent)]/10 px-2 py-0.5 text-sm tracking-wider'
                                : 'border border-[var(--accent)]/15 bg-[var(--accent)]/[0.06] px-2 py-1 text-xs tracking-wide'
                            )}>
                              <Phone className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{order.customerPhone}</span>
                            </a>
                          </td>
                          <td className="px-3 py-2.5">
                            {order.orderType === 'PICKUP' ? (
                              <div className="inline-flex items-center gap-1.5 text-xs font-black text-purple-700 dark:text-purple-300 bg-purple-500/15 px-2.5 py-1 rounded-lg border border-purple-500/30 uppercase">
                                <Store className="h-4 w-4 shrink-0" />
                                <span>Retira en restaurante</span>
                              </div>
                            ) : (
                              <div className={cn('flex flex-col gap-1', isDeliveryStaff ? 'max-w-[210px]' : 'max-w-[260px]')}>
                                {order.zone && (
                                  <span className={cn(
                                    'flex items-center gap-1 font-black uppercase text-[var(--accent)]',
                                    isDeliveryStaff ? 'text-xs' : 'text-[11px]'
                                  )}>
                                    <MapPin className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                                    <span className="truncate">{order.zone.name}</span>
                                  </span>
                                )}
                                <span className={cn(
                                  'break-words font-extrabold leading-snug text-[var(--text-primary)]',
                                  isDeliveryStaff ? 'text-sm leading-tight' : 'text-[13px]'
                                )} title={order.customerAddress}>
                                  {order.customerAddress || 'Sin dirección'}
                                </span>
                                {order.addressReference && (
                                  <span className={cn(
                                    'truncate font-semibold italic text-[var(--text-muted)]',
                                    isDeliveryStaff ? 'text-xs' : 'text-[11px]'
                                  )} title={order.addressReference}>
                                    Ref: {order.addressReference}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {order.orderType === 'PICKUP' || order.orderType === 'LOCAL' ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold text-purple-700 bg-purple-500/10 border-purple-500/30">
                                  {order.orderType === 'PICKUP' ? 'Pasar a Recoger' : 'Mostrador'}
                                </span>
                                {hasPermission('dispatch.change_status') && order.orderType === 'PICKUP' && order.status !== 'READY' && order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && (
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
                              <div className="flex flex-col gap-0.5">
                                <span
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-lg border text-emerald-600 bg-emerald-500/10 border-emerald-500/30 cursor-default inline-flex items-center gap-1 opacity-85"
                                  title="Pedido finalizado"
                                >
                                  <Bike className="h-3 w-3" />
                                  <span>{order.deliveryDriver ? order.deliveryDriver.name : 'Sin Repartidor'}</span>
                                </span>
                                {order.deliveryDriver && order.updatedAt && (
                                  <span className="text-[9px] font-semibold text-[var(--text-muted)] pl-1">
                                    Salió: {formatTimeOnly(order.updatedAt)}
                                  </span>
                                )}
                              </div>
                            ) : hasPermission('dispatch.change_status') ? (
                              <div className={cn('flex flex-col items-start', isDeliveryStaff ? 'gap-1' : 'gap-1.5')}>
                                <button
                                  onClick={() => {
                                    setSelectedDriverId(order.deliveryDriverId || '')
                                    setRegisteringDriverInline(false)
                                    setInlineDriverName('')
                                    setInlineDriverPhone('')
                                    setDispatchError('')
                                    setDispatchDialog({ order, shouldKick: false })
                                  }}
                                  className={cn(
                                    'inline-flex cursor-pointer items-center gap-1 rounded-lg border text-[11px] font-black transition-colors',
                                    isDeliveryStaff ? 'px-2 py-0.5' : 'max-w-full px-2 py-1',
                                    order.deliveryDriver
                                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300'
                                      : 'animate-pulse border-amber-500/30 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25'
                                  )}
                                  title={order.deliveryDriver ? 'Hacer clic para cambiar repartidor' : 'Hacer clic para asignar repartidor'}
                                >
                                  <Bike className="h-3.5 w-3.5" />
                                  <span className="truncate">{order.deliveryDriver ? order.deliveryDriver.name : '⚠ Asignar'}</span>
                                </button>
                                {order.deliveryDriver && order.updatedAt && (
                                  <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded flex items-center gap-1" title={`Despachado a las ${formatTimeOnly(order.updatedAt)}`}>
                                    <Send className="h-2.5 w-2.5 shrink-0" />
                                    <span>Salió: {formatTimeOnly(order.updatedAt)}</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border text-[var(--text-muted)] bg-[var(--bg-subtle)] border-[var(--border-subtle)] inline-flex items-center gap-1">
                                  <Bike className="h-3 w-3" />
                                  <span>{order.deliveryDriver?.name || 'Sin repartidor'}</span>
                                </span>
                                {order.deliveryDriver && order.updatedAt && (
                                  <span className="text-[9px] font-semibold text-[var(--text-muted)] pl-1">
                                    Salió: {formatTimeOnly(order.updatedAt)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={cn(
                              'text-sm font-black text-[var(--text-primary)]',
                              !isDeliveryStaff && 'whitespace-nowrap tabular-nums'
                            )}>{formatCurrency(order.total)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            {order.status === 'IN_ROUTE' || order.deliveryDriver ? (
                              <div className={cn('flex flex-col', isDeliveryStaff ? 'gap-0.5' : 'items-start gap-1')}>
                                <span className={cn(
                                  'inline-flex items-center gap-1 rounded-lg border border-blue-500/25 px-2 py-1 text-[11px] font-black text-blue-700 dark:text-blue-300',
                                  isDeliveryStaff ? 'bg-blue-500/15' : 'whitespace-nowrap bg-blue-500/10'
                                )}>
                                  <Clock className="h-3 w-3 text-blue-600" />
                                  En ruta · {routeElapsed}
                                </span>
                                <span className="text-[9px] font-bold text-[var(--text-muted)] pl-0.5">
                                  Salió {formatTimeOnly(order.updatedAt)}
                                </span>
                              </div>
                            ) : order.orderType === 'PICKUP' ? (
                              <div className={cn('flex flex-col', isDeliveryStaff ? 'gap-0.5' : 'items-start gap-1')}>
                                <span className={cn(
                                  'inline-flex items-center gap-1 rounded-lg border border-purple-500/25 px-2 py-1 text-[11px] font-black text-purple-700 dark:text-purple-300',
                                  isDeliveryStaff ? 'bg-purple-500/15' : 'whitespace-nowrap bg-purple-500/10'
                                )}>
                                  <Clock className="h-3 w-3 text-purple-600" />
                                  {order.status === 'READY' ? 'Listo' : `Espera · ${elapsed}`}
                                </span>
                                <span className="text-[9px] font-bold text-[var(--text-muted)] pl-0.5">
                                  Pedido {formatTimeOnly(order.createdAt)}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black ${
                                  isUrgent
                                    ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                                    : isWarning
                                      ? 'bg-amber-500/15 text-amber-600'
                                      : 'bg-emerald-500/10 text-emerald-600'
                                }`}>
                                  {isUrgent ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                  {isUrgent ? `Debe salir · ${elapsed}` : isWarning ? `Por salir · ${elapsed}` : `Espera · ${elapsed}`}
                                </span>
                                <span className="text-[9px] font-bold text-[var(--text-muted)] pl-0.5">
                                  Pedido {formatTimeOnly(order.createdAt)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={cn('flex flex-col items-start', isDeliveryStaff ? 'gap-1' : 'gap-1.5')}>
                              {!isDeliveryStaff && (
                                <button
                                  type="button"
                                  onClick={() => setPaymentEditDialog(order)}
                                  className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-extrabold text-[var(--text-primary)] transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
                                  title="Hacer clic para cambiar método de pago (Efectivo / Transferencia)"
                                >
                                  <span>
                                    {order.paymentMethod === 'CASH' ? '💵 Efectivo' :
                                     order.paymentMethod === 'TRANSFER' ? '📱 Transferencia' :
                                     order.paymentMethod === 'NEQUI' ? '💜 Nequi' :
                                     order.paymentMethod === 'BANCOLOMBIA' ? '💛 Bancolombia' :
                                     order.paymentMethod === 'DAVIPLATA' ? '❤️ Daviplata' :
                                     order.paymentMethod === 'MIXED' ? '🔀 Mixto' :
                                     order.paymentMethod === 'CREDIT' ? '💳 Crédito' :
                                     order.paymentMethod === 'CORTESIA' ? '🎁 Cortesía' :
                                     getStatusLabel(order.paymentMethod)}
                                  </span>
                                  <Edit className="h-2.5 w-2.5 opacity-60 ml-0.5 text-[var(--accent)]" />
                                </button>
                              )}
                              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                order.paymentStatus === 'CONFIRMED'
                                  ? 'text-emerald-600 bg-emerald-500/10'
                                  : order.paymentStatus === 'DRIVER_CASH_PENDING'
                                    ? 'text-purple-600 bg-purple-500/10'
                                    : 'text-amber-600 bg-amber-500/10'
                              }`}>
                                {order.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : order.paymentStatus === 'DRIVER_CASH_PENDING' ? 'Con domiciliario' : 'Pendiente'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={cn('flex items-center justify-center', isDeliveryStaff ? 'gap-1' : 'flex-wrap gap-1.5')}>
                              {!isDeliveryStaff && order.paymentStatus !== 'CONFIRMED' && isReadyForCollection(order) && (
                                <Button size="sm" className={cn(
                                  'gap-1 border-0 bg-[var(--accent)] text-[10px] font-extrabold text-[var(--accent-fg)] shadow-xs transition-all hover:bg-[var(--accent-hover)] active:scale-95 cursor-pointer',
                                  isDeliveryStaff ? 'h-7 rounded-lg px-2' : 'h-8 rounded-xl px-2.5'
                                )}
                                  onClick={() => setCollectDialog(order)}
                                  title="Cobrar pedido"
                                >
                                  <DollarSign className="h-3 w-3" /> Cobrar
                                </Button>
                              )}
                              <Button
                                size="sm" 
                                variant="ghost" 
                                title="Reimprimir Comanda / Factura"
                                className={cn('p-0 text-blue-500 hover:bg-blue-500/10 cursor-pointer', isDeliveryStaff ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl')}
                                onClick={async () => {
                                  const orderWithDriver = {
                                    ...order,
                                    deliveryDriver: order.deliveryDriver || (order.deliveryDriverId ? drivers.find(d => d.id === order.deliveryDriverId) : undefined)
                                  };
                                  alerts.toast(`Enviando pedido #${order.orderNumber} a impresión...`);
                                  const res = await printComandaSmart(orderWithDriver, 'caja', user?.role, false, false);
                                  if (res?.error) {
                                    alerts.error('Error al imprimir', res.error);
                                  } else {
                                    alerts.toast(`Pedido #${order.orderNumber} enviado a la impresora`);
                                  }
                                }}
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                              {!isDeliveryStaff && order.status !== 'CANCELLED' && (
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  title="Editar Pedido"
                                  className={cn('p-0 text-amber-500 hover:bg-amber-500/10 cursor-pointer', isDeliveryStaff ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl')}
                                  onClick={() => navigate(order.tableId ? `/tables/new?tableId=${order.tableId}&editOrderId=${order.id}` : `/orders/new?edit=${order.id}`)}
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className={cn('p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer', isDeliveryStaff ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl')}
                                title="Ver detalle del pedido"
                                onClick={() => setDetailOrder(order)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {!isDeliveryStaff && activeStatuses.includes(order.status) && ['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER'].includes(user?.role || '') && (
                                <Button size="sm" variant="ghost" className={cn('p-0 text-red-400 hover:bg-red-500/10 cursor-pointer', isDeliveryStaff ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl')} title="Cancelar Pedido"
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
            </>
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Seleccionar repartidor</Label>
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
                      className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-9 pl-9 pr-8 focus:border-[var(--accent)] font-semibold"
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
                </div>
                {hasPermission('drivers.manage') && <button type="button" onClick={() => setRegisteringDriverInline(true)} className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] font-bold cursor-pointer border-0 bg-transparent">+ Registrar nuevo repartidor</button>}
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

      {/* ── Batch Dispatch Dialog (Asignación en Lote de Múltiples Domicilios) ── */}
      <Dialog open={batchDispatchOpen} onOpenChange={open => { if (!open) { setBatchDispatchOpen(false); setBatchDriverSearch(''); setBatchError(''); } }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-[var(--text-primary)] flex items-center gap-2">
              <Bike className="h-5 w-5 text-[var(--accent)]" />
              Asignar Repartidor a Múltiples Pedidos
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="p-3.5 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/25">
              <p className="text-xs font-black text-[var(--accent)] flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {selectedOrderIds.length} pedidos seleccionados para asignación conjunta:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {orders.filter(o => selectedOrderIds.includes(o.id)).map(o => (
                  <span key={o.id} className="bg-[var(--bg-panel)] px-2 py-0.5 rounded-lg border border-[var(--border-default)] text-xs font-black">
                    #{o.orderNumber}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Seleccionar Repartidor *</Label>
                <span className="text-[10px] text-[var(--text-muted)] font-bold">{filteredBatchDrivers.length} repartidores</span>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                <Input
                  value={batchDriverSearch}
                  onChange={e => {
                    const val = e.target.value
                    setBatchDriverSearch(val)
                    const q = val.trim().toLowerCase()
                    if (q) {
                      const auto = drivers.find(d => d.name.toLowerCase().startsWith(q))
                      if (auto) setBatchDriverId(auto.id)
                    }
                  }}
                  placeholder="Escribe el nombre del repartidor..."
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-9.5 pl-9 pr-8 focus:border-[var(--accent)] font-semibold"
                  autoFocus
                />
                {batchDriverSearch && (
                  <button
                    type="button"
                    onClick={() => setBatchDriverSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Lista interactiva de repartidores sin límite */}
              <div className="max-h-52 overflow-y-auto space-y-1 border border-[var(--border-subtle)] rounded-xl p-1 bg-[var(--bg-input)]/50">
                {filteredBatchDrivers.map(d => {
                  const isSelected = batchDriverId === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setBatchDriverId(d.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer text-left border",
                        isSelected 
                          ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] shadow-xs" 
                          : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-transparent"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Bike className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-[var(--accent-fg)]" : "text-[var(--accent)]")} />
                        <span className="font-extrabold">{d.name}</span>
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
                {filteredBatchDrivers.length === 0 && (
                  <div className="p-3 text-center text-xs text-[var(--text-muted)] font-semibold">
                    No se encontró ningún repartidor con "{batchDriverSearch}"
                  </div>
                )}
              </div>
            </div>

            {/* Imprimir comandas para los pedidos pendientes */}
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              <input
                type="checkbox"
                id="batchAutoPrint"
                checked={batchAutoPrint}
                onChange={e => setBatchAutoPrint(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer shrink-0"
              />
              <Label htmlFor="batchAutoPrint" className="text-xs font-bold text-[var(--text-secondary)] cursor-pointer select-none">
                Imprimir factura de caja para pedidos que pasen a En Ruta
              </Label>
            </div>

            {batchError && (
              <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-2.5 text-xs text-[var(--destructive)] font-semibold flex items-center gap-1.5 animate-fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{batchError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2 border-t border-[var(--border-subtle)]/40">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl font-bold text-sm cursor-pointer"
                onClick={() => setBatchDispatchOpen(false)}
                disabled={isSubmittingBatch}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md border-0 cursor-pointer"
                onClick={handleConfirmBatchDispatch}
                disabled={isSubmittingBatch || !batchDriverId}
              >
                {isSubmittingBatch ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Asignando...
                  </>
                ) : (
                  `Asignar los ${selectedOrderIds.length} pedidos`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Batch Collect Dialog (Cobro Masivo / Cobrar Todo) ── */}
      <Dialog 
        open={batchCollectOpen} 
        onOpenChange={open => { 
          if (chatModalOrder) return
          if (!open) { setBatchCollectOpen(false); setBatchCollectError(''); } 
        }}
      >
        <DialogContent 
          onPointerDownOutside={(e) => {
            if (chatModalOrder) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (chatModalOrder) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (chatModalOrder) e.preventDefault()
          }}
          className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-5xl p-6 max-h-[92vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-[var(--text-primary)] flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-emerald-500" />
              Liquidación de pedidos en ruta
            </DialogTitle>
            <p className="text-xs text-[var(--text-secondary)]">
              Revisa efectivo y transferencias por separado antes de finalizar <strong className="text-[var(--text-primary)]">{selectedOrdersList.length} pedidos</strong>.
            </p>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Resumen Financiero Destacado */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">💵 Efectivo</span>
                <span className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCurrency(batchCollectTotals.cash)}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">📱 Transferencia</span>
                <span className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400 tabular-nums">
                  {formatCurrency(batchCollectTotals.transfer)}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-black uppercase text-[var(--accent)]">💰 Gran Total</span>
                <span className="text-sm sm:text-base font-black text-[var(--accent)] tabular-nums">
                  {formatCurrency(batchCollectTotals.total)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black text-[var(--text-primary)]">Revisa cada pedido antes de liquidar</p>
                  <p className="text-[10px] font-medium text-[var(--text-muted)]">El método se puede corregir en la misma fila. Las transferencias requieren validación.</p>
                </div>
                {unreviewedTransferOrders.length > 0 ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black text-amber-700">
                    {unreviewedTransferOrders.length} transferencia{unreviewedTransferOrders.length === 1 ? '' : 's'} por validar
                  </span>
                ) : transferOrdersRequiringReview.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Transferencias validadas
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-emerald-500/5">
                <header className="flex items-center justify-between border-b border-emerald-500/20 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-black text-emerald-700">💵 Efectivo · {batchOrdersByPayment.cash.length}</p>
                    <p className="text-[10px] font-semibold text-emerald-700/70">Dinero que debe entregar el domiciliario</p>
                  </div>
                  <span className="text-sm font-black tabular-nums text-emerald-700">{formatCurrency(batchCollectTotals.cash)}</span>
                </header>
                <div className="max-h-[320px] space-y-2 overflow-y-auto p-2 scrollbar-thin">
                  {batchOrdersByPayment.cash.length > 0
                    ? batchOrdersByPayment.cash.map(order => renderBatchPaymentRow(order))
                    : <p className="py-6 text-center text-xs font-semibold text-[var(--text-muted)]">No hay pedidos en efectivo.</p>}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-blue-500/25 bg-blue-500/5">
                <header className="flex items-center justify-between border-b border-blue-500/20 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-black text-blue-700">📱 Transferencia · {batchOrdersByPayment.transfer.length}</p>
                    <p className="text-[10px] font-semibold text-blue-700/70">Verifica chat o comprobante antes de marcar</p>
                  </div>
                  <span className="text-sm font-black tabular-nums text-blue-700">{formatCurrency(batchCollectTotals.transfer)}</span>
                </header>
                <div className="max-h-[320px] space-y-2 overflow-y-auto p-2 scrollbar-thin">
                  {batchOrdersByPayment.transfer.length > 0
                    ? batchOrdersByPayment.transfer.map(order => renderBatchPaymentRow(order, true))
                    : <p className="py-6 text-center text-xs font-semibold text-[var(--text-muted)]">No hay pedidos por transferencia.</p>}
                </div>
              </section>
            </div>

            {batchOrdersByPayment.mixedOrOther.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-amber-500/25 bg-amber-500/5">
                <header className="border-b border-amber-500/20 px-3 py-2.5">
                  <p className="text-xs font-black text-amber-700">Revisión especial · {batchOrdersByPayment.mixedOrOther.length}</p>
                  <p className="text-[10px] font-semibold text-amber-700/70">Pedidos mixtos, crédito o cortesía. Confirma su forma final de pago.</p>
                </header>
                <div className="grid gap-2 p-2 lg:grid-cols-2">
                  {batchOrdersByPayment.mixedOrOther.map(order => renderBatchPaymentRow(
                    order,
                    getBatchOrderMethod(order) === 'MIXED' && Number(manualItemMethods[order.id]?.transferAmount ?? order.transferAmount ?? 0) > 0
                  ))}
                </div>
              </section>
            )}

            {/* Opción Abrir Cajón */}
            <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              <input
                type="checkbox"
                id="batchCollectDrawerKick"
                checked={batchCollectDrawerKick}
                onChange={e => setBatchCollectDrawerKick(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer shrink-0"
              />
              <Label htmlFor="batchCollectDrawerKick" className="text-xs font-bold text-[var(--text-primary)] cursor-pointer select-none">
                🗄 Abrir cajón monedero al confirmar (si hay cobro en efectivo)
              </Label>
            </div>

            {batchCollectError && (
              <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-3 text-xs text-[var(--destructive)] font-bold flex items-center gap-2 animate-fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{batchCollectError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2 border-t border-[var(--border-subtle)]/40">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl font-bold text-sm cursor-pointer"
                onClick={() => setBatchCollectOpen(false)}
                disabled={isSubmittingBatchCollect}
              >
                Cancelar
              </Button>
              <Button
                className="flex-[2] h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-xl border-0 cursor-pointer flex items-center justify-center gap-2"
                onClick={handleConfirmBatchCollect}
                disabled={isSubmittingBatchCollect || selectedOrdersList.length === 0 || unreviewedTransferOrders.length > 0}
              >
                {isSubmittingBatchCollect ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Cobrando {selectedOrdersList.length} pedidos...</span>
                  </>
                ) : (
                  <>
                    <DollarSign className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {unreviewedTransferOrders.length > 0
                        ? `Valida ${unreviewedTransferOrders.length} transferencia${unreviewedTransferOrders.length === 1 ? '' : 's'}`
                        : `Confirmar liquidación · ${formatCurrency(batchCollectTotals.total)}`}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog para Editar Método de Pago del Domicilio ── */}
      {!isDeliveryStaff && (
        <Dialog open={!!paymentEditDialog} onOpenChange={() => setPaymentEditDialog(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-[var(--text-primary)] flex items-center">
              <DollarSign className="h-5 w-5 mr-2 text-[var(--accent)]" />
              Cambiar Método de Pago
            </DialogTitle>
          </DialogHeader>

          {paymentEditDialog && (
            <div className="space-y-4">
              <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-[var(--text-secondary)]">Pedido #{paymentEditDialog.orderNumber}</p>
                  <p className="text-sm font-extrabold text-[var(--text-primary)] truncate max-w-[200px]">
                    {paymentEditDialog.customerName || 'Cliente'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Total</p>
                  <p className="text-base font-black text-emerald-500">
                    {formatCurrency(paymentEditDialog.total)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">
                  Selecciona el método de pago
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { val: 'CASH', label: '💵 Efectivo' },
                    { val: 'TRANSFER', label: '📱 Transferencia' },
                    { val: 'NEQUI', label: '💜 Nequi' },
                    { val: 'BANCOLOMBIA', label: '💛 Bancolombia' },
                    { val: 'DAVIPLATA', label: '❤️ Daviplata' },
                    { val: 'MIXED', label: '🔀 Pago Mixto' },
                    { val: 'CREDIT', label: '📋 Crédito' },
                  ].map(m => (
                    <button
                      key={m.val}
                      type="button"
                      onClick={() => {
                        setEditMethod(m.val)
                        if (m.val === 'MIXED') {
                          const tot = paymentEditDialog.total || 0
                          const half = Math.round(tot / 2)
                          setEditCashAmount(String(half))
                          setEditTransferAmount(String(tot - half))
                        }
                      }}
                      className={cn(
                        "p-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center",
                        editMethod === m.val
                          ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] shadow-md scale-[1.02]"
                          : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent)]/30 hover:bg-[var(--bg-hover)]"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {editMethod === 'MIXED' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-[var(--bg-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  <div>
                    <Label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase">
                      💵 Efectivo ($)
                    </Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatThousandsInput(editCashAmount)}
                      onChange={e => {
                        const num = parseThousandsInput(e.target.value)
                        setEditCashAmount(num > 0 ? String(num) : '')
                        const rest = Math.max(0, (paymentEditDialog.total || 0) - num)
                        setEditTransferAmount(rest > 0 ? String(rest) : '0')
                      }}
                      className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-9 text-xs font-bold text-emerald-500 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase">
                      📱 Transferencia ($)
                    </Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatThousandsInput(editTransferAmount)}
                      onChange={e => {
                        const num = parseThousandsInput(e.target.value)
                        setEditTransferAmount(num > 0 ? String(num) : '')
                        const rest = Math.max(0, (paymentEditDialog.total || 0) - num)
                        setEditCashAmount(rest > 0 ? String(rest) : '0')
                      }}
                      className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-9 text-xs font-bold text-blue-500 mt-1"
                    />
                  </div>
                </div>
              )}

              {!['CASH', 'CREDIT'].includes(editMethod) && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">
                    Referencia / Comprobante (opcional)
                  </Label>
                  <Input
                    value={editReference}
                    onChange={e => setEditReference(e.target.value)}
                    placeholder="# de transferencia o comprobante..."
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2 border-t border-[var(--border-subtle)]/40">
                <Button
                  variant="outline"
                  className="flex-1 h-11 rounded-xl font-bold text-sm cursor-pointer"
                  onClick={() => setPaymentEditDialog(null)}
                  disabled={isSavingPaymentMethod}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md border-0 cursor-pointer"
                  onClick={handleSavePaymentMethod}
                  disabled={isSavingPaymentMethod}
                >
                  {isSavingPaymentMethod ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Guardando...
                    </>
                  ) : (
                    'Guardar Método'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      )}

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
                      <p className="text-xs text-[var(--text-secondary)]">Pago: <span className={`font-bold ${o.paymentStatus === 'CONFIRMED' ? 'text-emerald-600' : 'text-amber-600'}`}>{o.paymentStatus === 'CONFIRMED' ? '✓ Cobrado' : o.paymentStatus === 'DRIVER_CASH_PENDING' ? 'Efectivo con domiciliario' : 'Pendiente'}</span></p>
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
                    <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                      onClick={async () => {
                        const orderWithDriver = {
                          ...o,
                          deliveryDriver: o.deliveryDriver || (o.deliveryDriverId ? drivers.find(d => d.id === o.deliveryDriverId) : undefined)
                        };
                        alerts.toast(`Enviando pedido #${o.orderNumber} a impresión...`);
                        const res = await printComandaSmart(orderWithDriver, 'caja', user?.role, false, false);
                        if (res?.error) {
                          alerts.error('Error al imprimir', res.error);
                        } else {
                          alerts.toast(`Pedido #${o.orderNumber} enviado a la impresora`);
                        }
                      }}
                      title="Imprimir Factura"
                    >
                      <Printer className="h-3.5 w-3.5 text-blue-500" /> Imprimir Ticket
                    </Button>
                    {!isDeliveryStaff && o.paymentStatus !== 'CONFIRMED' && isReadyForCollection(o) && (
                      <Button size="sm" className="h-9 px-4 text-xs font-extrabold bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl gap-1.5 border-0 cursor-pointer shadow-xs active:scale-95 transition-all"
                        onClick={() => { setDetailOrder(null); setCollectDialog(o); }}
                        title="Cobrar pedido"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Cobrar Pedido
                      </Button>
                    )}
                    {hasPermission('dispatch.change_status') && o.orderType !== 'PICKUP' && o.orderType !== 'LOCAL' && activeStatuses.includes(o.status) && (
                      <Button size="sm" variant="outline" className={`h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer ${o.deliveryDriver ? 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10' : 'border-amber-500/30 text-amber-600 hover:bg-amber-500/10'}`}
                        onClick={() => { setDetailOrder(null); setSelectedDriverId(o.deliveryDriverId || ''); setRegisteringDriverInline(false); setDispatchError(''); setDispatchDialog({ order: o, shouldKick: false }); }}
                        title={o.deliveryDriver ? 'Cambiar repartidor' : 'Asignar repartidor'}>
                        <Bike className="h-3.5 w-3.5" />
                        {o.deliveryDriver ? `Repartidor: ${o.deliveryDriver.name}` : 'Asignar Repartidor'}
                      </Button>
                    )}
                    {!isDeliveryStaff && o.status !== 'CANCELLED' && (
                      <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                        onClick={() => { setDetailOrder(null); navigate(o.tableId ? `/tables/new?tableId=${o.tableId}&editOrderId=${o.id}` : `/orders/new?edit=${o.id}`) }}
                        title="Editar pedido">
                        <Edit className="h-3.5 w-3.5" /> Editar Pedido
                      </Button>
                    )}
                    {!isDeliveryStaff && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="h-9 px-4 text-xs font-bold rounded-xl gap-1.5 cursor-pointer border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                        onClick={() => {
                          setDetailOrder(null)
                          setChatModalOrder(o)
                        }}
                        title="Abrir chat real de WhatsApp para verificar pago y mensajes"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Chat WhatsApp
                      </Button>
                    )}
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

      {chatModalOrder && (
        <OrderWhatsAppModal
          order={chatModalOrder}
          isOpen={Boolean(chatModalOrder)}
          onClose={() => setChatModalOrder(null)}
          onPaymentUpdated={(newMethod) => {
            if (newMethod && chatModalOrder) {
              const tot = Number(chatModalOrder.total) || 0
              const isCash = newMethod === 'CASH'
              const isTransfer = ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(newMethod)
              setManualItemMethods(prev => ({
                ...prev,
                [chatModalOrder.id]: {
                  method: newMethod,
                  cashAmount: isCash ? tot : 0,
                  transferAmount: isTransfer ? tot : 0,
                }
              }))
              if (isCash) {
                setReviewedTransferIds(previous => previous.filter(id => id !== chatModalOrder.id))
              }
            }
            loadOrders(true, true)
          }}
        />
      )}
    </motion.div>
  )
}

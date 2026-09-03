import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatDate, getStatusColor, getStatusLabel, formatThousandsInput, parseThousandsInput } from '@/lib/utils'
import { Banknote, CheckCircle2, XCircle, RefreshCw, ReceiptText, LockKeyhole, CalendarDays, Loader2, Lock, User, TrendingUp, TrendingDown, Clock, ChevronRight, Users, DollarSign, Printer, Search, LockOpen, Wallet, AlertTriangle } from 'lucide-react'
import { printClosingSmart, printOpeningSmart } from '@/lib/printer'
import Swal from 'sweetalert2'
import { io } from '@/lib/socket'
import { alerts } from '@/lib/alerts'

interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  status: string
  confirmedAt: string | null
  createdAt: string
  order: { id: string; orderNumber: number; customerName: string; customerPhone: string; total: number; cashRegisterId?: string | null }
}

interface CashSummary {
  totalCash: number
  totalTransfers: number
  totalSales: number
  totalTips: number
  totalExpenses: number
  orderCount: number
  isOpen: boolean
  initialCash: number
}

interface CashClosing {
  id: string
  shiftStart: string
  shiftEnd: string
  totalCash: number
  totalTransfers: number
  totalSales: number
  totalExpenses: number
  totalTips: number
  discrepancy: number
  initialCash: number
  notes: string | null
  isOpen: boolean
  createdAt: string
  user: { id: string; name: string }
}

const todayValue = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().split('T')[0]
}
const nowLocalValue = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
}

export default function PaymentsPage() {
  const { user, hasRole } = useAuth()
  const canManageCash = hasRole('SUPERADMIN', 'ADMIN', 'CASHIER')
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<CashSummary | null>(null)
  const [allCashes, setAllCashes] = useState<CashClosing[]>([])
  const [closings, setClosings] = useState<CashClosing[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(todayValue())
  const [dateMode, setDateMode] = useState<'date' | 'month'>('date')
  const [status, setStatus] = useState('ALL')
  const [method, setMethod] = useState('ALL')
  const [shiftStart, setShiftStart] = useState(nowLocalValue())
  const [notes, setNotes] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [openingDialog, setOpeningDialog] = useState(false)
  const [initialCash, setInitialCash] = useState('0')
  const [openingLoading, setOpeningLoading] = useState(false)
  const [closingLoading, setClosingLoading] = useState(false)
  const [closingResult, setClosingResult] = useState<CashClosing | null>(null)
  const [closingSummaryOpen, setClosingSummaryOpen] = useState(false)
  const [printingZ, setPrintingZ] = useState(false)
  const [detailClosing, setDetailClosing] = useState<CashClosing | null>(null)

  // Arqueo de Caja Físico state
  const [arqueoModalOpen, setArqueoModalOpen] = useState(false)
  const [countedCashInput, setCountedCashInput] = useState('')

  // Active cash register states
  const [activeRegisterId, setActiveRegisterId] = useState<string | null>(null)
  const [registersList, setRegistersList] = useState<any[]>([])
  const [selectedRegisterId, setSelectedRegisterId] = useState<string>('')
  const [filterRegister, setFilterRegister] = useState<'mine' | 'all'>('mine')

  // Cartera / Cuentas por Cobrar state
  const [paymentTab, setPaymentTab] = useState<'closing' | 'collect' | 'cartera'>('closing')
  const [creditOrders, setCreditOrders] = useState<any[]>([])
  const [loadingCredits, setLoadingCredits] = useState(false)
  const [carteraSearch, setCarteraSearch] = useState('')
  const [liquidateDialog, setLiquidateDialog] = useState<any | null>(null)
  const [liquidateMethod, setLiquidateMethod] = useState('CASH')
  const [liquidateRef, setLiquidateRef] = useState('')
  const [liquidating, setLiquidating] = useState(false)

  // Pedidos por Cobrar state
  const [collectOrders, setCollectOrders] = useState<any[]>([])
  const [loadingCollect, setLoadingCollect] = useState(false)
  const [collectSearch, setCollectSearch] = useState('')
  const [collectDialog, setCollectDialog] = useState<any | null>(null)
  const [collectMethod, setCollectMethod] = useState('CASH')
  const [collectRef, setCollectRef] = useState('')
  const [collecting, setCollecting] = useState(false)

  const loadCollectOrders = async () => {
    setLoadingCollect(true)
    try {
      const res = await api.get<any[]>('/orders?paymentStatus=PENDING')
      const filtered = res.filter(o => o.paymentMethod !== 'CREDIT' && o.status !== 'CANCELLED')
      setCollectOrders(filtered)
    } catch (err) {
      console.error('Error al cargar pedidos por cobrar', err)
    } finally {
      setLoadingCollect(false)
    }
  }

  const handleCollect = async () => {
    if (!collectDialog) return
    setCollecting(true)
    try {
      if (collectDialog.status !== 'DELIVERED') {
        await api.put(`/orders/${collectDialog.id}/status`, { status: 'DELIVERED' })
      }
      await api.put(`/orders/${collectDialog.id}/payment`, {
        method: collectMethod,
        paymentStatus: 'CONFIRMED',
        reference: collectRef || null,
      })
      setCollectDialog(null)
      setCollectRef('')
      loadCollectOrders()
      loadData()
      alerts.success('Pago Registrado', 'El pago ha sido registrado correctamente y la comanda cobrada.')
    } catch (err: any) {
      alerts.error('Error al cobrar', err.message || 'Error al registrar cobro')
    } finally {
      setCollecting(false)
    }
  }

  const loadCredits = async () => {
    setLoadingCredits(true)
    try {
      const res = await api.get<any[]>('/orders?paymentMethod=CREDIT&paymentStatus=PENDING')
      setCreditOrders(res)
    } catch (err) {
      console.error('Error al cargar cartera', err)
    } finally {
      setLoadingCredits(false)
    }
  }

  const handleLiquidate = async () => {
    if (!liquidateDialog) return
    setLiquidating(true)
    try {
      await api.put(`/payments/credit/${liquidateDialog.id}/pay`, {
        method: liquidateMethod,
        reference: liquidateRef || null,
      })
      setLiquidateDialog(null)
      setLiquidateRef('')
      loadCredits()
      loadData()
      alerts.success('Crédito Liquidado', 'El crédito ha sido liquidado correctamente y cargado al arqueo de caja.')
    } catch (err: any) {
      alerts.error('Error al liquidar', err.message || 'Error al liquidar crédito')
    } finally {
      setLiquidating(false)
    }
  }

  const [loadError, setLoadError] = useState('')

  const loadData = () => {
    if (!canManageCash) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (status !== 'ALL') params.set('status', status)
    if (method !== 'ALL') params.set('method', method)
    const fetchAllCashes = ['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user?.role || '')
      ? api.get<CashClosing[]>('/payments/closing/all-today')
      : Promise.resolve([] as CashClosing[])

    Promise.allSettled([
      api.get<Payment[]>(`/payments?${params.toString()}`),
      api.get<CashSummary>('/payments/closing/today'),
      api.get<CashClosing[]>(`/payments/closing/history?date=${date}`),
      fetchAllCashes,
      api.get<any>('/payments/opening/status'),
      api.get<any[]>('/cash-registers'),
    ]).then(([paymentsRes, summaryRes, closingsRes, allCashesRes, openStatusRes, registersRes]) => {
      if (paymentsRes.status === 'fulfilled') setPayments(paymentsRes.value)
      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value)
      else if (summaryRes.status === 'rejected') setLoadError(summaryRes.reason?.message || 'No se pudo cargar la caja')
      if (closingsRes.status === 'fulfilled') setClosings(closingsRes.value)
      if (allCashesRes.status === 'fulfilled') setAllCashes(allCashesRes.value)
      if (openStatusRes.status === 'fulfilled') {
        setActiveRegisterId(openStatusRes.value?.cashRegisterId || null)
      }
      if (registersRes.status === 'fulfilled') setRegistersList(registersRes.value)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
    loadCredits()
    loadCollectOrders()

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    const handleUpdate = () => {
      loadData()
      loadCredits()
      loadCollectOrders()
    }

    socket.on('newOrder', handleUpdate)
    socket.on('cashRegistersChanged', handleUpdate)
    socket.on('cashStatusChanged', handleUpdate)
    socket.on('paymentUpdated', handleUpdate)
    socket.on('orderUpdated', handleUpdate)
    socket.on('orderCreated', handleUpdate)
    socket.on('orderStatusChanged', handleUpdate)

    return () => {
      socket.disconnect()
    }
  }, [date, method, status, canManageCash])

  const displayedCashes = useMemo(() => {
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')
    if (isAdmin) return allCashes
    return allCashes.filter(c => c.user.id === user?.id)
  }, [allCashes, user])

  const filteredPayments = useMemo(() => {
    if (filterRegister === 'mine' && activeRegisterId) {
      return payments.filter(p => p.order?.cashRegisterId === activeRegisterId || !p.order?.cashRegisterId)
    }
    return payments
  }, [payments, filterRegister, activeRegisterId])

  const paymentStats = useMemo(() => {
    return {
      pending: filteredPayments.filter(payment => payment.status === 'PENDING').length,
      confirmed: filteredPayments.filter(payment => payment.status === 'CONFIRMED').length,
      rejected: filteredPayments.filter(payment => payment.status === 'REJECTED').length,
      total: filteredPayments.reduce((sum, payment) => sum + payment.amount, 0),
    }
  }, [filteredPayments])

  const filteredCollectOrders = useMemo(() => {
    let orders = collectOrders
    if (filterRegister === 'mine' && activeRegisterId) {
      orders = orders.filter((o: any) => o.cashRegisterId === activeRegisterId || !o.cashRegisterId)
    }
    if (collectSearch.trim()) {
      const s = collectSearch.toLowerCase()
      orders = orders.filter((o: any) =>
        (o.customerName && o.customerName.toLowerCase().includes(s)) ||
        (o.customerPhone && o.customerPhone.toLowerCase().includes(s)) ||
        (o.orderNumber && o.orderNumber.toString().includes(s))
      )
    }
    return orders
  }, [collectOrders, filterRegister, activeRegisterId, collectSearch])

  const filteredCreditOrders = useMemo(() => {
    let orders = creditOrders
    if (filterRegister === 'mine' && activeRegisterId) {
      orders = orders.filter((o: any) => o.cashRegisterId === activeRegisterId || !o.cashRegisterId)
    }
    if (carteraSearch.trim()) {
      const s = carteraSearch.toLowerCase()
      orders = orders.filter((o: any) =>
        (o.customerName && o.customerName.toLowerCase().includes(s)) ||
        (o.customerPhone && o.customerPhone.toLowerCase().includes(s)) ||
        (o.orderNumber && o.orderNumber.toString().includes(s))
      )
    }
    return orders
  }, [creditOrders, filterRegister, activeRegisterId, carteraSearch])

  const updatePayment = async (id: string, action: 'confirm' | 'reject') => {
    setActionId(id)
    try {
      await api.put(`/payments/${id}/${action}`)
      loadData()
    } finally {
      setActionId(null)
    }
  }

  const handleOpenCash = async () => {
    if (!selectedRegisterId) {
      alerts.error('Selecciona una caja', 'Por favor selecciona una caja registradora')
      return
    }
    setOpeningLoading(true)
    try {
      const openingResult = await api.post<any>('/payments/opening', { 
        initialCash: parseThousandsInput(initialCash),
        cashRegisterId: selectedRegisterId
      })
      setOpeningDialog(false)
      setInitialCash('0')
      setSelectedRegisterId('')
      alerts.success('Caja Abierta', 'El turno de caja ha sido abierto exitosamente.')
      loadData()
    } catch (err: any) {
      alerts.error('Error al abrir caja', err.message || 'No se pudo abrir la caja registradora.')
    } finally {
      setOpeningLoading(false)
    }
  }

  const expectedCashAmount = useMemo(() => {
    if (!summary) return 0
    return (summary.initialCash || 0) + (summary.totalCash || 0) - (summary.totalExpenses || 0)
  }, [summary])

  const handleCreateClosing = async () => {
    if (!summary?.isOpen) {
      alerts.error('Caja Cerrada', 'Primero debes abrir caja antes de realizar el cierre')
      setOpeningDialog(true)
      return
    }
    setCountedCashInput(expectedCashAmount.toString())
    setArqueoModalOpen(true)
  }

  const executeFinalClosing = async () => {
    setClosingLoading(true)
    try {
      const physicalCashVal = parseFloat(countedCashInput) || 0
      const result = await api.post<CashClosing>('/payments/closing', { 
        shiftStart, 
        notes,
        cashRegisterId: activeRegisterId || undefined,
        physicalCash: physicalCashVal
      })
      setClosingResult(result)
      setArqueoModalOpen(false)
      setClosingSummaryOpen(true)
      setNotes('')
      setShiftStart(nowLocalValue())
      alerts.success('Caja Cerrada', 'El arqueo y cierre de caja ha sido completado exitosamente.')
      loadData()
    } catch (err: any) {
      alerts.error('Error al cerrar caja', err.message || 'No se pudo completar el cierre.')
    } finally {
      setClosingLoading(false)
    }
  }

  const getShiftDuration = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime()
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-medium">Cargando pagos y caja...</span>
      </div>
    )
  }

  if (!canManageCash) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-16 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--warning)]/10 text-[var(--warning)] mx-auto shadow-inner">
          <Lock className="h-8 w-8" />
        </div>
        <div>
          <h2 className="antifont text-3xl tracking-wider text-[var(--text-primary)] mb-2">CAJA EXCLUSIVA</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Tu rol actual (<strong className="text-[var(--text-primary)]">{user?.role === 'DELIVERY_MANAGER' ? 'Gestor de Domicilios' : user?.role}</strong>) no tiene autorización para operar la caja registradora.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-xs text-left space-y-2">
          <p className="text-[var(--text-secondary)]">Para realizar operaciones de caja, inicia sesión con las siguientes credenciales:</p>
          <div className="bg-[var(--bg-elevated)] p-3 rounded-xl space-y-1 font-mono text-[var(--text-primary)]">
            <p>Usuario: <span className="text-[var(--accent)] font-bold">cajero@thevilladog.local</span></p>
            <p>Contraseña: <span className="text-[var(--accent)] font-bold">caja123</span></p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div>
          <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">PAGOS & CAJA</h2>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">Monitoreo de transacciones, múltiples terminales y arqueo de caja diario.</p>
        </div>
        <div className="flex items-center gap-3">
          {summary?.isOpen ? (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
              <Badge className="bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-semibold text-xs">
                <span className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                Caja Abierta
              </Badge>
            </motion.div>
          ) : (
            <Badge variant="outline" className="bg-[var(--destructive)]/10 text-[var(--destructive)] border border-[var(--destructive)]/20 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-semibold text-xs">
              <span className="h-2 w-2 rounded-full bg-[var(--destructive)]" />
              Caja Cerrada
            </Badge>
          )}
          <Button 
            variant="outline" 
            onClick={loadData} 
            className="border-[var(--border-default)] bg-[var(--bg-panel)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all rounded-xl h-10"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
        </div>
      </motion.div>

      {/* Tabs Selector */}
      <div className="flex border-b border-[var(--border-subtle)] pb-px">
        <button
          onClick={() => setPaymentTab('closing')}
          className={`px-5 py-2.5 text-sm font-semibold tracking-wider transition-all border-b-2 -mb-px ${
            paymentTab === 'closing'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          CONTROL DE CAJA
        </button>
        <button
          onClick={() => setPaymentTab('collect')}
          className={`px-5 py-2.5 text-sm font-semibold tracking-wider transition-all border-b-2 -mb-px ${
            paymentTab === 'collect'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          PEDIDOS POR COBRAR
        </button>
        <button
          onClick={() => setPaymentTab('cartera')}
          className={`px-5 py-2.5 text-sm font-semibold tracking-wider transition-all border-b-2 -mb-px ${
            paymentTab === 'cartera'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          CUENTAS POR COBRAR (CARTERA)
        </button>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-4 py-3 text-sm text-[var(--destructive)] flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--destructive)]" />
          {loadError}
        </div>
      )}

      {paymentTab === 'closing' ? (
        <>
          {/* Stats Cards */}
          <motion.div className="grid grid-cols-2 gap-4 lg:grid-cols-5" variants={stagger}>
            {[
              { label: 'Ventas del día', value: formatCurrency(summary?.totalSales || 0), color: 'text-[var(--text-primary)]', icon: DollarSign, bgGlow: 'from-[var(--success)]/10 to-transparent' },
              { label: 'Efectivo en Caja', value: formatCurrency(summary?.totalCash || 0), color: 'text-[var(--accent)]', icon: Banknote, bgGlow: 'from-[var(--accent)]/10 to-transparent' },
              { label: 'Transferencias', value: formatCurrency(summary?.totalTransfers || 0), color: 'text-[var(--text-primary)]', icon: RefreshCw, bgGlow: 'from-blue-500/10 to-transparent' },
              { label: 'Gastos de Hoy', value: formatCurrency(summary?.totalExpenses || 0), color: 'text-[var(--destructive)]', icon: TrendingDown, bgGlow: 'from-[var(--destructive)]/10 to-transparent' },
              { label: 'Pagos Pendientes', value: paymentStats.pending.toString(), color: 'text-[var(--warning)]', icon: Clock, bgGlow: 'from-[var(--warning)]/10 to-transparent' },
            ].map((stat) => {
              const Icon = stat.icon
              return (
                <motion.div key={stat.label} variants={fadeUp}>
                  <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] relative overflow-hidden rounded-2xl">
                    <div className={`absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br ${stat.bgGlow} rounded-full blur-2xl`} />
                    <CardContent className="p-5 flex items-start justify-between relative z-10">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{stat.label}</p>
                        <p className={`text-2xl font-bold ${stat.color} tracking-tight`}>{stat.value}</p>
                      </div>
                      <div className="p-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        <Icon className="h-5 w-5" />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>

          {/* Active Cashier Info */}
          {displayedCashes.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl relative overflow-hidden rounded-2xl">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-[var(--accent)]" />
                <CardHeader className="pb-3 px-6 pt-5">
                  <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-base font-bold">
                    <Users className="h-5 w-5 text-[var(--accent)]" /> {['ADMIN', 'SUPERADMIN'].includes(user?.role || '') ? 'Cajas Activas' : 'Mi Caja Activa'}
                  </CardTitle>
                  <CardDescription className="text-xs text-[var(--text-secondary)]">
                    {['ADMIN', 'SUPERADMIN'].includes(user?.role || '') 
                      ? 'Múltiples cajeros operando simultáneamente en el sistema hoy' 
                      : 'Detalles de tu caja operando actualmente en el sistema'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-5">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {displayedCashes.map(cash => {
                      const isMyCash = cash.user.id === user?.id
                      return (
                        <div 
                          key={cash.id} 
                          className={`flex items-center gap-4 rounded-2xl border p-4 ${
                            isMyCash 
                              ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5' 
                              : 'border-[var(--border-default)] bg-[var(--bg-elevated)] transition-all hover:border-[var(--accent)]/30'
                          }`}
                        >
                          <div className="relative">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isMyCash ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-neutral-800 text-[var(--text-secondary)]'}`}>
                              <User className="h-6 w-6" />
                            </div>
                            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[var(--success)] border-2 border-[var(--bg-elevated)] animate-pulse" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                              {cash.user.name} {isMyCash && <span className="text-[10px] text-[var(--accent)] font-extrabold">(Tú)</span>}
                            </p>
                            <p className="text-xs text-[var(--text-secondary)]">
                              Caja inicial: <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(cash.initialCash)}</span>
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                              Abierta: {formatDate(cash.shiftStart)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Filters Area */}
          <motion.div variants={fadeUp}>
            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--border-default)] p-1 rounded-xl shrink-0">
                    <button
                      type="button"
                      onClick={() => { setDateMode('date'); setDate(todayValue()); }}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${dateMode === 'date' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    >
                      Día
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDateMode('month'); setDate(todayValue().substring(0, 7)); }}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${dateMode === 'month' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    >
                      Mes
                    </button>
                  </div>
                  <div className="relative">
                    <CalendarDays className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    <Input 
                      type={dateMode} 
                      className="w-44 pl-10 h-10 bg-[var(--bg-input)] border-[var(--border-default)] focus:border-[var(--accent)] text-sm rounded-xl transition-all" 
                      value={date} 
                      onChange={event => setDate(event.target.value)} 
                    />
                  </div>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-48 h-10 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                      <SelectItem value="ALL">Todos los estados</SelectItem>
                      <SelectItem value="PENDING">Pendientes</SelectItem>
                      <SelectItem value="CONFIRMED">Confirmados</SelectItem>
                      <SelectItem value="REJECTED">Rechazados</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="w-48 h-10 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm">
                      <SelectValue placeholder="Método" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                      <SelectItem value="ALL">Todos los métodos</SelectItem>
                      <SelectItem value="CASH">Efectivo</SelectItem>
                      <SelectItem value="TRANSFER">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                  {activeRegisterId && (
                    <div className="flex items-center border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-input)] p-0.5 h-10 select-none">
                      <button
                        onClick={() => setFilterRegister('mine')}
                        className={`h-full px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          filterRegister === 'mine'
                            ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        Mi Caja
                      </button>
                      <button
                        onClick={() => setFilterRegister('all')}
                        className={`h-full px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          filterRegister === 'all'
                            ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        Todas las Cajas
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)] px-2.5 py-1 rounded-lg">{paymentStats.confirmed} confirmados</Badge>
                  <Badge variant="outline" className="text-[var(--text-muted)] border-[var(--border-default)] px-2.5 py-1 rounded-lg">{paymentStats.rejected} rechazados</Badge>
                  <Badge className="bg-[var(--accent)] text-[var(--accent-fg)] font-bold px-3 py-1 rounded-lg shadow-sm">{formatCurrency(paymentStats.total)}</Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Main Grid */}
          <motion.div className="grid gap-6 xl:grid-cols-[1fr_380px]" variants={fadeUp}>
            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl">
              <CardHeader className="border-b border-[var(--border-subtle)] pb-4 px-6">
                <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-lg">
                  <Banknote className="h-5 w-5 text-[var(--accent)]" /> Pagos Registrados
                </CardTitle>
                <CardDescription className="text-xs text-[var(--text-secondary)]">Confirma o rechaza los soportes de pago cargados por los clientes/domiciliarios.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {filteredPayments.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-12 text-center text-sm text-[var(--text-secondary)]">
                    <ReceiptText className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3" />
                    No hay pagos registrados con los filtros seleccionados.
                  </div>
                )}
                <AnimatePresence>
                  {filteredPayments.map((payment, index) => (
                    <motion.div
                      key={payment.id}
                      className="flex flex-col gap-4 rounded-2xl bg-[var(--bg-elevated)] p-4 lg:flex-row lg:items-center lg:justify-between border border-[var(--border-subtle)] hover:border-[var(--accent)]/20 transition-all duration-200"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/orders/${payment.order.id}`} className="antifont text-lg text-[var(--accent)] hover:underline">
                            #{payment.order.orderNumber}
                          </Link>
                          <p className="font-semibold text-[var(--text-primary)] truncate max-w-[180px]">
                            {payment.order.customerName}
                          </p>
                          <Badge 
                            variant="outline" 
                            className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider"
                            style={{ 
                              borderColor: `${getStatusColor(payment.status)}30`, 
                              color: getStatusColor(payment.status),
                              backgroundColor: `${getStatusColor(payment.status)}08`
                            }}
                          >
                            {getStatusLabel(payment.status)}
                          </Badge>
                          <Badge variant="secondary" className="bg-[var(--bg-panel)] text-[var(--text-secondary)] px-2.5 py-0.5 rounded-full text-[10px]">
                            {getStatusLabel(payment.method)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                          <span>{payment.order.customerPhone}</span>
                          <span className="text-[var(--text-muted)]">•</span>
                          <span>{formatDate(payment.createdAt)}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
                        <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">{formatCurrency(payment.amount)}</span>
                        {payment.status === 'PENDING' && (
                          <div className="flex items-center gap-2">
                            <Button 
                              size="sm" 
                              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-md shadow-[var(--accent)]/10 rounded-xl px-3"
                              onClick={() => updatePayment(payment.id, 'confirm')} 
                              disabled={actionId === payment.id}
                            >
                              {actionId === payment.id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Confirmar
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive" 
                              className="bg-[var(--destructive)]/10 hover:bg-[var(--destructive)] hover:text-white text-[var(--destructive)] border border-[var(--destructive)]/20 shadow-sm rounded-xl px-3 transition-all"
                              onClick={() => updatePayment(payment.id, 'reject')} 
                              disabled={actionId === payment.id}
                            >
                              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Rechazar
                            </Button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </CardContent>
            </Card>

            {/* Right Panel: Opening/Closing Cash & history */}
            <div className="space-y-6">
              <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl relative overflow-hidden rounded-2xl">
                <CardHeader className="border-b border-[var(--border-subtle)] pb-4">
                  <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-base font-bold">
                    <LockKeyhole className="h-5 w-5 text-[var(--accent)]" /> {summary?.isOpen ? 'Cerrar Caja' : 'Apertura de Caja'}
                  </CardTitle>
                  <CardDescription className="text-xs text-[var(--text-secondary)]">
                    {summary?.isOpen ? 'Registra el cierre con los totales calculados del día.' : 'Abre tu caja para comenzar a operar.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {summary?.isOpen ? (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Inicio del turno</Label>
                        <Input 
                          type="datetime-local" 
                          className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 text-sm" 
                          value={shiftStart} 
                          onChange={event => setShiftStart(event.target.value)} 
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Notas u Observaciones</Label>
                        <Textarea 
                          className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl min-h-[80px] text-sm" 
                          value={notes} 
                          onChange={event => setNotes(event.target.value)} 
                          placeholder="Observaciones del cierre, diferencias, etc..." 
                        />
                      </div>
                      
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 text-sm space-y-3 shadow-inner">
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Caja inicial</span>
                          <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(summary?.initialCash || 0)}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-[var(--success)]" /> Ventas Totales</span>
                          <span className="text-[var(--text-primary)] font-bold">{formatCurrency(summary?.totalSales || 0)}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Pedidos Entregados</span>
                          <span className="font-semibold text-[var(--text-primary)]">{summary?.orderCount || 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Propinas</span>
                          <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(summary?.totalTips || 0)}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span className="flex items-center gap-1.5"><TrendingDown className="h-3.5 w-3.5 text-[var(--destructive)]" /> Gastos</span>
                          <span className="text-[var(--destructive)] font-bold">-{formatCurrency(summary?.totalExpenses || 0)}</span>
                        </div>
                        <div className="h-px w-full bg-[var(--border-default)] my-1" />
                        <div className="flex justify-between text-[var(--text-primary)] font-bold text-base">
                          <span>Neto a Entregar</span>
                          <span className="text-[var(--accent)] font-extrabold text-lg">{formatCurrency((summary?.totalSales || 0) - (summary?.totalExpenses || 0))}</span>
                        </div>
                      </div>
                      <Button 
                        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 h-11 rounded-xl transition-all" 
                        onClick={handleCreateClosing} 
                        disabled={closingLoading}
                      >
                        {closingLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {closingLoading ? 'Cerrando caja...' : 'Cerrar Caja'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-6 text-center space-y-3 shadow-inner">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--warning)]/10 text-[var(--warning)] mx-auto">
                          <Lock className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-[var(--text-primary)] font-bold text-sm">Tu caja está cerrada</p>
                          <p className="text-xs text-[var(--text-secondary)] mt-1">Abre tu caja registradora con un monto inicial para comenzar a operar hoy.</p>
                        </div>
                      </div>
                      <Button 
                        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 h-11 rounded-xl transition-all" 
                        onClick={() => setOpeningDialog(true)}
                      >
                        <LockKeyhole className="mr-2 h-4 w-4" /> Abrir Mi Caja
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl">
                <CardHeader className="border-b border-[var(--border-subtle)] pb-4">
                  <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-base font-bold">
                    <ReceiptText className="h-5 w-5 text-[var(--accent)]" /> Cierres del Día
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  {closings.length === 0 && <p className="text-xs text-center py-4 text-[var(--text-muted)]">Aún no hay cierres registrados hoy.</p>}
                  <AnimatePresence>
                    {closings.map((closing, index) => (
                      <motion.div
                        key={closing.id}
                        className="group cursor-pointer rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--accent)]/30"
                        onClick={() => setDetailClosing(closing)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        whileHover={{ x: 4 }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] group-hover:bg-[var(--accent)]/20 transition-all">
                              <User className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)]">{closing.user.name}</p>
                              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatDate(closing.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <p className="text-sm font-bold text-[var(--accent)]">{formatCurrency(closing.totalSales)}</p>
                              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{getShiftDuration(closing.shiftStart, closing.shiftEnd)}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-[var(--text-muted)] transition-transform group-hover:translate-x-1" />
                          </div>
                        </div>
                        {closing.notes && <p className="mt-3 text-xs text-[var(--text-secondary)] border-t border-[var(--border-subtle)] pt-2 line-clamp-2 italic">"{closing.notes}"</p>}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </>
      ) : paymentTab === 'collect' ? (
        <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
          {/* Collect stats */}
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] relative overflow-hidden rounded-2xl md:col-span-2">
              <div className="absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br from-[var(--accent)]/10 to-transparent rounded-full blur-2xl" />
              <CardContent className="p-6 relative z-10 flex flex-col justify-between h-full">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wider">Total Pendiente por Cobrar</p>
                  <h3 className="text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
                    {formatCurrency(filteredCollectOrders.reduce((sum, order) => sum + (order.total || 0), 0))}
                  </h3>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-4">
                  Listado de pedidos entregados o listos pendientes de cobrar al cliente o al motorizado. Al registrar el cobro, el dinero ingresará automáticamente al cuadre de caja de tu turno activo.
                </p>
              </CardContent>
            </Card>

            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl relative overflow-hidden rounded-2xl">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Pedidos por Cobrar</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">{filteredCollectOrders.length} comandas</p>
                  </div>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" />
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <Input
                    placeholder="Filtrar por cliente, cel o #..."
                    className="w-full pl-9 h-10 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm"
                    value={collectSearch}
                    onChange={(e) => setCollectSearch(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* List of pending collections */}
          <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl">
            <CardHeader className="border-b border-[var(--border-subtle)] pb-4 px-6">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-lg">
                <ReceiptText className="h-5 w-5 text-[var(--accent)]" /> Detalle de Pedidos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {loadingCollect ? (
                <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--accent)]" />
                  <span>Cargando pedidos por cobrar...</span>
                </div>
              ) : filteredCollectOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-12 text-center text-sm text-[var(--text-secondary)]">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-[var(--success)] mb-3" />
                  ¡Todo al día! No hay pedidos pendientes de cobrar.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredCollectOrders.map((order) => (
                      <div
                        key={order.id}
                        className="flex flex-col gap-4 rounded-2xl bg-[var(--bg-elevated)] p-4 lg:flex-row lg:items-center lg:justify-between border border-[var(--border-subtle)] hover:border-[var(--accent)]/20 transition-all duration-200"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/orders/${order.id}`} className="antifont text-lg text-[var(--accent)] hover:underline">
                              #{order.orderNumber}
                            </Link>
                            <p className="font-semibold text-[var(--text-primary)] truncate max-w-[180px]">
                              {order.customerName}
                            </p>
                            <Badge variant="outline" className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border-[var(--accent)]/30 text-[var(--accent)] bg-[var(--accent)]/5">
                              {order.status}
                            </Badge>
                            {order.assignee && (
                              <Badge variant="secondary" className="bg-[var(--bg-panel)] text-[var(--text-secondary)] px-2.5 py-0.5 rounded-full text-[10px]">
                                Repartidor: {order.assignee.name}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                            <span>{order.customerPhone}</span>
                            <span className="text-[var(--text-muted)]">•</span>
                            <span>{formatDate(order.createdAt)}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
                          <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">{formatCurrency(order.total)}</span>
                          <Button
                            size="sm"
                            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-md shadow-[var(--accent)]/10 rounded-xl px-4 h-9"
                            onClick={() => {
                              setCollectDialog(order)
                              setCollectMethod('CASH')
                              setCollectRef('')
                            }}
                          >
                            <DollarSign className="mr-1.5 h-4 w-4" /> Registrar Cobro
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
          {/* Cartera stats */}
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] relative overflow-hidden rounded-2xl md:col-span-2">
              <div className="absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br from-[var(--accent)]/10 to-transparent rounded-full blur-2xl" />
              <CardContent className="p-6 relative z-10 flex flex-col justify-between h-full">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wider">Total en Cartera</p>
                  <h3 className="text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
                    {formatCurrency(filteredCreditOrders.reduce((sum, order) => sum + (order.total || 0), 0))}
                  </h3>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-4">
                  Cuentas por cobrar acumuladas de clientes que compraron a crédito (fiado). Al liquidar una deuda, el pago se sumará a los ingresos de tu turno actual de caja.
                </p>
              </CardContent>
            </Card>

            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl relative overflow-hidden rounded-2xl">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Créditos Pendientes</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">{filteredCreditOrders.length} facturas</p>
                  </div>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" />
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <Input
                    placeholder="Filtrar por cliente, cel o #..."
                    className="w-full pl-9 h-10 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm"
                    value={carteraSearch}
                    onChange={(e) => setCarteraSearch(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* List of pending credits */}
          <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl">
            <CardHeader className="border-b border-[var(--border-subtle)] pb-4 px-6">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-lg">
                <ReceiptText className="h-5 w-5 text-[var(--accent)]" /> Detalle de Deudas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {loadingCredits ? (
                <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--accent)]" />
                  <span>Cargando cartera...</span>
                </div>
              ) : filteredCreditOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-12 text-center text-sm text-[var(--text-secondary)]">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-[var(--success)] mb-3" />
                  ¡Cartera al día! No hay cuentas por cobrar pendientes.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredCreditOrders.map((order) => (
                      <div
                        key={order.id}
                        className="flex flex-col gap-4 rounded-2xl bg-[var(--bg-elevated)] p-4 lg:flex-row lg:items-center lg:justify-between border border-[var(--border-subtle)] hover:border-[var(--accent)]/20 transition-all duration-200"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/orders/${order.id}`} className="antifont text-lg text-[var(--accent)] hover:underline">
                              #{order.orderNumber}
                            </Link>
                            <p className="font-semibold text-[var(--text-primary)] truncate max-w-[180px]">
                              {order.customerName}
                            </p>
                            <Badge variant="outline" className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/5">
                              CRÉDITO PENDIENTE
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                            <span>{order.customerPhone}</span>
                            <span className="text-[var(--text-muted)]">•</span>
                            <span>{formatDate(order.createdAt)}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
                          <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">{formatCurrency(order.total)}</span>
                          <Button
                            size="sm"
                            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-md shadow-[var(--accent)]/10 rounded-xl px-4 h-9"
                            onClick={() => {
                              setLiquidateDialog(order)
                              setLiquidateMethod('CASH')
                              setLiquidateRef('')
                            }}
                          >
                            <DollarSign className="mr-1.5 h-4 w-4" /> Registrar Pago
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Arqueo Físico de Caja Dialog */}
      <Dialog open={arqueoModalOpen} onOpenChange={setArqueoModalOpen}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-md rounded-3xl shadow-2xl p-6">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2 text-xl font-extrabold">
              <Banknote className="h-6 w-6 text-[var(--accent)]" /> Arqueo Físico de Caja
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--text-secondary)]">
              Ingresa el dinero en efectivo que contaste físicamente en el cajón monedero antes de cerrar el turno.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Resumen del Turno */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 space-y-2 text-xs">
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Base Inicial:</span>
                <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(summary?.initialCash || 0)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Ventas en Efectivo:</span>
                <span className="font-semibold text-[var(--text-primary)]">+{formatCurrency(summary?.totalCash || 0)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Gastos del Turno:</span>
                <span className="text-[var(--destructive)] font-semibold">-{formatCurrency(summary?.totalExpenses || 0)}</span>
              </div>
              <div className="border-t border-[var(--border-default)] pt-2 flex justify-between font-bold text-sm">
                <span className="text-[var(--text-primary)]">Efectivo Esperado (Sistema):</span>
                <span className="text-[var(--accent)] font-extrabold">{formatCurrency(expectedCashAmount)}</span>
              </div>
            </div>

            {/* Input Efectivo Físico */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase">Efectivo Físico Contado ($) *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3.5 top-3.5 h-5 w-5 text-[var(--text-muted)]" />
                <Input
                  type="number"
                  value={countedCashInput}
                  onChange={e => setCountedCashInput(e.target.value)}
                  placeholder="0"
                  className="pl-10 text-xl font-black h-12 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl focus:border-[var(--accent)] text-[var(--text-primary)]"
                />
              </div>
            </div>

            {/* In-live Discrepancy Indicator Badge */}
            {(() => {
              const counted = parseFloat(countedCashInput) || 0
              const diff = counted - expectedCashAmount
              if (diff === 0) {
                return (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Cuadre Perfecto</span>
                    <span>$0 de diferencia</span>
                  </div>
                )
              } else if (diff > 0) {
                return (
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Sobrante en Caja</span>
                    <span>+{formatCurrency(diff)}</span>
                  </div>
                )
              } else {
                return (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Faltante en Caja</span>
                    <span>{formatCurrency(diff)}</span>
                  </div>
                )
              }
            })()}

            {/* Notas opcionales */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Observaciones del Cajero (Opcional)</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ej: Se sacaron $5.000 para dar vuelto..."
                rows={2}
                className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs"
              />
            </div>
          </div>

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={() => setArqueoModalOpen(false)}
              className="flex-1 h-11 rounded-xl font-bold text-xs border-[var(--border-default)] cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              onClick={executeFinalClosing}
              disabled={closingLoading}
              className="flex-1 font-extrabold h-11 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] text-xs uppercase tracking-wider shadow-lg shadow-[var(--accent)]/15 cursor-pointer"
            >
              {closingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar y Cerrar Caja'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opening Cash Register Dialog */}
      <Dialog open={openingDialog} onOpenChange={setOpeningDialog}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-md p-0 overflow-hidden rounded-3xl shadow-2xl">
          <div className="flex flex-col items-center px-8 pt-8 pb-6 bg-gradient-to-b from-[var(--warning)]/10 to-transparent">
            <motion.div
              className="h-16 w-16 rounded-2xl bg-[var(--warning)] flex items-center justify-center mb-4 shadow-lg shadow-[var(--warning)]/20 animate-pulse"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <Lock className="h-7 w-7 text-[#0D0D0D]" />
            </motion.div>
            <h2 className="antifont text-2xl text-[var(--text-primary)] tracking-wider mb-1">ABRIR MI CAJA</h2>
            <p className="text-xs text-[var(--text-secondary)] text-center">Cada cajero gestiona su propia caja de turno de forma independiente</p>
          </div>
          <div className="px-8 pb-8 space-y-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Seleccionar Caja Registradora</Label>
              <Select 
                value={selectedRegisterId} 
                onValueChange={setSelectedRegisterId}
              >
                <SelectTrigger className="h-12 rounded-xl bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)]">
                  <SelectValue placeholder="Seleccionar terminal de caja" />
                </SelectTrigger>
                <SelectContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl">
                  {registersList.map(reg => {
                    const isOpen = reg.closings?.some((c: any) => c.isOpen)
                    const operatorName = reg.closings?.find((c: any) => c.isOpen)?.user?.name
                    return (
                      <SelectItem 
                        key={reg.id} 
                        value={reg.id} 
                        disabled={isOpen}
                        className="text-[var(--text-primary)]"
                      >
                        {reg.name} {isOpen ? `(Abierta por ${operatorName})` : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Monto Inicial en Efectivo ($)</Label>
              <Input 
                type="text" 
                value={formatThousandsInput(initialCash)} 
                onChange={e => setInitialCash(e.target.value.replace(/\D/g, ''))} 
                placeholder="0" 
                className="text-lg h-12 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl focus:border-[var(--accent)] font-semibold" 
              />
            </div>
            <Button 
              className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] h-12 rounded-xl text-base font-bold shadow-lg shadow-[var(--accent)]/15 transition-all" 
              onClick={handleOpenCash} 
              disabled={openingLoading}
            >
              {openingLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LockKeyhole className="mr-2 h-5 w-5" />}
              {openingLoading ? 'Abriendo caja...' : 'Abrir Mi Caja'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cash Register Closed Success Dialog */}
      <Dialog open={closingSummaryOpen} onOpenChange={setClosingSummaryOpen}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-md rounded-3xl shadow-2xl p-6">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2 text-xl font-bold">
              <CheckCircle2 className="h-6 w-6 text-[var(--success)]" /> Cierre Completado
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--text-secondary)]">La caja registradora ha sido cerrada exitosamente para este turno.</DialogDescription>
          </DialogHeader>
          {closingResult && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-5 space-y-3 shadow-inner">
              <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                <span>Efectivo</span>
                <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(closingResult.totalCash)}</span>
              </div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                <span>Transferencias</span>
                <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(closingResult.totalTransfers)}</span>
              </div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                <span>Gastos</span>
                <span className="text-[var(--destructive)] font-semibold">-{formatCurrency(closingResult.totalExpenses)}</span>
              </div>
              <div className="border-t border-[var(--border-default)] pt-3 flex justify-between items-center">
                <span className="text-[var(--text-primary)] font-bold text-sm">Total Ventas de Caja</span>
                <span className="text-[var(--accent)] font-extrabold text-xl">{formatCurrency(closingResult.totalSales)}</span>
              </div>
            </div>
          )}
          <DialogFooter className="mt-4 flex gap-2">
            <Button 
              variant="outline"
              className="flex-1 h-11 rounded-xl font-bold text-xs border-[var(--border-default)]" 
              onClick={() => { setClosingSummaryOpen(false); setClosingResult(null); }}
              disabled={printingZ}
            >
              Confirmar y Salir
            </Button>
            <Button 
              className="flex-1 font-bold h-11 rounded-xl shadow-lg shadow-[var(--accent)]/15 gap-2 text-xs uppercase tracking-wider border-0 outline-none cursor-pointer hover:opacity-90" 
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
              disabled={printingZ}
              onClick={async () => {
                if (!closingResult) return
                setPrintingZ(true)
                try {
                  const detail = await api.get<any>(`/payments/closing/${closingResult.id}/detail`)
                  await printClosingSmart({ ...closingResult, user: { name: user?.name }, _detail: detail }, user?.role)
                } catch (err) {
                  console.error('Error al imprimir Reporte Z', err)
                  alerts.error('Error de Impresión', 'No se pudo imprimir el Reporte Z, pero el cierre de caja se realizó en la base de datos.')
                } finally {
                  setPrintingZ(false)
                  setClosingSummaryOpen(false)
                  setClosingResult(null)
                }
              }}
            >
              {printingZ ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {printingZ ? 'Imprimiendo...' : 'Imprimir Reporte Z'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closing Detail Dialog */}
      <Dialog open={!!detailClosing} onOpenChange={(v) => { if (!v) setDetailClosing(null) }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-lg rounded-3xl shadow-2xl p-6">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2 text-xl font-bold">
              <ReceiptText className="h-6 w-6 text-[var(--accent)]" /> Detalle del Cierre
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--text-secondary)]">Información financiera y desglose detallado del turno de caja.</DialogDescription>
          </DialogHeader>
          {detailClosing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Cajero</span>
                  </div>
                  <p className="text-sm font-bold text-[var(--text-primary)]">{detailClosing.user.name}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Duración del Turno</span>
                  </div>
                  <p className="text-sm font-bold text-[var(--text-primary)]">{getShiftDuration(detailClosing.shiftStart, detailClosing.shiftEnd)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 space-y-3 shadow-inner">
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Resumen Financiero</p>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Monto inicial</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(detailClosing.initialCash || 0)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Efectivo reportado</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(detailClosing.totalCash)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Transferencias</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(detailClosing.totalTransfers)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Propinas</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(detailClosing.totalTips || 0)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Gastos</span><span className="text-[var(--destructive)] font-semibold">-{formatCurrency(detailClosing.totalExpenses)}</span></div>
                <div className="h-px w-full bg-[var(--border-default)] my-1" />
                <div className="flex justify-between text-base font-bold"><span className="text-[var(--text-primary)]">Total ventas</span><span className="text-[var(--accent)] font-extrabold">{formatCurrency(detailClosing.totalSales)}</span></div>
                <div className="flex justify-between text-xs items-center">
                  <span className="text-[var(--text-secondary)]">Diferencia / Discrepancia</span>
                  <span className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${detailClosing.discrepancy !== 0 ? 'bg-[var(--warning)]/15 text-[var(--warning)]' : 'bg-[var(--success)]/15 text-[var(--success)]'}`}>
                    {formatCurrency(detailClosing.discrepancy)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)] font-medium">Inicio:</span>
                  <p className="text-[var(--text-secondary)] mt-0.5 font-medium">{formatDate(detailClosing.shiftStart)}</p>
                </div>
                <div className="rounded-xl bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)] font-medium">Cierre:</span>
                  <p className="text-[var(--text-secondary)] mt-0.5 font-medium">{formatDate(detailClosing.shiftEnd)}</p>
                </div>
              </div>

              {detailClosing.notes && (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 italic">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider not-italic mb-1">Notas del cajero:</p>
                  <p className="text-xs text-[var(--text-primary)]">"{detailClosing.notes}"</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="mt-4 flex gap-2 w-full">
            <Button 
              variant="outline"
              className="flex-1 border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 font-bold h-11 rounded-xl transition-all flex items-center justify-center gap-1.5"
              onClick={async () => {
                if (!detailClosing) return
                try {
                  await printClosingSmart(detailClosing, user?.role)
                } catch (err) {
                  console.error(err)
                }
              }}
            >
              <Printer className="h-4 w-4" /> Re-imprimir
            </Button>
            <Button className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-11 rounded-xl shadow-md transition-all" onClick={() => setDetailClosing(null)}>
              Cerrar Detalle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Liquidate Credit Order Dialog */}
      <Dialog open={!!liquidateDialog} onOpenChange={(v) => { if (!v) setLiquidateDialog(null) }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-md p-0 overflow-hidden rounded-3xl shadow-2xl">
          <div className="flex flex-col items-center px-8 pt-8 pb-6 bg-gradient-to-b from-[var(--accent)]/10 to-transparent">
            <motion.div
              className="h-16 w-16 rounded-2xl bg-[var(--accent)] flex items-center justify-center mb-4 shadow-lg shadow-[var(--accent)]/20"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <DollarSign className="h-8 w-8 text-[var(--accent-fg)]" />
            </motion.div>
            <h2 className="antifont text-2xl text-[var(--text-primary)] tracking-wider mb-1">LIQUIDAR CRÉDITO</h2>
            <p className="text-xs text-[var(--text-secondary)] text-center">Registrar recaudo para el pedido #{liquidateDialog?.orderNumber}</p>
          </div>
          <div className="px-8 pb-8 space-y-5">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 text-center">
              <span className="text-xs text-[var(--text-secondary)] block mb-1">Total a Pagar</span>
              <span className="text-2xl font-extrabold text-[var(--accent)]">{formatCurrency(liquidateDialog?.total || 0)}</span>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Método de Recibo</Label>
              <Select value={liquidateMethod} onValueChange={setLiquidateMethod}>
                <SelectTrigger className="w-full h-11 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm">
                  <SelectValue placeholder="Seleccionar método" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                  <SelectItem value="CASH">Efectivo</SelectItem>
                  <SelectItem value="TRANSFER">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {liquidateMethod === 'TRANSFER' && (
              <div className="space-y-1.5 animate-fade-in">
                <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Referencia de Transferencia</Label>
                <Input
                  value={liquidateRef}
                  onChange={(e) => setLiquidateRef(e.target.value)}
                  placeholder="Número de comprobante, Nequi, etc."
                  className="h-11 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl focus:border-[var(--accent)] text-sm"
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] h-11 rounded-xl font-bold"
                onClick={() => setLiquidateDialog(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] h-11 rounded-xl font-bold shadow-lg shadow-[var(--accent)]/15 transition-all"
                onClick={handleLiquidate}
                disabled={liquidating}
              >
                {liquidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirmar Pago
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Collect Pending Order Dialog */}
      <Dialog open={!!collectDialog} onOpenChange={(v) => { if (!v) setCollectDialog(null) }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)] max-w-md p-0 overflow-hidden rounded-3xl shadow-2xl">
          <div className="flex flex-col items-center px-8 pt-8 pb-6 bg-gradient-to-b from-[var(--accent)]/10 to-transparent">
            <motion.div
              className="h-16 w-16 rounded-2xl bg-[var(--accent)] flex items-center justify-center mb-4 shadow-lg shadow-[var(--accent)]/20"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <DollarSign className="h-8 w-8 text-[var(--accent-fg)]" />
            </motion.div>
            <h2 className="antifont text-2xl text-[var(--text-primary)] tracking-wider mb-1">REGISTRAR COBRO</h2>
            <p className="text-xs text-[var(--text-secondary)] text-center">Registrar pago para el pedido #{collectDialog?.orderNumber}</p>
          </div>
          <div className="px-8 pb-8 space-y-5">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 text-center">
              <span className="text-xs text-[var(--text-secondary)] block mb-1">Total a Pagar</span>
              <span className="text-2xl font-extrabold text-[var(--accent)]">{formatCurrency(collectDialog?.total || 0)}</span>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Método de Pago</Label>
              <Select value={collectMethod} onValueChange={setCollectMethod}>
                <SelectTrigger className="w-full h-11 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-sm">
                  <SelectValue placeholder="Seleccionar método" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                  <SelectItem value="CASH">Efectivo</SelectItem>
                  <SelectItem value="TRANSFER">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {collectMethod === 'TRANSFER' && (
              <div className="space-y-1.5 animate-fade-in">
                <Label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Referencia de Transferencia</Label>
                <Input
                  value={collectRef}
                  onChange={(e) => setCollectRef(e.target.value)}
                  placeholder="Número de comprobante, Nequi, etc."
                  className="h-11 bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl focus:border-[var(--accent)] text-sm"
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] h-11 rounded-xl font-bold"
                onClick={() => setCollectDialog(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] h-11 rounded-xl font-bold shadow-lg shadow-[var(--accent)]/15 transition-all"
                onClick={handleCollect}
                disabled={collecting}
              >
                {collecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirmar Cobro
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}


import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatDate } from '@/lib/utils'
import { 
  Wallet, DollarSign, ArrowUpRight, TrendingUp, History, Filter, Search, 
  Printer, LockOpen, Lock, User, Calendar, CheckCircle2, AlertTriangle, 
  Layers, RefreshCw, Banknote, CreditCard, Smartphone, ShieldCheck, PieChart, BarChart2,
  Eye, FileText, ChevronRight, Receipt, X
} from 'lucide-react'
import { io } from '@/lib/socket'
import { PageHeader } from '@/components/ui/PageHeader'
import { printClosingSmart } from '@/lib/printer'

interface CashRegister {
  id: string
  name: string
  description: string | null
  manager: { id: string; name: string } | null
  closings: { id: string; isOpen: boolean; user: { id: string; name: string }; initialCash: number; shiftStart: string }[]
}

interface CashClosingHistory {
  id: string
  shiftStart: string
  shiftEnd: string
  createdAt: string
  initialCash: number
  totalCash: number
  totalTransfers: number
  totalNequi: number
  totalBancolombia: number
  totalDaviplata: number
  totalSales: number
  totalTips: number
  totalExpenses: number
  discrepancy: number
  notes: string | null
  isOpen?: boolean
  user: { id: string; name: string }
  cashRegister?: { id: string; name: string } | null
}

interface Summary {
  orderCount: number
  totalSales: number
  totalCash: number
  totalTransfer: number
  totalNequi: number
  totalBancolombia: number
  totalDaviplata: number
  totalTips: number
  isOpen?: boolean
  initialCash?: number
  cashInDrawer?: number
}

interface ClosingDetailData {
  closing: CashClosingHistory
  transacciones: number
  valorTransacciones: number
  propinas: number
  domicilios: number
  inicialPorMetodo: { label: string; value: number }[]
  ventasPorMetodo: { method: string; label: string; count: number; sales: number; tips: number; deliveryFees: number; subtotal: number; tax: number }[]
  orders?: { id: string; orderNumber: number; customerName: string; customerPhone?: string; total: number; paymentMethod: string; createdAt: string; driverName?: string; itemsSummary?: string }[]
  impuestos: { nombre: string; base: number; impuesto: number }
  gastos: { items: { tipo: string; total: number }[]; total: number }
  resumen: { inicialMasVentasMasPropinas: number; pagosFacturas: number; gastos: number; totalEfectivo: number; debeTener: number; domicilios: number }
}

const fadeUp = { hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }

export default function CashControlPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'SUMMARY' | 'HISTORY'>('SUMMARY')
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  const [closings, setClosings] = useState<CashClosingHistory[]>([])
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Filters for History
  const [filterDate, setFilterDate] = useState<string>('')
  const [dateMode, setDateMode] = useState<'date' | 'month'>('date')
  const [filterRegisterId, setFilterRegisterId] = useState<string>('ALL')
  const [filterUserId, setFilterUserId] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  // Detail modal
  const [selectedClosingId, setSelectedClosingId] = useState<string | null>(null)
  const [closingDetail, setClosingDetail] = useState<ClosingDetailData | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [regs, history, usrList] = await Promise.all([
        api.get<CashRegister[]>('/cash-registers'),
        api.get<CashClosingHistory[]>('/payments/closing/history'),
        api.get<any[]>('/users').catch(() => [])
      ])
      setRegisters(regs)
      setClosings(history)
      setUsers(usrList.map((u: any) => ({ id: u.id, name: u.name })))

      const sums: Record<string, Summary> = {}
      for (const r of regs) {
        try {
          const s = await api.get<Summary>(`/cash-registers/${r.id}/summary`)
          if (s) sums[r.id] = s
        } catch (err) {
          console.error(`Error cargando sumario de caja ${r.id}:`, err)
        }
      }
      
      try {
        const nullSum = await api.get<Summary>('/cash-registers/null/summary')
        if (nullSum && nullSum.orderCount > 0) {
          sums['null'] = nullSum
        }
      } catch (err) {
        console.error('Error cargando sumario de ventas fuera de caja', err)
      }

      setSummaries(sums)
    } catch (e) {
      console.error('Error cargando control de caja', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    const handleRefresh = () => {
      loadData()
    }

    socket.on('cashRegistersChanged', handleRefresh)
    socket.on('cashStatusChanged', handleRefresh)
    socket.on('paymentSubmitted', handleRefresh)
    socket.on('paymentValidated', handleRefresh)
    socket.on('paymentUpdated', handleRefresh)
    socket.on('orderCreated', handleRefresh)
    socket.on('orderUpdated', handleRefresh)
    socket.on('orderStatusChanged', handleRefresh)
    socket.on('tableOrderSubmitted', handleRefresh)
    socket.on('tableClosed', handleRefresh)
    socket.on('expenseCreated', handleRefresh)

    return () => {
      socket.disconnect()
    }
  }, [])

  // Load closing detail when selected
  const openClosingDetail = async (closingId: string) => {
    setSelectedClosingId(closingId)
    setLoadingDetail(true)
    setClosingDetail(null)
    try {
      const detail = await api.get<ClosingDetailData>(`/payments/closing/${closingId}/detail`)
      setClosingDetail(detail)
    } catch (e) {
      console.error('Error cargando detalle del cierre', e)
    } finally {
      setLoadingDetail(false)
    }
  }

  // Load consolidated detail
  const openConsolidatedDetail = async () => {
    setSelectedClosingId('CONSOLIDADO')
    setLoadingDetail(true)
    setClosingDetail(null)
    try {
      const detail = await api.get<ClosingDetailData>('/payments/closing/consolidated/report')
      setClosingDetail(detail)
    } catch (e) {
      console.error('Error cargando detalle consolidado', e)
    } finally {
      setLoadingDetail(false)
    }
  }

  const closeDetailModal = () => {
    setSelectedClosingId(null)
    setClosingDetail(null)
  }

  // Filter closings history
  const filteredClosings = useMemo(() => {
    return closings.filter(c => {
      if (c.isOpen) return false
      if (filterRegisterId !== 'ALL' && c.cashRegister?.id !== filterRegisterId) return false
      if (filterUserId !== 'ALL' && c.user?.id !== filterUserId) return false
      if (filterDate) {
        const cDate = new Date(c.shiftEnd || c.createdAt).toISOString().split('T')[0]
        if (dateMode === 'month') {
          if (!cDate.startsWith(filterDate)) return false
        } else {
          if (cDate !== filterDate) return false
        }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim()
        const matchUser = c.user?.name?.toLowerCase().includes(q)
        const matchReg = c.cashRegister?.name?.toLowerCase().includes(q)
        const matchNotes = c.notes?.toLowerCase().includes(q)
        if (!matchUser && !matchReg && !matchNotes) return false
      }
      return true
    })
  }, [closings, filterRegisterId, filterUserId, filterDate, searchQuery, dateMode])

  // Grand consolidated total across all registers today
  const globalSummary = useMemo(() => {
    let totalSales = 0
    let totalCash = 0
    let totalTransfers = 0
    let totalInitial = 0
    let totalCashInDrawer = 0
    let totalTips = 0
    let orderCount = 0

    Object.values(summaries).forEach(s => {
      totalSales += s.totalSales || 0
      totalCash += s.totalCash || 0
      totalTransfers += s.totalTransfer || 0
      totalInitial += s.initialCash || 0
      totalCashInDrawer += s.cashInDrawer ?? ((s.initialCash || 0) + (s.totalCash || 0))
      totalTips += s.totalTips || 0
      orderCount += s.orderCount || 0
    })

    const openCount = registers.filter(r => r.closings?.some(c => c.isOpen) || summaries[r.id]?.isOpen).length

    return { totalSales, totalCash, totalTransfers, totalInitial, totalCashInDrawer, totalTips, orderCount, openCount }
  }, [summaries, registers])

  // Print the detail as professional Reporte Z
  const handlePrintReporteZ = async () => {
    if (!closingDetail) return
    try {
      await printClosingSmart(
        { ...closingDetail.closing, _detail: closingDetail },
        user?.role
      )
    } catch (e) {
      console.error(e)
    }
  }

  const fmtCOP = (val: number) => formatCurrency(val)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-semibold text-sm">Cargando control general de cajas...</span>
      </div>
    )
  }

  return (
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      <PageHeader
        title="CONTROL DE CAJA"
        description="Consolidado global de ventas, administración de cajas y auditoría histórica de cierres."
        actions={
          <Button
            variant="outline"
            className="border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-bold rounded-xl h-10 px-4 gap-2 text-xs cursor-pointer"
            onClick={loadData}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar Datos
          </Button>
        }
      />

      {/* KPI Cards */}
      <motion.div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" variants={fadeUp}>
        <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--accent)]">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Ventas Totales Hoy</p>
              <p className="text-2xl font-black text-[var(--accent)] tracking-tight mt-0.5">{formatCurrency(globalSummary.totalSales)}</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{globalSummary.orderCount} pedidos en {registers.length} cajas</p>
            </div>
          </div>
        </Card>
        <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Efectivo en Cajas</p>
              <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{formatCurrency(globalSummary.totalCashInDrawer)}</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Base ({formatCurrency(globalSummary.totalInitial)}) + Ventas ({formatCurrency(globalSummary.totalCash)})</p>
            </div>
          </div>
        </Card>
        <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 border border-blue-500/30 text-blue-500">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Bancos y Digitales</p>
              <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{formatCurrency(globalSummary.totalTransfers)}</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Transferencias / Nequi / Daviplata</p>
            </div>
          </div>
        </Card>
        <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-500">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Estado de Turnos</p>
              <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{globalSummary.openCount} / {registers.length}</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Cajas abiertas actualmente</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Tab Switcher & Consolidated Report Button */}
      <motion.div variants={fadeUp} className="flex justify-between items-center flex-wrap gap-4">
        <div className="flex gap-2 p-1 bg-[var(--bg-panel)] rounded-2xl border border-[var(--border-subtle)] w-fit">
          <button type="button" onClick={() => setActiveTab('SUMMARY')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${activeTab === 'SUMMARY' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-md' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
            <BarChart2 className="h-4 w-4" /> Resumen por Caja Registradora
          </button>
          <button type="button" onClick={() => setActiveTab('HISTORY')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${activeTab === 'HISTORY' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-md' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
            <History className="h-4 w-4" /> Historial de Cierres de Caja
          </button>
        </div>
        <Button
          className="hover:opacity-90 font-bold rounded-xl h-11 px-5 text-xs uppercase tracking-wider gap-2 shadow-lg shadow-[var(--accent)]/15 cursor-pointer border-0"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
          onClick={openConsolidatedDetail}
        >
          <Receipt className="h-4 w-4" /> Reporte Consolidado (Hoy)
        </Button>
      </motion.div>

      {/* TAB 1: SUMMARY BY REGISTER */}
      {activeTab === 'SUMMARY' && (
        <motion.div className="grid gap-6 md:grid-cols-2" variants={fadeUp}>
          {registers.map(reg => {
            const sum = summaries[reg.id]
            const openClosing = reg.closings?.find(c => c.isOpen) || (sum?.isOpen ? { id: 'active', isOpen: true, user: { id: 'cajero', name: (sum as any).operatorName || 'Cajero' }, initialCash: sum.initialCash || 0, shiftStart: (sum as any).shiftStart || new Date().toISOString() } : null)
            const isOpen = !!openClosing || !!sum?.isOpen
            const lastClosedId = closings.find(c => !c.isOpen && c.cashRegister?.id === reg.id)?.id

            return (
              <Card key={reg.id}
                className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden cursor-pointer hover:border-[var(--accent)]/40 hover:shadow-lg transition-all group"
                onClick={() => { if (lastClosedId) openClosingDetail(lastClosedId) }}>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-[var(--accent)]" />
                        <h3 className="font-extrabold text-lg text-[var(--text-primary)] tracking-wide">{reg.name}</h3>
                      </div>
                      {reg.description && <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">{reg.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider ${isOpen ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'}`}>
                        {isOpen ? 'Abierta' : 'Cerrada'}
                      </Badge>
                      {lastClosedId && <ChevronRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />}
                    </div>
                  </div>

                  {openClosing && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-xl p-3">
                      <User className="h-4 w-4 text-[var(--accent)]" />
                      <div>
                        <p className="font-bold text-[var(--text-primary)]">Operador actual: {openClosing.user.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">Apertura: {new Date(openClosing.shiftStart).toLocaleString('es-CO')} | Base: {formatCurrency(openClosing.initialCash)}</p>
                      </div>
                    </div>
                  )}

                  {reg.manager && !isOpen && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-3">
                      <User className="h-4 w-4 text-[var(--text-muted)]" />
                      <p><span className="text-[var(--text-muted)]">Encargado:</span> <strong className="text-[var(--text-primary)]">{reg.manager.name}</strong></p>
                    </div>
                  )}

                  {sum && (
                    <div className="grid grid-cols-2 gap-3 text-sm pt-2">
                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Ventas Totales</p>
                        <p className="text-lg font-black text-[var(--accent)] mt-0.5">{formatCurrency(sum.totalSales || 0)}</p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {sum.orderCount} pedidos {isOpen ? 'del turno' : 'hoy'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Efectivo en Caja</p>
                        <p className="text-lg font-black text-[var(--text-primary)] mt-0.5">
                          {formatCurrency(sum.cashInDrawer ?? ((sum.initialCash || 0) + sum.totalCash))}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {sum.initialCash ? `Base (${formatCurrency(sum.initialCash)}) + Efectivo` : 'Recaudado en físico'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Transferencias & Digitales</p>
                        <p className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">
                          {formatCurrency(sum.totalTransfer || 0)}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Bancos / Nequi / Daviplata</p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Total General del Turno</p>
                        <p className="text-base font-extrabold text-emerald-400 mt-0.5">
                          {formatCurrency(((sum.initialCash || 0) + sum.totalSales))}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Inicial + Ventas Totales</p>
                      </div>
                    </div>
                  )}

                  {lastClosedId && (
                    <div className="flex justify-end pt-1">
                      <span className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider group-hover:underline">Ver último cierre →</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}

          {summaries['null'] && summaries['null'].orderCount > 0 && (
            <Card className="border border-dashed border-amber-500/40 bg-amber-500/5 rounded-2xl overflow-hidden shadow-sm relative">
              <div className="absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br from-amber-500/10 to-transparent rounded-full blur-2xl animate-pulse" />
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      <h3 className="font-extrabold text-lg text-amber-500 tracking-wide">Ventas Fuera de Caja</h3>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">
                      Pedidos del día procesados sin una caja de turno abierta (Pedidos de prueba o manuales administrativos).
                    </p>
                  </div>
                  <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/10 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider">
                    Manual / Sin Caja
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm pt-2">
                  <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Ventas Totales</p>
                    <p className="text-lg font-black text-amber-500 mt-0.5">{formatCurrency(summaries['null'].totalSales)}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{summaries['null'].orderCount} pedidos manuales</p>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Efectivo Recaudado</p>
                    <p className="text-lg font-black text-[var(--text-primary)] mt-0.5">{formatCurrency(summaries['null'].totalCash)}</p>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Transferencias Bancarias</p>
                    <p className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">{formatCurrency(summaries['null'].totalTransfer)}</p>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Billeteras Virtuales</p>
                    <p className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">{formatCurrency(summaries['null'].totalNequi + summaries['null'].totalBancolombia + summaries['null'].totalDaviplata)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}

      {/* TAB 2: CLOSINGS HISTORY */}
      {activeTab === 'HISTORY' && (
        <motion.div className="space-y-4" variants={fadeUp}>
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Fecha de Cierre</Label>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => { setDateMode('date'); setFilterDate(''); }} className={`text-[10px] font-bold uppercase transition-colors cursor-pointer ${dateMode === 'date' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>Día</button>
                    <span className="text-[var(--text-muted)] text-[10px]">|</span>
                    <button type="button" onClick={() => { setDateMode('month'); setFilterDate(''); }} className={`text-[10px] font-bold uppercase transition-colors cursor-pointer ${dateMode === 'month' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>Mes</button>
                  </div>
                </div>
                <Input type={dateMode} className="h-10 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs font-bold text-[var(--text-primary)]" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Filtrar por Caja</Label>
                <Select value={filterRegisterId} onValueChange={setFilterRegisterId}>
                  <SelectTrigger className="h-10 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs font-bold text-[var(--text-primary)]"><SelectValue placeholder="Todas las cajas" /></SelectTrigger>
                  <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)]">
                    <SelectItem value="ALL">Todas las cajas</SelectItem>
                    {registers.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Filtrar por Cajero</Label>
                <Select value={filterUserId} onValueChange={setFilterUserId}>
                  <SelectTrigger className="h-10 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs font-bold text-[var(--text-primary)]"><SelectValue placeholder="Todos los cajeros" /></SelectTrigger>
                  <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-subtle)]">
                    <SelectItem value="ALL">Todos los cajeros</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Buscar en notas o cajero</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                  <Input className="h-10 pl-9 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs text-[var(--text-primary)]" placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-extrabold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-elevated)]/50">
                    <th className="px-6 py-4">Fecha Cierre</th>
                    <th className="px-6 py-4">Caja</th>
                    <th className="px-6 py-4">Cajero / Operador</th>
                    <th className="px-6 py-4">Base Inicial</th>
                    <th className="px-6 py-4">Ventas Totales</th>
                    <th className="px-6 py-4">Efectivo Recaudado</th>
                    <th className="px-6 py-4">Discrepancia</th>
                    <th className="px-6 py-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredClosings.map(c => {
                    const hasDiscrepancy = Math.abs(c.discrepancy || 0) > 100
                    return (
                      <tr key={c.id} className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer" onClick={() => openClosingDetail(c.id)}>
                        <td className="px-6 py-4 font-bold text-[var(--text-primary)] whitespace-nowrap">
                          <div>{new Date(c.shiftEnd || c.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-normal mt-0.5">
                            Apertura: {new Date(c.shiftStart || c.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-extrabold text-[var(--accent)] whitespace-nowrap">{c.cashRegister?.name || 'Caja Principal'}</td>
                        <td className="px-6 py-4 font-bold text-[var(--text-secondary)] whitespace-nowrap">{c.user?.name || 'Operador'}</td>
                        <td className="px-6 py-4 text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">{formatCurrency(c.initialCash)}</td>
                        <td className="px-6 py-4 font-extrabold text-[var(--text-primary)] whitespace-nowrap">{formatCurrency(c.totalSales)}</td>
                        <td className="px-6 py-4 font-bold text-emerald-500 whitespace-nowrap">{formatCurrency(c.totalCash)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {hasDiscrepancy ? (
                            <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/10 font-black text-[10px] rounded-full px-2 py-0.5">{formatCurrency(c.discrepancy)}</Badge>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)] font-bold">$0</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <Button size="sm" variant="outline"
                            className="border-[var(--border-default)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] rounded-xl h-8 px-3 text-xs font-bold gap-1.5 cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); openClosingDetail(c.id) }}>
                            <Eye className="h-3.5 w-3.5" /> Ver Detalle
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredClosings.length === 0 && (
                <div className="py-16 text-center text-[var(--text-secondary)]">
                  <History className="mx-auto h-10 w-10 text-[var(--text-muted)] mb-3 opacity-30" />
                  <p className="font-bold">No se encontraron cierres de caja con los filtros seleccionados.</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* PROFESSIONAL Z REPORT DETAIL MODAL */}
      <Dialog open={!!selectedClosingId} onOpenChange={v => { if (!v) closeDetailModal() }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl max-w-lg p-0 overflow-hidden shadow-2xl max-h-[90vh]">
          <div className="h-1.5 w-full bg-gradient-to-r from-[var(--accent)] to-emerald-500" />
          
          {loadingDetail && (
            <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
                <div className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              </motion.div>
              <span className="ml-3 font-semibold text-sm">Cargando detalle del cierre...</span>
            </div>
          )}

          {closingDetail && !loadingDetail && (
            <div className="overflow-y-auto max-h-[calc(90vh-100px)]">
              <div className="p-6 space-y-4">
                {/* Header */}
                <DialogHeader className="pb-0">
                  <DialogTitle className="text-center space-y-1">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[3px]">Comprobante Informe Diario</p>
                    <p className="text-xl font-black text-[var(--text-primary)] tracking-wide">THE VILLA DOG</p>
                    <p className="text-[10px] text-[var(--text-secondary)] font-medium">Montería, Córdoba · Tel: 310 000 0000</p>
                  </DialogTitle>
                  <DialogDescription className="sr-only">Detalle del cierre de caja para reporte Z</DialogDescription>
                </DialogHeader>

                {/* Datos del Comprobante */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-1 text-xs">
                  <Row label="Responsable de caja" value={closingDetail.closing.user?.name || 'Cajero'} bold />
                  <Row label="Caja" value={closingDetail.closing.cashRegister?.name || 'Principal'} />
                  <Row label="Fecha Inicial" value={new Date(closingDetail.closing.shiftStart).toLocaleString('es-CO')} />
                  <Row label="Fecha Final" value={new Date(closingDetail.closing.shiftEnd).toLocaleString('es-CO')} />
                  <div className="border-t border-[var(--border-subtle)]/50 my-1.5" />
                  <Row label="Transacciones" value={String(closingDetail.transacciones)} bold />
                  <Row label="Valor Transacciones" value={fmtCOP(closingDetail.valorTransacciones)} bold />
                  <Row label="Propinas" value={fmtCOP(closingDetail.propinas)} />
                </div>

                {/* Inicial */}
                <SectionTitle title="Inicial" />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs space-y-1">
                  <div className="flex justify-between font-bold text-[var(--text-muted)] text-[10px] uppercase pb-1 border-b border-[var(--border-subtle)]/50">
                    <span>Medio de pago</span><span>Inicial</span>
                  </div>
                  {closingDetail.inicialPorMetodo.map(m => <Row key={m.label} label={m.label} value={fmtCOP(m.value)} />)}
                  <div className="border-t border-[var(--accent)]/30 pt-1.5 mt-1">
                    <Row label="Total" value={fmtCOP(closingDetail.closing.initialCash)} bold accent />
                  </div>
                </div>

                {/* Ventas */}
                <SectionTitle title="Ventas" />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs space-y-1">
                  <div className="grid grid-cols-3 gap-1 font-bold text-[var(--text-muted)] text-[10px] uppercase pb-1 border-b border-[var(--border-subtle)]/50">
                    <span>Nombre</span><span className="text-center">No. Trans.</span><span className="text-right">Sistema</span>
                  </div>
                  {closingDetail.ventasPorMetodo.map(m => (
                    <div key={m.method} className="grid grid-cols-3 gap-1">
                      <span className="text-[var(--text-secondary)] font-medium">{m.label}</span>
                      <span className="text-center font-bold text-[var(--text-primary)]">{m.count}</span>
                      <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(m.sales)}</span>
                    </div>
                  ))}
                  <div className="border-t border-[var(--accent)]/30 pt-1.5 mt-1">
                    <div className="grid grid-cols-3 gap-1 font-extrabold">
                      <span className="text-[var(--accent)]">Total (Prop. Incluida)</span>
                      <span className="text-center text-[var(--text-primary)]">{closingDetail.transacciones}</span>
                      <span className="text-right text-[var(--accent)]">{fmtCOP(closingDetail.valorTransacciones)}</span>
                    </div>
                    <Row label="Propinas" value={fmtCOP(closingDetail.propinas)} />
                  </div>
                </div>

                {/* Detalle Ventas */}
                <SectionTitle title="Detalle Ventas" />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs space-y-1">
                  <div className="grid grid-cols-4 gap-1 font-bold text-[var(--text-muted)] text-[10px] uppercase pb-1 border-b border-[var(--border-subtle)]/50">
                    <span>Nombre</span><span className="text-right">Venta</span><span className="text-right">Propina</span><span className="text-right">Domicilio</span>
                  </div>
                  {closingDetail.ventasPorMetodo.map(m => (
                    <div key={m.method} className="grid grid-cols-4 gap-1">
                      <span className="text-[var(--text-secondary)] font-medium">{m.label}</span>
                      <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(m.sales)}</span>
                      <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(m.tips)}</span>
                      <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(m.deliveryFees)}</span>
                    </div>
                  ))}
                  <div className="border-t border-[var(--accent)]/30 pt-1.5 mt-1">
                    <div className="grid grid-cols-4 gap-1 font-extrabold">
                      <span className="text-[var(--accent)]">Total</span>
                      <span className="text-right text-[var(--accent)]">{fmtCOP(closingDetail.valorTransacciones)}</span>
                      <span className="text-right text-[var(--accent)]">{fmtCOP(closingDetail.propinas)}</span>
                      <span className="text-right text-[var(--accent)]">{fmtCOP(closingDetail.domicilios)}</span>
                    </div>
                  </div>
                </div>

                {/* Impuestos */}
                <SectionTitle title="Impuestos" />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs space-y-1">
                  <div className="grid grid-cols-3 gap-1 font-bold text-[var(--text-muted)] text-[10px] uppercase pb-1 border-b border-[var(--border-subtle)]/50">
                    <span>Nombre</span><span className="text-right">Base</span><span className="text-right">Imp</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <span className="text-[var(--text-secondary)] font-medium">{closingDetail.impuestos.nombre}</span>
                    <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(closingDetail.impuestos.base)}</span>
                    <span className="text-right font-bold text-[var(--text-primary)]">{fmtCOP(closingDetail.impuestos.impuesto)}</span>
                  </div>
                  <div className="border-t border-[var(--accent)]/30 pt-1.5 mt-1">
                    <div className="grid grid-cols-3 gap-1 font-extrabold">
                      <span className="text-[var(--accent)]">Total</span><span />
                      <span className="text-right text-[var(--accent)]">{fmtCOP(closingDetail.impuestos.impuesto)}</span>
                    </div>
                  </div>
                </div>

                {/* Gastos */}
                <SectionTitle title="Gastos" />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs space-y-1">
                  <div className="flex justify-between font-bold text-[var(--text-muted)] text-[10px] uppercase pb-1 border-b border-[var(--border-subtle)]/50">
                    <span>Tipo de gasto</span><span>Total</span>
                  </div>
                  {closingDetail.gastos.items.length > 0
                    ? closingDetail.gastos.items.map(g => <Row key={g.tipo} label={g.tipo} value={fmtCOP(g.total)} />)
                    : <Row label="Sin gastos registrados" value="" />
                  }
                  <div className="border-t border-[var(--accent)]/30 pt-1.5 mt-1">
                    <Row label="Total" value={fmtCOP(closingDetail.gastos.total)} bold accent />
                  </div>
                </div>

                {/* Resumen Financiero Detallado */}
                <SectionTitle title="Resumen Financiero del Turno" />
                <div className="rounded-xl border-2 border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 text-xs space-y-2.5">
                  <div className="space-y-1 border-b border-[var(--border-subtle)]/40 pb-2">
                    <Row label="Base Inicial en Caja (Apertura)" value={fmtCOP(closingDetail.closing?.initialCash || 0)} />
                    <Row label="Ventas en Efectivo" value={fmtCOP(closingDetail.ventasPorMetodo.find(v => v.method === 'CASH')?.sales || 0)} />
                    <Row label="Ventas en Transferencias & Digitales" value={fmtCOP(closingDetail.ventasPorMetodo.filter(v => v.method !== 'CASH' && v.method !== 'CREDIT' && v.method !== 'CORTESIA').reduce((s, v) => s + v.sales, 0))} />
                    <Row label="Ventas a Crédito / Fiado" value={fmtCOP(closingDetail.ventasPorMetodo.find(v => v.method === 'CREDIT')?.sales || 0)} />
                    {(closingDetail.ventasPorMetodo.find(v => v.method === 'CORTESIA')?.sales || 0) > 0 && (
                      <Row label="Cortesías" value={fmtCOP(closingDetail.ventasPorMetodo.find(v => v.method === 'CORTESIA')?.sales || 0)} />
                    )}
                    <Row label="Ventas Totales del Turno (Sin Base)" value={fmtCOP(closingDetail.valorTransacciones)} bold />
                  </div>

                  <div className="space-y-1 border-b border-[var(--border-subtle)]/40 pb-2">
                    <Row label="Propinas Recaudadas" value={fmtCOP(closingDetail.propinas)} />
                    <Row label="Gastos del Turno" value={`-${fmtCOP(closingDetail.gastos.total)}`} />
                    <Row label="Domicilios Incluidos en Ventas" value={fmtCOP(closingDetail.domicilios)} />
                  </div>

                  <div className="pt-1 space-y-1.5 font-bold">
                    <Row label="EFECTIVO TOTAL EN GAVETA (DEBE TENER EN FÍSICO)" value={fmtCOP(closingDetail.resumen.totalEfectivo)} bold accent />
                    <p className="text-[10px] text-[var(--text-secondary)] -mt-1 font-normal">
                      (Base ${Math.round(closingDetail.closing?.initialCash || 0).toLocaleString('de-DE')} + Efectivo ${Math.round(closingDetail.ventasPorMetodo.find(v => v.method === 'CASH')?.sales || 0).toLocaleString('de-DE')} - Gastos ${Math.round(closingDetail.gastos.total).toLocaleString('de-DE')})
                    </p>
                    <Row label="RECAUDO TOTAL DEL TURNO (INICIAL + VENTAS)" value={fmtCOP(closingDetail.resumen.inicialMasVentasMasPropinas)} bold />
                  </div>
                </div>

                {/* Pedidos del Turno */}
                <SectionTitle title={`📦 Pedidos del Turno (${closingDetail.orders?.length || 0})`} />
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs space-y-2 max-h-60 overflow-y-auto">
                  {closingDetail.orders && closingDetail.orders.length > 0 ? (
                    closingDetail.orders.map((ord: any) => (
                      <div key={ord.id} className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]/50 space-y-1">
                        <div className="flex items-center justify-between font-bold text-[var(--text-primary)]">
                          <span className="text-[var(--accent)] font-black">#{ord.orderNumber} · {ord.customerName}</span>
                          <span className="text-xs font-black">{fmtCOP(ord.total)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                          <span>🕒 {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="font-bold px-1.5 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
                            {ord.paymentMethod === 'CASH' ? '💵 Efectivo' : ord.paymentMethod === 'TRANSFER' ? '📱 Transferencia' : ord.paymentMethod === 'CREDIT' ? '💳 Crédito' : '🎁 Cortesía'}
                          </span>
                        </div>
                        {ord.itemsSummary && (
                          <p className="text-[10px] text-[var(--text-muted)] truncate">{ord.itemsSummary}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-[var(--text-muted)] text-center py-2">No hay pedidos registrados en este turno.</p>
                  )}
                </div>

                {/* Abonos de Cartera del Turno */}
                {(closingDetail as any).abonosCartera && (
                  <>
                    <SectionTitle title={`💳 Abonos de Cartera Recaudados (${(closingDetail as any).abonosCartera.count || 0})`} />
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs space-y-2 max-h-60 overflow-y-auto">
                      {(closingDetail as any).abonosCartera.items && (closingDetail as any).abonosCartera.items.length > 0 ? (
                        (closingDetail as any).abonosCartera.items.map((ab: any) => (
                          <div key={ab.id} className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                            <div className="flex items-center justify-between font-bold text-[var(--text-primary)]">
                              <span className="text-emerald-500 font-extrabold">{ab.customerName} ({ab.customerPhone})</span>
                              <span className="text-xs font-black text-emerald-500">+{fmtCOP(ab.amount)}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                              <span>🕒 {new Date(ab.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Recibió: {ab.confirmedBy}</span>
                              <span className="font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                {ab.method === 'Efectivo' ? '💵 Efectivo' : '📱 Transferencia'}
                              </span>
                            </div>
                            {ab.notes && (
                              <p className="text-[10px] text-[var(--text-muted)] italic">Obs/Motivo: {ab.notes}</p>
                            )}
                            {ab.reference && (
                              <p className="text-[10px] text-[var(--text-secondary)] font-medium">Ref: {ab.reference}</p>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-[var(--text-muted)] text-center py-2">No se registraron abonos de cartera en este turno.</p>
                      )}
                    </div>
                  </>
                )}

                {closingDetail.closing.notes && (
                  <div className="p-3 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] text-xs">
                    <p className="font-bold text-[var(--text-muted)] uppercase text-[9px] mb-1">Notas del Cierre:</p>
                    <p className="text-[var(--text-primary)] font-medium leading-relaxed">{closingDetail.closing.notes}</p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 pb-1 sticky bottom-0 bg-[var(--bg-panel)]">
                  <Button variant="outline" className="rounded-xl h-10 font-bold text-xs px-4 cursor-pointer" onClick={closeDetailModal}>Cerrar</Button>
                  <Button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-10 px-4 text-xs gap-2 shadow-md cursor-pointer" onClick={handlePrintReporteZ}>
                    <Printer className="h-4 w-4" /> Imprimir Reporte Z
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

// Helper Components
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
      <span className="text-[10px] font-black text-[var(--accent)] uppercase tracking-[2px]">{title}</span>
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  )
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`${bold ? 'font-extrabold' : 'font-medium'} ${accent ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>{label}</span>
      <span className={`${bold ? 'font-extrabold' : 'font-bold'} ${accent ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  )
}

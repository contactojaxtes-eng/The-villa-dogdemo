import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from '@/lib/socket'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  Users, Search, Plus, Phone, Award, Bike, DollarSign, History, 
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Edit, Trash2, ShieldAlert,
  User, MapPin, ClipboardList, UtensilsCrossed, XCircle, Printer, FileSpreadsheet, FileText, Download, Wallet, RefreshCw, SlidersHorizontal, CalendarDays
} from 'lucide-react'
import { formatCurrency, formatDate, getStatusColor, getStatusLabel, cleanNotes, groupOrderItems, formatThousandsInput, parseThousandsInput } from '@/lib/utils'
import { printComandaSmart } from '@/lib/printer'

interface DriverOrder {
  id: string
  orderNumber: number
  total: number
  deliveryFee: number
  status: string
  createdAt: string
  customerName?: string
  customerAddress?: string
  paymentMethod?: string
  paymentStatus?: string
  cashAmount?: number
}

interface Driver {
  id: string
  name: string
  phone: string
  active: boolean
  createdAt: string
  completedDeliveries: number
  activeDeliveries?: number
  totalDeliveryEarnings: number
  totalDeliveredSales?: number
  pendingCash?: number
  pendingCashOrders?: { id: string; orderNumber: number; amount: number }[]
  orders?: DriverOrder[]
  portalUser?: { id: string; name: string; email: string; phone?: string | null; active: boolean } | null
}

interface DriverDetail {
  id: string
  name: string
  phone: string
  active: boolean
  orders: {
    id: string
    orderNumber: number
    total: number
    deliveryFee: number
    status: string
    createdAt: string
    customerName: string
    customerAddress: string
  }[]
}

const fadeUp = { hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

const suggestAccessLogin = (name: string, fallback: string) => {
  const suggestion = String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return suggestion || fallback
}

const PERIOD_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'CURRENT', label: 'Turno actual', description: 'Caja Domicilios abierta' },
  { value: 'WEEK', label: 'Esta semana', description: 'Lunes a domingo' },
  { value: 'MONTH', label: 'Este mes', description: 'Desde el día 1' },
  { value: 'CLOSING', label: 'Cierre de caja', description: 'Escoge un turno cerrado' },
  { value: 'DATE', label: 'Por fecha', description: 'Un día específico' },
  { value: 'ALL', label: 'Histórico', description: 'Todas las cajas' },
]

export default function DriversPage() {
  const { user, hasRole, hasPermission } = useAuth()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [closings, setClosings] = useState<any[]>([])
  const [filterType, setFilterType] = useState<string>('CURRENT')
  const [selectedClosingId, setSelectedClosingId] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'PENDING_CASH'>('ALL')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settlementDriver, setSettlementDriver] = useState<Driver | null>(null)
  const [settlementAmount, setSettlementAmount] = useState('')
  const [settlementNotes, setSettlementNotes] = useState('')
  const [settling, setSettling] = useState(false)
  const [accessDriver, setAccessDriver] = useState<Driver | null>(null)
  const [accessMode, setAccessMode] = useState<'CREATE' | 'LINK'>('CREATE')
  const [accessLogin, setAccessLogin] = useState('')
  const [accessPassword, setAccessPassword] = useState('')
  const [accessUserId, setAccessUserId] = useState('')
  const [accessCandidates, setAccessCandidates] = useState<Array<{ id: string; name: string; email: string; role?: string }>>([])
  const [loadingAccessCandidates, setLoadingAccessCandidates] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)
  const [accessError, setAccessError] = useState('')

  // Details Modal
  const [detailDriver, setDetailDriver] = useState<DriverDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Order Detail Modal
  const [detailOrder, setDetailOrder] = useState<any>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)

  const loadDrivers = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const params = new URLSearchParams()
      params.append('filterType', filterType)
      if (filterType === 'CLOSING' && selectedClosingId) {
        params.append('cashClosingId', selectedClosingId)
      }
      if (filterType === 'DATE' && selectedDate) {
        params.append('selectedDate', selectedDate)
      }
      const data = await api.get<Driver[]>(`/delivery-drivers?${params.toString()}`)
      setDrivers(data)
    } catch (err) {
      console.error('Error al cargar domiciliarios:', err)
      setLoadError('No se pudo actualizar la lista de domiciliarios. Revisa la conexión e inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [filterType, selectedClosingId, selectedDate])

  const loadClosings = async () => {
    try {
      const data = await api.get<any[]>('/payments/closing/history?all=true')
      setClosings(data || [])
      if (data && data.length > 0 && !selectedClosingId) {
        setSelectedClosingId(data[0].id)
      }
    } catch (err) {
      console.error('Error al cargar cierres de caja:', err)
    }
  }

  useEffect(() => {
    loadClosings()
  }, [])

  useEffect(() => {
    loadDrivers()
  }, [loadDrivers])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
      query: { userId: user?.id, userName: user?.name },
    })

    const handleUpdate = () => {
      loadDrivers()
    }

    socket.on('newOrder', handleUpdate)
    socket.on('orderStatusChanged', handleUpdate)
    socket.on('orderUpdated', handleUpdate)
    socket.on('paymentUpdated', handleUpdate)
    socket.on('driversChanged', handleUpdate)

    return () => {
      socket.disconnect()
    }
  }, [user, loadDrivers])

  const filteredDrivers = useMemo(() => {
    const q = search.toLowerCase().trim()
    return drivers
      .filter(d => 
        d.name.toLowerCase().includes(q) || 
        d.phone.includes(q)
      )
      .filter(d => {
        if (statusFilter === 'ACTIVE') return d.active
        if (statusFilter === 'INACTIVE') return !d.active
        if (statusFilter === 'PENDING_CASH') return (d.pendingCash || 0) > 0
        return true
      })
      .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.pendingCash || 0) - (a.pendingCash || 0) || b.completedDeliveries - a.completedDeliveries || a.name.localeCompare(b.name))
  }, [drivers, search, statusFilter])

  // Ranking calculation
  const rankedDrivers = useMemo(() => {
    return [...drivers]
      .filter(d => d.completedDeliveries > 0)
      .sort((a, b) => b.completedDeliveries - a.completedDeliveries)
  }, [drivers])

  const summary = useMemo(() => {
    const total = drivers.length
    const active = drivers.filter(d => d.active).length
    const activeDeliveries = drivers.reduce((sum, d) => sum + (d.activeDeliveries || 0), 0)
    const completed = drivers.reduce((sum, d) => sum + d.completedDeliveries, 0)
    const totalFees = drivers.reduce((sum, d) => sum + d.totalDeliveryEarnings, 0)
    const pendingCash = drivers.reduce((sum, d) => sum + (d.pendingCash || 0), 0)
    return { total, active, activeDeliveries, completed, totalFees, pendingCash }
  }, [drivers])

  const hasLocalFilters = Boolean(search.trim()) || statusFilter !== 'ALL'
  const clearLocalFilters = () => {
    setSearch('')
    setStatusFilter('ALL')
  }

  const openSettlementDialog = (driver: Driver) => {
    setSettlementDriver(driver)
    setSettlementAmount(String(Math.round(driver.pendingCash || 0)))
    setSettlementNotes('')
  }

  const handleSettleCash = async () => {
    if (!settlementDriver?.pendingCashOrders?.length) return
    setSettling(true)
    try {
      await api.post(`/delivery-drivers/${settlementDriver.id}/settlements`, {
        orderIds: settlementDriver.pendingCashOrders.map(order => order.id),
        receivedCash: parseThousandsInput(settlementAmount),
        notes: settlementNotes || undefined,
      })
      setSettlementDriver(null)
      await loadDrivers()
    } catch (err: any) {
      alert(err.message || 'No se pudo liquidar el efectivo del domiciliario')
    } finally {
      setSettling(false)
    }
  }

  const openCreateDialog = () => {
    setEditId(null)
    setDriverName('')
    setDriverPhone('')
    setError('')
    setDialogOpen(true)
  }

  const openEditDialog = (driver: Driver) => {
    setEditId(driver.id)
    setDriverName(driver.name)
    setDriverPhone(driver.phone)
    setError('')
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!driverName.trim()) { setError('El nombre es obligatorio'); return }
    if (!driverPhone.trim()) { setError('El teléfono es obligatorio'); return }
    const phoneClean = driverPhone.replace(/\D/g, '')
    if (phoneClean.length !== 10 || !phoneClean.startsWith('3')) {
      setError('El celular debe tener 10 dígitos y empezar con 3 (Ej: 3001234567)')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = { name: driverName.trim(), phone: phoneClean }
      if (editId) {
        await api.put(`/delivery-drivers/${editId}`, payload)
        setDialogOpen(false)
        void loadDrivers()
      } else {
        const created = await api.post<Pick<Driver, 'id' | 'name' | 'phone' | 'active' | 'createdAt'>>('/delivery-drivers', payload)
        const newDriver: Driver = {
          ...created,
          completedDeliveries: 0,
          activeDeliveries: 0,
          totalDeliveryEarnings: 0,
          totalDeliveredSales: 0,
          pendingCash: 0,
          pendingCashOrders: [],
          orders: [],
          portalUser: null,
        }
        setDialogOpen(false)
        void openAccessDialog(newDriver)
        void loadDrivers()
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDriver = async (driver: Driver) => {
    const confirm = window.confirm(`¿Deseas desactivar al domiciliario "${driver.name}"? Su historial y liquidaciones se conservarán.`)
    if (!confirm) return
    try {
      await api.delete(`/delivery-drivers/${driver.id}`)
      loadDrivers()
    } catch (err: any) {
      console.error('Error al eliminar domiciliario:', err)
      alert(err.response?.data?.message || err.message || 'Error al eliminar domiciliario')
    }
  }

  const openAccessDialog = async (driver: Driver) => {
    setAccessDriver(driver)
    setAccessMode('CREATE')
    setAccessLogin(driver.portalUser?.email?.replace(/@thevilladog\.local$/i, '') || suggestAccessLogin(driver.name, driver.phone))
    setAccessPassword('')
    setAccessUserId('')
    setAccessError('')
    if (driver.portalUser) return
    setLoadingAccessCandidates(true)
    try {
      const candidates = await api.get<Array<{ id: string; name: string; email: string; role?: string }>>('/delivery-drivers/access/candidates')
      setAccessCandidates(Array.isArray(candidates) ? candidates : [])
    } catch (err: any) {
      setAccessCandidates([])
      setAccessError(err?.message || 'No se pudieron cargar los usuarios disponibles.')
    } finally {
      setLoadingAccessCandidates(false)
    }
  }

  const closeAccessDialog = () => {
    if (!savingAccess) setAccessDriver(null)
  }

  const handleSaveAccess = async () => {
    if (!accessDriver) return
    if (accessMode === 'CREATE') {
      if (!accessLogin.trim()) { setAccessError('Escribe el usuario o correo para entrar.'); return }
      if (accessPassword.trim().length < 4) { setAccessError('La contraseña debe tener al menos 4 caracteres.'); return }
    } else if (!accessUserId) {
      setAccessError('Selecciona el usuario existente que vas a vincular.');
      return
    }
    setSavingAccess(true)
    setAccessError('')
    try {
      await api.put(`/delivery-drivers/${accessDriver.id}/access`, accessMode === 'CREATE'
        ? { mode: 'CREATE', login: accessLogin.trim(), password: accessPassword.trim() }
        : { mode: 'LINK', userId: accessUserId })
      setAccessDriver(null)
      await loadDrivers()
    } catch (err: any) {
      setAccessError(err?.message || 'No se pudo guardar el acceso del domiciliario.')
    } finally {
      setSavingAccess(false)
    }
  }

  const handleViewDetail = async (id: string) => {
    setLoadingDetail(true)
    try {
      const params = new URLSearchParams()
      params.append('filterType', filterType)
      if (filterType === 'CLOSING' && selectedClosingId) {
        params.append('cashClosingId', selectedClosingId)
      }
      if (filterType === 'DATE' && selectedDate) {
        params.append('selectedDate', selectedDate)
      }
      const data = await api.get<DriverDetail>(`/delivery-drivers/${id}?${params.toString()}`)
      setDetailDriver(data)
    } catch (err) {
      console.error('Error al cargar detalles del domiciliario:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleViewOrder = async (orderId: string) => {
    setLoadingOrder(true)
    try {
      const data = await api.get(`/orders/${orderId}`)
      setDetailOrder(data)
    } catch (err) {
      console.error('Error al cargar detalles del pedido:', err)
      alert('Error al cargar los detalles del pedido')
    } finally {
      setLoadingOrder(false)
    }
  }

  const getFilterDescription = () => {
    if (filterType === 'CURRENT') return 'Turno Actual'
    if (filterType === 'WEEK') return 'Esta Semana (Lunes a Domingo)'
    if (filterType === 'MONTH') return 'Este Mes'
    if (filterType === 'DATE') return `Fecha ${selectedDate}`
    if (filterType === 'CLOSING') {
      const c = closings.find(x => x.id === selectedClosingId)
      return c ? `Cierre de Caja (${formatDate(c.shiftStart)})` : 'Cierre de Caja'
    }
    return 'Todas las Cajas (Histórico)'
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    try {
      const ExcelJS = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      const filterLabel = getFilterDescription()

      // 1. Resumen por Domiciliario
      const summaryData = [
        ['REPORTE DE DOMICILIARIOS — THE VILLA DOG'],
        ['Filtro Aplicado', filterLabel],
        ['Fecha de Generación', new Date().toLocaleString('es-CO')],
        ['Total Domiciliarios', filteredDrivers.length],
        ['Total Tarifas Entregadas', formatCurrency(summary.totalFees)],
        [''],
        ['DOMICILIARIO', 'TELÉFONO', 'ESTADO', 'DOMICILIOS ENTREGADOS', 'RECAUDO FLETES', 'TOTAL VENTAS ENTREGADAS'],
        ...filteredDrivers.map(d => [
          d.name,
          d.phone,
          d.active ? 'Activo' : 'Inactivo',
          d.completedDeliveries,
          formatCurrency(d.totalDeliveryEarnings || 0),
          formatCurrency(d.totalDeliveredSales || 0),
        ])
      ]
      const ws1 = wb.addWorksheet('Resumen Domiciliarios')
      ws1.addRows(summaryData)
      ws1.columns = [25, 18, 14, 24, 20, 24].map(width => ({ width }))

      // 2. Detalle de Entregas por Fecha
      const allDeliveries: any[] = []
      for (const d of filteredDrivers) {
        if (d.orders && d.orders.length > 0) {
          for (const o of d.orders) {
            allDeliveries.push({
              ...o,
              driverName: d.name,
              driverPhone: d.phone,
            })
          }
        }
      }
      allDeliveries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      if (allDeliveries.length > 0) {
        const deliveriesData = [
          ['FECHA Y HORA', 'FECHA', '# PEDIDO', 'DOMICILIARIO', 'TEL. DOMICILIARIO', 'CLIENTE', 'DIRECCIÓN', 'FLETE DOMICILIO', 'TOTAL PEDIDO', 'MÉTODO DE PAGO', 'ESTADO'],
          ...allDeliveries.map(o => [
            new Date(o.createdAt).toLocaleString('es-CO'),
            `${new Date(o.createdAt).getDate()}/${new Date(o.createdAt).getMonth() + 1}/${new Date(o.createdAt).getFullYear()}`,
            `#${o.orderNumber}`,
            o.driverName,
            o.driverPhone,
            o.customerName || 'Consumidor Final',
            o.customerAddress || 'N/A',
            formatCurrency(o.deliveryFee || 0),
            formatCurrency(o.total || 0),
            o.paymentMethod || 'Efectivo',
            o.status === 'DELIVERED' ? 'Entregado' : o.status === 'IN_ROUTE' ? 'En Ruta' : o.status,
          ])
        ]
        const ws2 = wb.addWorksheet('Detalle de Entregas')
        ws2.addRows(deliveriesData)
        ws2.columns = [20, 14, 14, 22, 18, 22, 28, 18, 18, 18, 16].map(width => ({ width }))
      }

      const safeFilterName = filterType.toLowerCase()
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `Reporte_Domiciliarios_${safeFilterName}_${new Date().toISOString().split('T')[0]}.xlsx`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Error exportando Excel de domiciliarios:', err)
    } finally {
      setExporting(null)
    }
  }

  const handleExportPDF = async () => {
    setExporting('pdf')
    try {
      const jsPDFModule = await import('jspdf')
      const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF
      const autoTableModule = await import('jspdf-autotable')
      const autoTable = autoTableModule.default || autoTableModule.autoTable

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
      const pageW = doc.internal.pageSize.getWidth()
      const filterLabel = getFilterDescription()

      // Banner superior Villa Dog
      doc.setFillColor(144, 191, 80) // #F97316
      doc.rect(0, 0, pageW, 28, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.setTextColor(255, 255, 255)
      doc.text('THE VILLA DOG', pageW / 2, 13, { align: 'center' })
      doc.setFontSize(9)
      doc.text(`REPORTE DE DOMICILIARIOS Y ENTREGAS (${filterLabel})`, pageW / 2, 21, { align: 'center' })

      let y = 35

      // Section 1: RESUMEN DE DOMICILIARIOS
      doc.setTextColor(40, 40, 40)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('1. RESUMEN POR DOMICILIARIO', 14, y)
      y += 5

      autoTable(doc, {
        startY: y,
        head: [['Domiciliario', 'Teléfono', 'Estado', 'Entregas', 'Recaudo Fletes', 'Total Transportado']],
        body: filteredDrivers.map(d => [
          d.name,
          d.phone,
          d.active ? 'Activo' : 'Inactivo',
          String(d.completedDeliveries),
          formatCurrency(d.totalDeliveryEarnings || 0),
          formatCurrency(d.totalDeliveredSales || 0),
        ]),
        theme: 'grid',
        headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [245, 250, 240] },
        margin: { left: 14, right: 14 },
      })

      y = (doc as any).lastAutoTable?.finalY + 10 || y + 50

      // Section 2: DETALLE DE ENTREGAS
      const allDeliveries: any[] = []
      for (const d of filteredDrivers) {
        if (d.orders && d.orders.length > 0) {
          for (const o of d.orders) {
            allDeliveries.push({
              ...o,
              driverName: d.name,
            })
          }
        }
      }
      allDeliveries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      if (allDeliveries.length > 0) {
        if (y > 220) { doc.addPage(); y = 20 }
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('2. HISTORIAL DETALLADO DE ENTREGAS (ORGANIZADO POR FECHA)', 14, y)
        y += 5

        autoTable(doc, {
          startY: y,
          head: [['Fecha/Hora', '# Pedido', 'Domiciliario', 'Cliente', 'Flete', 'Total']],
          body: allDeliveries.slice(0, 100).map(o => [
            new Date(o.createdAt).toLocaleString('es-CO'),
            `#${o.orderNumber}`,
            o.driverName,
            o.customerName || 'Consumidor Final',
            formatCurrency(o.deliveryFee || 0),
            formatCurrency(o.total || 0),
          ]),
          theme: 'grid',
          headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [245, 250, 240] },
          margin: { left: 14, right: 14 },
        })
      }

      const totalPages = doc.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFontSize(7)
        doc.setTextColor(160, 160, 160)
        doc.text(`THE VILLA DOG — Generado el ${new Date().toLocaleString('es-CO')} — Página ${i} de ${totalPages}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
      }

      const safeFilterName = filterType.toLowerCase()
      doc.save(`Reporte_Domiciliarios_${safeFilterName}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (err) {
      console.error('Error exportando PDF de domiciliarios:', err)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">
            <Bike className="h-4 w-4" /> Operación de domicilios
          </div>
          <h2 className="antifont text-3xl tracking-wider text-[var(--text-primary)] leading-none uppercase sm:text-4xl">Domiciliarios</h2>
          <p className="mt-2 max-w-xl text-xs font-medium leading-5 text-[var(--text-secondary)]">Consulta el desempeño, el efectivo pendiente y el estado de cada repartidor en el período seleccionado.</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {hasPermission('drivers.export') && (
            <>
              <Button
                onClick={handleExportExcel}
                disabled={exporting !== null || loading}
                variant="outline"
                className="border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 font-bold rounded-xl h-11 px-4 gap-1.5 cursor-pointer text-xs uppercase tracking-wider bg-[var(--bg-panel)]"
              >
                {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Exportar Excel
              </Button>
              <Button
                onClick={handleExportPDF}
                disabled={exporting !== null || loading}
                variant="outline"
                className="border-red-500/30 text-red-500 hover:bg-red-500/10 font-bold rounded-xl h-11 px-4 gap-1.5 cursor-pointer text-xs uppercase tracking-wider bg-[var(--bg-panel)]"
              >
                {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Exportar PDF
              </Button>
            </>
          )}
          {hasPermission('drivers.manage') && (
            <Button 
              onClick={openCreateDialog}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold rounded-xl h-11 px-5 gap-1.5 shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer text-xs uppercase tracking-wider"
            >
              <Plus className="h-4.5 w-4.5" /> Nuevo domiciliario
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Domiciliarios</p>
              <h3 className="mt-1.5 text-3xl font-black text-[var(--text-primary)]">{summary.total}</h3>
              <p className="mt-1 text-[10px] font-semibold text-emerald-600">{summary.active} activos</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-muted)]/40 text-[var(--accent)]">
              <Users className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Entregas completadas</p>
              <h3 className="mt-1.5 text-3xl font-black text-[var(--text-primary)]">{summary.completed}</h3>
              <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">En {getFilterDescription().toLowerCase()}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-emerald-500/25 bg-[var(--bg-panel)] shadow-sm">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">En ruta ahora</p>
              <h3 className="mt-1.5 text-3xl font-black text-emerald-600">{summary.activeDeliveries}</h3>
              <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">Pedidos asignados</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Bike className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-amber-500/25 bg-[var(--bg-panel)] shadow-sm">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Efectivo pendiente</p>
              <h3 className="mt-1.5 text-3xl font-black text-amber-600">{formatCurrency(summary.pendingCash)}</h3>
              <p className="mt-1 text-[10px] font-semibold text-[var(--text-secondary)]">Fletes entregados: {formatCurrency(summary.totalFees)}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Wallet className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Search & Drivers List */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-black text-[var(--text-primary)]"><SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" /> Filtros de consulta</p>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">Elige un período y luego busca por nombre, celular o estado.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadDrivers()}
                  disabled={loading}
                  className="h-9 shrink-0 rounded-xl border-[var(--border-default)] px-3 text-[10px] font-extrabold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                </Button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o teléfono..."
                  aria-label="Buscar domiciliario por nombre o teléfono"
                  className="h-11 rounded-xl border-[var(--border-default)] bg-[var(--bg-input)] pl-10 pr-10 text-xs font-semibold focus:border-[var(--accent)]"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} title="Limpiar búsqueda" className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">Período</p>
                  <span className="truncate text-[10px] font-semibold text-[var(--accent)]">{getFilterDescription()}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PERIOD_OPTIONS.map(option => {
                    const selected = filterType === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFilterType(option.value)}
                        aria-pressed={selected}
                        className={`min-h-[54px] rounded-xl border px-3 py-2 text-left transition-all ${selected ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm' : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:bg-[var(--bg-hover)]'}`}
                      >
                        <span className="block text-[11px] font-black">{option.label}</span>
                        <span className="mt-0.5 block truncate text-[9px] font-medium opacity-75">{option.description}</span>
                      </button>
                    )
                  })}
                </div>

                {filterType === 'CLOSING' && (
                  <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3">
                    <label htmlFor="driver-closing" className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]"><ClipboardList className="h-3.5 w-3.5 text-[var(--accent)]" /> Selecciona el cierre</label>
                    <select
                      id="driver-closing"
                      value={selectedClosingId}
                      onChange={e => setSelectedClosingId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs font-bold text-[var(--text-primary)] focus:border-[var(--accent)]"
                    >
                      {closings.length === 0 ? (
                        <option value="">Sin cierres registrados</option>
                      ) : (
                        closings.map((c, idx) => (
                          <option key={c.id} value={c.id}>
                            Turno #{closings.length - idx} · {formatDate(c.shiftStart)} {c.user?.name ? `· ${c.user.name}` : ''}
                          </option>
                        ))
                      )}
                    </select>
                    {closings.length === 0 && <p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">Aún no existe un cierre para consultar.</p>}
                  </div>
                )}

                {filterType === 'DATE' && (
                  <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3">
                    <label htmlFor="driver-date" className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]"><CalendarDays className="h-3.5 w-3.5 text-[var(--accent)]" /> Selecciona el día</label>
                    <Input
                      id="driver-date"
                      type="date"
                      value={selectedDate}
                      onChange={e => setSelectedDate(e.target.value)}
                      className="h-10 rounded-xl border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs font-bold text-[var(--text-primary)] focus:border-[var(--accent)]"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">Mostrar domiciliarios</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['ALL', 'Todos', drivers.length],
                    ['ACTIVE', 'Activos', summary.active],
                    ['INACTIVE', 'Inactivos', Math.max(0, summary.total - summary.active)],
                    ['PENDING_CASH', 'Con efectivo pendiente', drivers.filter(d => (d.pendingCash || 0) > 0).length],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStatusFilter(value)}
                      aria-pressed={statusFilter === value}
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-extrabold transition-all ${statusFilter === value ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--text-primary)]'}`}
                    >
                      {label} <span className="ml-1 opacity-75">{count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {hasLocalFilters && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] text-blue-700 dark:text-blue-300">
                  <span>Filtros locales: {filteredDrivers.length} resultado{filteredDrivers.length === 1 ? '' : 's'}.</span>
                  <button type="button" onClick={clearLocalFilters} className="font-black underline hover:no-underline">Limpiar</button>
                </div>
              )}
            </CardContent>
          </Card>

          {loadError && (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--destructive)]/25 bg-[var(--destructive)]/5 px-4 py-3 text-xs text-[var(--destructive)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1 leading-5">{loadError}</span>
              <Button type="button" variant="outline" onClick={() => loadDrivers()} className="h-8 rounded-lg border-[var(--destructive)]/30 px-2.5 text-[10px] font-black text-[var(--destructive)] hover:bg-[var(--destructive)]/10">Reintentar</Button>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center py-20 text-[var(--text-secondary)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
              <span className="text-xs font-semibold mt-2">Cargando domiciliarios...</span>
            </div>
          ) : filteredDrivers.length === 0 ? (
            <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-10 text-center text-[var(--text-muted)] sm:p-16">
              {hasLocalFilters ? <Search className="mx-auto h-12 w-12 opacity-30" /> : <Bike className="mx-auto h-12 w-12 opacity-30" />}
              <p className="mt-3 text-sm font-bold text-[var(--text-primary)]">{hasLocalFilters ? 'No hay coincidencias' : 'No hay domiciliarios registrados'}</p>
              <p className="mt-1 text-xs">{hasLocalFilters ? 'Prueba otro nombre o limpia los filtros de estado.' : 'Registra los domiciliarios que realizan las entregas físicas.'}</p>
              {hasLocalFilters && <Button type="button" variant="outline" onClick={clearLocalFilters} className="mt-4 h-9 rounded-xl px-3 text-[10px] font-black">Limpiar filtros</Button>}
              {!hasLocalFilters && hasPermission('drivers.manage') && <Button type="button" onClick={openCreateDialog} className="mt-4 h-9 rounded-xl bg-[var(--accent)] px-3 text-[10px] font-black text-[var(--accent-fg)]">+ Registrar domiciliario</Button>}
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AnimatePresence>
                {filteredDrivers.map(d => (
                  <motion.div
                    key={d.id}
                    variants={fadeUp}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    layout
                  >
                    <Card className={`overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md transition-all duration-200 hover:border-[var(--accent)]/40 ${!d.active ? 'opacity-65' : ''}`}>
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${d.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'}`}>
                              {d.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <h4 className="truncate text-base font-extrabold leading-snug text-[var(--text-primary)]">{d.name}</h4>
                              <a href={`tel:${d.phone}`} className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--accent)] hover:underline">
                                <Phone className="h-3 w-3" /> {d.phone}
                              </a>
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${d.active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500' : 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400'}`}
                          >
                            <span className="mr-1">●</span>{d.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>

                        <Separator className="bg-[var(--border-subtle)]/50" />

                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/50 p-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Entregas</p>
                            <p className="mt-0.5 text-base font-black text-[var(--text-primary)]">{d.completedDeliveries}</p>
                          </div>
                          <div className="rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/50 p-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">En ruta</p>
                            <p className="mt-0.5 text-base font-black text-emerald-600">{d.activeDeliveries || 0}</p>
                          </div>
                          <div className="rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/50 p-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Fletes</p>
                            <p className="mt-0.5 text-sm font-black text-[var(--accent)]">{formatCurrency(d.totalDeliveryEarnings || 0)}</p>
                          </div>
                        </div>

                        {(d.pendingCash || 0) > 0 && (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Efectivo pendiente</span>
                            <span className="text-xs font-black">{formatCurrency(d.pendingCash || 0)}</span>
                          </div>
                        )}

                        {hasRole('ADMIN', 'SUPERADMIN') && (
                          <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold ${d.portalUser ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
                            <span className="flex min-w-0 items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0" />{d.portalUser ? <span className="truncate">Acceso listo: {d.portalUser.email}</span> : 'Sin acceso individual'}</span>
                            {d.portalUser && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 pt-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDetail(d.id)}
                            className="h-8 text-[10px] font-bold rounded-xl px-3 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                          >
                            <History className="h-3.5 w-3.5" /> Ver entregas
                          </Button>
                          <div className="flex items-center gap-1">
                            {hasRole('ADMIN', 'SUPERADMIN') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void openAccessDialog(d)}
                              className={`h-8 rounded-xl px-2.5 text-[10px] font-black ${d.portalUser ? 'border-emerald-500/25 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300' : 'border-blue-500/25 text-blue-700 hover:bg-blue-500/10 dark:text-blue-300'}`}
                              title={d.portalUser ? 'Restablecer acceso' : 'Crear acceso individual'}
                            >
                              <User className="mr-1 h-3.5 w-3.5" /> {d.portalUser ? 'Acceso' : 'Crear acceso'}
                            </Button>
                            )}
                            {hasPermission('drivers.manage') && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditDialog(d)}
                              className="h-8 w-8 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                              title="Editar datos"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            )}
                            {hasRole('ADMIN', 'SUPERADMIN') && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteDriver(d)}
                              className="h-8 w-8 rounded-lg text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                              title="Eliminar domiciliario"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            )}
                          </div>
                        </div>
                        {(d.pendingCash || 0) > 0 && (hasPermission('dispatch.change_status') || hasPermission('cash.open_close')) && (
                          <Button
                            onClick={() => openSettlementDialog(d)}
                            className="h-10 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs font-extrabold text-amber-600 hover:bg-amber-500/20"
                          >
                            <DollarSign className="mr-1.5 h-4 w-4" /> Recibir efectivo · {formatCurrency(d.pendingCash || 0)}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Right Side: Podiums / Ranking */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm rounded-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-yellow-500/10 to-transparent blur-xl pointer-events-none" />
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)] px-5 py-4.5">
              <CardTitle className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                <Award className="h-4.5 w-4.5 text-yellow-500" /> Ranking de Entregas
              </CardTitle>
              <CardDescription className="text-[10px] text-[var(--text-secondary)]">Los repartidores con más domicilios completados hoy/histórico.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-2.5">
              {rankedDrivers.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text-muted)] italic">
                  Aún no hay entregas registradas para el ranking.
                </div>
              ) : (
                rankedDrivers.map((d, index) => {
                  const isTop1 = index === 0
                  const isTop2 = index === 1
                  const isTop3 = index === 2
                  
                  let badgeBg = 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-default)]'
                  if (isTop1) badgeBg = 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                  else if (isTop2) badgeBg = 'bg-slate-300/10 text-slate-300 border border-slate-300/20'
                  else if (isTop3) badgeBg = 'bg-amber-600/10 text-amber-600 border border-amber-600/20'

                  return (
                    <div 
                      key={d.id} 
                      className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                        isTop1 ? 'bg-yellow-500/5 border-yellow-500/20 shadow-sm' : 'bg-[var(--bg-panel)] border-[var(--border-subtle)]/70'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center font-extrabold text-xs shrink-0 ${badgeBg}`}>
                          {index + 1}
                        </Badge>
                        <div className="min-w-0">
                          <p className="font-extrabold text-xs text-[var(--text-primary)] truncate">{d.name}</p>
                          <p className="text-[9px] text-[var(--text-secondary)] font-semibold mt-0.5">{d.phone}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-xs text-[var(--text-primary)]">{d.completedDeliveries} uds</p>
                        <p className="text-[9px] text-[var(--accent)] font-bold mt-0.5">{formatCurrency(d.totalDeliveryEarnings)}</p>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!accessDriver} onOpenChange={open => { if (!open) closeAccessDialog() }}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-3xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0">
          <div className="border-b border-[var(--border-subtle)] p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-black text-[var(--text-primary)]"><User className="h-5 w-5 text-[var(--accent)]" /> {accessDriver?.portalUser ? 'Restablecer acceso' : 'Acceso del domiciliario'}</DialogTitle>
              <DialogDescription>
                {accessDriver?.portalUser
                  ? `Actualiza el usuario o contraseña de ${accessDriver.name} sin ir al módulo de Usuarios.`
                  : `Configura el ingreso de ${accessDriver?.name || 'este domiciliario'} a su portal privado de entregas.`}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
              <p className="font-black text-[var(--text-primary)]">{accessDriver?.name}</p>
              <p className="mt-0.5 text-xs font-medium text-[var(--text-secondary)]">{accessDriver?.phone}</p>
              <p className="mt-2 text-[11px] leading-4 text-[var(--text-secondary)]">Solo verá sus propios pedidos, sus cobros y el historial del turno activo.</p>
            </div>

            {!accessDriver?.portalUser && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--bg-elevated)] p-1.5">
                <button type="button" onClick={() => { setAccessMode('CREATE'); setAccessError('') }} className={`h-9 rounded-xl text-xs font-black transition ${accessMode === 'CREATE' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>Crear cuenta</button>
                <button type="button" onClick={() => { setAccessMode('LINK'); setAccessError('') }} className={`h-9 rounded-xl text-xs font-black transition ${accessMode === 'LINK' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>Vincular usuario</button>
              </div>
            )}

            {accessMode === 'CREATE' ? (
              <>
                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">Usuario o correo</Label><Input value={accessLogin} onChange={event => setAccessLogin(event.target.value)} placeholder="Ej: juan.domicilios" className="h-11 rounded-xl" /><p className="text-[10px] leading-4 text-[var(--text-muted)]">Si escribes solo un usuario, el sistema completa el correo interno automáticamente.</p></div>
                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">{accessDriver?.portalUser ? 'Nueva contraseña' : 'Contraseña inicial'}</Label><Input type="password" value={accessPassword} onChange={event => setAccessPassword(event.target.value)} placeholder="Mínimo 4 caracteres" className="h-11 rounded-xl" autoComplete="new-password" /></div>
              </>
            ) : (
              <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">Cuenta de domiciliario existente</Label><select value={accessUserId} onChange={event => setAccessUserId(event.target.value)} disabled={loadingAccessCandidates} className="flex h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm font-semibold text-[var(--text-primary)]"><option value="">{loadingAccessCandidates ? 'Cargando cuentas...' : 'Selecciona una cuenta'}</option>{accessCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}</select><p className="text-[10px] leading-4 text-[var(--text-muted)]">Solo aparecen cuentas ya creadas para domiciliarios; ningún perfil de asignación, caja o salón se modifica.</p></div>
            )}

            {accessError && <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300">{accessError}</div>}
            <Button onClick={() => void handleSaveAccess()} disabled={savingAccess || (accessMode === 'LINK' && loadingAccessCandidates)} className="h-11 w-full rounded-xl bg-[var(--accent)] font-black text-white"><>{savingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{accessDriver?.portalUser ? 'Guardar nuevo acceso' : accessMode === 'CREATE' ? 'Crear acceso' : 'Vincular acceso'}</></Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!settlementDriver} onOpenChange={open => { if (!open && !settling) setSettlementDriver(null) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-black text-[var(--text-primary)]">
              <Wallet className="h-5 w-5 text-amber-500" /> Liquidar efectivo
            </DialogTitle>
            <DialogDescription>
              Recibe el dinero de {settlementDriver?.name} y deja estos pedidos conciliados en Caja Domicilios.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-secondary)]">Valor esperado</span>
                <strong className="text-xl font-black text-amber-600">{formatCurrency(settlementDriver?.pendingCash || 0)}</strong>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(settlementDriver?.pendingCashOrders || []).map(order => (
                  <Badge key={order.id} className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-secondary)]">
                    #{order.orderNumber} · {formatCurrency(order.amount)}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">Efectivo recibido</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--text-muted)]">$</span>
                <Input
                  value={formatThousandsInput(settlementAmount)}
                  onChange={event => setSettlementAmount(event.target.value.replace(/\D/g, ''))}
                  className="h-12 rounded-xl border-[var(--border-default)] bg-[var(--bg-input)] pl-8 text-lg font-black"
                  inputMode="numeric"
                />
              </div>
            </div>
            {settlementDriver && parseThousandsInput(settlementAmount) !== Math.round(settlementDriver.pendingCash || 0) && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs font-bold text-red-500">
                Diferencia: {formatCurrency(parseThousandsInput(settlementAmount) - (settlementDriver.pendingCash || 0))}. Quedará registrada en la liquidación.
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">Nota opcional</Label>
              <Input value={settlementNotes} onChange={event => setSettlementNotes(event.target.value)} placeholder="Ej: faltante informado por el domiciliario" className="h-11 rounded-xl" />
            </div>
            <Button onClick={handleSettleCash} disabled={settling} className="h-12 w-full rounded-xl bg-amber-500 font-extrabold text-white hover:bg-amber-600">
              {settling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirmar entrega de efectivo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CREATE / EDIT DIALOG ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-sm">
          <div className="h-1.5 w-full bg-[var(--accent)]" />
          <div className="p-6">
            <DialogHeader className="pb-3 border-b border-[var(--border-subtle)]/60">
              <DialogTitle className="text-[var(--text-primary)] text-lg font-black flex items-center gap-2">
                <Bike className="h-5.5 w-5.5 text-[var(--accent)]" />
                {editId ? 'Editar Domiciliario' : 'Nuevo Domiciliario'}
              </DialogTitle>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-medium">Registra los datos para asignar pedidos y facturas de flete.</p>
            </DialogHeader>
            
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre Completo *</Label>
                <Input
                  value={driverName}
                  onChange={e => setDriverName(e.target.value)}
                  placeholder="Ej: Brayan Domicilios"
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 focus:border-[var(--accent)] font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Número de Celular *</Label>
                <Input
                  value={driverPhone}
                  onChange={e => setDriverPhone(e.target.value)}
                  placeholder="Ej: 3001234567"
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl text-xs h-10 focus:border-[var(--accent)] font-semibold"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-2.5 text-[10px] text-[var(--destructive)] font-semibold leading-relaxed flex items-center gap-1.5 animate-fade-in">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button 
                  variant="outline" 
                  className="flex-1 h-10 rounded-xl font-bold text-xs border-[var(--border-default)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1 h-10 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-xs shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer"
                  onClick={handleSave} 
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Guardando...' : 'Confirmar'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── DETAIL / HISTORIAL DIALOG ── */}
      <Dialog open={!!detailDriver} onOpenChange={open => { if (!open) setDetailDriver(null) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-xl">
          <div className="h-1.5 w-full bg-[var(--accent)]" />
          <div className="p-6">
            <DialogHeader className="pb-3 border-b border-[var(--border-subtle)]/60">
              <DialogTitle className="text-[var(--text-primary)] text-lg font-black flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <History className="h-5.5 w-5.5 text-[var(--accent)]" />
                  Historial de Entregas: {detailDriver?.name}
                </span>
                <Badge className="text-[9px] bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent-border)] font-bold">
                  {detailDriver?.orders.length} pedidos
                </Badge>
              </DialogTitle>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 font-medium">Últimos domicilios despachados a este repartidor.</p>
            </DialogHeader>

            <div className="pt-4 max-h-[380px] overflow-y-auto pr-1 space-y-3 custom-scrollbar">
              {detailDriver?.orders.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--text-muted)] italic">
                  Este domiciliario no ha realizado ninguna entrega aún.
                </div>
              ) : (
                detailDriver?.orders.map(order => (
                  <div 
                    key={order.id}
                    onClick={() => handleViewOrder(order.id)}
                    className="p-3.5 rounded-xl border border-[var(--border-subtle)]/70 bg-[var(--bg-elevated)]/30 space-y-2 flex justify-between items-start cursor-pointer hover:border-[var(--accent)] hover:shadow-sm transition-all"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-[var(--text-primary)]">Pedido #{order.orderNumber}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{formatDate(order.createdAt)}</span>
                        <Badge 
                          variant="outline" 
                          className="px-2 py-0.5 rounded-full text-[9px] uppercase font-black tracking-wider"
                          style={{ 
                            borderColor: `${getStatusColor(order.status)}30`, 
                            color: getStatusColor(order.status),
                            backgroundColor: `${getStatusColor(order.status)}08`
                          }}
                        >
                          {getStatusLabel(order.status)}
                        </Badge>
                      </div>
                      <p className="text-xs font-bold text-[var(--text-secondary)] truncate">Cliente: {order.customerName}</p>
                      <p className="text-[10px] text-[var(--text-muted)] truncate">Dir: {order.customerAddress}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className="text-sm font-black text-[var(--text-primary)] block">{formatCurrency(order.total)}</span>
                      <span className="text-[9px] font-extrabold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-md mt-1 inline-block">
                        Flete: {formatCurrency(order.deliveryFee)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex pt-4 border-t border-[var(--border-subtle)]/50 mt-4 justify-end">
              <Button 
                variant="outline" 
                className="h-10 rounded-xl font-bold text-xs border-[var(--border-default)] hover:bg-[var(--bg-hover)] px-5 cursor-pointer"
                onClick={() => setDetailDriver(null)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Order Detail Dialog ── */}
      <Dialog open={!!detailOrder} onOpenChange={() => setDetailOrder(null)}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto p-6 custom-scrollbar">
          {detailOrder && (() => {
            const o = detailOrder
            const phoneDigits = (o.customerPhone || '').replace(/\D/g, '')
            const whatsappMsg = encodeURIComponent(`Hola ${o.customerName}! Tu pedido en The Villa Dog está registrado. Total: ${formatCurrency(o.total)}`)
            const whatsapp = phoneDigits ? `https://wa.me/57${phoneDigits}?text=${whatsappMsg}` : '#'
            return (
              <div className="space-y-4">
                <DialogHeader className="pb-2 border-b border-[var(--border-subtle)]">
                  <DialogTitle className="flex items-center justify-between">
                    <div>
                      <span className="text-2xl font-black text-[var(--text-primary)]">Factura #{o.invoiceNumber || o.orderNumber}</span>
                      <span className="text-xs text-[var(--text-muted)] font-bold ml-2">(Turno #{o.orderNumber})</span>
                    </div>
                    <Badge className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: getStatusColor(o.status), backgroundColor: `${getStatusColor(o.status)}15`, border: `1px solid ${getStatusColor(o.status)}25` }}>
                      {getStatusLabel(o.status)}
                    </Badge>
                  </DialogTitle>
                </DialogHeader>

                {/* Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-1.5">
                    <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1"><User className="h-3 w-3" /> Cliente</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{o.customerName}</p>
                    <a href={`tel:${o.customerPhone}`} className="text-xs text-[var(--accent)] font-semibold flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" /> {o.customerPhone}
                    </a>
                    <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1 mt-1">
                      <MapPin className="h-3 w-3 shrink-0 mt-0.5" /> {o.zone ? o.zone.name : o.customerAddress}
                    </p>
                    {o.zone && o.customerAddress && <p className="text-[10px] text-[var(--text-muted)] font-bold">{o.customerAddress}</p>}
                    {o.addressReference && <p className="text-[10px] text-[var(--text-muted)] italic">Ref: {o.addressReference}</p>}
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
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl h-10 font-bold text-xs cursor-pointer" onClick={() => setDetailOrder(null)}>
                    Cerrar
                  </Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl h-10 px-4 text-xs gap-1 cursor-pointer"
                    onClick={() => printComandaSmart(o, 'caja', user?.role, false, false)}>
                    <Printer className="h-4 w-4" /> Imprimir Factura
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

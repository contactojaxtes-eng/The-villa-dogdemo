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
  User, MapPin, ClipboardList, UtensilsCrossed, XCircle, Printer, FileSpreadsheet, FileText, Download, Wallet
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
  totalDeliveryEarnings: number
  totalDeliveredSales?: number
  pendingCash?: number
  pendingCashOrders?: { id: string; orderNumber: number; amount: number }[]
  orders?: DriverOrder[]
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

export default function DriversPage() {
  const { user, hasRole, hasPermission } = useAuth()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [closings, setClosings] = useState<any[]>([])
  const [filterType, setFilterType] = useState<string>('CURRENT')
  const [selectedClosingId, setSelectedClosingId] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }))
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
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

  // Details Modal
  const [detailDriver, setDetailDriver] = useState<DriverDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Order Detail Modal
  const [detailOrder, setDetailOrder] = useState<any>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)

  const loadDrivers = useCallback(async () => {
    setLoading(true)
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
      .sort((a, b) => b.completedDeliveries - a.completedDeliveries || a.name.localeCompare(b.name))
  }, [drivers, search])

  // Ranking calculation
  const rankedDrivers = useMemo(() => {
    return [...drivers]
      .filter(d => d.completedDeliveries > 0)
      .sort((a, b) => b.completedDeliveries - a.completedDeliveries)
  }, [drivers])

  const summary = useMemo(() => {
    const total = drivers.length
    const active = drivers.filter(d => d.active).length
    const totalFees = drivers.reduce((sum, d) => sum + d.totalDeliveryEarnings, 0)
    const pendingCash = drivers.reduce((sum, d) => sum + (d.pendingCash || 0), 0)
    return { total, active, totalFees, pendingCash }
  }, [drivers])

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
      } else {
        await api.post('/delivery-drivers', payload)
      }
      setDialogOpen(false)
      loadDrivers()
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDriver = async (driver: Driver) => {
    const confirm = window.confirm(`🗑️ ¿Estás seguro de que deseas eliminar permanentemente al domiciliario "${driver.name}"?`)
    if (!confirm) return
    try {
      await api.delete(`/delivery-drivers/${driver.id}`)
      loadDrivers()
    } catch (err: any) {
      console.error('Error al eliminar domiciliario:', err)
      alert(err.response?.data?.message || err.message || 'Error al eliminar domiciliario')
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
        ['Total Domiciliarios', drivers.length],
        ['Total Tarifas Entregadas', formatCurrency(summary.totalFees)],
        [''],
        ['DOMICILIARIO', 'TELÉFONO', 'ESTADO', 'DOMICILIOS ENTREGADOS', 'RECAUDO FLETES', 'TOTAL VENTAS ENTREGADAS'],
        ...drivers.map(d => [
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
      for (const d of drivers) {
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
        body: drivers.map(d => [
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
      for (const d of drivers) {
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
    <div className="space-y-6 max-w-7xl pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none uppercase">Domiciliarios</h2>
          <p className="text-[var(--text-secondary)] text-xs mt-1.5 font-medium">Control, entrega y ranking de repartidores en tiempo real.</p>
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
                Excel
              </Button>
              <Button 
                onClick={handleExportPDF}
                disabled={exporting !== null || loading}
                variant="outline"
                className="border-red-500/30 text-red-500 hover:bg-red-500/10 font-bold rounded-xl h-11 px-4 gap-1.5 cursor-pointer text-xs uppercase tracking-wider bg-[var(--bg-panel)]"
              >
                {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                PDF
              </Button>
            </>
          )}
          {hasPermission('drivers.manage') && (
            <Button 
              onClick={openCreateDialog}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold rounded-xl h-11 px-5 gap-1.5 shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer text-xs uppercase tracking-wider"
            >
              <Plus className="h-4.5 w-4.5" /> Agregar Repartidor
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm rounded-2xl">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Total Creados</p>
              <h3 className="text-3xl font-black text-[var(--text-primary)] mt-1.5">{summary.total}</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-[var(--accent-muted)]/40 flex items-center justify-center text-[var(--accent)]">
              <Users className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/25 bg-[var(--bg-panel)] shadow-sm rounded-2xl">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Efectivo por entregar</p>
              <h3 className="text-3xl font-black text-amber-500 mt-1.5">{formatCurrency(summary.pendingCash)}</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
              <Wallet className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm rounded-2xl">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Choferes Activos</p>
              <h3 className="text-3xl font-black text-emerald-500 mt-1.5">{summary.active}</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <Bike className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm rounded-2xl">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Tarifas Entregadas</p>
              <h3 className="text-3xl font-black text-[var(--accent)] mt-1.5">{formatCurrency(summary.totalFees)}</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-[var(--accent-muted)]/40 flex items-center justify-center text-[var(--accent)]">
              <DollarSign className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Search & Drivers List */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm rounded-2xl">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar domiciliario por nombre o teléfono..."
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-11 pl-10 text-xs focus:border-[var(--accent)] font-semibold"
                  />
                </div>

                <div className="shrink-0 flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center">
                  <select
                    value={filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="bg-[var(--bg-input)] border border-[var(--border-default)] rounded-xl h-11 px-3 text-xs font-extrabold text-[var(--text-primary)] focus:border-[var(--accent)] cursor-pointer min-w-[220px]"
                  >
                    <option value="CURRENT">🟢 Turno Actual</option>
                    <option value="WEEK">📆 Esta Semana (Lunes a Domingo)</option>
                    <option value="MONTH">🗓️ Este Mes</option>
                    <option value="CLOSING">📋 Por Cierre de Caja</option>
                    <option value="DATE">📆 Por Fecha (Calendario)</option>
                    <option value="ALL">🌐 Todas las Cajas (Histórico)</option>
                  </select>

                  {filterType === 'CLOSING' && (
                    <select
                      value={selectedClosingId}
                      onChange={e => setSelectedClosingId(e.target.value)}
                      className="bg-[var(--bg-input)] border border-[var(--accent)]/50 rounded-xl h-11 px-3 text-xs font-extrabold text-[var(--text-primary)] focus:border-[var(--accent)] cursor-pointer min-w-[260px] max-w-full shadow-sm"
                    >
                      {closings.length === 0 ? (
                        <option value="">Sin cierres registrados</option>
                      ) : (
                        closings.map((c, idx) => (
                          <option key={c.id} value={c.id}>
                            Turno #{closings.length - idx} — {formatDate(c.shiftStart)} {c.user?.name ? `(${c.user.name})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  )}

                  {filterType === 'DATE' && (
                    <Input
                      type="date"
                      value={selectedDate}
                      onChange={e => setSelectedDate(e.target.value)}
                      className="bg-[var(--bg-input)] border border-[var(--accent)]/50 rounded-xl h-11 px-3 text-xs font-extrabold text-[var(--text-primary)] focus:border-[var(--accent)] cursor-pointer min-w-[170px]"
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex flex-col items-center py-20 text-[var(--text-secondary)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
              <span className="text-xs font-semibold mt-2">Cargando domiciliarios...</span>
            </div>
          ) : filteredDrivers.length === 0 ? (
            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl p-16 text-center text-[var(--text-muted)]">
              <Bike className="mx-auto h-12 w-12 opacity-30 animate-bounce" />
              <p className="font-bold text-sm mt-3 text-[var(--text-primary)]">No hay repartidores registrados</p>
              <p className="text-xs mt-1">Registra los domiciliarios que realizan las entregas físicas en Montería.</p>
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
                    <Card className={`border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl hover:border-[var(--accent)]/30 transition-all duration-200 shadow-md overflow-hidden ${!d.active ? 'opacity-65' : ''}`}>
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-extrabold text-base text-[var(--text-primary)] truncate leading-snug">{d.name}</h4>
                            <a href={`tel:${d.phone}`} className="flex items-center gap-1.5 text-xs text-[var(--accent)] font-bold mt-1 hover:underline">
                              <Phone className="h-3 w-3" />
                              {d.phone}
                            </a>
                          </div>
                          <Badge 
                            variant="outline" 
                            className={`rounded-full text-[9px] uppercase px-2 py-0.5 font-extrabold ${
                              d.active 
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                            }`}
                          >
                            {d.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>

                        <Separator className="bg-[var(--border-subtle)]/50" />

                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="bg-[var(--bg-elevated)]/50 rounded-xl p-2 border border-[var(--border-subtle)]/40">
                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Entregas</p>
                            <p className="text-base font-black text-[var(--text-primary)] mt-0.5">{d.completedDeliveries}</p>
                          </div>
                          <div className="bg-[var(--bg-elevated)]/50 rounded-xl p-2 border border-[var(--border-subtle)]/40">
                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Recaudo Flete</p>
                            <p className="text-base font-black text-[var(--accent)] mt-0.5">{formatCurrency(d.totalDeliveryEarnings)}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDetail(d.id)}
                            className="h-8 text-[10px] font-bold rounded-xl px-3 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                          >
                            <History className="h-3.5 w-3.5" /> Historial
                          </Button>
                          <div className="flex items-center gap-1">
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
                            <DollarSign className="mr-1.5 h-4 w-4" /> Liquidar {formatCurrency(d.pendingCash || 0)}
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

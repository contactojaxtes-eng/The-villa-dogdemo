import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { formatCurrency, getLocalDateString } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
  RadialBarChart, RadialBar,
} from 'recharts'
import {
  TrendingUp, DollarSign, ShoppingBag, Wallet, XCircle, Clock, CalendarDays, BarChart3,
  Download, FileSpreadsheet, FileText, Filter, ChevronDown, Award, Flame, CreditCard,
  ArrowUpRight, ArrowDownRight, Percent, Package, Users, Bike, Landmark,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/* ════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════ */
interface DailyReport {
  date: string
  totalOrders: number
  ordersDelivered: number
  ordersCancelled: number
  ordersPending: number
  totalSales: number
  totalCash: number
  totalTransfers: number
  totalTips: number
  totalExpenses: number
  netIncome: number
  paymentBreakdown?: { method: string; total: number }[]
}

interface DashboardStats {
  range: { start: string; end: string }
  today: {
    orders: number; delivered: number; pending: number; cancelled: number
    sales: number; tips: number; cash: number; transfer: number
    creditSales?: number; expenses: number; cogs?: number; marginPercent?: number
  }
  activeOrders: number
  totalOrders: number
  totalCustomers: number
  topWaiters: { waiterId: string; name: string; photo: string | null; orders: number; sales: number }[]
  topDrivers?: { waiterId: string; name: string; photo: string | null; orders: number; sales: number }[]
  topCashiers?: { waiterId: string; name: string; photo: string | null; orders: number; sales: number }[]
  topItems?: { name: string; quantity: number; price: number }[]
  lowStock?: { id: string; name: string; unit: string; stock: number; minStock: number; costPerUnit: number }[]
  trend?: { label: string; sales: number; expenses: number; net: number }[]
}

interface SalesReport {
  period: { start: string; end: string }
  summary: {
    totalSales: number
    totalSubtotal: number
    totalTax: number
    totalDeliveryFee: number
    totalOrders: number
    deliveredCount: number
    cancelledCount: number
    cancelledAmount: number
    pendingCount: number
    totalTips: number
    avgOrderValue: number
  }
  abonosCartera?: {
    total: number
    totalCash: number
    totalTransfer: number
    count: number
    items: any[]
  }
  byWaiter: { name: string; orders: number; sales: number; tips: number }[]
  byDriver: { name: string; phone: string; deliveries: number; fees: number; total: number }[]
  byCustomer: { name: string; phone: string; orders: number; total: number }[]
  byPaymentMethod: { method: string; orders: number; total: number }[]
  topItems: { name: string; quantity: number; total: number }[]
  orders: any[]
}

/* ════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════ */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo', TRANSFER: 'Transferencia', NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia', DAVIPLATA: 'Daviplata', CREDIT: 'Crédito',
}

const PIE_COLORS = ['#90BF50', '#7EA743', '#6B8E3B', '#587532', '#A4C96C', '#BFD98B', '#C8E59F']

const BAR_COLORS = {
  delivered: '#90BF50',
  pending: '#F59E0B',
  cancelled: '#EF4444',
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } }
} as const

/* ════════════════════════════════════════════════════════
   TOOLTIP
   ════════════════════════════════════════════════════════ */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/95 backdrop-blur-xl px-5 py-4 text-xs shadow-2xl space-y-1.5" style={{ minWidth: 160 }}>
      <p className="font-extrabold text-[var(--text-primary)] uppercase tracking-wider mb-2 text-[11px]">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 font-bold">
          <span style={{ color: p.color }} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: p.color }} />
            {p.name}:
          </span>
          <span className="text-[var(--text-primary)] font-extrabold">
            {typeof p.value === 'number' && !['pedidos', 'quantity', 'orders'].includes(p.dataKey) ? formatCurrency(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   DATE HELPERS
   ════════════════════════════════════════════════════════ */
function todayStr() { return getLocalDateString() }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return getLocalDateString(d) }
function monthStart() { const d = new Date(); d.setDate(1); return getLocalDateString(d) }

type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom'

const RANGE_PRESETS: { key: RangePreset; label: string; icon: typeof CalendarDays }[] = [
  { key: 'today', label: 'Hoy', icon: CalendarDays },
  { key: '7d', label: '7 Días', icon: Filter },
  { key: '30d', label: '30 Días', icon: Filter },
  { key: 'month', label: 'Este Mes', icon: CalendarDays },
  { key: 'custom', label: 'Personalizado', icon: ChevronDown },
]

/* ════════════════════════════════════════════════════════
   EXCEL EXPORT
   ════════════════════════════════════════════════════════ */
async function exportToExcel(
  daily: DailyReport | null,
  dashboard: DashboardStats | null,
  sales: SalesReport | null,
  startDate: string,
  endDate: string,
) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const summary = sales?.summary
  const totalSales = summary?.totalSales ?? dashboard?.today.sales ?? daily?.totalSales ?? 0
  const totalSubtotal = summary?.totalSubtotal ?? 0
  const totalTax = summary?.totalTax ?? 0
  const totalDeliveryFee = summary?.totalDeliveryFee ?? 0
  const totalOrders = summary?.totalOrders ?? dashboard?.today.orders ?? daily?.totalOrders ?? 0
  const deliveredCount = summary?.deliveredCount ?? dashboard?.today.delivered ?? daily?.ordersDelivered ?? 0
  const cancelledCount = summary?.cancelledCount ?? dashboard?.today.cancelled ?? daily?.ordersCancelled ?? 0
  const cancelledAmount = summary?.cancelledAmount ?? 0
  const pendingCount = summary?.pendingCount ?? dashboard?.today.pending ?? daily?.ordersPending ?? 0
  const totalCash = dashboard?.today.cash ?? daily?.totalCash ?? 0
  const totalTransfer = dashboard?.today.transfer ?? daily?.totalTransfers ?? 0
  const creditSales = dashboard?.today.creditSales ?? 0
  const totalExpenses = dashboard?.today.expenses ?? daily?.totalExpenses ?? 0
  const netIncome = totalSales - totalExpenses
  const avgTicket = summary?.avgOrderValue ?? (deliveredCount > 0 ? totalSales / deliveredCount : 0)

  const formatExcelDate = (dVal: any) => {
    if (!dVal) return ''
    const d = new Date(dVal)
    if (isNaN(d.getTime())) return String(dVal)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  const formatExcelCurrency = (val: number) => {
    if (val === undefined || val === null || isNaN(val)) return '$0,00'
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val).replace(/\s+/g, ' ')
  }

  // Sheet 1: Ventas / Reporte Contable General (Organizado cronológicamente por Fecha)
  const sortedOrders = [...(sales?.orders || [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const accountingVentasData = [
    ['Fecha Creación', 'No.', 'Mesa', 'Facturador', 'Forma de pago', 'Fecha de pago', 'Base Imp', 'Total Imp.', 'Total', 'Propina', 'Domicilio', 'domiciliario', 'Cliente', 'Estado'],
    ...sortedOrders.map(o => {
      const orderTypeLabel = o.orderType === 'DELIVERY' ? 'DOMICILIOS' : o.orderType === 'PICKUP' ? 'RECOGER LOCAL' : 'MOSTRADOR'
      const facturadorName = o.assignee?.name || o.waiter?.name || 'Adriana'
      const formaPago = o.paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'

      const subtotalProd = (o.subtotal && o.subtotal > 0) ? o.subtotal : Math.max(0, (o.total || 0) - (o.deliveryFee || 0))
      const baseVal = Math.round((subtotalProd / 1.08) * 100) / 100
      const taxVal = Math.round((subtotalProd - baseVal) * 100) / 100

      const motivoCancelacion = o.cancellationReason || (o as any).cancelReason || ''
      const estadoLabel = o.status === 'DELIVERED' ? 'Entregado'
        : o.status === 'CANCELLED' ? (motivoCancelacion ? `Cancelado (${motivoCancelacion.trim()})` : 'Cancelado')
        : o.status === 'IN_ROUTE' ? 'En Ruta'
        : o.status === 'READY' ? 'Listo'
        : o.status === 'PREPARING' ? 'En Preparación'
        : 'Pendiente'

      return [
        formatExcelDate(o.createdAt),
        o.orderNumber,
        orderTypeLabel,
        facturadorName,
        formaPago,
        formatExcelDate(o.paidAt || o.createdAt),
        formatExcelCurrency(baseVal),
        formatExcelCurrency(taxVal),
        formatExcelCurrency(o.total || 0),
        formatExcelCurrency(o.tip || 0),
        formatExcelCurrency(o.deliveryFee || 0),
        o.deliveryDriver?.name || '',
        o.customerName || 'Consumidor Final',
        estadoLabel,
      ]
    })
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(accountingVentasData)
  ws1['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'Ventas')

  // Sheet 2: Resumen Financiero
  const summaryData = [
    ['REPORTE FINANCIERO Y OPERATIVO — THE VILLA DOG'],
    ['Período Consultado', `${startDate} al ${endDate}`],
    ['Fecha de Generación', new Date().toLocaleString('es-CO')],
    [''],
    ['CONCEPTO / INDICADOR', 'VALOR'],
    ['Total Pedidos Registrados', totalOrders],
    ['Pedidos Entregados (Exitosos)', deliveredCount],
    ['Pedidos Pendientes / En Ruta', pendingCount],
    ['Pedidos Cancelados', cancelledCount],
    ['Monto Total Cancelado', formatCurrency(cancelledAmount)],
    [''],
    ['Subtotal Base Imponible (Sin Impuestos)', formatCurrency(totalSubtotal)],
    ['Impoconsumo (INC 8%)', formatCurrency(totalTax)],
    ['Recaudo Fletes (Domicilios)', formatCurrency(totalDeliveryFee)],
    ['VENTAS TOTALES FACTURADAS', formatCurrency(totalSales)],
    [''],
    ['Recaudo Efectivo', formatCurrency(totalCash)],
    ['Recaudo Transferencias / Bancos', formatCurrency(totalTransfer)],
    ['Ventas a Crédito (Fiado)', formatCurrency(creditSales)],
    ['Gastos / Egresos del Período', formatCurrency(totalExpenses)],
    ['INGRESO NETO CONSOLIDADO', formatCurrency(netIncome)],
    ['Ticket Promedio por Pedido', formatCurrency(avgTicket)],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 40 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Financiero')

  // Sheet 2: Domiciliarios
  const driversList = sales?.byDriver?.length ? sales.byDriver : (dashboard?.topDrivers || []).map(d => ({ name: d.name, phone: '', deliveries: d.orders, fees: 0, total: d.sales }))
  if (driversList.length) {
    const driverData = [
      ['DOMICILIARIO', 'TELÉFONO', 'ENTREGAS COMPLETADAS', 'RECAUDO FLETES', 'TOTAL TRANSPORTADO'],
      ...driversList.map(d => [d.name, d.phone || 'N/A', d.deliveries, formatCurrency(d.fees || 0), formatCurrency(d.total)])
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(driverData)
    ws2['!cols'] = [{ wch: 25 }, { wch: 16 }, { wch: 24 }, { wch: 18 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Domiciliarios')
  }

  // Sheet 3: Ventas por Día / Tendencia
  if (dashboard?.trend?.length) {
    const trendData = [
      ['PERÍODO / DÍA', 'VENTAS TOTALES', 'GASTOS', 'INGRESO NETO'],
      ...dashboard.trend.map(t => [t.label, formatCurrency(t.sales), formatCurrency(t.expenses), formatCurrency(t.net)])
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(trendData)
    ws3['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Ventas por Día')
  }

  // Sheet 4: Métodos de Pago
  if (sales?.byPaymentMethod?.length) {
    const payData = [
      ['MÉTODO DE PAGO', 'PEDIDOS PROCESADOS', 'TOTAL RECAUDADO'],
      ...sales.byPaymentMethod.map(p => [PAYMENT_LABELS[p.method] || p.method, p.orders, formatCurrency(p.total)])
    ]
    const ws4 = XLSX.utils.aoa_to_sheet(payData)
    ws4['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws4, 'Métodos de Pago')
  }

  // Sheet 5: Asesores / Trabajadores
  if (sales?.byWaiter?.length) {
    const waiterData = [
      ['TRABAJADOR / ASESOR', 'PEDIDOS ATENDIDOS', 'TOTAL FACTURADO', 'PROPINAS RECAUDADAS'],
      ...sales.byWaiter.map(w => [w.name, w.orders, formatCurrency(w.sales), formatCurrency(w.tips)])
    ]
    const ws5 = XLSX.utils.aoa_to_sheet(waiterData)
    ws5['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, ws5, 'Trabajadores')
  }

  // Sheet 6: Cajeros
  if (dashboard?.topCashiers?.length) {
    const cashierData = [
      ['CAJERO', 'PEDIDOS COBRADOS', 'TOTAL RECAUDADO'],
      ...dashboard.topCashiers.map(c => [c.name, c.orders, formatCurrency(c.sales)])
    ]
    const ws6 = XLSX.utils.aoa_to_sheet(cashierData)
    ws6['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws6, 'Cajeros')
  }

  // Sheet 7: Top Clientes
  if (sales?.byCustomer?.length) {
    const custData = [
      ['CLIENTE', 'TELÉFONO', 'CANTIDAD PEDIDOS', 'TOTAL GASTADO'],
      ...sales.byCustomer.map(c => [c.name, c.phone || 'N/A', c.orders, formatCurrency(c.total)])
    ]
    const ws7 = XLSX.utils.aoa_to_sheet(custData)
    ws7['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws7, 'Top Clientes')
  }

  // Sheet 8: Productos Top
  if (sales?.topItems?.length) {
    const itemsData = [
      ['RANKING', 'PRODUCTO', 'UNIDADES VENDIDAS', 'TOTAL GENERADO'],
      ...sales.topItems.map((i, idx) => [idx + 1, i.name, i.quantity, formatCurrency(i.total)])
    ]
    const ws8 = XLSX.utils.aoa_to_sheet(itemsData)
    ws8['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws8, 'Productos Top')
  }

  // Sheet 9: Listado Detallado de Pedidos
  if (sales?.orders?.length) {
    const ordersData = [
      ['FACTURA/TURNO', 'FECHA Y HORA', 'CLIENTE', 'TELÉFONO', 'DIRECCIÓN', 'BARRIO/ZONA', 'DOMICILIARIO', 'ESTADO', 'MÉTODO PAGO', 'SUBTOTAL (BASE)', 'FLETE', 'IMPOCONSUMO (8%)', 'TOTAL FACTURADO', 'ASESOR', 'MOTIVO CANCELACIÓN'],
      ...sales.orders.map(o => {
        const taxVal = o.tax && o.tax > 0 ? o.tax : Math.round(o.subtotal - Math.round(o.subtotal / 1.08));
        const baseVal = (o.subtotal || 0) - taxVal;
        return [
          `#${o.orderNumber}`,
          new Date(o.createdAt).toLocaleString('es-CO'),
          o.customerName || 'N/A',
          o.customerPhone || 'N/A',
          o.customerAddress || 'N/A',
          o.zone?.name || 'N/A',
          o.deliveryDriver?.name || 'Sin asignar',
          o.status,
          PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod,
          formatCurrency(baseVal),
          formatCurrency(o.deliveryFee || 0),
          formatCurrency(taxVal),
          formatCurrency(o.total || 0),
          o.waiter?.name || 'Sistema',
          o.cancellationReason || '',
        ]
      })
    ]
    const ws9 = XLSX.utils.aoa_to_sheet(ordersData)
    ws9['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 28 }]
    XLSX.utils.book_append_sheet(wb, ws9, 'Detalle de Pedidos')
  }

  XLSX.writeFile(wb, `Reporte_The Villa Dog_${startDate}_${endDate}.xlsx`)
}

/* ════════════════════════════════════════════════════════
   PDF EXPORT
   ════════════════════════════════════════════════════════ */
async function exportToPDF(
  daily: DailyReport | null,
  dashboard: DashboardStats | null,
  sales: SalesReport | null,
  startDate: string,
  endDate: string,
) {
  const jsPDFModule = await import('jspdf')
  const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = autoTableModule.default || autoTableModule.autoTable

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()

  // Banner superior verde The Villa Dog
  doc.setFillColor(144, 191, 80) // #90BF50
  doc.rect(0, 0, pageW, 28, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text('THE VILLA DOG', pageW / 2, 13, { align: 'center' })
  doc.setFontSize(9)
  doc.text(`REPORTE CONSOLIDADO DE VENTAS Y OPERACIÓN (${startDate} — ${endDate})`, pageW / 2, 21, { align: 'center' })

  let y = 35

  const summary = sales?.summary
  const totalSales = summary?.totalSales ?? dashboard?.today.sales ?? daily?.totalSales ?? 0
  const totalSubtotal = summary?.totalSubtotal ?? 0
  const totalTax = summary?.totalTax ?? 0
  const totalDeliveryFee = summary?.totalDeliveryFee ?? 0
  const totalOrders = summary?.totalOrders ?? dashboard?.today.orders ?? daily?.totalOrders ?? 0
  const deliveredCount = summary?.deliveredCount ?? dashboard?.today.delivered ?? daily?.ordersDelivered ?? 0
  const cancelledCount = summary?.cancelledCount ?? dashboard?.today.cancelled ?? daily?.ordersCancelled ?? 0
  const pendingCount = summary?.pendingCount ?? dashboard?.today.pending ?? daily?.ordersPending ?? 0
  const totalExpenses = dashboard?.today.expenses ?? daily?.totalExpenses ?? 0
  const netIncome = totalSales - totalExpenses
  const avgTicket = summary?.avgOrderValue ?? (deliveredCount > 0 ? totalSales / deliveredCount : 0)

  // Section 1: RESUMEN FINANCIERO Y OPERATIVO
  doc.setTextColor(40, 40, 40)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('1. RESUMEN FINANCIERO Y OPERATIVO', 14, y)
  y += 5

  autoTable(doc, {
    startY: y,
    head: [['Métrica Operativa / Financiera', 'Valor']],
    body: [
      ['Total Pedidos Registrados', String(totalOrders)],
      ['Pedidos Entregados', String(deliveredCount)],
      ['Pedidos Pendientes / En Ruta', String(pendingCount)],
      ['Pedidos Cancelados', String(cancelledCount)],
      ['Subtotal Bruto', formatCurrency(totalSubtotal)],
      ['Impoconsumo (8%)', formatCurrency(totalTax)],
      ['Recaudo Fletes Domicilio', formatCurrency(totalDeliveryFee)],
      ['VENTAS TOTALES FACTURADAS', formatCurrency(totalSales)],
      ['Gastos / Egresos', formatCurrency(totalExpenses)],
      ['INGRESO NETO CONSOLIDADO', formatCurrency(netIncome)],
      ['Ticket Promedio por Pedido', formatCurrency(avgTicket)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [245, 250, 240] },
    margin: { left: 14, right: 14 },
  })

  y = (doc as any).lastAutoTable?.finalY + 10 || y + 60

  // Section 2: RENDIMIENTO DE DOMICILIARIOS
  const driversList = sales?.byDriver?.length ? sales.byDriver : (dashboard?.topDrivers || []).map(d => ({ name: d.name, phone: '', deliveries: d.orders, fees: 0, total: d.sales }))
  if (driversList.length) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('2. RENDIMIENTO POR DOMICILIARIO', 14, y)
    y += 5

    autoTable(doc, {
      startY: y,
      head: [['Domiciliario', 'Teléfono', 'Entregas', 'Recaudo Fletes', 'Total Transportado']],
      body: driversList.map(d => [
        d.name, d.phone || 'N/A', String(d.deliveries), formatCurrency(d.fees || 0), formatCurrency(d.total)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [245, 250, 240] },
      margin: { left: 14, right: 14 },
    })

    y = (doc as any).lastAutoTable?.finalY + 10 || y + 35
  }

  // Section 3: TRABAJADORES Y ASESORES
  if (sales?.byWaiter?.length) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('3. RENDIMIENTO POR TRABAJADOR / ASESOR', 14, y)
    y += 5

    autoTable(doc, {
      startY: y,
      head: [['Asesor / Mesero', 'Pedidos Atendidos', 'Total Facturado', 'Propinas']],
      body: sales.byWaiter.map(w => [
        w.name, String(w.orders), formatCurrency(w.sales), formatCurrency(w.tips)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [245, 250, 240] },
      margin: { left: 14, right: 14 },
    })

    y = (doc as any).lastAutoTable?.finalY + 10 || y + 35
  }

  // Section 4: MÉTODOS DE PAGO
  if (sales?.byPaymentMethod?.length) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('4. MÉTODOS DE PAGO', 14, y)
    y += 5

    autoTable(doc, {
      startY: y,
      head: [['Método de Pago', 'Pedidos', 'Total Recaudado']],
      body: sales.byPaymentMethod.map(p => [
        PAYMENT_LABELS[p.method] || p.method, String(p.orders), formatCurrency(p.total)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [245, 250, 240] },
      margin: { left: 14, right: 14 },
    })

    y = (doc as any).lastAutoTable?.finalY + 10 || y + 35
  }

  // Section 5: TOP PRODUCTOS
  if (sales?.topItems?.length) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('5. PRODUCTOS MÁS VENDIDOS', 14, y)
    y += 5

    autoTable(doc, {
      startY: y,
      head: [['#', 'Producto', 'Unidades Vendidas', 'Total Generado']],
      body: sales.topItems.slice(0, 15).map((item, i) => [
        String(i + 1), item.name, String(item.quantity), formatCurrency(item.total)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [144, 191, 80], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [245, 250, 240] },
      margin: { left: 14, right: 14 },
    })

    y = (doc as any).lastAutoTable?.finalY + 10 || y + 35
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text(`THE VILLA DOG — Generado el ${new Date().toLocaleString('es-CO')} — Página ${i} de ${totalPages}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
  }

  doc.save(`Reporte_The Villa Dog_${startDate}_${endDate}.pdf`)
}

/* ════════════════════════════════════════════════════════
   RADIAL PROGRESS COMPONENT
   ════════════════════════════════════════════════════════ */
function RadialKPI({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const data = [{ name: label, value: pct, fill: color }]
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width={90} height={90}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
          <RadialBar background dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>
      <span className="text-lg font-black mt-1" style={{ color }}>{pct}%</span>
      <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const [daily, setDaily] = useState<DailyReport | null>(null)
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null)
  const [sales, setSales] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<RangePreset>('today')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())

  const handleMonthYearChange = useCallback((month: string, year: string) => {
    setSelectedMonth(month)
    setSelectedYear(year)
    if (!month) {
      setStartDate(`${year}-01-01`)
      setEndDate(`${year}-12-31`)
    } else {
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      setStartDate(`${year}-${month}-01`)
      setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`)
    }
    setPreset('custom')
  }, [])

  const applyPreset = useCallback((p: RangePreset) => {
    setPreset(p)
    const currentYear = new Date().getFullYear().toString()
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0')
    switch (p) {
      case 'today':
        setStartDate(todayStr())
        setEndDate(todayStr())
        setSelectedMonth(currentMonth)
        setSelectedYear(currentYear)
        break
      case '7d':
        setStartDate(daysAgo(7))
        setEndDate(todayStr())
        setSelectedMonth('')
        setSelectedYear(currentYear)
        break
      case '30d':
        setStartDate(daysAgo(30))
        setEndDate(todayStr())
        setSelectedMonth('')
        setSelectedYear(currentYear)
        break
      case 'month':
        setStartDate(monthStart())
        setEndDate(todayStr())
        setSelectedMonth(currentMonth)
        setSelectedYear(currentYear)
        break
      case 'custom':
        break
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const promises = [
      api.get<DailyReport>(`/reports/daily?date=${startDate}`).catch(() => null),
      api.get<DashboardStats>(`/reports/dashboard?startDate=${startDate}&endDate=${endDate}`).catch(() => null),
      api.get<SalesReport>(`/reports/sales?startDate=${startDate}&endDate=${endDate}`).catch(() => null),
    ]
    Promise.all(promises).then(([d, dash, s]) => {
      setDaily(d as any)
      setDashboard(dash as any)
      setSales(s as any)
    }).finally(() => setLoading(false))
  }, [startDate, endDate])

  const handleExportExcel = async () => {
    setExporting('excel')
    try { await exportToExcel(daily, dashboard, sales, startDate, endDate) }
    catch (e) { console.error('Excel export error:', e) }
    finally { setExporting(null) }
  }

  const handleExportPDF = async () => {
    setExporting('pdf')
    try { await exportToPDF(daily, dashboard, sales, startDate, endDate) }
    catch (e) { console.error('PDF export error:', e) }
    finally { setExporting(null) }
  }

  // ── Derived Data ──
  const orderChartData = useMemo(() => {
    const d = dashboard?.today || daily
    if (!d) return []
    return [
      { name: 'Entregados', pedidos: ('delivered' in d ? d.delivered : d.ordersDelivered) || 0, fill: BAR_COLORS.delivered },
      { name: 'Pendientes', pedidos: ('pending' in d ? d.pending : d.ordersPending) || 0, fill: BAR_COLORS.pending },
      { name: 'Cancelados', pedidos: ('cancelled' in d ? d.cancelled : d.ordersCancelled) || 0, fill: BAR_COLORS.cancelled },
    ]
  }, [dashboard, daily])

  const paymentPieData = useMemo(() => {
    if (sales?.byPaymentMethod?.length) {
      return sales.byPaymentMethod.map(p => ({
        name: PAYMENT_LABELS[p.method] || p.method,
        value: p.total,
      }))
    }
    return (daily?.paymentBreakdown || []).map(p => ({
      name: PAYMENT_LABELS[p.method] || p.method,
      value: p.total,
    }))
  }, [sales, daily])

  const paymentTotal = useMemo(() => paymentPieData.reduce((s, p) => s + p.value, 0), [paymentPieData])

  const topItemsData = useMemo(() => {
    const items = sales?.topItems || dashboard?.topItems || []
    return items.slice(0, 8).map((item, i) => ({
      name: item.name.length > 20 ? item.name.substring(0, 18) + '…' : item.name,
      fullName: item.name,
      quantity: item.quantity,
      total: 'total' in item ? item.total : (item as any).price * item.quantity,
      rank: i + 1,
    }))
  }, [sales, dashboard])

  const trendData = useMemo(() => dashboard?.trend || [], [dashboard])

  const summary = sales?.summary
  const totalOrders = summary?.totalOrders ?? dashboard?.today?.orders ?? daily?.totalOrders ?? 0
  const totalDelivered = summary?.deliveredCount ?? dashboard?.today?.delivered ?? daily?.ordersDelivered ?? 0
  const totalPending = summary?.pendingCount ?? dashboard?.today?.pending ?? daily?.ordersPending ?? 0
  const totalCancelled = summary?.cancelledCount ?? dashboard?.today?.cancelled ?? daily?.ordersCancelled ?? 0
  const totalSales = summary?.totalSales ?? dashboard?.today?.sales ?? daily?.totalSales ?? 0
  const totalCash = dashboard?.today?.cash ?? daily?.totalCash ?? 0
  const totalTransfer = dashboard?.today?.transfer ?? daily?.totalTransfers ?? 0
  const totalTips = summary?.totalTips ?? dashboard?.today?.tips ?? daily?.totalTips ?? 0
  const totalExpenses = dashboard?.today?.expenses ?? daily?.totalExpenses ?? 0
  const netIncome = totalSales - totalExpenses
  const deliveryRate = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 0
  const avgTicket = summary?.avgOrderValue ?? (totalDelivered > 0 ? Math.round(totalSales / totalDelivered) : 0)

  const financeAreaData = [
    { name: 'Ventas', monto: totalSales },
    { name: 'Gastos', monto: totalExpenses },
    { name: 'Neto', monto: netIncome },
  ]

  // ── Loading State ──
  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-14 w-14 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse font-bold">Analizando métricas financieras...</p>
    </div>
  )

  return (
    <div className="space-y-7">
      {/* ── HEADER ── */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/15"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
            <BarChart3 className="h-6 w-6 text-[var(--accent-fg)]" />
          </div>
          <div>
            <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">REPORTES</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Analítica financiera y rendimiento del negocio.</p>
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={exporting === 'excel'}
            className="h-10 px-4 rounded-xl border-[var(--accent)]/40 hover:bg-[var(--accent-muted)]/20 text-[var(--accent)] text-[10px] uppercase font-extrabold tracking-wider gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === 'excel' ? 'Generando...' : 'Excel'}
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={exporting === 'pdf'}
            className="h-10 px-4 rounded-xl border-red-400/40 hover:bg-red-50/20 text-red-500 text-[10px] uppercase font-extrabold tracking-wider gap-2"
          >
            <FileText className="h-4 w-4" />
            {exporting === 'pdf' ? 'Generando...' : 'PDF'}
          </Button>
        </div>
      </div>

      {/* ── DATE RANGE SELECTOR ── */}
      <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {RANGE_PRESETS.map(rp => (
                <button
                  key={rp.key}
                  onClick={() => applyPreset(rp.key)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all duration-200 ${
                    preset === rp.key
                      ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg shadow-[var(--accent)]/25'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]/50'
                  }`}
                >
                  {rp.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Selector de Año */}
              <select
                value={selectedYear}
                onChange={e => handleMonthYearChange(selectedMonth, e.target.value)}
                className="h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)] cursor-pointer outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]"
              >
                <option value="2026">Año: 2026</option>
                <option value="2025">Año: 2025</option>
                <option value="2024">Año: 2024</option>
              </select>

              {/* Selector de Mes */}
              <select
                value={selectedMonth}
                onChange={e => handleMonthYearChange(e.target.value, selectedYear)}
                className="h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)] cursor-pointer outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]"
              >
                <option value="">Todo el año</option>
                <option value="01">Enero</option>
                <option value="02">Febrero</option>
                <option value="03">Marzo</option>
                <option value="04">Abril</option>
                <option value="05">Mayo</option>
                <option value="06">Junio</option>
                <option value="07">Julio</option>
                <option value="08">Agosto</option>
                <option value="09">Septiembre</option>
                <option value="10">Octubre</option>
                <option value="11">Noviembre</option>
                <option value="12">Diciembre</option>
              </select>

              {/* Día Específico */}
              <div className="flex items-center gap-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2.5 h-10 shadow-inner">
                <span className="text-[10px] font-extrabold text-[var(--accent)] uppercase tracking-wider whitespace-nowrap">Día Específico:</span>
                <input
                  type="date"
                  value={startDate === endDate ? startDate : ''}
                  onChange={e => {
                    const val = e.target.value
                    if (val) {
                      setStartDate(val)
                      setEndDate(val)
                      setPreset('custom')
                      setSelectedMonth('')
                      setSelectedYear('')
                    }
                  }}
                  className="h-8 bg-transparent text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2.5 h-10">
                <span className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Rango:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPreset('custom'); setSelectedMonth(''); setSelectedYear('') }}
                  className="h-8 bg-transparent text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer outline-none"
                />
                <span className="text-[10px] font-bold text-[var(--text-muted)]">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPreset('custom'); setSelectedMonth(''); setSelectedYear('') }}
                  className="h-8 bg-transparent text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer outline-none"
                />
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setLoading(true)
                  const promises = [
                    api.get<DailyReport>(`/reports/daily?date=${startDate}`).catch(() => null),
                    api.get<DashboardStats>(`/reports/dashboard?startDate=${startDate}&endDate=${endDate}`).catch(() => null),
                    api.get<SalesReport>(`/reports/sales?startDate=${startDate}&endDate=${endDate}`).catch(() => null),
                  ]
                  Promise.all(promises).then(([d, dash, s]) => {
                    setDaily(d as any)
                    setDashboard(dash as any)
                    setSales(s as any)
                  }).finally(() => setLoading(false))
                }}
                className="h-10 px-3.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] text-[10px] font-extrabold uppercase tracking-wider gap-1.5 shadow-md cursor-pointer"
                title="Consultar métricas del período"
              >
                <Filter className="h-3.5 w-3.5" />
                Buscar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI CARDS ── */}
      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {[
          { icon: ShoppingBag, label: 'Pedidos', value: String(totalOrders), color: '#90BF50', sub: null },
          { icon: TrendingUp, label: 'Entregados', value: String(totalDelivered), color: '#7EA743', sub: `${deliveryRate}% efectividad` },
          { icon: Clock, label: 'Pendientes', value: String(totalPending), color: '#F59E0B', sub: null },
          { icon: XCircle, label: 'Cancelados', value: String(totalCancelled), color: '#EF4444', sub: null },
          { icon: DollarSign, label: 'Ventas', value: formatCurrency(totalSales), color: '#6B8E3B', sub: null },
          { icon: CreditCard, label: 'Ticket Prom.', value: formatCurrency(avgTicket), color: '#587532', sub: null },
          { icon: Wallet, label: 'Gastos', value: formatCurrency(totalExpenses), color: '#A4ACA0', sub: null },
          { icon: TrendingUp, label: 'Neto', value: formatCurrency(netIncome), color: netIncome >= 0 ? '#90BF50' : '#EF4444', sub: null },
        ].map(({ icon: Icon, label, value, color, sub }) => (
          <motion.div key={label} variants={itemVariants}>
            <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] relative overflow-hidden rounded-2xl h-full" style={{ boxShadow: `0 4px 24px -8px ${color}15` }}>
              <div className="absolute -right-6 -top-6 w-20 h-20 rounded-full blur-2xl opacity-30" style={{ backgroundColor: color }} />
              <CardContent className="p-4 flex flex-col justify-between min-h-[100px] relative z-10">
                <div className="p-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/50 w-fit" style={{ color }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="space-y-0.5 mt-2">
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
                  <p className="text-sm font-black tracking-tight truncate" style={{ color }}>{value}</p>
                  {sub && <p className="text-[8px] text-[var(--text-muted)] font-bold">{sub}</p>}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* ── CHARTS ROW 1: Trend + Payment Pie ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Tendencia de Ventas (wider) */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg lg:col-span-3">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[var(--accent)]" /> Tendencia de Ventas
                </CardTitle>
                <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Evolución de ingresos, gastos y utilidad neta.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {trendData.length > 1 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#90BF50" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#90BF50" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EF4444" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6B8E3B" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6B8E3B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 'bold' }} />
                  <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="sales" name="Ventas" stroke="#90BF50" fill="url(#gradSales)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="expenses" name="Gastos" stroke="#EF4444" fill="url(#gradExp)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="net" name="Neto" stroke="#6B8E3B" fill="url(#gradNet)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={financeAreaData}>
                  <defs>
                    <linearGradient id="areaGradSingle" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 'bold' }} />
                  <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="monto" name="Monto" stroke="var(--accent)" fill="url(#areaGradSingle)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payment Donut */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg lg:col-span-2">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[var(--accent)]" /> Métodos de Pago
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Distribución por método de cobro.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {paymentPieData.length > 0 ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={paymentPieData}
                      cx="50%"
                      cy="45%"
                      innerRadius={65}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={2}
                      stroke="var(--bg-panel)"
                    >
                      {paymentPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v ?? 0))}
                      contentStyle={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: '16px', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 'bold', backdropFilter: 'blur(8px)' }}
                    />
                    <Legend verticalAlign="bottom" height={40} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total */}
                <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                  <p className="text-[8px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Total</p>
                  <p className="text-lg font-black text-[var(--accent)] tracking-tight">{formatCurrency(paymentTotal)}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-[280px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
                <DollarSign className="h-10 w-10 text-[var(--text-muted)] mb-3 animate-pulse" />
                Sin recaudos en este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 2: Orders Bar + Top Products ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Estado de Pedidos */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-[var(--accent)]" /> Estado de Pedidos
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Distribución de estados del período.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6 mb-6">
              <RadialKPI value={totalDelivered} max={totalOrders} label="Entregados" color={BAR_COLORS.delivered} />
              <RadialKPI value={totalPending} max={totalOrders} label="Pendientes" color={BAR_COLORS.pending} />
              <RadialKPI value={totalCancelled} max={totalOrders} label="Cancelados" color={BAR_COLORS.cancelled} />
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={orderChartData} barSize={50}>
                <defs>
                  {orderChartData.map((d, i) => (
                    <linearGradient key={d.name} id={`barGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={d.fill} stopOpacity={1} />
                      <stop offset="100%" stopColor={d.fill} stopOpacity={0.3} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 'bold' }} />
                <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-hover)', opacity: 0.3 }} />
                <Bar dataKey="pedidos" name="Pedidos" radius={[8, 8, 0, 0]}>
                  {orderChartData.map((_, i) => (
                    <Cell key={i} fill={`url(#barGrad${i})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Productos */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <Award className="h-4 w-4 text-[var(--accent)]" /> Top Productos
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Los productos más vendidos del período.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {topItemsData.length > 0 ? (
              <div className="space-y-3">
                {topItemsData.map((item, i) => {
                  const maxQty = topItemsData[0]?.quantity || 1
                  const pct = Math.round((item.quantity / maxQty) * 100)
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''
                  return (
                    <motion.div
                      key={item.name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, type: 'spring', stiffness: 200 }}
                      className="group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] truncate">
                          <span className="text-base">{medal || `#${item.rank}`}</span>
                          <span className="truncate" title={item.fullName}>{item.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] shrink-0">
                          <span className="font-extrabold text-[var(--accent)]">{item.quantity} uds</span>
                          <span className="font-bold text-[var(--text-secondary)]">{formatCurrency('total' in item ? item.total : 0)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden border border-[var(--border-subtle)]/30">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, ${PIE_COLORS[i % PIE_COLORS.length]}, ${PIE_COLORS[(i + 1) % PIE_COLORS.length]})` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: i * 0.08, ease: 'easeOut' }}
                        />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-[280px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
                <Package className="h-10 w-10 text-[var(--text-muted)] mb-3 animate-pulse" />
                Sin productos vendidos en este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 3: Finance Breakdown + Waiters/Sellers ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Desglose Financiero */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[var(--accent)]" /> Desglose Financiero
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Detalle contable del período seleccionado.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {[
              { label: 'Recaudado Efectivo', value: totalCash, icon: Wallet, color: '#90BF50', pct: totalSales > 0 ? (totalCash / totalSales) * 100 : 0 },
              { label: 'Transferencias', value: totalTransfer, icon: CreditCard, color: '#7EA743', pct: totalSales > 0 ? (totalTransfer / totalSales) * 100 : 0 },
              { label: 'Propinas Recibidas', value: totalTips, icon: Award, color: '#6B8E3B', pct: totalSales > 0 ? (totalTips / totalSales) * 100 : 0 },
              { label: 'Gastos / Egresos', value: totalExpenses, icon: ArrowDownRight, color: '#EF4444', pct: totalSales > 0 ? (totalExpenses / totalSales) * 100 : 0, negative: true },
            ].map(row => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[var(--text-secondary)] font-bold flex items-center gap-2">
                    <row.icon className="h-3.5 w-3.5" style={{ color: row.color }} />
                    {row.label}
                  </span>
                  <span className="font-extrabold" style={{ color: row.color }}>
                    {row.negative ? `-${formatCurrency(row.value)}` : formatCurrency(row.value)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: row.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, row.pct)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </div>
            ))}

            <div className="flex justify-between items-center pt-4 text-sm border-t border-[var(--border-subtle)]/50 mt-4">
              <span className="font-extrabold text-[var(--text-primary)] uppercase tracking-wide">Neto Consolidado</span>
              <span className={`text-2xl font-black tracking-tight ${netIncome >= 0 ? 'text-[var(--accent)]' : 'text-red-500'}`}>
                {formatCurrency(netIncome)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Rendimiento por Asesor */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--accent)]" /> Rendimiento por Asesor
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Ventas y pedidos por cada asesor.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {(sales?.byWaiter?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {sales!.byWaiter.slice(0, 6).map((w, i) => {
                  const maxSales = sales!.byWaiter[0]?.sales || 1
                  const pct = Math.round((w.sales / maxSales) * 100)
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''
                  return (
                    <motion.div
                      key={w.name}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 180 }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                          <span className="text-base">{medal || `#${i + 1}`}</span>
                          <span>{w.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] shrink-0">
                          <span className="font-bold text-[var(--text-secondary)]">{w.orders} pedidos</span>
                          <span className="font-extrabold text-[var(--accent)]">{formatCurrency(w.sales)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden border border-[var(--border-subtle)]/30">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, ${PIE_COLORS[i % PIE_COLORS.length]}, ${PIE_COLORS[(i + 2) % PIE_COLORS.length]})` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, delay: i * 0.08, ease: 'easeOut' }}
                        />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-[260px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
                <Users className="h-10 w-10 text-[var(--text-muted)] mb-3 animate-pulse" />
                Sin datos de asesores en este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 4: Cajeros + Domiciliarios ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Rendimiento por Cajero */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[var(--accent)]" /> Rendimiento por Cajero
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Pedidos cobrados y total recaudado por cada cajero.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {(dashboard?.topCashiers?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {dashboard!.topCashiers!.slice(0, 6).map((c, i) => {
                  const maxSales = dashboard!.topCashiers![0]?.sales || 1
                  const pct = Math.round((c.sales / maxSales) * 100)
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''
                  return (
                    <motion.div
                      key={c.waiterId}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 180 }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                          <span className="text-base">{medal || `#${i + 1}`}</span>
                          <span>{c.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] shrink-0">
                          <span className="font-bold text-[var(--text-secondary)]">{c.orders} cobros</span>
                          <span className="font-extrabold text-[var(--accent)]">{formatCurrency(c.sales)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden border border-[var(--border-subtle)]/30">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, #587532, #90BF50)` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, delay: i * 0.08, ease: 'easeOut' }}
                        />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
                <Landmark className="h-10 w-10 text-[var(--text-muted)] mb-3 animate-pulse" />
                Sin datos de cajeros en este período.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rendimiento por Domiciliario */}
        <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              <Bike className="h-4 w-4 text-[var(--accent)]" /> Rendimiento por Domiciliario
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Entregas realizadas y total transportado.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {(dashboard?.topDrivers?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {dashboard!.topDrivers!.slice(0, 6).map((d, i) => {
                  const maxOrders = dashboard!.topDrivers![0]?.orders || 1
                  const pct = Math.round((d.orders / maxOrders) * 100)
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''
                  return (
                    <motion.div
                      key={d.waiterId}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 180 }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                          <span className="text-base">{medal || `#${i + 1}`}</span>
                          <span>{d.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] shrink-0">
                          <span className="font-bold text-[var(--text-secondary)]">{d.orders} entregas</span>
                          <span className="font-extrabold text-[var(--accent)]">{formatCurrency(d.sales)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden border border-[var(--border-subtle)]/30">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, #6B8E3B, #A4C96C)` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, delay: i * 0.08, ease: 'easeOut' }}
                        />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
                <Bike className="h-10 w-10 text-[var(--text-muted)] mb-3 animate-pulse" />
                Sin datos de domiciliarios en este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 5: Recaudo de Cartera / Abonos ── */}
      <Card className="niche-card-premium border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden shadow-lg">
        <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
          <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[var(--accent)]" /> Recaudo de Cartera / Abonos de Clientes
          </CardTitle>
          <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">
            Abonos en efectivo y transferencia recibidos durante este período.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {(sales?.abonosCartera?.items?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs font-bold text-[var(--text-primary)]">
                <div>Total Abonos Recaudados: <span className="text-emerald-500 font-extrabold text-sm">{formatCurrency(sales?.abonosCartera?.total || 0)}</span></div>
                <div>En Efectivo: <span className="text-emerald-600">{formatCurrency(sales?.abonosCartera?.totalCash || 0)}</span></div>
                <div>En Transferencia: <span className="text-blue-500">{formatCurrency(sales?.abonosCartera?.totalTransfer || 0)}</span></div>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] uppercase text-[9px] font-extrabold border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="p-3">Cliente</th>
                      <th className="p-3">Monto</th>
                      <th className="p-3">Método</th>
                      <th className="p-3">Observaciones / Motivo</th>
                      <th className="p-3">Referencia</th>
                      <th className="p-3">Fecha y Hora</th>
                      <th className="p-3">Recibió</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/40">
                    {sales!.abonosCartera!.items.map((ab: any) => (
                      <tr key={ab.id} className="hover:bg-[var(--bg-elevated)]/40">
                        <td className="p-3 font-bold text-[var(--text-primary)]">{ab.customerName} <span className="text-[10px] text-[var(--text-muted)] font-normal">({ab.customerPhone})</span></td>
                        <td className="p-3 font-black text-emerald-500">+{formatCurrency(ab.amount)}</td>
                        <td className="p-3">
                          <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-extrabold">
                            {ab.method}
                          </Badge>
                        </td>
                        <td className="p-3 text-[var(--text-secondary)] italic">{ab.notes || 'Abono a cartera'}</td>
                        <td className="p-3 text-[var(--text-muted)] font-semibold">{ab.reference || '—'}</td>
                        <td className="p-3 text-[var(--text-muted)]">{new Date(ab.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="p-3 font-semibold text-[var(--text-secondary)]">{ab.confirmedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex h-[120px] flex-col items-center justify-center text-xs text-[var(--text-secondary)] font-bold">
              <Wallet className="h-8 w-8 text-[var(--text-muted)] mb-2 animate-pulse" />
              No hay abonos de cartera registrados en este período.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── FOOTER NOTE ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center py-4"
      >
        <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
          📊 Descarga tus reportes en Excel o PDF para compartirlos con tu equipo.
        </p>
      </motion.div>
    </div>
  )
}

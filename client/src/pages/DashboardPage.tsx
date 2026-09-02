import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { io } from 'socket.io-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { brand } from '@/lib/brand'
import { api } from '@/lib/api'
import { formatCurrency, cn, getLocalDateString } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { VillaDogAiAnalyticsCard } from '@/components/analytics/VillaDogAiAnalyticsCard'
import { ShoppingBag, DollarSign, Users, Bike, Clock3, ReceiptText, TrendingUp, Zap, Wallet, Headphones, ArrowUpRight, Award, Percent, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'

interface DashboardStats {
  range: { start: string; end: string }
  today: {
    orders: number
    delivered: number
    pending: number
    cancelled: number
    sales: number
    tips: number
    cash: number
    transfer: number
    creditSales?: number
    expenses: number
    cogs?: number
    marginPercent?: number
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

const quickActionsByRole: Record<string, { label: string; href: string; icon: typeof ShoppingBag }[]> = {
  SUPERADMIN: [
    { label: 'Nuevo pedido', href: '/orders/new', icon: ShoppingBag },
    { label: 'Domicilios activos', href: '/orders', icon: Bike },
    { label: 'Reportes', href: '/reports', icon: TrendingUp },
    { label: 'Caja', href: '/payments', icon: Wallet },
  ],
  ADMIN: [
    { label: 'Nuevo pedido', href: '/orders/new', icon: ShoppingBag },
    { label: 'Domicilios', href: '/orders', icon: Bike },
    { label: 'Reportes', href: '/reports', icon: TrendingUp },
    { label: 'Usuarios', href: '/users', icon: Users },
  ],
  CASHIER: [
    { label: 'Caja y Cobros', href: '/payments', icon: Wallet },
  ],
  DELIVERY_MANAGER: [
    { label: 'Nuevo pedido', href: '/orders/new', icon: ShoppingBag },
    { label: 'Domicilios activos', href: '/orders', icon: Headphones },
    { label: 'En ruta', href: '/orders?status=IN_ROUTE', icon: Bike },
  ],
}

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const scaleIn = { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const duration = 1000
    const steps = 30
    const increment = value / steps
    let current = 0
    const interval = setInterval(() => {
      current += increment
      if (current >= value) { setDisplay(value); clearInterval(interval) }
      else { setDisplay(Math.floor(current)) }
    }, duration / steps)
    return () => clearInterval(interval)
  }, [value])
  return <span>{suffix}{display}</span>
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [time, setTime] = useState(new Date())
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7days' | 'month' | 'custom'>('today')
  const [customStart, setCustomStart] = useState(() => getLocalDateString())
  const [customEnd, setCustomEnd] = useState(() => getLocalDateString())

  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())

  const handleMonthYearChange = (month: string, year: string) => {
    setSelectedMonth(month)
    setSelectedYear(year)
    if (!month) {
      setCustomStart(`${year}-01-01`)
      setCustomEnd(`${year}-12-31`)
    } else {
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      setCustomStart(`${year}-${month}-01`)
      setCustomEnd(`${year}-${month}-${String(lastDay).padStart(2, '0')}`)
    }
    setDateRange('custom')
  }

  const handleSelectRange = (rangeId: 'today' | 'yesterday' | '7days' | 'month' | 'custom') => {
    setDateRange(rangeId)
    const currentYear = new Date().getFullYear().toString()
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0')
    if (rangeId === 'today' || rangeId === 'month') {
      setSelectedMonth(currentMonth)
      setSelectedYear(currentYear)
    } else if (rangeId === 'yesterday') {
      const yes = new Date()
      yes.setDate(yes.getDate() - 1)
      setSelectedMonth(String(yes.getMonth() + 1).padStart(2, '0'))
      setSelectedYear(yes.getFullYear().toString())
    } else if (rangeId === '7days') {
      setSelectedMonth('')
      setSelectedYear(currentYear)
    }
  }

  const getDates = () => {
    const today = new Date()
    const formatDate = (d: Date) => getLocalDateString(d)

    switch (dateRange) {
      case 'today':
        return { start: formatDate(today), end: formatDate(today) }
      case 'yesterday': {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return { start: formatDate(yesterday), end: formatDate(yesterday) }
      }
      case '7days': {
        const last7 = new Date()
        last7.setDate(last7.getDate() - 6)
        return { start: formatDate(last7), end: formatDate(today) }
      }
      case 'month': {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
        return { start: formatDate(firstDay), end: formatDate(today) }
      }
      case 'custom':
        return { start: customStart, end: customEnd }
    }
  }

  const { start, end } = getDates()

  useEffect(() => {
    if (dateRange === 'custom' && (!customStart || !customEnd)) return

    setLoading(true)
    api.get<DashboardStats>(`/reports/dashboard?startDate=${start}&endDate=${end}`)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [dateRange, customStart, customEnd])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
      query: { userId: user?.id, userName: user?.name },
    })

    const handleUpdate = () => {
      if (dateRange === 'custom' && (!customStart || !customEnd)) return
      api.get<DashboardStats>(`/reports/dashboard?startDate=${start}&endDate=${end}`)
        .then(setStats)
        .catch(console.error)
    }

    socket.on('newOrder', handleUpdate)
    socket.on('orderStatusChanged', handleUpdate)
    socket.on('orderUpdated', handleUpdate)

    return () => {
      socket.disconnect()
    }
  }, [user, dateRange, customStart, customEnd, start, end])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando panel de control...</p>
    </div>
  )
  if (!stats) return <div className="p-8 text-center text-[var(--text-secondary)]">Error cargando datos</div>

  const deliveryRate = stats.today.orders > 0 ? Math.round((stats.today.delivered / stats.today.orders) * 100) : 0
  const netPeriod = stats.today.sales - stats.today.expenses
  const pieData = [
    { name: 'Entregados', value: stats.today.delivered, color: 'var(--success)' },
    { name: 'Pendientes', value: stats.today.pending, color: 'var(--warning)' },
    { name: 'Cancelados', value: stats.today.cancelled, color: 'var(--destructive)' },
  ].filter(d => d.value > 0)

  const timeStr = time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  const dateStr = time.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const quickActions = quickActionsByRole[user?.role || 'CASHIER'] || quickActionsByRole.CASHIER
  const roleSubtitle: Record<string, string> = {
    CASHIER: 'Toma pedidos, factura y controla la caja del turno.',
    DELIVERY_MANAGER: 'Coordina entregas, estados y domiciliarios en tiempo real.',
    ADMIN: 'Visión completa del negocio y configuración.',
    SUPERADMIN: 'Control total del sistema THE VILLA DOG.',
  }

  return (
    <motion.div className="space-y-7" initial="hidden" animate="visible" variants={stagger}>
      <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-[var(--accent)]/20 bg-gradient-to-br from-[var(--bg-panel)] via-[var(--bg-subtle)] to-[var(--bg-panel)] p-8 shadow-2xl shadow-[var(--accent)]/5">
        <motion.div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-[var(--accent)] opacity-[0.03] blur-[80px]" animate={{ scale: [1, 1.1, 1], opacity: [0.02, 0.04, 0.02] }} transition={{ duration: 6, repeat: Infinity }} />
        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <div className="relative z-10">
            <div className="mb-4 flex items-center gap-3 text-[var(--text-secondary)] text-xs">
              <span className="flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-3 py-1 text-[var(--accent)] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                {timeStr}
              </span>
              <span className="capitalize font-bold">{dateStr}</span>
            </div>
            <h2 className="antifont text-5xl leading-[0.95] text-[var(--text-primary)] md:text-7xl">CENTRO DE<br /><span className="text-[var(--accent)]">CONTROL</span></h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
              Hola <strong className="text-[var(--text-primary)]">{user?.name}</strong> — {roleSubtitle[user?.role || ''] || 'Operación diaria de'} <strong className="text-[var(--text-primary)]">{brand.name}</strong>.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {quickActions.map(action => {
                const Icon = action.icon
                return (
                  <Link key={action.href} to={action.href}>
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Button className="bg-[var(--accent)] text-[var(--accent-fg)] font-bold hover:bg-[var(--accent-hover)] shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 gap-2">
                        <Icon className="h-4 w-4" />{action.label}
                      </Button>
                    </motion.div>
                  </Link>
                )
              })}
            </div>
          </div>
          <motion.div variants={scaleIn} className="relative z-10 flex items-center justify-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/50 p-6 backdrop-blur-sm shadow-inner">
            <BrandLogo imageClassName="w-56" />
          </motion.div>
        </div>
      </motion.section>

      {/* Date Range Selector Bar */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Período de Análisis:</span>
          <div className="flex flex-wrap gap-1">
            {[
              { id: 'today', label: 'Hoy' },
              { id: 'yesterday', label: 'Ayer' },
              { id: '7days', label: 'Últimos 7 días' },
              { id: 'month', label: 'Este mes' },
              { id: 'custom', label: 'Personalizado' },
            ].map(opt => (
              <Button
                key={opt.id}
                variant={dateRange === opt.id ? 'default' : 'ghost'}
                className={cn(
                  "h-8 px-3 rounded-lg text-xs font-bold transition-all",
                  dateRange === opt.id 
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]" 
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
                onClick={() => handleSelectRange(opt.id as any)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Selector de Año */}
          <select
            value={selectedYear}
            onChange={e => handleMonthYearChange(selectedMonth, e.target.value)}
            className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="2026">Año: 2026</option>
            <option value="2025">Año: 2025</option>
            <option value="2024">Año: 2024</option>
          </select>

          {/* Selector de Mes */}
          <select
            value={selectedMonth}
            onChange={e => handleMonthYearChange(e.target.value, selectedYear)}
            className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
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

          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <span className="text-[10px] text-[var(--text-muted)] font-bold ml-1">o Fechas:</span>
              <input
                type="date"
                value={customStart}
                onChange={e => { setCustomStart(e.target.value); setDateRange('custom'); setSelectedMonth(''); setSelectedYear('') }}
                className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
              />
              <span className="text-xs text-[var(--text-muted)] font-bold">al</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => { setCustomEnd(e.target.value); setDateRange('custom'); setSelectedMonth(''); setSelectedYear('') }}
                className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* KPI Cards Grid */}
      <motion.div 
        className={cn(
          "grid grid-cols-2 gap-4",
          ['ADMIN', 'SUPERADMIN'].includes(user?.role || '') ? "lg:grid-cols-5" : "lg:grid-cols-4"
        )} 
        variants={stagger}
      >
        {(user?.role === 'DELIVERY_MANAGER'
          ? [
              { icon: Bike, label: 'Domicilios Activos', value: stats.activeOrders, suffix: '', subtitle: 'Pendientes y en ruta', color: '#8B5CF6' },
              { icon: Clock3, label: 'Pendientes Período', value: stats.today.pending, suffix: '', subtitle: 'Por despachar', color: '#F59E0B' },
              { icon: ShoppingBag, label: 'Entregados Período', value: stats.today.delivered, suffix: '', subtitle: 'Completados', color: '#10B981' },
              { icon: Users, label: 'Pedidos Período', value: stats.today.orders, suffix: '', subtitle: 'Total consultado', color: '#3B82F6' },
            ]
          : [
              { icon: ShoppingBag, label: 'Pedidos', value: stats.today.orders, suffix: '', subtitle: `${stats.today.delivered} entregados · ${stats.today.pending} activos`, color: '#10B981' },
              { icon: DollarSign, label: 'Ventas', value: stats.today.sales, suffix: '$', subtitle: `Efe: ${formatCurrency(stats.today.cash)} · Trans: ${formatCurrency(stats.today.transfer)} · Créd: ${formatCurrency(stats.today.creditSales ?? 0)}`, color: '#3B82F6' },
              ...( ['ADMIN', 'SUPERADMIN'].includes(user?.role || '') ? [
                { icon: Percent, label: 'Margen Neto', value: stats.today.marginPercent ?? 0, suffix: '%', subtitle: `COGS: ${formatCurrency(stats.today.cogs ?? 0)} · Utilidad: ${formatCurrency(stats.today.sales - (stats.today.cogs ?? 0))}`, color: '#0ea5e9' }
              ] : [] ),
              { icon: Bike, label: 'Domicilios Activos', value: stats.activeOrders, suffix: '', subtitle: 'En preparación o en ruta', color: '#8B5CF6' },
              { icon: Users, label: 'Clientes Totales', value: stats.totalCustomers, suffix: '', subtitle: `${stats.totalOrders} pedidos totales`, color: '#EC4899' },
            ]
        ).map((stat) => {
          const Icon = stat.icon
          return (
            <motion.div 
              key={stat.label} 
              variants={fadeUp}
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
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest truncate">{stat.label}</p>
                  {stat.label === 'Ventas' ? (
                    <p className="text-xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{formatCurrency(stats.today.sales)}</p>
                  ) : (
                    <p className="text-xl font-black text-[var(--text-primary)] tracking-tight mt-0.5"><AnimatedNumber value={stat.value} suffix={stat.suffix} /></p>
                  )}
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5 font-medium truncate">{stat.subtitle}</p>
                </div>
              </div>
            </motion.div>
          )
        })}
      </motion.div>

      {/* THE VILLA DOG AI ANALYTICS & COPILOT CARD */}
      <motion.div variants={fadeUp}>
        <VillaDogAiAnalyticsCard />
      </motion.div>

      <motion.div className="grid grid-cols-1 gap-6 lg:grid-cols-2" variants={fadeUp}>
        <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-lg">
              <Zap className="h-5 w-5 text-[#F59E0B]" />
              Semáforo Operativo
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Lectura rápida para tomar decisiones en turno</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
             <div className="rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)] flex items-center gap-2 font-bold"><TrendingUp className="h-4 w-4 text-[var(--accent)]" /> Entregas completadas</span>
                <span className="text-lg font-bold text-[var(--accent)]">{deliveryRate}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)]/30">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]" initial={{ width: 0 }} animate={{ width: `${deliveryRate}%` }} transition={{ delay: 0.3, duration: 1.2, ease: 'easeOut' }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(user?.role === 'DELIVERY_MANAGER'
                ? [
                    { icon: Clock3, label: 'Pendientes', value: stats.today.pending, color: 'var(--warning)' },
                    { icon: XCircle, label: 'Cancelados', value: stats.today.cancelled, color: 'var(--destructive)' },
                  ]
                : [
                    { icon: Clock3, label: 'Pendientes', value: stats.today.pending, color: 'var(--warning)' },
                    { icon: DollarSign, label: 'Neto estimado', value: `${formatCurrency(netPeriod)}`, color: 'var(--accent)' },
                  ]
              ).map(item => {
                const Icon = item.icon
                return (
                  <motion.div key={item.label} className="rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-4 flex flex-col justify-between" whileHover={{ scale: 1.02 }}>
                    <Icon className="mb-2 h-5 w-5" style={{ color: item.color }} />
                    <div>
                      <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{item.label}</p>
                      <p className="text-lg font-black text-[var(--text-primary)] mt-0.5">{item.value}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            <div className="space-y-2">
              {[
                { label: 'Recibidos', value: stats.today.orders, color: 'var(--accent)' },
                { label: 'Activos', value: stats.today.pending, color: 'var(--warning)' },
                { label: 'Entregados', value: stats.today.delivered, color: 'var(--success)' },
                { label: 'Cancelados', value: stats.today.cancelled, color: 'var(--destructive)' },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  className="flex items-center justify-between rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] px-4 py-2.5"
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.08 }}
                >
                  <span className="flex items-center gap-2.5 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}40` }} />
                    {item.label}
                  </span>
                  <motion.span className="text-sm font-extrabold text-[var(--text-primary)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 + i * 0.08 }}>{item.value}</motion.span>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
            <CardTitle className="text-[var(--text-primary)] text-lg">Estado de Pedidos</CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Proporción de estados del total de comandas en el período</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={6} dataKey="value"
                    label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#555', strokeWidth: 1 }}
                  >
                     {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: '16px', boxShadow: '0 8px 30px var(--shadow-color)' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                <ShoppingBag className="mb-4 h-12 w-12 text-[#333] opacity-35" />
                <p className="text-sm font-semibold">Sin pedidos registrados en este período</p>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Trend & Low Stock Grid */}
      {['ADMIN', 'SUPERADMIN'].includes(user?.role || '') && (
        <motion.div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mt-6" variants={fadeUp}>
          {/* Trend Chart (Ventas vs Gastos) */}
          <Card className="lg:col-span-2 border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-lg">
                <TrendingUp className="h-5 w-5 text-[var(--accent)]" />
                Tendencia de Ventas vs Gastos
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Comparativo temporal de ingresos y egresos del período</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {stats.trend && stats.trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={stats.trend}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="expensesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 'bold' }} />
                    <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 'bold' }} formatter={(v) => formatCurrency(Number(v))} />
                    <Area type="monotone" name="Ventas" dataKey="sales" stroke="var(--accent)" fill="url(#salesGrad)" strokeWidth={2} />
                    <Area type="monotone" name="Gastos" dataKey="expenses" stroke="#EF4444" fill="url(#expensesGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] text-xs">
                  <TrendingUp className="h-8 w-8 mb-2 opacity-30" />
                  Sin datos de tendencia para este período.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Low Stock Alerts */}
          <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-md font-extrabold uppercase tracking-wide">
                <AlertTriangle className="h-4.5 w-4.5 text-[#F59E0B]" />
                Alertas de Stock Bajo
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Insumos críticos por debajo del stock mínimo configurado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5 pt-4 max-h-[280px] overflow-y-auto">
              {stats.lowStock && stats.lowStock.length > 0 ? (
                stats.lowStock.map(ing => {
                  const pct = ing.minStock > 0 ? Math.min((ing.stock / ing.minStock) * 100, 100) : 0;
                  const isZero = ing.stock <= 0;
                  return (
                    <div key={ing.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[var(--text-primary)] truncate max-w-[130px]">{ing.name}</span>
                        <span className={cn(
                          "font-bold shrink-0",
                          isZero ? "text-red-500 font-extrabold" : "text-amber-500"
                        )}>
                          {ing.stock} / {ing.minStock} {ing.unit.slice(0, 4)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                        <motion.div 
                          className={cn(
                            "h-full rounded-full",
                            isZero 
                              ? "bg-red-600 animate-pulse" 
                              : "bg-gradient-to-r from-amber-500 to-yellow-400"
                          )} 
                          initial={{ width: 0 }} 
                          animate={{ width: `${pct}%` }} 
                          transition={{ duration: 0.8, ease: 'easeOut' }} 
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] text-xs">
                  <CheckCircle className="h-8 w-8 mb-2 text-emerald-500 opacity-60" />
                  Todo el inventario está óptimo.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {['ADMIN', 'SUPERADMIN'].includes(user?.role || '') && (
        <motion.div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 mt-6" variants={fadeUp}>
          {/* Resumen de Caja */}
          <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-md font-extrabold uppercase tracking-wide">
                <Wallet className="h-4.5 w-4.5 text-[var(--accent)]" />
                Resumen de Caja
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Flujo de efectivo, transferencias y egresos del período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5 pt-4">
              <div className="rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Efectivo Recaudado</p>
                  <p className="text-lg font-black text-emerald-500 tracking-tight mt-0.5">{formatCurrency(stats.today.cash)}</p>
                </div>
                <div className="h-8.5 w-8.5 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Transferencias / Bancos</p>
                  <p className="text-lg font-black text-blue-500 tracking-tight mt-0.5">{formatCurrency(stats.today.transfer)}</p>
                </div>
                <div className="h-8.5 w-8.5 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Gastos / Egresos</p>
                  <p className="text-lg font-black text-rose-500 tracking-tight mt-0.5">{formatCurrency(stats.today.expenses)}</p>
                </div>
                <div className="h-8.5 w-8.5 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                  <ReceiptText className="h-4 w-4" />
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Ventas a Crédito (Fiado)</p>
                  <p className="text-lg font-black text-amber-500 tracking-tight mt-0.5">{formatCurrency(stats.today.creditSales ?? 0)}</p>
                </div>
                <div className="h-8.5 w-8.5 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                  <Clock3 className="h-4 w-4" />
                </div>
              </div>

              <div className="rounded-xl bg-[var(--accent-muted)] border border-[var(--accent-border)] p-3.5 flex items-center justify-between mt-4">
                <div>
                  <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider">Neto en Caja (Estimado)</p>
                  <p className="text-xl font-black text-[var(--text-primary)] tracking-tight mt-0.5">{formatCurrency(netPeriod)}</p>
                </div>
                <div className="h-8.5 w-8.5 rounded-xl bg-[var(--accent)] flex items-center justify-center text-[var(--accent-fg)] shadow-md">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Productos Más Vendidos */}
          <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-md font-extrabold uppercase tracking-wide">
                <TrendingUp className="h-4.5 w-4.5 text-[var(--accent)]" />
                Productos Más Vendidos
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Platos y bebidas más populares del período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {stats.topItems && stats.topItems.length > 0 ? (
                (() => {
                  const maxQty = Math.max(...stats.topItems.map(i => i.quantity));
                  return stats.topItems.map((item, idx) => {
                    const pct = maxQty > 0 ? (item.quantity / maxQty) * 100 : 0;
                    return (
                      <div key={item.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-primary)] truncate max-w-[150px]">{idx + 1}. {item.name}</span>
                          <span className="font-semibold text-[var(--text-secondary)] shrink-0">{item.quantity} unds. · {formatCurrency(item.quantity * item.price)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                          <motion.div 
                            className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]" 
                            initial={{ width: 0 }} 
                            animate={{ width: `${pct}%` }} 
                            transition={{ duration: 0.8, ease: 'easeOut' }} 
                          />
                        </div>
                      </div>
                    );
                  });
                })()
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] text-xs">
                  <ShoppingBag className="h-8 w-8 mb-2 opacity-30" />
                  Sin productos vendidos en este período.
                </div>
              )}
            </CardContent>
          </Card>


          {/* Ranking Toma de Domicilios / Call Center */}
          <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-md font-extrabold uppercase tracking-wide">
                <Headphones className="h-4.5 w-4.5 text-[var(--accent)]" />
                Ranking Toma Domicilios
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Pedidos ingresados por Call Center / Operador.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-4">
              {stats.topWaiters && stats.topWaiters.length > 0 ? (
                stats.topWaiters.map((seller, idx) => {
                  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-700'];
                  const MedalIcon = idx < 3 ? Award : null;
                  return (
                    <div key={seller.waiterId} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-2.5 hover:border-[var(--accent-border)] transition-colors">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-black text-[var(--text-secondary)]">
                          {MedalIcon ? (
                            <MedalIcon className={cn("h-3.5 w-3.5", medalColors[idx])} />
                          ) : (
                            `#${idx + 1}`
                          )}
                        </div>
                        {seller.photo ? (
                          <img src={seller.photo} alt={seller.name} className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-[var(--border-subtle)]" />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-muted)] text-[var(--accent)] font-extrabold text-[10px]">
                            {seller.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 pr-1">
                          <p className="truncate text-xs font-bold text-[var(--text-primary)] leading-tight">{seller.name}</p>
                          <p className="text-[10px] font-extrabold text-[var(--accent)] mt-0.5">{formatCurrency(seller.sales)}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-secondary)] whitespace-nowrap">
                          {seller.orders} pedidos
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] text-xs">
                  <Users className="h-8 w-8 mb-2 opacity-30" />
                  Sin pedidos registrados.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ranking Cajeros */}
          <Card className="border border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] shadow-xl rounded-2xl">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="flex items-center gap-2 text-[var(--text-primary)] text-md font-extrabold uppercase tracking-wide">
                <Wallet className="h-4.5 w-4.5 text-[var(--accent)]" />
                Ranking Cajeros
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Recaudación y cobros por cajero.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-4">
              {stats.topCashiers && stats.topCashiers.length > 0 ? (
                stats.topCashiers.map((cashier, idx) => {
                  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-700'];
                  const MedalIcon = idx < 3 ? Award : null;
                  return (
                    <div key={cashier.waiterId} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-2.5 hover:border-[var(--accent-border)] transition-colors">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-black text-[var(--text-secondary)]">
                          {MedalIcon ? (
                            <MedalIcon className={cn("h-3.5 w-3.5", medalColors[idx])} />
                          ) : (
                            `#${idx + 1}`
                          )}
                        </div>
                        {cashier.photo ? (
                          <img src={cashier.photo} alt={cashier.name} className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-[var(--border-subtle)]" />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-muted)] text-[var(--accent)] font-extrabold text-[10px]">
                            {cashier.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 pr-1">
                          <p className="truncate text-xs font-bold text-[var(--text-primary)] leading-tight">{cashier.name}</p>
                          <p className="text-[10px] font-extrabold text-[var(--accent)] mt-0.5">{formatCurrency(cashier.sales)}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-secondary)] whitespace-nowrap">
                          {cashier.orders} cobros
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] text-xs">
                  <Wallet className="h-8 w-8 mb-2 opacity-30" />
                  Sin cobros en este período.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}

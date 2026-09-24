import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Bike, ChefHat, CircleAlert, Plus, RefreshCw, UtensilsCrossed, Wallet } from 'lucide-react'
import { io } from '@/lib/socket'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { allNavItems, getHiddenModules, hasNavItemAccess } from '@/lib/navigation'
import { isDashboardStats, type DashboardStats } from '@/lib/dashboard'
import { formatCurrency } from '@/lib/utils'

const actions = [
  { href: '/tables/new', label: 'Pedido en mesa', description: 'Abre una mesa y toma el pedido.', icon: UtensilsCrossed },
  { href: '/orders/new', label: 'Nuevo domicilio', description: 'Registra el pedido y la entrega.', icon: Bike },
  { href: '/kitchen', label: 'Ver cocina', description: 'Consulta lo que se está preparando.', icon: ChefHat },
  { href: '/payment-validation', label: 'Validar pagos', description: 'Revisa y confirma los cobros.', icon: BadgeCheck },
]

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [connected, setConnected] = useState(false)
  const [updated, setUpdated] = useState<Date | null>(null)
  const [range, setRange] = useState<'today' | 'yesterday' | 'week'>('today')
  const refresh = useRef<() => void>(() => {})
  const hidden = getHiddenModules()
  const canOpen = (href: string) => {
    const item = allNavItems.find(nav => nav.href === href)
    return !!item && hasNavItemAccess(user, item) && !hidden.includes(item.module)
  }

  useEffect(() => {
    let active = true
    let inFlight = false
    let queued = false
    let pendingWhileHidden = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (!active) return
      if (inFlight) { queued = true; return }
      inFlight = true
      setRefreshing(true)
      const now = new Date()
      // Business date is always Colombia, independent of the device timezone.
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
      const startDate = new Date(`${today}T12:00:00Z`)
      if (range === 'yesterday') startDate.setUTCDate(startDate.getUTCDate() - 1)
      if (range === 'week') startDate.setUTCDate(startDate.getUTCDate() - 6)
      const start = startDate.toISOString().slice(0, 10)
      const end = range === 'yesterday' ? start : today
      try {
        const data = await api.get<unknown>(`/orders/dashboard-stats?startDate=${start}&endDate=${end}`)
        if (!isDashboardStats(data)) throw new Error('No se pudo leer el resumen. Actualiza el sistema e intenta de nuevo.')
        if (active) { setStats(data); setError(''); setUpdated(new Date()) }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar el resumen.')
      } finally {
        inFlight = false
        if (active) {
          setRefreshing(false)
          if (queued) { queued = false; schedule() }
        }
      }
    }
    const schedule = () => {
      if (!active) return
      if (document.hidden) {
        pendingWhileHidden = true
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 350)
    }
    const handleVisibilityChange = () => {
      if (document.hidden || !pendingWhileHidden) return
      pendingWhileHidden = false
      schedule()
    }
    refresh.current = () => void load()
    void load()
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, { transports: ['websocket', 'polling'] })
    let connectedOnce = false
    socket.on('connect', () => {
      setConnected(true)
      if (connectedOnce) schedule()
      connectedOnce = true
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))
    for (const event of ['newOrder', 'orderUpdated', 'orderStatusChanged', 'tableUpdated', 'tableClosed', 'kitchenTicketUpdated', 'paymentSubmitted', 'paymentValidated', 'paymentRejected', 'cashStatusChanged', 'cashRegistersChanged']) socket.on(event, schedule)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      socket.disconnect()
    }
  }, [range])

  const counters = [
    { href: '/tables', label: 'Mesas abiertas', value: stats?.operation.openTables, icon: UtensilsCrossed, color: 'text-orange-600 bg-orange-500/10' },
    { href: '/kitchen', label: 'En cocina', value: stats?.operation.kitchenPending, icon: ChefHat, color: 'text-blue-600 bg-blue-500/10' },
    { href: '/payment-validation', label: 'Pagos por validar', value: stats?.operation.pendingPayments, icon: BadgeCheck, color: 'text-violet-600 bg-violet-500/10' },
    { href: '/dispatch', label: 'Domicilios activos', value: stats?.operation.activeDeliveries, icon: Bike, color: 'text-emerald-600 bg-emerald-500/10' },
  ].filter(item => canOpen(item.href))
  const dateLabel = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium capitalize text-[var(--text-muted)]">{dateLabel}</p>
          <h1 className="text-3xl font-bold tracking-tight">Hola, {user?.name?.split(' ')[0] || 'equipo'}<span className="text-[var(--accent)]">.</span></h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Todo listo para organizar tu turno.</p>
        </div>
        <div className="flex items-center gap-3">
          <span role="status" className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />{connected ? 'Conectado en vivo' : 'Reconectando…'}</span>
          <button aria-label="Actualizar resumen" disabled={refreshing} onClick={() => refresh.current()} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-panel)] p-2.5 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
        </div>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 p-4 text-sm"><CircleAlert className="h-5 w-5 shrink-0 text-[var(--destructive)]" /><div className="flex-1"><p>{error}</p>{updated && <p className="mt-1 text-xs text-[var(--text-muted)]">Los datos visibles corresponden a la última consulta correcta.</p>}</div><button className="font-semibold underline" onClick={() => refresh.current()}>Reintentar</button></div>}

      <section className="overflow-hidden rounded-3xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] p-6 text-[var(--text-primary)] sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">Comienza aquí</p><h2 className="mt-2 text-2xl font-bold">Un buen turno empieza con un pedido.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">Mesas, cocina y caja conectadas para que cada pedido llegue a tiempo.</p></div>
          {canOpen('/tables/new') ? <Link to="/tables/new" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-5 py-3 text-sm font-bold text-white shadow-md transition-all"><Plus className="h-4 w-4" />Pedido en mesa</Link> : canOpen('/orders/new') && <Link to="/orders/new" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-5 py-3 text-sm font-bold text-white shadow-md transition-all"><Plus className="h-4 w-4" />Nuevo pedido</Link>}
        </div>
      </section>

      <section aria-label="Operación actual">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Así va la operación</h2><span className="text-xs text-[var(--text-muted)]">Pendientes actuales</span></div>
        <div className={`grid gap-3 sm:grid-cols-2 ${counters.length === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>{counters.map(({ href, label, value, icon: Icon, color }) => <Link key={href} to={href} className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 transition-colors hover:border-[var(--accent)]"><div className="flex items-center justify-between"><span className={`rounded-xl p-2.5 ${color}`}><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent)]" /></div><p className="mt-5 text-3xl font-semibold tabular-nums">{value ?? '—'}</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{label}</p></Link>)}</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Resumen de pedidos</h2><select aria-label="Período del resumen" value={range} onChange={e => { setStats(null); setUpdated(null); setRange(e.target.value as typeof range) }} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs"><option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="week">Últimos 7 días</option></select></div>
          <p className="text-xs text-[var(--text-secondary)]">Ventas de pedidos entregados y con pago confirmado</p><p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{stats ? formatCurrency(stats.today.sales) : '—'}</p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-5 sm:grid-cols-4">{[{ label: 'Pedidos', value: stats?.today.orders }, { label: 'Entregados', value: stats?.today.delivered }, { label: 'Pendientes', value: stats?.today.pending }, { label: 'Cancelados', value: stats?.today.cancelled }].map(item => <div key={item.label}><p className="text-xl font-semibold tabular-nums">{item.value ?? '—'}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{item.label}</p></div>)}</div>
          {stats?.today.orders === 0 && <p className="mt-5 rounded-xl bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-secondary)]">No hay pedidos en este período. Los nuevos pedidos aparecerán aquí.</p>}
          <p className="mt-5 text-xs text-[var(--text-muted)]">{updated ? `Última consulta: ${updated.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : refreshing ? 'Consultando el resumen…' : 'Resumen sin datos disponibles'}</p>
        </section>
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 sm:p-6"><h2 className="mb-3 text-base font-semibold">Accesos rápidos</h2><div className="divide-y divide-[var(--border-subtle)]">{actions.filter(action => canOpen(action.href)).map(({ href, label, description, icon: Icon }) => <Link key={href} to={href} className="group flex items-center gap-3 py-4"><Icon className="h-5 w-5 shrink-0 text-[var(--accent)]" /><div className="flex-1"><p className="text-sm font-semibold group-hover:text-[var(--accent)]">{label}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p></div><ArrowRight className="h-4 w-4 text-[var(--text-muted)]" /></Link>)}</div></section>
      </div>
      {canOpen('/cash-registers') && <Link to="/cash-registers" className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] px-5 py-4 text-sm hover:bg-[var(--bg-panel)]"><Wallet className="h-5 w-5 text-[var(--accent)]" /><span className="flex-1">{stats ? stats.operation.openRegisters ? `${stats.operation.openRegisters} turno(s) de caja abierto(s)` : 'Abre caja para comenzar a tomar pedidos' : 'Consultar cajas y turnos'}</span><span className="font-semibold">Ir a caja</span><ArrowRight className="h-4 w-4" /></Link>}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Crown, Database, Loader2, LogIn, Mail, MessageCircle, RefreshCw, Search, Server, Settings2, ShieldCheck, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'

interface Overview {
  usersByRole: { role: string; count: number }[]
  ordersToday: number
  ordersTotal: number
  errorLogsLast24h: number
  whatsappSessionsActive: number
  dbTotalSize: string
  smtpConfigured: boolean
  whatsappConfigured: boolean
}

interface UserData {
  id: string
  name: string
  email: string
  role: string
  active: boolean
}

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero / Facturación',
  DELIVERY_MANAGER: 'Gestor de Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

const roleColors: Record<string, string> = {
  SUPERADMIN: 'bg-violet-500',
  ADMIN: 'bg-orange-500',
  CASHIER: 'bg-blue-500',
  DELIVERY_MANAGER: 'bg-emerald-500',
  WAITER: 'bg-sky-500',
  KITCHEN: 'bg-rose-500',
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo cargar el panel.'

export default function SuperAdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)
  const [supportQuery, setSupportQuery] = useState('')
  const [supportRole, setSupportRole] = useState('ALL')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { startImpersonation, user: currentUser } = useAuth()

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewData, usersData] = await Promise.all([
        api.get<Overview>('/superadmin/overview', { force: true }),
        api.get<UserData[]>('/users', { force: true }),
      ])
      setData(overviewData)
      setUsers(usersData.filter(user => user.active && user.id !== currentUser?.id && user.role !== 'SUPERADMIN'))
      setLastUpdated(new Date())
    } catch (error) {
      alerts.error('No se pudo cargar el panel', getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [currentUser?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDashboard() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDashboard])

  const handleBroadcastRefresh = async () => {
    const ok = await alerts.confirm(
      '¿Sincronizar las pantallas abiertas?',
      'Los usuarios conectados recibirán una actualización para aplicar cambios recientes.',
      'Sincronizar',
      'Cancelar'
    )
    if (!ok) return
    setRefreshing(true)
    try {
      const result = await api.post<{ clientsNotified: number }>('/superadmin/broadcast-refresh')
      alerts.success('Sincronización enviada', `${result.clientsNotified} pantalla(s) conectada(s) recibirán la actualización.`)
    } catch (error) {
      alerts.error('No se pudo sincronizar', getErrorMessage(error))
    } finally {
      setRefreshing(false)
    }
  }

  const handleImpersonate = async (user: UserData) => {
    const ok = await alerts.confirm(
      `¿Entrar como ${user.name}?`,
      'Esta función es solo para soporte. Podrás volver a tu cuenta desde el menú principal.',
      'Entrar a soporte',
      'Cancelar'
    )
    if (!ok) return
    setImpersonatingId(user.id)
    try {
      await startImpersonation(user.id)
    } catch (error) {
      alerts.error('No se pudo iniciar soporte', getErrorMessage(error))
      setImpersonatingId(null)
    }
  }

  const filteredUsers = useMemo(() => {
    const query = supportQuery.trim().toLowerCase()
    return users.filter(user => {
      const matchesRole = supportRole === 'ALL' || user.role === supportRole
      const matchesQuery = !query || `${user.name} ${user.email}`.toLowerCase().includes(query)
      return matchesRole && matchesQuery
    })
  }, [supportQuery, supportRole, users])

  if (loading) {
    return <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-muted)]"><Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" /><p className="text-sm font-bold">Cargando panel de control…</p></div>
  }

  const hasErrors = (data?.errorLogsLast24h ?? 0) > 0
  const activeUsers = data?.usersByRole.reduce((total, item) => total + item.count, 0) ?? 0
  const maxRoleCount = Math.max(...(data?.usersByRole.map(item => item.count) || [1]), 1)
  const stats = [
    { label: 'Pedidos hoy', value: data?.ordersToday ?? 0, helper: 'Actividad del día', icon: Activity, tone: 'accent' },
    { label: 'Pedidos acumulados', value: data?.ordersTotal ?? 0, helper: 'Historial completo', icon: Database, tone: 'slate' },
    { label: 'Chats activos', value: data?.whatsappSessionsActive ?? 0, helper: 'WhatsApp en atención', icon: MessageCircle, tone: 'green' },
    { label: 'Errores recientes', value: data?.errorLogsLast24h ?? 0, helper: 'Últimas 24 horas', icon: AlertTriangle, tone: hasErrors ? 'red' : 'slate' },
  ]

  return (
    <div className="mx-auto min-h-[85vh] max-w-[1550px] rounded-[2rem] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-[var(--text-primary)] shadow-sm sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-[var(--accent)]/5 to-transparent" />
      <div className="relative space-y-5">
        <header className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]"><Crown className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">Panel SuperAdministrador</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Centro de control</h1><p className="mt-1 text-xs text-[var(--text-muted)]">Resumen operativo, salud del sistema y soporte de usuarios.</p></div></div>
          <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${hasErrors ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}><span className={`h-2 w-2 rounded-full ${hasErrors ? 'bg-red-500' : 'bg-emerald-500'}`} />{hasErrors ? `${data?.errorLogsLast24h} alerta(s) reciente(s)` : 'Operación estable'}</span><span className="hidden text-[10px] font-bold text-[var(--text-muted)] sm:inline">{lastUpdated ? `Actualizado ${lastUpdated.toLocaleTimeString('es-CO')}` : ''}</span><button type="button" onClick={() => void loadDashboard()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-xs font-black text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"><RefreshCw className="h-4 w-4" /> Actualizar</button><button type="button" onClick={() => void handleBroadcastRefresh()} disabled={refreshing} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--accent)] px-3 text-xs font-black text-[var(--accent-fg)] transition hover:opacity-90 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Sincronizar pantallas</button></div>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(stat => { const Icon = stat.icon; const tone = stat.tone === 'accent' ? 'border-[var(--accent)]/25 bg-[var(--accent)]/5 text-[var(--accent)]' : stat.tone === 'green' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600' : stat.tone === 'red' ? 'border-red-500/25 bg-red-500/5 text-red-600' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)]'; return <div key={stat.label} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 sm:p-5 ${tone}`}><div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-bold text-[var(--text-muted)]">{stat.label}</p><p className="mt-2 text-2xl font-black sm:text-3xl">{stat.value.toLocaleString('es-CO')}</p><p className="mt-1 text-[10px] font-medium text-[var(--text-muted)]">{stat.helper}</p></div><Icon className="h-5 w-5 opacity-80" /></div></div> })}</div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(290px,0.8fr)]">
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-black"><Users className="h-5 w-5 text-[var(--accent)]" /> Usuarios activos</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{activeUsers} usuarios operativos distribuidos por rol.</p></div><ShieldCheck className="h-5 w-5 text-emerald-600" /></div><div className="space-y-3">{data?.usersByRole.map(item => <div key={item.role}><div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="font-bold text-[var(--text-secondary)]">{roleLabels[item.role] || item.role}</span><span className="font-black text-[var(--text-primary)]">{item.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className={`h-full rounded-full ${roleColors[item.role] || 'bg-slate-400'}`} style={{ width: `${Math.max(8, (item.count / maxRoleCount) * 100)}%` }} /></div></div>)}</div></section>
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><h2 className="flex items-center gap-2 text-base font-black"><Settings2 className="h-5 w-5 text-[var(--accent)]" /> Accesos rápidos</h2><div className="mt-4 space-y-2"><Link to="/superadmin/config" className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] px-3 py-3 text-xs font-black text-[var(--text-secondary)] transition hover:bg-[var(--accent)]/5 hover:text-[var(--accent)]"><span>Configuración técnica</span><ArrowRight className="h-4 w-4" /></Link><Link to="/superadmin/audit-logs" className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] px-3 py-3 text-xs font-black text-[var(--text-secondary)] transition hover:bg-[var(--accent)]/5 hover:text-[var(--accent)]"><span>Auditoría y errores</span><ArrowRight className="h-4 w-4" /></Link><Link to="/superadmin/maintenance" className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] px-3 py-3 text-xs font-black text-[var(--text-secondary)] transition hover:bg-[var(--accent)]/5 hover:text-[var(--accent)]"><span>Estado de base de datos</span><ArrowRight className="h-4 w-4" /></Link></div><p className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/5 p-3 text-[11px] leading-5 text-[var(--text-muted)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Las acciones de mantenimiento son de solo lectura.</p></section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-base font-black"><Users className="h-5 w-5 text-[var(--accent)]" /> Soporte de usuarios</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Entra temporalmente a una cuenta para revisar un problema.</p></div><span className="rounded-lg bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-black text-[var(--text-muted)]">{filteredUsers.length} resultado(s)</span></div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><input value={supportQuery} onChange={event => setSupportQuery(event.target.value)} placeholder="Buscar por nombre o correo" className="h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-9 pr-3 text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" /></label><select value={supportRole} onChange={event => setSupportRole(event.target.value)} className="h-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-bold text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"><option value="ALL">Todos los roles</option>{Array.from(new Set(users.map(user => user.role))).sort().map(role => <option key={role} value={role}>{roleLabels[role] || role}</option>)}</select></div><div className="mt-4 grid max-h-[330px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{filteredUsers.slice(0, 10).map(user => <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"><div className="min-w-0"><p className="truncate text-xs font-black text-[var(--text-primary)]">{user.name}</p><p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{roleLabels[user.role] || user.role}</p></div><button type="button" onClick={() => void handleImpersonate(user)} disabled={impersonatingId === user.id} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] disabled:opacity-50" title={`Entrar como ${user.name}`}>{impersonatingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}</button></div>)}{filteredUsers.length === 0 && <p className="col-span-2 py-10 text-center text-xs font-bold text-[var(--text-muted)]">No hay usuarios con ese filtro.</p>}</div>{filteredUsers.length > 10 && <p className="mt-3 text-[10px] font-bold text-[var(--text-muted)]">Mostrando los primeros 10 resultados. Usa la búsqueda para encontrar otro usuario.</p>}</section>

          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><h2 className="flex items-center gap-2 text-base font-black"><Server className="h-5 w-5 text-[var(--accent)]" /> Salud del sistema</h2><div className="mt-4 space-y-2"><div className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] p-3"><span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><Database className="h-4 w-4 text-[var(--accent)]" /> Base de datos</span><span className="text-xs font-black text-[var(--text-primary)]">{data?.dbTotalSize || 'Sin datos'}</span></div><div className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] p-3"><span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><Mail className="h-4 w-4 text-[var(--accent)]" /> Correo</span><span className={`rounded-lg px-2 py-1 text-[10px] font-black ${data?.smtpConfigured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{data?.smtpConfigured ? 'Configurado' : 'Pendiente'}</span></div><div className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] p-3"><span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><MessageCircle className="h-4 w-4 text-[var(--accent)]" /> WhatsApp</span><span className={`rounded-lg px-2 py-1 text-[10px] font-black ${data?.whatsappConfigured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{data?.whatsappConfigured ? 'Conectado' : 'Pendiente'}</span></div><div className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] p-3"><span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><AlertTriangle className="h-4 w-4 text-[var(--accent)]" /> Errores últimos 24 h</span><span className={`text-xs font-black ${hasErrors ? 'text-red-600' : 'text-emerald-600'}`}>{data?.errorLogsLast24h ?? 0}</span></div></div><Link to="/superadmin/maintenance" className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-4 text-xs font-black text-[var(--accent)]">Abrir estado técnico <ArrowRight className="h-4 w-4" /></Link></section>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { Crown, Users, ShoppingBag, Database, AlertTriangle, MessageCircle, Loader2, Server, Activity, ArrowRight, LogIn, RefreshCw, ShieldCheck, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { alerts } from '@/lib/alerts'

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
}

export default function SuperAdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(true)
  const { startImpersonation, user: currentUser } = useAuth()
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleBroadcastRefresh = async () => {
    const ok = await alerts.confirm(
      '¿Refrescar todos los clientes?',
      'Todos los usuarios con la página abierta verán una recarga automática en unos segundos para aplicar los últimos cambios.',
      'Refrescar ahora',
      'Cancelar'
    )
    if (!ok) return
    setRefreshing(true)
    try {
      const res = await api.post<{ ok: boolean; clientsNotified: number }>('/superadmin/broadcast-refresh')
      alerts.success('Refresco enviado', `${res.clientsNotified} cliente(s) conectados recibirán la actualización.`)
    } catch (err: any) {
      alerts.error('No se pudo enviar el refresco', err.message || 'Intenta nuevamente')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    Promise.all([
      api.get<Overview>('/superadmin/overview'),
      api.get<UserData[]>('/users')
    ])
      .then(([overviewData, usersData]) => {
        setData(overviewData)
        setUsers(usersData.filter(u => u.active && u.id !== currentUser?.id && u.role !== 'SUPERADMIN'))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentUser?.id])

  const handleImpersonate = async (u: UserData) => {
    const ok = await alerts.confirm(
      `¿Entrar como ${u.name}?`,
      'Vas a iniciar sesión con los permisos de este usuario. Podrás regresar a tu cuenta desde el menú principal.',
      'Entrar',
      'Cancelar'
    )
    if (!ok) return
    setImpersonatingId(u.id)
    try {
      await startImpersonation(u.id)
    } catch (err: any) {
      alerts.error('No se pudo iniciar sesión', err.message || 'Intenta nuevamente')
      setImpersonatingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-[#64748B] min-h-[80vh] bg-[#FFFFFF] rounded-3xl border border-[#E5E7EB]">
        <Loader2 className="h-8 w-8 animate-spin text-[#7A1F2B]" />
        <p className="mt-4 text-sm font-medium text-[#64748B]">Cargando Panel de Control...</p>
      </div>
    )
  }

  const hasErrors = (data?.errorLogsLast24h ?? 0) > 0
  const stats = [
    { label: 'Pedidos Hoy', value: data?.ordersToday ?? 0, icon: ShoppingBag, color: 'from-[#7A1F2B]/15 to-transparent', text: 'text-[#7A1F2B]', border: 'border-[#7A1F2B]/20' },
    { label: 'Pedidos Totales', value: data?.ordersTotal ?? 0, icon: Activity, color: 'from-[#7A1F2B]/15 to-transparent', text: 'text-[#0F172A]', border: 'border-[#E2E8F0]' },
    { label: 'Sesiones WhatsApp', value: data?.whatsappSessionsActive ?? 0, icon: MessageCircle, color: 'from-[#7A1F2B]/15 to-transparent', text: 'text-[#0F172A]', border: 'border-[#E2E8F0]' },
    { label: 'Errores (24h)', value: data?.errorLogsLast24h ?? 0, icon: AlertTriangle, color: hasErrors ? 'from-red-500/15 to-transparent' : 'from-[#7A1F2B]/15 to-transparent', text: hasErrors ? 'text-red-600' : 'text-[#0F172A]', border: hasErrors ? 'border-red-200' : 'border-[#E2E8F0]' },
  ]
  const activeUsers = data?.usersByRole.reduce((total, item) => total + item.count, 0) ?? 0

  return (
    <div className="min-h-[85vh] bg-[#F6F7F9] rounded-[2rem] border border-[#E5E7EB] p-4 md:p-8 text-[#334155] relative overflow-hidden shadow-2xl">
      {/* Background Soft Gradients */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#7A1F2B]/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.05),transparent_50%)] pointer-events-none" />
      
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 space-y-8">
        
        {/* Header */}
        <motion.div variants={itemVariants} className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E5E7EB] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-5 w-5 text-[#B45309]" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#B45309] uppercase font-bold">Panel Super Administrador</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0F172A] tracking-tight">
              Panel de control
            </h1>
            <p className="text-xs text-[#64748B] mt-1">Estado general, usuarios y accesos de soporte de The Villa Dog.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBroadcastRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-[#7A1F2B]/10 hover:bg-[#7A1F2B]/20 border border-[#7A1F2B]/30 rounded-xl text-sm font-medium text-[#7A1F2B] transition-colors cursor-pointer disabled:opacity-50"
              title="Recargar la página de todos los usuarios conectados"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refrescar Sistema
            </button>
            <Link to="/superadmin/config">
              <button className="flex items-center gap-2 px-4 py-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#0F172A] transition-colors cursor-pointer">
                <Server className="h-4 w-4 text-[#64748B]" /> Configuración
              </button>
            </Link>
          </div>
        </motion.div>

        {/* Top KPI Metrics */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <div key={s.label} className={`relative p-5 rounded-2xl bg-gradient-to-br ${s.color} border ${s.border} backdrop-blur-md transition-transform hover:-translate-y-1`}>
              <div className="relative z-10 flex justify-between items-start">
                <div>
                  <p className="text-xs font-medium text-[#64748B]">{s.label}</p>
                  <p className={`text-3xl font-black mt-2 ${s.text}`}>
                    {s.value}
                  </p>
                </div>
                <s.icon className={`h-6 w-6 ${s.text} opacity-80`} />
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-lg">
            <div className="mb-5 flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-base font-bold text-[#0F172A]"><Users className="h-5 w-5 text-[#7A1F2B]" /> Usuarios activos</h3><p className="mt-1 text-xs text-[#64748B]">Distribución actual por rol · {activeUsers} en total</p></div><ShieldCheck className="h-5 w-5 text-emerald-600" /></div>
            <div className="grid gap-2 sm:grid-cols-2">{data?.usersByRole.map(item => <div key={item.role} className="flex items-center justify-between rounded-xl bg-[#F6F7F9] px-3 py-2.5"><span className="text-xs font-medium text-[#64748B]">{roleLabels[item.role] || item.role}</span><span className="text-sm font-black text-[#0F172A]">{item.count}</span></div>)}</div>
          </div>
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-lg">
            <h3 className="flex items-center gap-2 text-base font-bold text-[#0F172A]"><Settings2 className="h-5 w-5 text-[#7A1F2B]" /> Atajos seguros</h3>
            <div className="mt-4 space-y-2"><Link to="/superadmin/config" className="flex items-center justify-between rounded-xl bg-[#F6F7F9] px-3 py-3 text-xs font-bold text-[#334155] transition hover:bg-[#F1F5F9]"><span>Configuración técnica</span><ArrowRight className="h-4 w-4 text-[#7A1F2B]" /></Link><Link to="/superadmin/audit-logs" className="flex items-center justify-between rounded-xl bg-[#F6F7F9] px-3 py-3 text-xs font-bold text-[#334155] transition hover:bg-[#F1F5F9]"><span>Auditoría y errores</span><ArrowRight className="h-4 w-4 text-[#7A1F2B]" /></Link><Link to="/superadmin/maintenance" className="flex items-center justify-between rounded-xl bg-[#F6F7F9] px-3 py-3 text-xs font-bold text-[#334155] transition hover:bg-[#F1F5F9]"><span>Estado de base de datos</span><ArrowRight className="h-4 w-4 text-[#7A1F2B]" /></Link></div>
          </div>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* Quick Access to Users */}
          <motion.div variants={itemVariants} className="lg:col-span-2">
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] p-6 h-full shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2">
                  <Users className="h-5 w-5 text-[#7A1F2B]" /> Acceso rápido de soporte
                </h3>
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {users.length === 0 ? (
                  <p className="text-sm text-[#64748B] col-span-2 text-center py-8">No hay usuarios activos para acceder.</p>
                ) : (
                  users.map((u) => (
                    <div key={u.id} className="group flex items-center justify-between bg-[#F6F7F9] p-4 rounded-xl border border-[#E5E7EB] hover:border-[#E2E8F0] transition-all">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0F172A] truncate">{u.name}</p>
                        <p className="text-xs text-[#64748B] truncate mt-0.5">{roleLabels[u.role] || u.role}</p>
                      </div>
                      <button
                        onClick={() => handleImpersonate(u)}
                        disabled={impersonatingId === u.id}
                        className="flex items-center justify-center h-8 w-8 rounded-lg bg-[#7A1F2B]/10 text-[#7A1F2B] hover:bg-[#7A1F2B] hover:text-white transition-colors shrink-0 ml-3"
                        title={`Entrar como ${u.name}`}
                      >
                        {impersonatingId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>

          {/* System Health */}
          <motion.div variants={itemVariants} className="lg:col-span-1">
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] p-6 h-full shadow-lg flex flex-col">
                <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2 mb-6">
                  <Database className="h-5 w-5 text-[#7A1F2B]" /> Estado del Sistema
              </h3>
              
              <div className="space-y-4 flex-1">
                <div className="bg-[#F6F7F9] p-4 rounded-xl border border-[#E5E7EB]">
                  <p className="text-xs text-[#64748B] uppercase tracking-wider mb-1">Base de Datos</p>
                  <p className="text-lg font-medium text-[#0F172A] flex items-baseline gap-2">
                    {data?.dbTotalSize || '0 MB'} <span className="text-xs text-[#64748B]">usado</span>
                  </p>
                </div>
                
                <div className="bg-[#F6F7F9] p-4 rounded-xl border border-[#E5E7EB] flex justify-between items-center">
                  <p className="text-sm text-[#334155]">Servicio de Correo</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${data?.smtpConfigured ? 'bg-[#7A1F2B]/10 text-[#7A1F2B]' : 'bg-red-50 text-red-600'}`}>
                    {data?.smtpConfigured ? 'Activo' : 'Inactivo'}
                  </span>
                </div>

                <div className="bg-[#F6F7F9] p-4 rounded-xl border border-[#E5E7EB] flex justify-between items-center">
                  <p className="text-sm text-[#334155]">API WhatsApp</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${data?.whatsappConfigured ? 'bg-[#7A1F2B]/10 text-[#7A1F2B]' : 'bg-red-50 text-red-600'}`}>
                    {data?.whatsappConfigured ? 'Conectado' : 'Sin Conexión'}
                  </span>
                </div>

              </div>

              <div className="mt-6 pt-4 border-t border-[#E5E7EB]">
                <Link to="/superadmin/maintenance" className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F172A] transition-colors">
                  Ver estado técnico (solo lectura) <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

    </div>
  )
}

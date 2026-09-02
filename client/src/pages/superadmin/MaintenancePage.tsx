import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { Trash2, Loader2, HardDrive, ShieldCheck, Database, AlertOctagon, ArrowLeft, Terminal } from 'lucide-react'
import { Link } from 'react-router-dom'

interface DbSize {
  total: string
  tables: { table: string; size: string }[]
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
}

export default function MaintenancePage() {
  const [dbSize, setDbSize] = useState<DbSize | null>(null)
  const [loading, setLoading] = useState(true)
  const [olderThanDays, setOlderThanDays] = useState(365)
  const [purging, setPurging] = useState(false)

  const loadDbSize = () => {
    setLoading(true)
    api.get<DbSize>('/superadmin/maintenance/db-size')
      .then(setDbSize)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDbSize() }, [])

  const handlePurge = async () => {
    const ok = await alerts.confirm(
      '¿Purgar chats antiguos de WhatsApp?',
      `Se eliminarán permanentemente las sesiones inactivas y sus mensajes con más de ${olderThanDays} días. Esta acción NO se puede deshacer.`,
      'Ejecutar Purga',
      'Abortar'
    )
    if (!ok) return
    setPurging(true)
    try {
      const res = await api.post<{ sessionsDeleted: number; messagesDeleted: number }>('/superadmin/maintenance/purge-whatsapp-chats', { olderThanDays })
      alerts.success('Purga completada', `SYSTEM PURGE: ${res.sessionsDeleted} sesiones y ${res.messagesDeleted} mensajes eliminados.`)
      loadDbSize()
    } catch (err: any) {
      alerts.error('Error al purgar', err.message)
    } finally {
      setPurging(false)
    }
  }

  return (
    <div className="min-h-[85vh] bg-[#F6F7F9] rounded-[2rem] border border-[#E5E7EB] p-4 md:p-8 text-[#334155] relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#1E40AF]/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_top_right,rgba(30,64,175,0.04),transparent_50%)] pointer-events-none" />
      
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 space-y-8">
        
        {/* Header */}
        <motion.div variants={itemVariants} className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E2E8F0] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link to="/superadmin">
                <button className="flex items-center justify-center h-6 w-6 rounded-md bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] transition-colors cursor-pointer mr-2">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              </Link>
              <ShieldCheck className="h-5 w-5 text-[#B45309]" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#B45309] uppercase font-bold">SYSTEM MAINTENANCE</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0F172A] tracking-tight uppercase flex items-center gap-3">
              Mantenimiento
            </h1>
            <p className="text-xs text-[#64748B] font-mono mt-1">Gestión de recursos y limpieza de base de datos</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadDbSize} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E2E8F0] rounded-lg text-[10px] font-mono text-[#0F172A] transition-colors cursor-pointer">
              <Loader2 className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#1E40AF]' : ''}`} /> REFRESH DB STATUS
            </button>
          </div>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* DB Size */}
          <motion.div variants={itemVariants} className="lg:col-span-2">
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col h-full">
              <div className="p-4 border-b border-[#E5E7EB] bg-[#F6F7F9]/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[#1E40AF]/10 rounded-lg text-[#1E40AF]">
                    <Database className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-widest">Uso de Base de Datos</h2>
                    <p className="text-[10px] font-mono text-[#64748B]">Distribución de almacenamiento por tablas</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider mb-1">TOTAL USAGE</p>
                  <p className="text-xl font-black text-[#0F172A] font-mono">{dbSize?.total || '0.00 MB'}</p>
                </div>
              </div>
              
              <div className="p-6 bg-[#F6F7F9]">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[#64748B]">
                    <Loader2 className="h-6 w-6 animate-spin text-[#1E40AF] mb-2" />
                    <p className="text-[10px] font-mono uppercase tracking-widest">Calculating Storage...</p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {dbSize?.tables.map(t => (
                      <div key={t.table} className="group flex items-center justify-between p-3 bg-[#FFFFFF] border border-[#E5E7EB] hover:border-[#CBD5E1] rounded-xl transition-colors">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-3.5 w-3.5 text-[#94A3B8] group-hover:text-[#1E40AF] transition-colors" />
                          <span className="text-xs font-mono text-[#334155]">{t.table}</span>
                        </div>
                        <span className="text-xs font-mono font-bold text-[#0F172A]">{t.size}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Destructive Actions */}
          <motion.div variants={itemVariants} className="lg:col-span-1">
            <div className="bg-[#FEF2F2] rounded-2xl border border-red-200 shadow-[0_0_30px_-10px_rgba(239,68,68,0.2)] overflow-hidden flex flex-col h-full">
              <div className="p-4 border-b border-red-200 bg-red-50 flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg text-red-500 animate-pulse">
                  <AlertOctagon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-red-600 uppercase tracking-widest">Data Purge</h2>
                  <p className="text-[10px] font-mono text-red-600/60">Limpieza de chats inactivos</p>
                </div>
              </div>
              
              <div className="p-6 space-y-4 flex-1 flex flex-col justify-center">
                <p className="text-xs font-mono text-[#64748B] leading-relaxed mb-2">
                  <span className="text-red-600 font-bold">WARNING:</span> Esta acción elimina permanentemente sesiones y mensajes de WhatsApp. No afecta métricas ni pedidos del historial.
                </p>
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-red-600/80 uppercase tracking-wider">Antigüedad (Días)</label>
                  <div className="relative">
                    <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500/50" />
                    <input type="number" min={30} className="w-full h-10 pl-9 pr-3 bg-white border border-red-300 rounded-xl text-sm font-mono text-red-600 focus:outline-none focus:border-red-500 transition-colors" value={olderThanDays} onChange={e => setOlderThanDays(Number(e.target.value))} />
                  </div>
                  <p className="text-[9px] font-mono text-[#64748B] text-right mt-1">MIN: 30 DAYS</p>
                </div>
              </div>
              
              <div className="p-4 bg-[#F8FAFC] border-t border-red-200">
                <button onClick={handlePurge} disabled={purging} className="w-full h-10 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-mono font-bold rounded-xl text-xs uppercase tracking-widest transition-colors cursor-pointer shadow-[0_0_15px_-3px_rgba(239,68,68,0.5)]">
                  {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="h-4 w-4" /> EXECUTE PURGE</>}
                </button>
              </div>
            </div>
          </motion.div>

        </div>
      </motion.div>
    </div>
  )
}

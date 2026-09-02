import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { ScrollText, AlertTriangle, Loader2, ChevronLeft, ChevronRight, Activity, Zap, Terminal, ShieldAlert, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

interface AuditLog {
  id: string
  actorName: string
  actorRole: string
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: any
  createdAt: string
}

interface ErrorLog {
  id: string
  message: string
  stack?: string | null
  path?: string | null
  method?: string | null
  statusCode?: number | null
  createdAt: string
}

interface Paginated<T> { items: T[]; total: number; page: number; pageCount: number }

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
}

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
}

export default function AuditLogsPage() {
  const [tab, setTab] = useState<'audit' | 'errors'>('audit')
  const [audit, setAudit] = useState<Paginated<AuditLog> | null>(null)
  const [errors, setErrors] = useState<Paginated<ErrorLog> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [expandedError, setExpandedError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const endpoint = tab === 'audit' ? `/superadmin/audit-logs?page=${page}` : `/superadmin/error-logs?page=${page}`
    api.get<Paginated<any>>(endpoint)
      .then(data => tab === 'audit' ? setAudit(data) : setErrors(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tab, page])

  const current = tab === 'audit' ? audit : errors

  return (
    <div className="min-h-[85vh] bg-[#F6F7F9] rounded-[2rem] border border-[#E5E7EB] p-4 md:p-8 text-[#334155] relative overflow-hidden shadow-2xl flex flex-col">
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#1E40AF]/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_top_right,rgba(30,64,175,0.04),transparent_50%)] pointer-events-none" />
      
      <div className="relative z-10 space-y-6 flex-1 flex flex-col">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E2E8F0] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link to="/superadmin">
                <button className="flex items-center justify-center h-6 w-6 rounded-md bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] transition-colors cursor-pointer mr-2">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              </Link>
              <Activity className="h-5 w-5 text-[#B45309]" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#B45309] uppercase font-bold">SYSTEM TELEMETRY</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0F172A] tracking-tight uppercase flex items-center gap-3">
              Logs & Auditoría
            </h1>
            <p className="text-xs text-[#64748B] font-mono mt-1">Historial inmutable de acciones administrativas y trazas de error</p>
          </div>
          
          <div className="flex bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl p-1">
            <button
              onClick={() => { setTab('audit'); setPage(1) }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${tab === 'audit' ? 'bg-[#1E40AF]/10 text-[#1E40AF]' : 'text-[#64748B] hover:text-[#334155] hover:bg-[#F1F5F9]'}`}
            >
              <ScrollText className="h-3.5 w-3.5" />
              Action Logs
            </button>
            <button
              onClick={() => { setTab('errors'); setPage(1) }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${tab === 'errors' ? 'bg-red-50 text-red-600' : 'text-[#64748B] hover:text-[#334155] hover:bg-[#F1F5F9]'}`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Error Traces
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-[#FFFFFF] border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12">
              <Loader2 className={`h-8 w-8 animate-spin ${tab === 'audit' ? 'text-[#1E40AF]' : 'text-red-600'} mb-4`} />
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#64748B]">Querying Telemetry Database...</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
                
                {tab === 'audit' && audit?.items.map(log => (
                  <motion.div variants={itemVariants} key={log.id} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#F6F7F9] border border-[#E5E7EB] hover:border-[#1E40AF]/30 rounded-xl transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                        <Terminal className="h-4 w-4 text-[#1E40AF]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="px-1.5 py-0.5 bg-[#1E40AF]/10 border border-[#1E40AF]/20 text-[#1E40AF] rounded text-[9px] font-mono font-bold uppercase">
                            {log.action}
                          </span>
                          <span className="text-xs font-bold text-[#0F172A]">{log.actorName}</span>
                          <span className="text-[10px] font-mono text-[#64748B] uppercase">[{log.actorRole}]</span>
                        </div>
                        {log.targetType && (
                          <p className="text-[10px] font-mono text-[#64748B]">
                            TARGET: <span className="text-[#334155]">{log.targetType}</span> · <span className="opacity-50">{log.targetId}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono text-[#94A3B8]">{new Date(log.createdAt).toLocaleString('es-CO')}</span>
                    </div>
                  </motion.div>
                ))}

                {tab === 'errors' && errors?.items.map(err => (
                  <motion.div variants={itemVariants} key={err.id} className="group p-4 bg-[#F6F7F9] border border-[#E5E7EB] hover:border-red-300 rounded-xl transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-500 rounded text-[10px] font-mono font-bold mt-0.5 shrink-0">
                          {err.statusCode || '500'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0F172A] mb-0.5 break-all">{err.message}</p>
                          {err.path && (
                            <p className="text-[10px] font-mono text-red-600/70">
                              {err.method} {err.path}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-[#94A3B8] shrink-0">{new Date(err.createdAt).toLocaleString('es-CO')}</span>
                    </div>
                    
                    {err.stack && (
                      <div className="pl-12 pt-1">
                        <button
                          onClick={() => setExpandedError(expandedError === err.id ? null : err.id)}
                          className="flex items-center gap-1.5 text-[9px] font-mono text-red-500/60 hover:text-red-600 uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          <Zap className="h-3 w-3" /> {expandedError === err.id ? 'HIDE TRACE' : 'SHOW STACK TRACE'}
                        </button>
                        
                        <AnimatePresence>
                          {expandedError === err.id && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <pre className="mt-2 p-3 bg-white border border-red-200 rounded-lg text-[9px] font-mono text-red-600/70 overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
                                {err.stack}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                ))}

                {current?.items.length === 0 && (
                  <div className="py-20 text-center">
                    <Activity className="h-8 w-8 text-[#CBD5E1] mx-auto mb-3" />
                    <p className="text-xs font-mono text-[#64748B] uppercase tracking-widest">NO TELEMETRY DATA FOUND.</p>
                  </div>
                )}
                
              </motion.div>
            </div>
          )}
          
          {/* Pagination */}
          {current && current.pageCount > 1 && (
            <div className="p-3 border-t border-[#E5E7EB] bg-[#F6F7F9]/50 flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider pl-2">
                PAGE {current.page} / {current.pageCount}
              </span>
              <div className="flex gap-2">
                <button 
                  disabled={page <= 1} 
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] disabled:opacity-30 disabled:hover:bg-[#F1F5F9] rounded-md border border-[#E2E8F0] text-[#0F172A] transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button 
                  disabled={page >= current.pageCount} 
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] disabled:opacity-30 disabled:hover:bg-[#F1F5F9] rounded-md border border-[#E2E8F0] text-[#0F172A] transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

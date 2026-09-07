import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, ChevronLeft, ChevronRight, Filter, Info, Loader2, RefreshCw, ScrollText, ShieldAlert, Terminal, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'

interface AuditLog {
  id: string
  actorName: string
  actorRole: string
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown> | null
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

const actionLabels: Record<string, string> = {
  SYSTEM_FORCE_REFRESH: 'Refresco del sistema',
  SMTP_TEST_EMAIL: 'Prueba de correo',
  RESET_TEST_SALES: 'Limpieza de pruebas',
  PURGE_WHATSAPP_CHATS: 'Purga de chats',
  USER_CREATED: 'Usuario creado',
  USER_UPDATED: 'Usuario actualizado',
  USER_DELETED: 'Usuario eliminado',
  USER_DEACTIVATED: 'Usuario desactivado',
  IMPERSONATION_STARTED: 'Soporte como usuario',
}

const roleLabels: Record<string, string> = { SUPERADMIN: 'SuperAdmin', ADMIN: 'Administrador' }
const actionLabel = (action: string) => actionLabels[action] || action.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (letter: string) => letter.toUpperCase())
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo cargar la auditoría.'

export default function AuditLogsPage() {
  const [tab, setTab] = useState<'audit' | 'errors'>('audit')
  const [audit, setAudit] = useState<Paginated<AuditLog> | null>(null)
  const [errors, setErrors] = useState<Paginated<ErrorLog> | null>(null)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedError, setExpandedError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    const query = actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : ''
    const endpoint = tab === 'audit' ? `/superadmin/audit-logs?page=${page}${query}` : `/superadmin/error-logs?page=${page}`
    api.get<Paginated<AuditLog> | Paginated<ErrorLog>>(endpoint, { force: true })
      .then(data => {
        if (!active) return
        if (tab === 'audit') setAudit(data as Paginated<AuditLog>)
        else setErrors(data as Paginated<ErrorLog>)
      })
      .catch(error => {
        if (active) alerts.error('No se pudo cargar el registro', getErrorMessage(error))
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [tab, page, actionFilter])

  const current = tab === 'audit' ? audit : errors
  const actionOptions = useMemo(() => Object.entries(actionLabels).sort((a, b) => a[1].localeCompare(b[1])), [])

  return (
    <div className="mx-auto min-h-[85vh] max-w-[1450px] space-y-4 pb-8">
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3"><Link to="/superadmin" className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" aria-label="Volver al panel"><ArrowLeft className="h-4 w-4" /></Link><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScrollText className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">SuperAdmin · Trazabilidad</p><h1 className="mt-1 text-xl font-black text-[var(--text-primary)] sm:text-2xl">Auditoría y errores</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">La auditoría responde quién hizo qué, sobre qué registro y cuándo. Los errores ayudan a diagnosticar fallos sin exponer credenciales.</p></div></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setTab('audit'); setPage(1) }} className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black transition ${tab === 'audit' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}><ScrollText className="h-4 w-4" /> Acciones</button><button type="button" onClick={() => { setTab('errors'); setPage(1) }} className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black transition ${tab === 'errors' ? 'bg-red-600 text-white' : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}><ShieldAlert className="h-4 w-4" /> Errores</button></div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-[var(--text-secondary)] sm:flex-row sm:items-center"><Info className="h-5 w-5 shrink-0 text-sky-600" /><p><strong className="text-[var(--text-primary)]">¿Para qué sirve?</strong> Revisa cambios de usuarios, configuraciones, pruebas de correo y soporte. Este registro no se puede borrar desde la aplicación.</p></div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2 text-sm font-black text-[var(--text-primary)]"><Filter className="h-4 w-4 text-[var(--accent)]" /> {tab === 'audit' ? 'Filtrar acciones' : 'Registro de errores'}</div>
          <div className="flex flex-wrap items-center gap-2">{tab === 'audit' && <select value={actionFilter} onChange={event => { setActionFilter(event.target.value); setPage(1) }} className="h-10 min-w-56 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-bold text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"><option value="">Todas las acciones</option>{actionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<button type="button" onClick={() => setPage(page)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-black text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"><RefreshCw className="h-4 w-4" /> Actualizar</button></div>
        </div>

        <div className="min-h-[420px] p-4 sm:p-5">
          {loading ? <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-xs font-bold text-[var(--text-muted)]"><Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" /> Consultando registros…</div> : <div className="space-y-2">{tab === 'audit' && (audit?.items || []).map(log => { const details = Object.entries(log.metadata || {}).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(' · '); return <div key={log.id} className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 transition hover:border-[var(--accent)]/40 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Terminal className="h-4 w-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-[var(--accent)]/10 px-2 py-1 text-[10px] font-black text-[var(--accent)]">{actionLabel(log.action)}</span><span className="text-xs font-black text-[var(--text-primary)]">{log.actorName}</span><span className="text-[10px] font-bold text-[var(--text-muted)]">{roleLabels[log.actorRole] || log.actorRole}</span></div><p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{log.targetType ? `Registro: ${log.targetType}${log.targetId ? ` · ${log.targetId}` : ''}` : 'Acción general del sistema'}{details ? ` · ${details}` : ''}</p></div></div><span className="shrink-0 text-[10px] font-bold text-[var(--text-muted)]">{new Date(log.createdAt).toLocaleString('es-CO')}</span></div> })}{tab === 'errors' && (errors?.items || []).map(error => <div key={error.id} className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-600">HTTP {error.statusCode || 500}</span><div className="min-w-0"><p className="break-words text-xs font-black text-[var(--text-primary)]">{error.message}</p>{error.path && <p className="mt-1 font-mono text-[10px] text-red-600/80">{error.method} {error.path}</p>}</div></div><span className="shrink-0 text-[10px] font-bold text-[var(--text-muted)]">{new Date(error.createdAt).toLocaleString('es-CO')}</span></div>{error.stack && <div className="mt-3"><button type="button" onClick={() => setExpandedError(expandedError === error.id ? null : error.id)} className="inline-flex items-center gap-1.5 text-[10px] font-black text-red-600"> <Zap className="h-3 w-3" /> {expandedError === error.id ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</button>{expandedError === error.id && <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-[var(--bg-panel)] p-3 text-[10px] leading-5 text-red-700">{error.stack}</pre>}</div>}</div>)}{current?.items.length === 0 && <div className="flex min-h-[340px] flex-col items-center justify-center text-center"><Activity className="mb-3 h-8 w-8 text-[var(--text-muted)]" /><p className="text-sm font-black text-[var(--text-secondary)]">No hay registros con este filtro</p><p className="mt-1 text-xs text-[var(--text-muted)]">Los nuevos eventos aparecerán aquí automáticamente.</p></div>}</div>}
        </div>

        {current && current.pageCount > 1 && <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"><span className="text-[10px] font-black text-[var(--text-muted)]">Página {current.page} de {current.pageCount} · {current.total} registros</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)] disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button type="button" disabled={page >= current.pageCount} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)] disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, CheckCircle2, Database, HardDrive, Info, Loader2, RefreshCw, ShieldCheck, Table2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'

interface DbSize {
  total: string
  tables: { table: string; size: string }[]
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo consultar el estado de la base de datos.'

export default function MaintenancePage() {
  const [dbSize, setDbSize] = useState<DbSize | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadDbSize = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.get<DbSize>('/superadmin/maintenance/db-size', { force: true })
      setDbSize(result)
      setLastUpdated(new Date())
    } catch (error) {
      alerts.error('No se pudo consultar mantenimiento', getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadDbSize() }, [loadDbSize])

  return (
    <div className="mx-auto min-h-[85vh] max-w-[1450px] space-y-4 pb-8">
      <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link to="/superadmin" className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" aria-label="Volver al panel"><ArrowLeft className="h-4 w-4" /></Link>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600"><HardDrive className="h-5 w-5" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">SuperAdmin · Estado técnico</p><h1 className="mt-1 text-xl font-black text-[var(--text-primary)] sm:text-2xl">Mantenimiento seguro</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Consulta el uso de la base de datos y el estado operativo sin borrar pedidos, chats, usuarios ni configuraciones.</p></div>
          </div>
          <button type="button" onClick={() => void loadDbSize()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-black text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar estado</button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><Database className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Base de datos</p><p className="text-xl font-black text-[var(--text-primary)]">{dbSize?.total || (loading ? '…' : 'Sin datos')}</p></div></div></Card>
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600"><Table2 className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Tablas monitoreadas</p><p className="text-xl font-black text-[var(--text-primary)]">{dbSize?.tables.length ?? (loading ? '…' : 0)}</p></div></div></Card>
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Activity className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Última revisión</p><p className="text-sm font-black text-[var(--text-primary)]">{lastUpdated ? lastUpdated.toLocaleTimeString('es-CO') : 'Pendiente'}</p></div></div></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Card className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm"><div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5"><div><h2 className="text-base font-black text-[var(--text-primary)]">Uso por tabla</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Las diez tablas que más almacenamiento ocupan.</p></div><Database className="h-5 w-5 text-[var(--text-muted)]" /></div><div className="p-4 sm:p-5">{loading ? <div className="flex items-center justify-center gap-2 py-12 text-xs font-bold text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" /> Consultando PostgreSQL…</div> : dbSize?.tables.length ? <div className="grid gap-2 sm:grid-cols-2">{dbSize.tables.map(row => <div key={row.table} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3"><span className="flex min-w-0 items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><Table2 className="h-4 w-4 shrink-0 text-[var(--accent)]" /><span className="truncate">{row.table}</span></span><span className="shrink-0 text-xs font-black text-[var(--text-primary)]">{row.size}</span></div>)}</div> : <p className="py-12 text-center text-xs text-[var(--text-muted)]">No hay datos de almacenamiento para mostrar.</p>}</div></Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border-emerald-500/20 bg-emerald-500/5 p-5 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">Protección activa</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Este módulo es de solo lectura. No existe un botón para borrar la base de datos desde el panel.</p></div></div></Card>
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">¿Qué se gestiona aquí?</h2><ul className="mt-2 space-y-2 text-xs leading-5 text-[var(--text-secondary)]"><li>• Revisar crecimiento de tablas y detectar acumulación.</li><li>• Consultar respaldos y restauración directamente en Railway.</li><li>• Investigar cambios desde <Link to="/superadmin/audit-logs" className="font-black text-[var(--accent)] hover:underline">Auditoría</Link>.</li></ul></div></div></Card>
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">Si hay un incidente</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Revoca credenciales, revisa la auditoría, pausa integraciones y restaura un respaldo desde el proveedor. Los respaldos no se exponen en esta pantalla.</p></div></div></Card>
        </div>
      </div>
    </div>
  )
}

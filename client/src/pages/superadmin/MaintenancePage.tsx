import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, CheckCircle2, Database, HardDrive, Info, Loader2, RefreshCw, ShieldCheck, Table2, Wifi } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'

interface DbSize {
  total: string
  tables: { table: string; size: string }[]
}

interface TrafficRoute {
  route: string
  method: string
  requests: number
  bytes: number
  unknownBytesRequests: number
  errors: number
}

interface TrafficDay {
  date: string
  firstSeenAt: string
  lastSeenAt: string
  requests: number
  bytes: number
  unknownBytesRequests: number
  errors: number
  routes: TrafficRoute[]
}

interface TrafficReport {
  days: TrafficDay[]
  siteId: string
  note: string
  connections?: { users: number; sockets: number }
}

type TrafficRange = 'today' | 'yesterday' | 'seven'
type TrafficSort = 'bytes' | 'requests'

const numberFormat = new Intl.NumberFormat('es-CO')
const mbFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const percentFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })
const formatMb = (bytes: number) => mbFormat.format(bytes / 1_000_000)
const utcDateOffset = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const formatTimestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleString('es-CO')
}

const summarizeTraffic = (days: TrafficDay[]) => {
  const routes = new Map<string, TrafficRoute>()
  let requests = 0
  let bytes = 0
  let unknownBytesRequests = 0
  let errors = 0

  for (const day of days) {
    requests += day.requests
    bytes += day.bytes
    unknownBytesRequests += day.unknownBytesRequests
    errors += day.errors
    for (const route of day.routes) {
      const key = `${route.method} ${route.route}`
      const previous = routes.get(key)
      routes.set(key, previous ? {
        ...previous,
        requests: previous.requests + route.requests,
        bytes: previous.bytes + route.bytes,
        unknownBytesRequests: previous.unknownBytesRequests + route.unknownBytesRequests,
        errors: previous.errors + route.errors,
      } : { ...route })
    }
  }

  return { requests, bytes, unknownBytesRequests, errors, routes: [...routes.values()] }
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo consultar el estado del sistema.'

export default function MaintenancePage() {
  const { activeSite } = useAuth()
  const [dbSize, setDbSize] = useState<DbSize | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [traffic, setTraffic] = useState<TrafficReport | null>(null)
  const [trafficLoading, setTrafficLoading] = useState(true)
  const [trafficError, setTrafficError] = useState(false)
  const [trafficRange, setTrafficRange] = useState<TrafficRange>('today')
  const [trafficSort, setTrafficSort] = useState<TrafficSort>('bytes')
  const [todayUtc, setTodayUtc] = useState(() => new Date().toISOString().slice(0, 10))

  const loadDbSize = useCallback(() => api.get<DbSize>('/superadmin/maintenance/db-size', { force: true })
    .then(result => {
      setDbSize(result)
      setLastUpdated(new Date())
    })
    .catch(error => alerts.error('No se pudo consultar mantenimiento', getErrorMessage(error)))
    .finally(() => setLoading(false)), [])

  const loadTraffic = useCallback(() => api.get<TrafficReport>('/superadmin/traffic', { force: true })
    .then(result => {
      setTraffic(result)
      setTodayUtc(new Date().toISOString().slice(0, 10))
      setTrafficError(false)
    })
    .catch(error => {
      setTrafficError(true)
      alerts.error('No se pudo consultar el tráfico', getErrorMessage(error))
    })
    .finally(() => setTrafficLoading(false)), [activeSite?.id])

  useEffect(() => { void loadDbSize() }, [loadDbSize])
  useEffect(() => {
    setTraffic(null)
    setTrafficLoading(true)
    void loadTraffic()
  }, [loadTraffic])

  const selectedDays = useMemo(() => {
    const yesterdayUtc = utcDateOffset(todayUtc, -1)
    const firstWeekDayUtc = utcDateOffset(todayUtc, -6)
    return (traffic?.days ?? []).filter(day => trafficRange === 'today'
      ? day.date === todayUtc
      : trafficRange === 'yesterday'
        ? day.date === yesterdayUtc
        : day.date >= firstWeekDayUtc && day.date <= todayUtc)
  }, [traffic, trafficRange, todayUtc])

  const trafficSummary = useMemo(() => summarizeTraffic(selectedDays), [selectedDays])
  const rankedRoutes = useMemo(() => [...trafficSummary.routes]
    .sort((a, b) => trafficSort === 'bytes'
      ? b.bytes - a.bytes || b.requests - a.requests
      : b.requests - a.requests || b.bytes - a.bytes)
    .slice(0, 15), [trafficSummary.routes, trafficSort])
  const measurementStartedAt = traffic?.days.map(day => day.firstSeenAt).filter(Boolean).sort()[0]
  const knownRequests = Math.max(0, trafficSummary.requests - trafficSummary.unknownBytesRequests)
  const knownPercent = trafficSummary.requests > 0 ? knownRequests / trafficSummary.requests * 100 : 0

  return (
    <div className="mx-auto min-h-[85vh] max-w-[1450px] space-y-4 pb-8">
      <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link to="/superadmin" className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" aria-label="Volver al panel"><ArrowLeft className="h-4 w-4" /></Link>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600"><HardDrive className="h-5 w-5" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">SuperAdmin · Estado técnico</p><h1 className="mt-1 text-xl font-black text-[var(--text-primary)] sm:text-2xl">Mantenimiento seguro</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Consulta el uso de la base de datos y el estado operativo sin borrar pedidos, chats, usuarios ni configuraciones.</p></div>
          </div>
          <button type="button" onClick={() => { setLoading(true); setTrafficLoading(true); void loadDbSize(); void loadTraffic() }} disabled={loading || trafficLoading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-black text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60">{loading || trafficLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar estado</button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><Database className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Base de datos total</p><p className="text-xl font-black text-[var(--text-primary)]">{dbSize?.total || (loading ? '…' : 'Sin datos')}</p></div></div></Card>
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600"><Table2 className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Tablas monitoreadas</p><p className="text-xl font-black text-[var(--text-primary)]">{dbSize?.tables.length ?? (loading ? '…' : 0)}</p></div></div></Card>
        <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Activity className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Última revisión</p><p className="text-sm font-black text-[var(--text-primary)]">{lastUpdated ? lastUpdated.toLocaleTimeString('es-CO') : 'Pendiente'}</p></div></div></Card>
      </div>

      <Card className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2"><Wifi className="h-5 w-5 text-[var(--accent)]" /><h2 className="text-base font-black text-[var(--text-primary)]">Tráfico HTTP de {activeSite?.name || 'la sede activa'}</h2></div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Fechas UTC · Cambia de sede desde el selector superior para consultar otra. El registro separado empieza al desplegar esta versión.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Periodo de tráfico">
            {([['today', 'Hoy'], ['yesterday', 'Ayer'], ['seven', 'Últimos 7 días']] as const).map(([range, label]) => <button key={range} type="button" onClick={() => setTrafficRange(range)} aria-pressed={trafficRange === range} className={`rounded-xl px-3 py-2 text-xs font-black transition ${trafficRange === range ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent)]'}`}>{label}</button>)}
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {trafficLoading && !traffic ? <div className="flex items-center justify-center gap-2 py-12 text-xs font-bold text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" /> Consultando tráfico…</div> : trafficError && !traffic ? <div className="py-8 text-center"><p className="text-xs text-[var(--text-muted)]">No se pudo consultar el tráfico.</p><button type="button" onClick={() => { setTrafficLoading(true); void loadTraffic() }} className="mt-3 text-xs font-black text-[var(--accent)] hover:underline">Reintentar</button></div> : <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">MB conocidos</p><p className="mt-1 text-xl font-black text-[var(--text-primary)]">{formatMb(trafficSummary.bytes)} MB</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Solo respuestas con tamaño medido</p></div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Solicitudes HTTP</p><p className="mt-1 text-xl font-black text-[var(--text-primary)]">{numberFormat.format(trafficSummary.requests)}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{numberFormat.format(trafficSummary.errors)} respuestas 5xx</p></div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Respuestas con tamaño conocido</p><p className="mt-1 text-xl font-black text-[var(--text-primary)]">{percentFormat.format(knownPercent)} %</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{numberFormat.format(trafficSummary.unknownBytesRequests)} sin tamaño medido</p></div>
            </div>

            <div className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)] sm:flex-row sm:justify-between sm:gap-3">
              <span>Inicio de medición: <strong className="text-[var(--text-secondary)]">{measurementStartedAt ? formatTimestamp(measurementStartedAt) : 'Aún sin solicitudes'}</strong></span>
              {traffic?.connections && <span>Conexiones actuales: <strong className="text-[var(--text-secondary)]">{numberFormat.format(traffic.connections.sockets)} sockets / {numberFormat.format(traffic.connections.users)} usuarios</strong></span>}
            </div>

            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              <div className="flex flex-col gap-3 bg-[var(--bg-elevated)] p-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-xs font-black text-[var(--text-primary)]">Rutas con más tráfico</h3><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Hasta 15 rutas; MB contados solo cuando se conoce el tamaño.</p></div><div className="flex gap-1" aria-label="Orden de rutas">{([['bytes', 'MB'], ['requests', 'Llamadas']] as const).map(([sort, label]) => <button key={sort} type="button" onClick={() => setTrafficSort(sort)} aria-pressed={trafficSort === sort} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black ${trafficSort === sort ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'}`}>{label}</button>)}</div></div>
              {rankedRoutes.length ? <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-xs"><thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]"><tr><th className="px-3 py-2.5">Ruta</th><th className="px-3 py-2.5 text-right">MB conocidos</th><th className="px-3 py-2.5 text-right">Llamadas</th><th className="px-3 py-2.5 text-right">Sin tamaño</th></tr></thead><tbody className="divide-y divide-[var(--border-subtle)]">{rankedRoutes.map(route => <tr key={`${route.method} ${route.route}`}><td className="max-w-[420px] px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]"><span className="mr-2 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 font-black text-[var(--accent)]">{route.method}</span><span className="break-all">{route.route}</span></td><td className="px-3 py-2.5 text-right font-black text-[var(--text-primary)]">{formatMb(route.bytes)}</td><td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{numberFormat.format(route.requests)}</td><td className="px-3 py-2.5 text-right text-[var(--text-muted)]">{numberFormat.format(route.unknownBytesRequests)}</td></tr>)}</tbody></table></div> : <p className="px-3 py-10 text-center text-xs text-[var(--text-muted)]">No hay solicitudes medidas en este periodo.</p>}
            </div>

            <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] leading-5 text-[var(--text-secondary)]"><Info className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-sky-600" />Este HTTP medido no equivale al egress total de Railway. {traffic?.note || 'WebSocket y tráfico externo quedan fuera.'}</p>
          </>}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Card className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm"><div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5"><div><h2 className="text-base font-black text-[var(--text-primary)]">Uso total por tabla</h2><p className="mt-1 text-xs text-[var(--text-muted)]">PostgreSQL informa el tamaño físico conjunto de todas las sedes.</p></div><Database className="h-5 w-5 text-[var(--text-muted)]" /></div><div className="p-4 sm:p-5">{loading ? <div className="flex items-center justify-center gap-2 py-12 text-xs font-bold text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" /> Consultando PostgreSQL…</div> : dbSize?.tables.length ? <div className="grid gap-2 sm:grid-cols-2">{dbSize.tables.map(row => <div key={row.table} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3"><span className="flex min-w-0 items-center gap-2 text-xs font-bold text-[var(--text-secondary)]"><Table2 className="h-4 w-4 shrink-0 text-[var(--accent)]" /><span className="truncate">{row.table}</span></span><span className="shrink-0 text-xs font-black text-[var(--text-primary)]">{row.size}</span></div>)}</div> : <p className="py-12 text-center text-xs text-[var(--text-muted)]">No hay datos de almacenamiento para mostrar.</p>}</div></Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border-emerald-500/20 bg-emerald-500/5 p-5 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">Protección activa</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Este módulo es de solo lectura. No existe un botón para borrar la base de datos desde el panel.</p></div></div></Card>
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">¿Qué se gestiona aquí?</h2><ul className="mt-2 space-y-2 text-xs leading-5 text-[var(--text-secondary)]"><li>• Revisar crecimiento de tablas y detectar acumulación.</li><li>• Consultar respaldos y restauración directamente en Railway.</li><li>• Investigar cambios desde <Link to="/superadmin/audit-logs" className="font-black text-[var(--accent)] hover:underline">Auditoría</Link>.</li></ul></div></div></Card>
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" /><div><h2 className="text-sm font-black text-[var(--text-primary)]">Si hay un incidente</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Revoca credenciales, revisa la auditoría, pausa integraciones y restaura un respaldo desde el proveedor. Los respaldos no se exponen en esta pantalla.</p></div></div></Card>
        </div>
      </div>
    </div>
  )
}

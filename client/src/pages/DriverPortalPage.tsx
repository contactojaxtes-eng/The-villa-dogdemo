import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { io } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cleanNotes, cn, formatCurrency, formatDate, groupOrderItems } from '@/lib/utils'
import {
  AlertTriangle,
  Banknote,
  Bike,
  Camera,
  CheckCircle2,
  Clock,
  ClipboardList,
  History,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  Smartphone,
  Upload,
  Wallet,
} from 'lucide-react'

type PaymentMethod = 'CASH' | 'TRANSFER' | 'NEQUI' | 'BANCOLOMBIA' | 'DAVIPLATA' | 'MIXED'

interface ProofSummary {
  id: string
  status: string
  method: string
  rejectionReason?: string | null
  createdAt: string
  originalName?: string | null
}

interface PortalOrder {
  id: string
  orderNumber: number
  customerName: string
  customerPhone: string
  customerAddress: string
  addressReference?: string | null
  notes?: string | null
  total: number
  deliveryFee: number
  status: string
  paymentMethod: string
  cashAmount?: number | null
  transferAmount?: number | null
  originalPaymentMethod?: string | null
  paymentStatus: string
  paymentReference?: string | null
  driverSettlementId?: string | null
  createdAt: string
  updatedAt: string
  zone?: { id: string; name: string; rate?: number; km?: number | null } | null
  items: Array<{
    id: string
    quantity: number
    unitPrice: number
    totalPrice: number
    notes?: string | null
    menuItem?: { id: string; name: string } | null
  }>
  transferProofs?: ProofSummary[]
}

interface DriverPortalData {
  driver: { id: string; name: string; phone: string; active: boolean }
  currentShift: { id: string; startedAt: string; registerName: string } | null
  activeOrders: PortalOrder[]
  history: PortalOrder[]
  settlements: Array<{ id: string; expectedCash: number; receivedCash: number; difference: number; createdAt: string }>
  summary: { activeOrders: number; deliveredThisShift: number; pendingCash: number; pendingTransfers: number }
}

const paymentOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'MIXED', label: 'Mixto · efectivo + transferencia' },
]

const paymentLabel: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia',
  DAVIPLATA: 'Daviplata',
  MIXED: 'Mixto · efectivo + transferencia',
}

function isTransferMethod(method?: string) {
  return ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'MIXED'].includes(String(method || '').toUpperCase())
}

function normalizeDriverPaymentMethod(method?: string): PaymentMethod {
  const normalized = String(method || '').toUpperCase()
  if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(normalized)) return 'TRANSFER'
  if (normalized === 'MIXED') return 'MIXED'
  return 'CASH'
}

function originalPaymentLabel(order?: PortalOrder | null) {
  const method = order?.originalPaymentMethod || order?.paymentMethod
  return paymentLabel[String(method || '').toUpperCase()] || method || 'Por confirmar'
}

function receivedPaymentLabel(order?: PortalOrder | null) {
  const method = order?.paymentMethod
  return paymentLabel[String(method || '').toUpperCase()] || method || 'Por confirmar'
}

function paymentState(order: PortalOrder) {
  if (order.paymentStatus === 'CONFIRMED') return { label: 'Pago validado', tone: 'emerald' }
  if (order.paymentStatus === 'REJECTED') return { label: 'Comprobante rechazado', tone: 'rose' }
  if (order.paymentStatus === 'PENDING_REVIEW') return { label: 'Pago por validar', tone: 'amber' }
  if (order.paymentStatus === 'DRIVER_CASH_PENDING') return { label: 'Efectivo por liquidar', tone: 'amber' }
  return { label: 'Cobro pendiente', tone: 'slate' }
}

function StatusPill({ order }: { order: PortalOrder }) {
  const state = paymentState(order)
  const tones: Record<string, string> = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    slate: 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
  }
  return <Badge className={cn('border text-[10px] font-black', tones[state.tone])}>{state.label}</Badge>
}

function OrderItems({ order }: { order: PortalOrder }) {
  const items = groupOrderItems((order.items || []).map((item) => ({
    ...item,
    menuItem: item.menuItem || undefined,
  })))
  if (!items.length) return null
  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]"><ClipboardList className="h-3.5 w-3.5" /> Pedido</p>
      <div className="space-y-1.5">
        {items.map((item: any, index: number) => {
          const note = cleanNotes(item.notes, item.menuItem?.name)
          return (
            <div key={`${item.id}-${index}`} className="text-xs">
              <p className="font-bold text-[var(--text-primary)]"><span className="text-[var(--accent)]">{item.quantity}×</span> {item.menuItem?.name || 'Producto'}</p>
              {note && <p className="mt-0.5 border-l-2 border-amber-400 pl-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">{note}</p>}
              {item.additions?.length > 0 && <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">+ {item.additions.map((addition: any) => `${addition.quantity}× ${addition.menuItem?.name || 'Adición'}`).join(' · ')}</p>}
            </div>
          )
        })}
      </div>
      {order.notes && <p className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-secondary)]"><strong>Nota:</strong> {cleanNotes(order.notes)}</p>}
    </div>
  )
}

export default function DriverPortalPage() {
  const [data, setData] = useState<DriverPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE')
  const [targetOrder, setTargetOrder] = useState<PortalOrder | null>(null)
  const [dialogMode, setDialogMode] = useState<'COMPLETE' | 'PAYMENT' | 'PROOF'>('COMPLETE')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [cashAmount, setCashAmount] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const realtimeTimer = useRef<number | null>(null)
  const realtimeConnected = useRef(false)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const result = await api.get<DriverPortalData>('/delivery-drivers/me', { force: true, ttlMs: 0 })
      setData(result)
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar tus pedidos. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/delivery-driver`, {
      transports: ['websocket', 'polling'],
    })
    const refreshPortal = () => {
      if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current)
      realtimeTimer.current = window.setTimeout(() => { void load(true) }, 120)
    }
    const handleConnect = () => {
      realtimeConnected.current = true
      refreshPortal()
    }
    const handleDisconnect = () => {
      realtimeConnected.current = false
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load(true)
    }

    // El evento no transporta pedidos: solo avisa a esta cuenta para volver a
    // consultar su endpoint privado. El intervalo consulta únicamente si el
    // socket está caído; al volver a la pestaña se reconcilia una sola vez.
    socket.on('driverPortalUpdated', refreshPortal)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !realtimeConnected.current) void load(true)
    }, 60_000)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      realtimeConnected.current = false
      socket.disconnect()
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (realtimeTimer.current !== null) {
        window.clearTimeout(realtimeTimer.current)
        realtimeTimer.current = null
      }
    }
  }, [load])

  const openCompletion = (order: PortalOrder) => {
    setTargetOrder(order)
    setDialogMode('COMPLETE')
    setMethod(normalizeDriverPaymentMethod(order.paymentMethod))
    setReference(order.paymentReference || '')
    setCashAmount(order.cashAmount != null ? String(order.cashAmount) : '')
    setTransferAmount(order.transferAmount != null ? String(order.transferAmount) : '')
    setProof(null)
  }

  const openProofUpload = (order: PortalOrder) => {
    setTargetOrder(order)
    setDialogMode('PROOF')
    const currentMethod = normalizeDriverPaymentMethod(order.paymentMethod)
    setMethod(isTransferMethod(currentMethod) ? currentMethod : 'TRANSFER')
    setReference(order.paymentReference || '')
    setCashAmount(order.cashAmount != null ? String(order.cashAmount) : '')
    setTransferAmount(order.transferAmount != null ? String(order.transferAmount) : '')
    setProof(null)
  }

  const openPaymentCorrection = (order: PortalOrder) => {
    setTargetOrder(order)
    setDialogMode('PAYMENT')
    setMethod(normalizeDriverPaymentMethod(order.paymentMethod))
    setReference(order.paymentReference || '')
    setCashAmount(order.cashAmount != null ? String(order.cashAmount) : '')
    setTransferAmount(order.transferAmount != null ? String(order.transferAmount) : '')
    setProof(null)
  }

  const closeDialog = () => {
    if (saving) return
    setTargetOrder(null)
    setProof(null)
    setCashAmount('')
    setTransferAmount('')
  }

  const submitCollection = async () => {
    if (!targetOrder) return
    if (dialogMode === 'PROOF' && !proof) {
      alerts.warning('Foto requerida', 'Selecciona la foto del comprobante para subirla al pedido.')
      return
    }
    if (proof && proof.size > 8 * 1024 * 1024) {
      alerts.warning('Foto muy pesada', 'El comprobante puede pesar máximo 8 MB. Toma una foto más liviana o comprímela antes de subirla.')
      return
    }
    const total = Number(targetOrder.total || 0)
    const cash = Number(cashAmount)
    const transfer = Number(transferAmount)
    if (method === 'MIXED' && (!Number.isFinite(cash) || !Number.isFinite(transfer) || cash <= 0 || transfer <= 0 || Math.abs((cash + transfer) - total) > 1)) {
      alerts.warning('Distribución inválida', `El efectivo y la transferencia deben ser mayores que cero y sumar ${formatCurrency(total)}.`)
      return
    }
    setSaving(true)
    try {
      if (dialogMode === 'PAYMENT') {
        await api.put(`/delivery-drivers/me/orders/${targetOrder.id}/payment`, {
          method,
          reference: reference.trim() || undefined,
          ...(method === 'MIXED' ? { cashAmount: cash, transferAmount: transfer } : {}),
        })
      } else {
        const form = new FormData()
        form.append('method', method)
        if (reference.trim()) form.append('reference', reference.trim())
        if (method === 'MIXED') {
          form.append('cashAmount', String(cash))
          form.append('transferAmount', String(transfer))
        }
        if (proof) form.append('proof', proof)
        const endpoint = dialogMode === 'COMPLETE'
          ? `/delivery-drivers/me/orders/${targetOrder.id}/complete`
          : `/delivery-drivers/me/orders/${targetOrder.id}/proof`
        await api.post(endpoint, form)
      }
      alerts.success(
        dialogMode === 'COMPLETE' ? 'Entrega registrada' : dialogMode === 'PAYMENT' ? 'Método de pago corregido' : 'Comprobante adjuntado',
        dialogMode === 'COMPLETE'
          ? (method === 'MIXED' ? 'El efectivo quedó pendiente de liquidación y la transferencia pendiente de validación de caja.' : isTransferMethod(method) ? 'El pago quedó pendiente de validación de caja.' : 'El efectivo quedó pendiente de liquidación en caja.')
          : dialogMode === 'PAYMENT'
            ? 'El cambio ya se refleja en tu historial y en administración.'
            : 'Caja ya puede revisar el comprobante.'
      )
      setTargetOrder(null)
      setProof(null)
      setCashAmount('')
      setTransferAmount('')
      await load(true)
      setTab('HISTORY')
    } catch (err: any) {
      alerts.error('No se pudo guardar', err?.message || 'Intenta nuevamente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" /></div>
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-rose-500" />
        <p className="font-black text-[var(--text-primary)]">No se pudo abrir Mis entregas</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{error}</p>
        <Button onClick={() => void load()} className="mt-4">Reintentar</Button>
      </div>
    )
  }

  const activeOrders = data?.activeOrders || []
  const history = data?.history || []
  const settlements = data?.settlements || []

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-8">
      <section className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/12 text-[var(--accent)]"><Bike className="h-6 w-6" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-black text-[var(--text-primary)]">Mis entregas</h1><Badge className="border border-emerald-500/25 bg-emerald-500/10 text-[10px] font-black text-emerald-700 dark:text-emerald-300">EN VIVO</Badge></div>
              <p className="truncate text-sm text-[var(--text-secondary)]">{data?.driver.name} · {data?.driver.phone}</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-1.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Actualización automática
          </span>
        </div>
        {data?.currentShift ? (
          <div className="border-t border-[var(--border-subtle)] bg-emerald-500/[0.06] px-5 py-3 text-xs text-emerald-800 dark:text-emerald-200">
            <span className="font-black">Turno activo:</span> {data.currentShift.registerName} · abierto {formatDate(data.currentShift.startedAt)}
          </div>
        ) : (
          <div className="flex items-start gap-2 border-t border-amber-500/20 bg-amber-500/10 px-5 py-3 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>No hay Caja Domicilios abierta.</strong> Puedes ver pedidos asignados, pero caja debe abrir el turno antes de registrar un cobro.</span></div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: 'En curso', value: data?.summary.activeOrders || 0, icon: Bike, tone: 'text-[var(--accent)] bg-[var(--accent)]/10' },
          { label: 'Entregados del turno', value: data?.summary.deliveredThisShift || 0, icon: PackageCheck, tone: 'text-emerald-600 bg-emerald-500/10' },
          { label: 'Efectivo por liquidar', value: formatCurrency(data?.summary.pendingCash || 0), icon: Banknote, tone: 'text-amber-600 bg-amber-500/10' },
          { label: 'Transferencias por validar', value: data?.summary.pendingTransfers || 0, icon: Smartphone, tone: 'text-blue-600 bg-blue-500/10' },
        ].map(stat => (
          <Card key={stat.label} className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xs"><CardContent className="flex min-h-[82px] items-center gap-2.5 p-3 sm:p-4"><span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10', stat.tone)}><stat.icon className="h-4.5 w-4.5 sm:h-5 sm:w-5" /></span><div className="min-w-0"><p className="text-[9px] font-black uppercase leading-tight tracking-wide text-[var(--text-muted)] sm:text-[10px]">{stat.label}</p><p className="mt-1 truncate text-base font-black text-[var(--text-primary)] sm:text-lg">{stat.value}</p></div></CardContent></Card>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1.5 shadow-xs">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={() => setTab('ACTIVE')} className={cn('flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition', tab === 'ACTIVE' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}><Bike className="h-4 w-4" /> En curso <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', tab === 'ACTIVE' ? 'bg-white/20' : 'bg-[var(--bg-elevated)]')}>{activeOrders.length}</span></button>
          <button type="button" onClick={() => setTab('HISTORY')} className={cn('flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition', tab === 'HISTORY' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}><History className="h-4 w-4" /> Turno actual <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', tab === 'HISTORY' ? 'bg-white/20' : 'bg-[var(--bg-elevated)]')}>{history.length}</span></button>
        </div>
      </section>

      {tab === 'ACTIVE' ? (
        <section className="space-y-3">
          {activeOrders.map(order => {
            const canComplete = order.status === 'IN_ROUTE'
            return (
              <Card key={order.id} className="overflow-hidden border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Badge className="bg-blue-600 text-[10px] font-black text-white">#{order.orderNumber}</Badge><Badge className="border border-blue-500/30 bg-blue-500/10 text-[10px] font-black text-blue-700 dark:text-blue-300">{order.status === 'IN_ROUTE' ? 'EN RUTA' : 'EN PREPARACIÓN'}</Badge></div>
                        <h2 className="mt-2 text-lg font-black text-[var(--text-primary)]">{order.customerName || 'Cliente'}</h2>
                        <a href={`tel:${order.customerPhone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--accent)] hover:underline"><Phone className="h-3.5 w-3.5" /> {order.customerPhone}</a>
                      </div>
                      <div className="sm:text-right"><p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Total a cobrar</p><p className="text-2xl font-black text-[var(--accent)]">{formatCurrency(order.total)}</p><p className="mt-1 text-xs font-bold text-[var(--text-secondary)]">Indicado: {originalPaymentLabel(order)}</p></div>
                    </div>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3"><p className="flex items-start gap-2 text-sm font-bold text-[var(--text-primary)]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /><span>{order.customerAddress || 'Dirección pendiente'}{order.zone?.name && <span className="ml-1 text-[var(--text-secondary)]">· {order.zone.name}</span>}</span></p>{order.addressReference && <p className="ml-6 mt-1 text-xs italic text-[var(--text-secondary)]">Ref: {order.addressReference}</p>}</div>
                    <OrderItems order={order} />
                    {canComplete ? <Button onClick={() => openCompletion(order)} disabled={!data?.currentShift} className="h-12 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"><CheckCircle2 className="mr-2 h-5 w-5" /> Entregar pedido</Button> : <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-200"><Clock className="h-4 w-4" /> Espera a que el pedido salga a ruta para registrar la entrega.</div>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {!activeOrders.length && <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-panel)] p-10 text-center"><Bike className="mx-auto h-9 w-9 text-[var(--text-muted)]" /><h2 className="mt-3 text-lg font-black text-[var(--text-primary)]">No tienes pedidos asignados</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Cuando te asignen un domicilio, aparecerá aquí.</p></div>}
        </section>
      ) : (
        <section className="space-y-3">
          {!data?.currentShift && <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-panel)] p-8 text-center"><Wallet className="mx-auto h-8 w-8 text-[var(--text-muted)]" /><h2 className="mt-2 font-black text-[var(--text-primary)]">El historial empieza con la caja del día</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Al abrir Caja Domicilios verás aquí las entregas y liquidaciones de ese turno.</p></div>}
          {data?.currentShift && (
            <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xs">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 font-black text-[var(--text-primary)]"><Wallet className="h-4 w-4 text-emerald-600" /> Liquidaciones del turno</h2>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">Efectivo recibido por caja en este turno.</p>
                  </div>
                  <Badge className="w-fit border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[10px] font-black text-[var(--text-secondary)]">{settlements.length} registrada{settlements.length === 1 ? '' : 's'}</Badge>
                </div>

                {settlements.length ? (
                  <div className="mt-4 space-y-2">
                    {settlements.map(settlement => {
                      const difference = Number(settlement.difference || 0)
                      const differenceLabel = difference === 0
                        ? 'Sin diferencia'
                        : `${difference > 0 ? '+' : '−'}${formatCurrency(Math.abs(difference))}`
                      return (
                        <div key={settlement.id} className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-[var(--text-primary)]">Liquidación registrada</p>
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--text-secondary)]"><Clock className="h-3.5 w-3.5" /> {formatDate(settlement.createdAt)}</p>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-right sm:min-w-[330px]">
                            <div><p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Esperado</p><p className="mt-0.5 text-xs font-black text-[var(--text-primary)]">{formatCurrency(settlement.expectedCash)}</p></div>
                            <div><p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Recibido</p><p className="mt-0.5 text-xs font-black text-emerald-700 dark:text-emerald-300">{formatCurrency(settlement.receivedCash)}</p></div>
                            <div><p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Diferencia</p><p className={cn('mt-0.5 text-xs font-black', difference === 0 ? 'text-[var(--text-secondary)]' : difference > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>{differenceLabel}</p></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-dashed border-[var(--border-default)] px-3 py-3 text-xs text-[var(--text-secondary)]">Aún no hay liquidaciones registradas por caja en este turno.</p>
                )}
              </CardContent>
            </Card>
          )}
          {history.map(order => {
            const proofs = order.transferProofs || []
            const lastProof = proofs[0]
            const canCorrectPayment = !order.driverSettlementId && order.paymentStatus !== 'CONFIRMED'
            const canUpload = canCorrectPayment && isTransferMethod(order.paymentMethod)
            return (
              <Card key={order.id} className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xs"><CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge className="bg-[var(--bg-elevated)] text-[10px] font-black text-[var(--text-primary)]">Pedido #{order.orderNumber}</Badge><StatusPill order={order} /></div><p className="mt-2 font-black text-[var(--text-primary)]">{order.customerName}</p><p className="mt-1 flex items-center gap-1 text-xs text-[var(--text-secondary)]"><Clock className="h-3.5 w-3.5" /> Entregado {formatDate(order.updatedAt)}</p></div><div className="sm:text-right"><p className="text-lg font-black text-[var(--accent)]">{formatCurrency(order.total)}</p><p className="text-xs font-bold text-[var(--text-primary)]">Recibido: {receivedPaymentLabel(order)}</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Original: {originalPaymentLabel(order)}</p></div></div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 font-bold text-[var(--text-secondary)]"><MapPin className="h-3.5 w-3.5 text-rose-500" /> {order.customerAddress}</span>{lastProof ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-2.5 py-1 font-bold text-blue-700 dark:text-blue-300"><Camera className="h-3.5 w-3.5" /> {proofs.length} comprobante{proofs.length !== 1 ? 's' : ''}</span> : isTransferMethod(order.paymentMethod) ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Sin foto</span> : null}</div>
                {lastProof?.rejectionReason && <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200"><strong>Caja indicó:</strong> {lastProof.rejectionReason}</div>}
                {canCorrectPayment && <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3"><Button variant="outline" onClick={() => openPaymentCorrection(order)} className="h-9 rounded-xl text-xs font-black"><Wallet className="mr-1.5 h-4 w-4" /> Corregir método de pago</Button>{canUpload && <Button variant="outline" onClick={() => openProofUpload(order)} className="h-9 rounded-xl border-blue-500/30 text-xs font-black text-blue-700 hover:bg-blue-500/10 dark:text-blue-300"><Upload className="mr-1.5 h-4 w-4" /> {lastProof ? 'Subir otra foto' : 'Adjuntar comprobante'}</Button>}</div>}
              </CardContent></Card>
            )
          })}
          {data?.currentShift && !history.length && <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-panel)] p-10 text-center"><History className="mx-auto h-9 w-9 text-[var(--text-muted)]" /><h2 className="mt-3 text-lg font-black text-[var(--text-primary)]">Aún no hay entregas en este turno</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Las entregas que cierres hoy aparecerán aquí.</p></div>}
        </section>
      )}

      <Dialog open={Boolean(targetOrder)} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-3xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0">
          <div className="border-b border-[var(--border-subtle)] p-5"><DialogHeader><DialogTitle className="flex items-center gap-2 text-lg font-black"><Wallet className="h-5 w-5 text-[var(--accent)]" />{dialogMode === 'COMPLETE' ? `Entregar pedido #${targetOrder?.orderNumber}` : dialogMode === 'PAYMENT' ? `Corregir pago #${targetOrder?.orderNumber}` : `Adjuntar comprobante #${targetOrder?.orderNumber}`}</DialogTitle><DialogDescription>{dialogMode === 'COMPLETE' ? 'Elige cómo pagó realmente el cliente y confirma la entrega. La foto es opcional.' : dialogMode === 'PAYMENT' ? 'Corrige cómo pagó el cliente. El método original seguirá visible para control.' : 'Sube la foto cuando la tengas. El pedido puede haberse entregado sin comprobante.'}</DialogDescription></DialogHeader></div>
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between rounded-2xl bg-[var(--bg-elevated)] p-3"><div><p className="text-xs font-bold text-[var(--text-secondary)]">Total del pedido</p><p className="text-xl font-black text-[var(--accent)]">{formatCurrency(targetOrder?.total || 0)}</p><p className="mt-1 text-[11px] font-semibold text-[var(--text-muted)]">Método original: {originalPaymentLabel(targetOrder)}</p></div><Badge className="bg-[var(--bg-panel)] text-xs font-black text-[var(--text-primary)]">#{targetOrder?.orderNumber}</Badge></div>
            <div className="space-y-1.5"><Label className="text-xs font-black text-[var(--text-secondary)]">Método de pago recibido</Label><select value={method} onChange={event => { const next = event.target.value as PaymentMethod; setMethod(next); if (next === 'CASH') setProof(null); if (next === 'MIXED' && targetOrder) { const half = Math.round(Number(targetOrder.total || 0) / 2); if (!cashAmount) setCashAmount(String(half)); if (!transferAmount) setTransferAmount(String(Number(targetOrder.total || 0) - half)) } }} className="flex h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]">{dialogMode !== 'PROOF' && <option value="CASH">Efectivo</option>}{paymentOptions.filter(option => option.value !== 'CASH').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            {method === 'MIXED' && (
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] p-3.5">
                <p className="mb-2 text-xs font-black text-violet-800 dark:text-violet-200">Distribuye el total entre efectivo y transferencia</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label className="text-[11px] font-black text-[var(--text-secondary)]">Efectivo</Label><Input type="number" min="1" step="1" value={cashAmount} onChange={event => setCashAmount(event.target.value)} placeholder="0" className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5"><Label className="text-[11px] font-black text-[var(--text-secondary)]">Transferencia</Label><Input type="number" min="1" step="1" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} placeholder="0" className="h-10 rounded-xl" /></div>
                </div>
                <p className="mt-2 text-[11px] font-semibold text-[var(--text-secondary)]">Total distribuido: {formatCurrency((Number(cashAmount) || 0) + (Number(transferAmount) || 0))} · Pedido: {formatCurrency(targetOrder?.total || 0)}</p>
              </div>
            )}
            <div className="space-y-1.5"><Label className="text-xs font-black text-[var(--text-secondary)]">Referencia de pago <span className="font-medium text-[var(--text-muted)]">(opcional)</span></Label><Input value={reference} onChange={event => setReference(event.target.value)} maxLength={300} placeholder="Ej: comprobante, últimos dígitos" className="h-11 rounded-xl" /></div>
            {isTransferMethod(method) && dialogMode !== 'PAYMENT' && <div className="rounded-2xl border border-blue-500/25 bg-blue-500/[0.06] p-3.5"><div className="flex gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><p className="text-xs font-black text-blue-800 dark:text-blue-200">Foto del comprobante {dialogMode === 'PROOF' ? '' : '(opcional)'}</p><p className="mt-0.5 text-[11px] leading-4 text-blue-700/80 dark:text-blue-200/75">Puedes entregar primero y subirla desde el historial cuando la tengas. Máximo 8 MB.</p></div></div><label className="mt-3 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-500/40 bg-[var(--bg-panel)] px-3 text-xs font-black text-blue-700 transition hover:bg-blue-500/10 dark:text-blue-300"><Upload className="h-4 w-4" />{proof ? proof.name : 'Seleccionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={event => setProof(event.target.files?.[0] || null)} /></label>{proof && <button type="button" onClick={() => setProof(null)} className="mt-2 text-[11px] font-bold text-rose-600 hover:underline">Quitar foto</button>}</div>}
            {dialogMode === 'PAYMENT' && isTransferMethod(method) && <p className="rounded-xl bg-blue-500/[0.08] px-3 py-2 text-xs text-blue-700 dark:text-blue-200">La foto sigue siendo opcional. Después de guardar podrás adjuntarla desde este historial.</p>}
            <Button onClick={() => void submitCollection()} disabled={saving || !data?.currentShift} className="h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-black text-white"><>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : dialogMode === 'COMPLETE' ? <CheckCircle2 className="mr-2 h-4 w-4" /> : dialogMode === 'PAYMENT' ? <Wallet className="mr-2 h-4 w-4" /> : <Upload className="mr-2 h-4 w-4" />}{dialogMode === 'COMPLETE' ? 'Confirmar entrega' : dialogMode === 'PAYMENT' ? 'Guardar método recibido' : 'Subir comprobante'}</></Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

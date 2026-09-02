import { useEffect, useMemo, useState } from 'react'
import { io } from '@/lib/socket'
import { Banknote, CheckCircle2, Eye, Image, RefreshCw, Search, Wallet, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

const statusFilters = [
  { value: 'PENDING_REVIEW', label: 'Pendientes' },
  { value: 'CONFIRMED', label: 'Pagados' },
  { value: 'REJECTED', label: 'Rechazados' },
  { value: 'ALL', label: 'Todos' },
]

const methodFilters = [
  { value: 'ALL', label: 'Todos' },
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencias' },
]

const methodLabels: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia',
  DAVIPLATA: 'Daviplata',
  MIXED: 'Mixto',
  CREDIT: 'Credito',
  CORTESIA: 'Cortesia',
}

export default function PaymentValidationPage() {
  const { user, hasPermission } = useAuth()
  const [payments, setPayments] = useState<any[]>([])
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [method, setMethod] = useState('ALL')
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const load = () => api.get<any[]>(`/payment-validation?status=${status}&method=${method}`).then(setPayments).catch(console.error)
  useEffect(() => { load() }, [status, method])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })
    socket.on('paymentSubmitted', load)
    socket.on('paymentValidated', load)
    socket.on('paymentRejected', load)
    return () => { socket.disconnect() }
  }, [user?.id, user?.name, user?.role, status, method])

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return payments
    return payments.filter(payment => {
      const haystack = [
        payment.order?.diningTable?.label,
        payment.order?.orderNumber,
        payment.order?.waiter?.name,
        methodLabels[payment.method] || payment.method,
        payment.paymentReference,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [payments, search])

  const openProof = async (proofId: string) => {
    try {
      const next = URL.createObjectURL(await api.getBlob(`/payment-validation/proofs/${proofId}/image`))
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      setImageUrl(next)
    } catch (err: any) {
      alerts.error('Comprobante no disponible', err.message)
    }
  }

  const review = async (payment: any, action: 'validate' | 'reject') => {
    if (action === 'validate' && payment.method === 'CASH' && !hasPermission('payment_validation.cash')) {
      alerts.error('Sin permiso', 'No tienes permiso para validar pagos en efectivo.')
      return
    }
    if (action === 'validate' && payment.method !== 'CASH' && !hasPermission('payment_validation.transfer')) {
      alerts.error('Sin permiso', 'No tienes permiso para validar transferencias.')
      return
    }
    if (action === 'reject' && !hasPermission('payment_validation.reject')) {
      alerts.error('Sin permiso', 'No tienes permiso para rechazar pagos.')
      return
    }
    try {
      await api.put(`/payment-validation/${payment.id}/${action}`, action === 'reject' ? { reason } : {})
      alerts.success(action === 'validate' ? 'Pago validado' : 'Pago rechazado', payment.order?.diningTable?.label || 'Mesa actualizada')
      setReason('')
      load()
    } catch (err: any) {
      alerts.error('No se pudo actualizar', err.message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black"><Wallet className="h-7 w-7 text-[var(--accent)]" />Validacion de pagos</h1>
          <p className="text-sm text-[var(--text-secondary)]">Efectivo y transferencias de mesas con comprobante.</p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map(s => <Button key={s.value} variant={status === s.value ? 'default' : 'outline'} onClick={() => setStatus(s.value)}>{s.label}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {methodFilters.map(m => <Button key={m.value} variant={method === m.value ? 'default' : 'outline'} onClick={() => setMethod(m.value)}>{m.label}</Button>)}
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="Buscar por mesa, pedido, mesera o metodo..." />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filteredPayments.map(payment => {
          const proof = payment.transferProofs?.[0]
          const isCash = payment.method === 'CASH'
          return (
            <article key={payment.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black">{payment.order?.diningTable?.label || 'Mesa'} - Pedido #{payment.order?.orderNumber}</p>
                  <p className="text-xs text-[var(--text-secondary)]">Mesera: {payment.order?.waiter?.name || 'Sin asignar'}</p>
                </div>
                <b className="text-xl text-[var(--accent)]">{formatCurrency(payment.amount || payment.order?.total || 0)}</b>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className={isCash ? 'rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700' : 'rounded-full bg-blue-500/10 px-2 py-1 text-blue-700'}>
                  {isCash ? <Banknote className="mr-1 inline h-3.5 w-3.5" /> : <Image className="mr-1 inline h-3.5 w-3.5" />}
                  {methodLabels[payment.method] || payment.method}
                </span>
                <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-secondary)]">{statusFilters.find(s => s.value === payment.status)?.label || payment.status}</span>
                {!isCash && <span className={proof ? 'rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700' : 'rounded-full bg-rose-500/10 px-2 py-1 text-rose-700'}>{proof ? 'Foto recibida' : 'Sin foto'}</span>}
              </div>

              {proof && <Button variant="outline" className="mt-3 gap-2" onClick={() => openProof(proof.id)}><Eye className="h-4 w-4" />Ver comprobante</Button>}

              {payment.status === 'PENDING_REVIEW' && (
                <div className="mt-4 space-y-2">
                  <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo si se rechaza..." />
                  <div className="flex gap-2">
                    <Button onClick={() => review(payment, 'validate')} className="flex-1 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" />Validar</Button>
                    <Button onClick={() => review(payment, 'reject')} variant="outline" className="flex-1 gap-2 text-rose-600"><XCircle className="h-4 w-4" />Rechazar</Button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        {filteredPayments.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-muted)]">No hay pagos en esta bandeja.</p>}
      </div>

      <Dialog open={!!imageUrl} onOpenChange={v => !v && setImageUrl(null)}>
        <DialogContent className="max-w-4xl bg-black p-2">
          {imageUrl && <img src={imageUrl} alt="Comprobante" className="max-h-[82vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

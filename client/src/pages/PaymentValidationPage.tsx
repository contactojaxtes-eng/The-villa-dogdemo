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
import { ProtectedImage } from '@/components/ProtectedImage'

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
  const [reasons, setReasons] = useState<Record<string, string>>({})
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

  const openProof = async (proofId: string, directBase64?: string) => {
    if (directBase64) {
      setImageUrl(directBase64)
      return
    }
    try {
      const next = URL.createObjectURL(await api.getBlob(`/payment-validation/proofs/${proofId}/image`))
      if (imageUrl && !imageUrl.startsWith('data:')) URL.revokeObjectURL(imageUrl)
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
      const reasonText = reasons[payment.id] || ''
      await api.put(`/payment-validation/${payment.id}/${action}`, action === 'reject' ? { reason: reasonText } : {})
      alerts.success(action === 'validate' ? 'Pago validado' : 'Pago rechazado', payment.order?.diningTable?.label || 'Mesa actualizada')
      setReasons(prev => {
        const next = { ...prev }
        delete next[payment.id]
        return next
      })
      load()
    } catch (err: any) {
      alerts.error('No se pudo actualizar', err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black"><Wallet className="h-7 w-7 text-[var(--accent)]" />Validacion de pagos</h1>
          <p className="text-sm text-[var(--text-secondary)]">Efectivo y transferencias de mesas con vista previa rápida de comprobante.</p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Actualizar</Button>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map(s => <Button key={s.value} size="sm" variant={status === s.value ? 'default' : 'outline'} onClick={() => setStatus(s.value)}>{s.label}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {methodFilters.map(m => <Button key={m.value} size="sm" variant={method === m.value ? 'default' : 'outline'} onClick={() => setMethod(m.value)}>{m.label}</Button>)}
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-10" placeholder="Buscar por mesa, pedido, mesera o metodo..." />
      </div>

      {/* Grid de tarjetas horizontales compactas */}
      <div className="grid gap-3.5 md:grid-cols-2">
        {filteredPayments.map(payment => {
          const proof = payment.transferProofs?.[0]
          const isCash = payment.method === 'CASH'
          return (
            <article key={payment.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-sm transition-all hover:border-[var(--accent)] hover:shadow-md flex flex-col sm:flex-row gap-3.5 items-stretch">
              {/* Miniatura vertical a la izquierda */}
              {proof ? (
                <div 
                  className="group relative w-full sm:w-28 md:w-32 h-48 sm:h-auto min-h-[145px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col items-center justify-center transition-all hover:border-[var(--accent)]"
                  onClick={() => openProof(proof.id, proof.fileBase64)}
                  title="Toca para ver comprobante en grande"
                >
                  {proof.fileBase64 ? (
                    <img src={proof.fileBase64} alt="Comprobante" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                  ) : (
                    <ProtectedImage endpoint={`/payment-validation/proofs/${proof.id}/image`} alt="Comprobante" className="h-full w-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1 text-center">
                    <span className="rounded-lg bg-black/80 px-2 py-1 text-[11px] font-bold text-white flex items-center gap-1 backdrop-blur-sm shadow">
                      <Eye className="h-3.5 w-3.5 text-[var(--accent)]" /> Ver grande
                    </span>
                  </div>
                  <div className="absolute bottom-1 right-1 sm:hidden">
                    <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
                      <Eye className="h-3 w-3" /> Ver
                    </span>
                  </div>
                </div>
              ) : isCash ? (
                <div className="hidden sm:flex w-28 md:w-32 h-auto min-h-[145px] shrink-0 rounded-xl border border-emerald-500/20 bg-emerald-500/5 items-center justify-center flex-col gap-1.5 text-emerald-600">
                  <Banknote className="h-7 w-7" />
                  <span className="text-xs font-black">Efectivo</span>
                </div>
              ) : null}

              {/* Información y botones a la derecha */}
              <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-black truncate text-[var(--text-primary)]">
                        {payment.order?.diningTable?.label || 'Mesa'} - Pedido #{payment.order?.orderNumber}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-secondary)] mt-0.5">
                        <span>Mesera: <strong className="text-[var(--text-primary)]">{payment.order?.waiter?.name || 'Sin asignar'}</strong></span>
                        {proof?.createdAt && (
                          <>
                            <span>•</span>
                            <span className="text-[var(--text-muted)]">Subido: {new Date(proof.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <b className="text-lg font-black text-[var(--accent)] block">
                        {formatCurrency(payment.amount || payment.order?.total || 0)}
                      </b>
                    </div>
                  </div>

                  {/* Badges de estado */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className={isCash ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700' : 'rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-700'}>
                      {isCash ? <Banknote className="mr-1 inline h-3 w-3" /> : <Image className="mr-1 inline h-3 w-3" />}
                      {methodLabels[payment.method] || payment.method}
                    </span>
                    <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-secondary)]">
                      {statusFilters.find(s => s.value === payment.status)?.label || payment.status}
                    </span>
                    {!isCash && (
                      <span className={proof ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700' : 'rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700'}>
                        {proof ? 'Foto recibida' : 'Sin foto'}
                      </span>
                    )}
                    {proof && (
                      <button 
                        type="button" 
                        onClick={() => openProof(proof.id, proof.fileBase64)}
                        className="text-[11px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1 ml-1"
                      >
                        <Eye className="h-3 w-3" /> Ver comprobante
                      </button>
                    )}
                  </div>
                </div>

                {/* Acciones de revisión si está pendiente */}
                {payment.status === 'PENDING_REVIEW' && (
                  <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)] mt-1">
                    <Input 
                      value={reasons[payment.id] || ''} 
                      onChange={e => setReasons(prev => ({ ...prev, [payment.id]: e.target.value }))} 
                      placeholder="Motivo si se rechaza..." 
                      className="h-8 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => review(payment, 'validate')} 
                        size="sm" 
                        className="flex-1 h-8.5 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Validar Pago
                      </Button>
                      <Button 
                        onClick={() => review(payment, 'reject')} 
                        size="sm" 
                        variant="outline" 
                        className="flex-1 h-8.5 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 font-bold text-xs"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Rechazar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          )
        })}
        {filteredPayments.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-muted)]">
            No hay pagos en esta bandeja.
          </p>
        )}
      </div>

      {/* Modal Ver en grande ajustado a la foto sin espacios negros gigantes */}
      <Dialog open={!!imageUrl} onOpenChange={v => !v && setImageUrl(null)}>
        <DialogContent className="max-w-md w-[92vw] bg-[var(--bg-panel)] p-3.5 border border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl shadow-2xl flex flex-col items-center">
          <div className="flex w-full justify-between items-center pb-2 border-b border-[var(--border-subtle)]">
            <span className="text-sm font-black flex items-center gap-2 text-[var(--text-primary)]">
              <Image className="h-4 w-4 text-[var(--accent)]" /> Comprobante de Transferencia
            </span>
            <Button 
              size="sm" 
              variant="ghost" 
              className="h-8 px-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" 
              onClick={() => setImageUrl(null)}
            >
              ✕ Cerrar
            </Button>
          </div>
          <div className="max-h-[78vh] w-full flex items-center justify-center overflow-auto rounded-xl bg-[var(--bg-elevated)] p-1.5 mt-2">
            {imageUrl && (
              <img 
                src={imageUrl} 
                alt="Comprobante completo" 
                className="max-h-[74vh] w-auto max-w-full object-contain rounded-lg shadow-sm" 
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

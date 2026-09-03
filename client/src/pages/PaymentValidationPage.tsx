import { useCallback, useEffect, useMemo, useState } from 'react'
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
  CREDIT: 'Crédito',
  CORTESIA: 'Cortesía',
}

export default function PaymentValidationPage() {
  const { user, hasPermission } = useAuth()
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [method, setMethod] = useState('ALL')
  const [search, setSearch] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // Cargar todos los pagos para filtrado reactivo e instantáneo (0ms) en memoria
  const load = useCallback(() => {
    setLoading(true)
    api.get<any[]>('/payment-validation?status=ALL&method=ALL')
      .then(setPayments)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

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
  }, [user?.id, user?.name, user?.role, load])

  useEffect(() => () => { if (imageUrl && !imageUrl.startsWith('data:')) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  // Filtrado instantáneo en cliente (0ms)
  const filteredPayments = useMemo(() => {
    let list = payments
    if (status !== 'ALL') {
      list = list.filter(p => p.status === status)
    }
    if (method === 'CASH') {
      list = list.filter(p => p.method === 'CASH')
    } else if (method === 'TRANSFER') {
      list = list.filter(p => p.method !== 'CASH')
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(payment => {
        const haystack = [
          payment.order?.diningTable?.label,
          payment.order?.customerName,
          payment.order?.orderNumber,
          payment.order?.waiter?.name,
          methodLabels[payment.method] || payment.method,
          payment.paymentReference,
        ].filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(q)
      })
    }
    return list
  }, [payments, status, method, search])

  const openProof = async (proofId: string, directBase64?: string) => {
    if (directBase64) {
      setImageUrl(directBase64)
      return
    }
    try {
      const next = URL.createObjectURL(await api.getBlob(`/payment-validation/proofs/${proofId}/image`))
      setImageUrl(next)
    } catch (err: any) {
      alerts.error('Comprobante no disponible', err.message)
    }
  }

  const review = async (payment: any, action: 'validate' | 'reject') => {
    const isPrivileged = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'CASHIER'
    if (action === 'validate' && payment.method === 'CASH' && !hasPermission('payment_validation.cash') && !isPrivileged) {
      alerts.error('Sin permiso', 'No tienes permiso para validar pagos en efectivo.')
      return
    }
    if (action === 'validate' && payment.method !== 'CASH' && !hasPermission('payment_validation.transfer') && !isPrivileged) {
      alerts.error('Sin permiso', 'No tienes permiso para validar transferencias.')
      return
    }
    if (action === 'reject' && !hasPermission('payment_validation.reject') && !isPrivileged) {
      alerts.error('Sin permiso', 'No tienes permiso para rechazar pagos.')
      return
    }
    try {
      const reasonText = reasons[payment.id] || ''
      await api.put(`/payment-validation/${payment.id}/${action}`, action === 'reject' ? { reason: reasonText } : {})
      alerts.success(action === 'validate' ? 'Pago validado' : 'Pago rechazado', payment.order?.diningTable?.label || payment.order?.customerName || 'Mesa actualizada')
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
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--text-primary)]">
            <Wallet className="h-7 w-7 text-[var(--accent)]" /> Validación de Pagos
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Comprobantes de mesas y cajas. Visualización compacta en un solo toque.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2 font-bold h-9">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </div>

      {/* Barra de Filtros Instantáneos */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between bg-[var(--bg-panel)] p-3 rounded-2xl border border-[var(--border-subtle)] shadow-xs">
        {/* Filtro de Estado */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-bold text-[var(--text-muted)] mr-1">Estado:</span>
          {statusFilters.map(s => (
            <Button
              key={s.value}
              size="sm"
              variant={status === s.value ? 'default' : 'ghost'}
              onClick={() => setStatus(s.value)}
              className={`h-8 text-xs font-bold ${status === s.value ? 'bg-[var(--accent)] text-white shadow-xs' : ''}`}
            >
              {s.label}
            </Button>
          ))}
        </div>

        {/* Filtro de Método (Efectivo vs Transferencia) */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-bold text-[var(--text-muted)] mr-1">Método:</span>
          {methodFilters.map(m => (
            <Button
              key={m.value}
              size="sm"
              variant={method === m.value ? 'default' : 'outline'}
              onClick={() => setMethod(m.value)}
              className={`h-8 text-xs font-bold ${method === m.value ? 'bg-[var(--text-primary)] text-white shadow-xs' : ''}`}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Buscador Rápido */}
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs rounded-xl bg-[var(--bg-panel)]"
          placeholder="Buscar por mesa, cliente, pedido, mesera..."
        />
      </div>

      {/* Lista de Pagos en Filas Horizontales Ultra-Compactas */}
      <div className="space-y-2.5">
        {filteredPayments.map(payment => {
          const proof = payment.transferProofs?.[0]
          const isCash = payment.method === 'CASH'
          const label = payment.order?.diningTable?.label || payment.order?.customerName || 'Mesa'

          return (
            <article
              key={payment.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs hover:border-[var(--accent)] transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
            >
              {/* Lado izquierdo: Miniatura compacta + Datos del pedido */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Miniatura si es transferencia */}
                {proof ? (
                  <div
                    className="group relative w-12 h-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center hover:border-[var(--accent)]"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openProof(proof.id, proof.fileBase64)
                    }}
                    title="Toca para ver comprobante en grande"
                  >
                    {proof.fileBase64 ? (
                      <img src={proof.fileBase64} alt="Comprobante" className="h-full w-full object-cover" />
                    ) : (
                      <ProtectedImage endpoint={`/payment-validation/proofs/${proof.id}/image`} alt="Comprobante" className="h-full w-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="h-4 w-4 text-white" />
                    </div>
                  </div>
                ) : isCash ? (
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--accent)] flex items-center justify-center" title="Pago en Efectivo">
                    <Banknote className="h-5 w-5" />
                  </div>
                ) : null}

                {/* Información */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-[var(--text-primary)] truncate">
                      {label} · Pedido #{payment.order?.orderNumber}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                      {methodLabels[payment.method] || payment.method}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                      {statusFilters.find(s => s.value === payment.status)?.label || payment.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mt-0.5 flex-wrap">
                    <span>Mesera: <strong>{payment.order?.waiter?.name || 'Sin asignar'}</strong></span>
                    {proof?.createdAt && (
                      <>
                        <span>•</span>
                        <span className="text-[var(--text-muted)]">
                          Subido: {new Date(proof.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    )}
                    {proof && (
                      <>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openProof(proof.id, proof.fileBase64)
                          }}
                          className="text-[var(--accent)] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" /> Ver comprobante
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Lado derecho: Monto + Acciones en una sola fila */}
              <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--border-subtle)]">
                <b className="text-base sm:text-lg font-black text-[var(--accent)] whitespace-nowrap">
                  {formatCurrency(payment.amount || payment.order?.total || 0)}
                </b>

                {payment.status === 'PENDING_REVIEW' && (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={reasons[payment.id] || ''}
                      onChange={e => setReasons(prev => ({ ...prev, [payment.id]: e.target.value }))}
                      placeholder="Motivo rechazo..."
                      className="h-8 text-xs w-28 sm:w-36 rounded-lg"
                    />
                    <Button
                      onClick={() => review(payment, 'validate')}
                      size="sm"
                      className="h-8 px-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold text-xs gap-1 shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Validar
                    </Button>
                    <Button
                      onClick={() => review(payment, 'reject')}
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-rose-600 border-rose-200 hover:bg-rose-50 font-bold text-xs"
                      title="Rechazar pago"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Rechazar
                    </Button>
                  </div>
                )}
              </div>
            </article>
          )
        })}

        {filteredPayments.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-muted)] bg-[var(--bg-panel)]">
            No hay pagos que coincidan con los filtros seleccionados.
          </div>
        )}
      </div>

      {/* Modal Ver en grande: Pantalla completa, sin bordes toscos y sin doble X */}
      <Dialog open={Boolean(imageUrl)} onOpenChange={(open) => { if (!open) setImageUrl(null) }}>
        <DialogContent className="max-w-fit w-auto max-h-[96vh] p-3 bg-[var(--bg-panel)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center [&>button.absolute]:hidden">
          <div className="flex w-full items-center justify-between pb-2 border-b border-[var(--border-subtle)] gap-6">
            <span className="text-xs font-black flex items-center gap-1.5 text-[var(--text-primary)]">
              <Image className="h-4 w-4 text-[var(--accent)]" /> Comprobante de Transferencia
            </span>
            <button
              type="button"
              className="rounded-xl px-2.5 py-1 text-xs font-bold bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-all cursor-pointer flex items-center gap-1 border border-[var(--border-subtle)]"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setImageUrl(null)
              }}
            >
              ✕ Cerrar
            </button>
          </div>
          <div className="max-h-[88vh] max-w-[94vw] sm:max-w-[85vw] flex items-center justify-center pt-2 overflow-auto">
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Comprobante completo"
                className="max-h-[84vh] w-auto max-w-full object-contain rounded-xl shadow-md block"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

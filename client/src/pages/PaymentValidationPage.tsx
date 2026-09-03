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

const validationTabs = [
  { value: 'PENDING_REVIEW', label: 'Pendientes' },
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencias' },
  { value: 'MIXED', label: 'Mixtos' },
  { value: 'CONFIRMED', label: 'Pagados' },
  { value: 'REJECTED', label: 'Rechazados' },
  { value: 'ALL', label: 'Todos' },
]

const methodLabels: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia',
  DAVIPLATA: 'Daviplata',
  MIXED: 'Pago Mixto',
  CREDIT: 'Crédito',
  CORTESIA: 'Cortesía',
}

const statusLabels: Record<string, string> = {
  PENDING_REVIEW: 'Pendiente',
  CONFIRMED: 'Pagado',
  REJECTED: 'Rechazado',
}

export default function PaymentValidationPage() {
  const { user, hasPermission } = useAuth()
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('PENDING_REVIEW')
  const [search, setSearch] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // Cargar todos los pagos para filtrado reactivo e instantáneo (0ms) en memoria
  const load = useCallback(() => {
    setLoading(true)
    api.get<any>('/payment-validation?status=ALL&method=ALL')
      .then(res => {
        const rows = Array.isArray(res) ? res : (res?.data || res?.items || [])
        setPayments(Array.isArray(rows) ? rows : [])
      })
      .catch(err => {
        console.error(err)
        setPayments([])
      })
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
  const safePayments = useMemo(() => Array.isArray(payments) ? payments : [], [payments])

  const filteredPayments = useMemo(() => {
    let list = safePayments
    if (activeTab === 'PENDING_REVIEW') {
      list = list.filter(p => p.status === 'PENDING_REVIEW')
    } else if (activeTab === 'CASH') {
      list = list.filter(p => p.method === 'CASH' && p.status === 'PENDING_REVIEW')
    } else if (activeTab === 'TRANSFER') {
      list = list.filter(p => p.method === 'TRANSFER' && p.status === 'PENDING_REVIEW')
    } else if (activeTab === 'MIXED') {
      list = list.filter(p => p.method === 'MIXED' && p.status === 'PENDING_REVIEW')
    } else if (activeTab === 'CONFIRMED') {
      list = list.filter(p => p.status === 'CONFIRMED')
    } else if (activeTab === 'REJECTED') {
      list = list.filter(p => p.status === 'REJECTED')
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
  }, [safePayments, activeTab, search])

  const tabCounts = useMemo(() => {
    const pending = safePayments.filter(p => p.status === 'PENDING_REVIEW')
    return {
      PENDING_REVIEW: pending.length,
      CASH: pending.filter(p => p.method === 'CASH').length,
      TRANSFER: pending.filter(p => p.method === 'TRANSFER').length,
      MIXED: pending.filter(p => p.method === 'MIXED').length,
      CONFIRMED: safePayments.filter(p => p.status === 'CONFIRMED').length,
      REJECTED: safePayments.filter(p => p.status === 'REJECTED').length,
      ALL: safePayments.length,
    }
  }, [safePayments])

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

    let reasonText = ''
    if (action === 'reject') {
      const input = prompt('Motivo del rechazo de este pago:')
      if (input === null) return
      if (!input.trim()) {
        alerts.warning('Motivo requerido', 'Debes ingresar el motivo por el cual rechazas este pago.')
        return
      }
      reasonText = input.trim()
    }

    try {
      await api.put(`/payment-validation/${payment.id}/${action}`, action === 'reject' ? { reason: reasonText } : {})
      alerts.toast(action === 'validate' ? `✅ Pago validado (${payment.order?.diningTable?.label || payment.order?.customerName || 'Mesa'})` : `❌ Pago rechazado`)
      load()
    } catch (err: any) {
      alerts.error('No se pudo procesar', err?.response?.data?.message || err.message)
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

      {/* Barra de Filtros Instantáneos Unificada (Una sola fila) */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between bg-[var(--bg-panel)] p-2.5 rounded-2xl border border-[var(--border-subtle)] shadow-xs">
        <div className="flex flex-wrap gap-1.5 items-center">
          {validationTabs.map(s => {
            const isActive = activeTab === s.value
            const count = tabCounts[s.value as keyof typeof tabCounts]
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setActiveTab(s.value)}
                className={`h-8 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]'
                }`}
              >
                <span>{s.label}</span>
                {count !== undefined && count > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                    isActive ? 'bg-white/25 text-white' : 'bg-[var(--accent)] text-white'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Buscador Rápido Integrado */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)]"
            placeholder="Buscar por mesa, cliente, pedido..."
          />
        </div>
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
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center" title="Pago en Efectivo">
                    <Banknote className="h-5 w-5" />
                  </div>
                ) : payment.method === 'MIXED' ? (
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] flex items-center justify-center font-black text-xs" title="Pago Mixto">
                    🔀
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
                      {statusLabels[payment.status] || payment.status}
                    </span>
                  </div>

                  {/* Desglose para pagos mixtos */}
                  {payment.method === 'MIXED' && (
                    <div className="flex items-center gap-2 mt-1 text-[11px] font-bold flex-wrap">
                      <span className="text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                        💵 Efectivo: {formatCurrency(payment.cashAmount || 0)}
                      </span>
                      <span className="text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md">
                        📲 Transferencia: {formatCurrency(payment.transferAmount || 0)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mt-0.5 flex-wrap">
                    <span>Mesera: <strong>{payment.order?.waiter?.name || 'Sin asignar'}</strong></span>
                    <span>•</span>
                    <span>Cobrado por: <strong className="text-[var(--text-primary)]">{proof?.submittedBy?.name || payment.order?.diningTable?.openedBy?.name || payment.order?.waiter?.name || 'Sin asignar'}</strong></span>
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
                <b className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">
                  {formatCurrency(payment.amount || payment.order?.total || 0)}
                </b>

                {payment.status === 'PENDING_REVIEW' && (
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => review(payment, 'validate')}
                      size="sm"
                      className="h-9 px-4 bg-red-600 hover:bg-red-700 text-white font-black text-xs gap-1.5 shadow-sm rounded-xl cursor-pointer"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Validar
                    </Button>
                    <Button
                      onClick={() => review(payment, 'reject')}
                      size="sm"
                      variant="outline"
                      className="h-9 px-3.5 border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-black text-xs gap-1.5 rounded-xl cursor-pointer"
                      title="Rechazar pago indicando motivo"
                    >
                      <XCircle className="h-4 w-4" /> Rechazar
                    </Button>
                  </div>
                )}
                {payment.status === 'REJECTED' && (payment.transferProofs?.[0]?.rejectionReason || payment.rejectionReason) && (
                  <div className="text-xs text-rose-600 font-bold max-w-xs text-right">
                    Motivo: {payment.transferProofs?.[0]?.rejectionReason || payment.rejectionReason}
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

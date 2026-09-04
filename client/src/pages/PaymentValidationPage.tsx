import { useCallback, useEffect, useMemo, useState } from 'react'
import { io } from '@/lib/socket'
import { Banknote, Bell, BellOff, CheckCircle2, Eye, Image, RefreshCw, Search, Wallet, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency, cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedImage } from '@/components/ProtectedImage'
import { isNotificationsMuted, toggleNotificationsMuted } from '@/lib/notificationSettings'

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
  const [cancellations, setCancellations] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('PENDING_REVIEW')
  const [search, setSearch] = useState('')
  const [modalViewer, setModalViewer] = useState<{
    items: any[]
    index: number
    payment?: any
  } | null>(null)
  const [isMuted, setIsMuted] = useState(() => isNotificationsMuted())
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    const syncMute = () => setIsMuted(isNotificationsMuted())
    window.addEventListener('the-villa-dog-mute-changed', syncMute)
    window.addEventListener('storage', syncMute)
    return () => {
      window.removeEventListener('the-villa-dog-mute-changed', syncMute)
      window.removeEventListener('storage', syncMute)
    }
  }, [])

  const handleToggleMute = () => {
    const next = toggleNotificationsMuted()
    setIsMuted(next)
  }

  const loadCancellations = useCallback(() => {
    api.get<any[]>('/orders/cancellations/pending')
      .then(res => {
        setCancellations(Array.isArray(res) ? res : [])
      })
      .catch(err => {
        console.error('Error cargando cancelaciones pendientes:', err)
        setCancellations([])
      })
  }, [])

  // Cargar todos los pagos para filtrado reactivo e instantáneo (0ms) en memoria
  const load = useCallback(() => {
    setLoading(true)
    loadCancellations()
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
  }, [loadCancellations])

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
    socket.on('cancellationRequested', (payload: any) => {
      loadCancellations()
      alerts.toast(`⚠️ Solicitud de cancelación recibida: Pedido #${payload?.order?.orderNumber || ''}`)
    })
    socket.on('cancellationResolved', () => {
      loadCancellations()
      load()
    })
    return () => { socket.disconnect() }
  }, [user?.id, user?.name, user?.role, load, loadCancellations])



  // Filtrado instantáneo en cliente (0ms)
  const safePayments = useMemo(() => Array.isArray(payments) ? payments : [], [payments])

  const filteredPayments = useMemo(() => {
    let list = safePayments
    if (activeTab === 'PENDING_REVIEW') {
      list = list.filter(p => p.status === 'PENDING_REVIEW')
    } else if (activeTab === 'CASH') {
      // Mostrar HISTORIAL COMPLETO de Efectivo
      list = list.filter(p => p.method === 'CASH')
    } else if (activeTab === 'TRANSFER') {
      // Mostrar HISTORIAL COMPLETO de Transferencias
      list = list.filter(p => ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(p.method))
    } else if (activeTab === 'MIXED') {
      // Mostrar HISTORIAL COMPLETO de Mixtos
      list = list.filter(p => p.method === 'MIXED')
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

  const filteredCancellations = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cancellations
    return cancellations.filter(c => {
      const haystack = [
        c.orderNumber,
        c.diningTable?.label,
        c.waiter?.name,
        c.cancellationReason,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [cancellations, search])

  const tabCounts = useMemo(() => {
    const pending = safePayments.filter(p => p.status === 'PENDING_REVIEW')
    return {
      PENDING_REVIEW: pending.length,
      CANCELLATIONS: cancellations.length,
      CASH: safePayments.filter(p => p.method === 'CASH').length,
      TRANSFER: safePayments.filter(p => ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(p.method)).length,
      MIXED: safePayments.filter(p => p.method === 'MIXED').length,
      CONFIRMED: safePayments.filter(p => p.status === 'CONFIRMED').length,
      REJECTED: safePayments.filter(p => p.status === 'REJECTED').length,
      ALL: safePayments.length,
    }
  }, [safePayments, cancellations])

  const openProofViewer = (proofs: any[], initialIndex = 0, payment?: any) => {
    const valid = (proofs || []).filter((p: any) => p && (p.fileBase64 || p.filePath || p.id))
    if (!valid.length) {
      alerts.warning('Comprobante', 'No hay imágenes disponibles para este cobro.')
      return
    }
    setModalViewer({
      items: valid,
      index: Math.min(Math.max(initialIndex, 0), valid.length - 1),
      payment,
    })
  }

  const openProof = (proofId: string, directBase64?: string, payment?: any) => {
    openProofViewer([{ id: proofId, fileBase64: directBase64 }], 0, payment)
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

  const handleApproveCancellation = async (order: any) => {
    const ok = await alerts.confirm(
      `¿Aprobar cancelación del Pedido #${order.orderNumber}?`,
      `Esta acción retirará el pedido de la mesa (${order.diningTable?.label || 'Mesa'}), anulará las comandas de cocina y descartará los cobros.`
    )
    if (!ok) return
    setActionLoading(order.id)
    try {
      await api.put(`/orders/${order.id}/cancellation/approve`, {})
      alerts.success('Cancelación aprobada', `El pedido #${order.orderNumber} fue cancelado y retirado de la cuenta de la mesera.`)
      load()
    } catch (err: any) {
      alerts.error('No se pudo aprobar', err?.response?.data?.message || err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleRejectCancellation = async (order: any) => {
    const reason = prompt(`Rechazar solicitud de cancelación del Pedido #${order.orderNumber}:\n\nEscribe el motivo del rechazo:`, 'Pedido ya preparado')
    if (reason === null) return
    if (!reason.trim()) {
      alerts.warning('Motivo requerido', 'Debes indicar el motivo del rechazo.')
      return
    }
    setActionLoading(order.id)
    try {
      await api.put(`/orders/${order.id}/cancellation/reject`, { reason: reason.trim() })
      alerts.info('Cancelación rechazada', `La solicitud del pedido #${order.orderNumber} fue rechazada y el pedido continúa activo.`)
      load()
    } catch (err: any) {
      alerts.error('No se pudo rechazar', err?.response?.data?.message || err.message)
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--text-primary)]">
            <Wallet className="h-7 w-7 text-[var(--accent)]" /> Validación de Pagos y Cancelaciones
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Comprobantes de mesas, historial por método y autorización de cancelaciones de meseras.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleToggleMute}
            className={cn(
              "flex items-center gap-2 px-3.5 h-9 rounded-xl text-xs font-bold transition-all border shadow-xs cursor-pointer",
              isMuted
                ? "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25"
                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
            )}
            title={isMuted ? "Notificaciones silenciadas (clic para activar)" : "Notificaciones activadas (clic para silenciar)"}
          >
            {isMuted ? <BellOff className="h-4 w-4 text-amber-500" /> : <Bell className="h-4 w-4 text-emerald-500" />}
            <span>{isMuted ? "🔕 Notificaciones: DESACTIVADAS" : "🔔 Notificaciones: ACTIVADAS"}</span>
          </button>
          <Button variant="outline" onClick={load} className="gap-2 font-bold h-9 rounded-xl cursor-pointer">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
        </div>
      </div>

      {/* Aviso destacado si hay cancelaciones de mesera esperando autorización */}
      {cancellations.length > 0 && activeTab !== 'CANCELLATIONS' && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-rose-500/10 border-2 border-rose-500/30 text-rose-800 dark:text-rose-200 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-xs">
            <XCircle className="h-4 w-4 text-rose-600 animate-pulse shrink-0" />
            <span>Hay <strong>{cancellations.length}</strong> solicitud(es) de cancelación de mesa pendiente(s) de autorización</span>
          </div>
          <Button
            size="sm"
            onClick={() => setActiveTab('CANCELLATIONS')}
            className="h-8 px-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-xs cursor-pointer"
          >
            Revisar Cancelaciones
          </Button>
        </div>
      )}

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
                    isActive
                      ? 'bg-white/25 text-white'
                      : 'bg-[var(--accent)] text-white'
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

      {/* PESTAÑA: CANCELACIONES SOLICITADAS POR MESERAS */}
      {activeTab === 'CANCELLATIONS' ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between pb-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('PENDING_REVIEW')}
              className="gap-1.5 font-black text-xs rounded-xl cursor-pointer"
            >
              ← Volver a Pagos
            </Button>
            <span className="text-xs font-bold text-[var(--text-secondary)]">
              {cancellations.length} solicitud(es) de cancelación
            </span>
          </div>
          {filteredCancellations.map(order => (
            <article
              key={order.id}
              className="rounded-2xl border-2 border-rose-400/50 bg-[var(--bg-panel)] p-4 shadow-sm hover:border-rose-500 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 shrink-0 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 flex items-center justify-center">
                  <XCircle className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-[var(--text-primary)]">
                      {order.diningTable?.label || 'Mesa'} · Pedido #{order.orderNumber}
                    </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30 animate-pulse">
                      ⏳ CANCELACIÓN SOLICITADA
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] font-medium">
                      Hora: {new Date(order.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="mt-1 text-xs font-black text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg inline-block">
                    ⚠️ Motivo: "{order.cancellationReason || 'Sin motivo especificado'}"
                  </div>

                  <div className="text-xs text-[var(--text-secondary)] mt-1.5 flex flex-wrap gap-2 items-center">
                    <span>Mesera: <strong className="text-[var(--text-primary)]">{order.waiter?.name || 'Mesera'}</strong></span>
                    <span>•</span>
                    <span>Productos: <strong className="text-[var(--text-primary)]">{order.items?.map((i: any) => `${i.quantity}x ${i.menuItem?.name || 'Item'}`).join(' · ')}</strong></span>
                  </div>
                </div>
              </div>

              {/* Lado derecho: Monto y Botones Aprobar / Rechazar */}
              <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--border-subtle)]">
                <b className="text-lg font-black text-rose-600 whitespace-nowrap">
                  {formatCurrency(order.total || 0)}
                </b>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleApproveCancellation(order)}
                    disabled={actionLoading === order.id}
                    size="sm"
                    className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs gap-1.5 shadow-sm rounded-xl cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Aprobar Cancelación
                  </Button>
                  <Button
                    onClick={() => handleRejectCancellation(order)}
                    disabled={actionLoading === order.id}
                    size="sm"
                    variant="outline"
                    className="h-9 px-3.5 border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-black text-xs gap-1.5 rounded-xl cursor-pointer"
                  >
                    <XCircle className="h-4 w-4" /> Rechazar
                  </Button>
                </div>
              </div>
            </article>
          ))}

          {filteredCancellations.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-muted)] bg-[var(--bg-panel)]">
              No hay solicitudes de cancelación pendientes de aprobación.
            </div>
          )}
        </div>
      ) : (
        /* Lista de Pagos en Filas Horizontales Ultra-Compactas */
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
                  {/* Miniaturas si es transferencia (soporta 1 o múltiples fotos) */}
                  {payment.transferProofs && payment.transferProofs.length > 0 && payment.transferProofs.some((p: any) => p.fileBase64 || p.filePath || p.id) ? (
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap max-w-xs md:max-w-sm">
                      {payment.transferProofs.filter((p: any) => p.fileBase64 || p.filePath || p.id).map((p: any, idx: number) => (
                        <div
                          key={p.id || idx}
                          className="group relative w-11 h-13 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center hover:border-[var(--accent)] shadow-xs transition"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openProofViewer(payment.transferProofs, idx, payment)
                          }}
                          title={`Comprobante #${idx + 1} de ${payment.transferProofs.length} - Clic para ver en grande`}
                        >
                          {p.fileBase64 ? (
                            <img src={p.fileBase64} alt={`Comprobante ${idx + 1}`} className="h-full w-full object-cover" />
                          ) : (
                            <ProtectedImage endpoint={`/payment-validation/proofs/${p.id}/image`} alt={`Comprobante ${idx + 1}`} className="h-full w-full object-cover" />
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Eye className="h-4 w-4 text-white" />
                          </div>
                          {payment.transferProofs.length > 1 && (
                            <span className="absolute bottom-0 right-0 bg-slate-950/80 text-white text-[9px] font-black px-1 rounded-tl">
                              #{idx + 1}
                            </span>
                          )}
                        </div>
                      ))}
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
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        payment.status === 'CONFIRMED'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                          : payment.status === 'REJECTED'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 animate-pulse'
                      }`}>
                        {statusLabels[payment.status] || payment.status}
                      </span>
                      {payment.transferProofs && payment.transferProofs.length > 1 && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                          📸 {payment.transferProofs.length} comprobantes
                        </span>
                      )}
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
                              openProofViewer(payment.transferProofs, 0, payment)
                            }}
                            className="text-[var(--accent)] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="h-3 w-3" /> {payment.transferProofs.length > 1 ? `Ver comprobantes (${payment.transferProofs.length})` : 'Ver comprobante'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lado derecho: Monto + Acciones / Estado en una sola fila */}
                <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--border-subtle)]">
                  <b className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">
                    {formatCurrency(payment.amount || payment.order?.total || 0)}
                  </b>

                  {payment.status === 'PENDING_REVIEW' ? (
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
                  ) : payment.status === 'CONFIRMED' ? (
                    <div className="flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20">
                      <CheckCircle2 className="h-4 w-4" /> Pagado / Aprobado
                    </div>
                  ) : payment.status === 'REJECTED' ? (
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1 text-xs font-black text-rose-600 bg-rose-500/10 px-2.5 py-1 rounded-xl border border-rose-500/20">
                          <XCircle className="h-3.5 w-3.5" /> Rechazado
                        </div>
                        {(payment.transferProofs?.[0]?.rejectionReason || payment.rejectionReason) && (
                          <span className="text-[10px] text-rose-600 italic max-w-xs text-right truncate">
                            Motivo: {payment.transferProofs?.[0]?.rejectionReason || payment.rejectionReason}
                          </span>
                        )}
                      </div>

                      {/* Botón para validar y aceptar pago previamente rechazado */}
                      <Button
                        onClick={() => review(payment, 'validate')}
                        size="sm"
                        className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs gap-1.5 shadow-sm rounded-xl cursor-pointer"
                        title="Aceptar y validar este pago rechazado"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Validar / Aceptar
                      </Button>
                    </div>
                  ) : null}
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
      )}

      {/* Modal Multi-Comprobante: Pantalla completa, navegación fluida entre fotos y validación directa */}
      <Dialog open={Boolean(modalViewer)} onOpenChange={(open) => { if (!open) setModalViewer(null) }}>
        <DialogContent className="max-w-2xl w-[94vw] max-h-[96vh] p-3 bg-[var(--bg-panel)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center [&>button.absolute]:hidden">
          {/* Header */}
          <div className="flex w-full items-center justify-between pb-2 border-b border-[var(--border-subtle)] gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Image className="h-4 w-4 text-[var(--accent)] shrink-0" />
              <span className="text-xs font-black text-[var(--text-primary)] truncate">
                Comprobante de Transferencia {modalViewer && modalViewer.items.length > 1 ? `(${modalViewer.index + 1} de ${modalViewer.items.length})` : ''}
              </span>
              {modalViewer?.payment?.order?.diningTable?.label && (
                <span className="text-[10px] font-bold text-[var(--text-secondary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-md">
                  {modalViewer.payment.order.diningTable.label}
                </span>
              )}
            </div>
            <button
              type="button"
              className="rounded-xl px-2.5 py-1 text-xs font-bold bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-all cursor-pointer flex items-center gap-1 border border-[var(--border-subtle)] shrink-0"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setModalViewer(null)
              }}
            >
              ✕ Cerrar
            </button>
          </div>

          {/* Navegación y selector si hay múltiples fotos */}
          {modalViewer && modalViewer.items.length > 1 && (
            <div className="flex items-center justify-between w-full pt-2 px-1 text-xs gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={modalViewer.index === 0}
                onClick={() => setModalViewer(prev => prev ? { ...prev, index: prev.index - 1 } : null)}
                className="h-7 px-2.5 text-xs font-bold gap-1 rounded-lg cursor-pointer"
              >
                ◀ Anterior
              </Button>
              <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                {modalViewer.items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setModalViewer(prev => prev ? { ...prev, index: i } : null)}
                    className={`w-7 h-7 rounded-lg text-xs font-black cursor-pointer transition ${
                      modalViewer.index === i
                        ? 'bg-[var(--accent)] text-white shadow-xs scale-105'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    #{i + 1}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={modalViewer.index === modalViewer.items.length - 1}
                onClick={() => setModalViewer(prev => prev ? { ...prev, index: prev.index + 1 } : null)}
                className="h-7 px-2.5 text-xs font-bold gap-1 rounded-lg cursor-pointer"
              >
                Siguiente ▶
              </Button>
            </div>
          )}

          {/* Foto Principal */}
          <div className="max-h-[72vh] w-full flex items-center justify-center pt-2 overflow-auto">
            {modalViewer && (() => {
              const cur = modalViewer.items[modalViewer.index]
              if (!cur) return null
              if (cur.fileBase64) {
                return (
                  <img
                    src={cur.fileBase64}
                    alt={`Comprobante ${modalViewer.index + 1}`}
                    className="max-h-[68vh] w-auto max-w-full object-contain rounded-xl shadow-md block"
                  />
                )
              }
              return (
                <ProtectedImage
                  endpoint={`/payment-validation/proofs/${cur.id}/image`}
                  alt={`Comprobante ${modalViewer.index + 1}`}
                  className="max-h-[68vh] w-auto max-w-full object-contain rounded-xl shadow-md block"
                />
              )
            })()}
          </div>

          {/* Acciones de Validación Directa dentro del Modal */}
          {modalViewer?.payment && modalViewer.payment.status === 'PENDING_REVIEW' && (
            <div className="flex items-center justify-between gap-3 w-full pt-2.5 mt-2 border-t border-[var(--border-subtle)] flex-wrap">
              <div className="text-xs font-bold text-[var(--text-secondary)]">
                Monto: <strong className="text-rose-600 dark:text-rose-400 text-sm font-black">{formatCurrency(modalViewer.payment.amount || modalViewer.payment.order?.total || 0)}</strong>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    const pay = modalViewer.payment
                    setModalViewer(null)
                    review(pay, 'validate')
                  }}
                  size="sm"
                  className="h-8 px-3.5 bg-red-600 hover:bg-red-700 text-white font-black text-xs gap-1.5 shadow-sm rounded-xl cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" /> Validar y Aceptar Pago
                </Button>
                <Button
                  onClick={() => {
                    const pay = modalViewer.payment
                    setModalViewer(null)
                    review(pay, 'reject')
                  }}
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 border-rose-300 text-rose-600 hover:bg-rose-50 font-black text-xs gap-1.5 rounded-xl cursor-pointer"
                >
                  <XCircle className="h-4 w-4" /> Rechazar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

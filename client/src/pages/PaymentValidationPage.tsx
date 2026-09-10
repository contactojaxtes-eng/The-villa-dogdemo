import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { io } from '@/lib/socket'
import { Banknote, Bell, BellOff, CheckCircle2, Eye, History, Image, RefreshCw, RotateCcw, Search, Smartphone, Wallet, XCircle, ZoomIn, ZoomOut } from 'lucide-react'
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
  const [proofZoom, setProofZoom] = useState(1)
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
    socket.on('cancellationRequested', () => {
      loadCancellations()
      load()
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

  const isRealImageProof = (p: any) => {
    if (!p) return false
    if (p.fileBase64 || p.filePath) return true
    if (!p.id || p.purgedAt) return false
    if (p.originalName?.includes('Cobro en Efectivo') || p.originalName?.includes('Cobro Mixto')) {
      return Boolean(p.fileSize && p.fileSize > 0)
    }
    return true
  }

  const openProofViewer = (proofs: any[], initialIndex = 0, payment?: any) => {
    const valid = (proofs || []).filter(isRealImageProof)
    if (!valid.length) {
      alerts.warning('Comprobante', 'No hay imágenes disponibles para este cobro.')
      return
    }
    setProofZoom(1)
    setModalViewer({
      items: valid,
      index: Math.min(Math.max(initialIndex, 0), valid.length - 1),
      payment,
    })
  }

  const openProof = (proofId: string, directBase64?: string, payment?: any) => {
    openProofViewer([{ id: proofId, fileBase64: directBase64 }], 0, payment)
  }

  const changeProofZoom = (amount: number) => {
    setProofZoom(current => Math.min(3, Math.max(0.75, Number((current + amount).toFixed(2)))))
  }

  const selectProof = (index: number) => {
    setProofZoom(1)
    setModalViewer(prev => prev ? { ...prev, index } : null)
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
            Validación operativa del turno actual. Los pedidos de turnos anteriores se archivan en el Historial de Ventas.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/tables/history">
            <Button variant="outline" className="gap-2 font-bold h-9 rounded-xl text-xs cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <History className="h-4 w-4 text-[var(--accent)]" /> Historial Pedidos Mesa
            </Button>
          </Link>
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
            const imageProofs = !isCash ? (payment.transferProofs || []).filter(isRealImageProof) : []
            const hasImageProofs = imageProofs.length > 0

            return (
              <article
                key={payment.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs hover:border-[var(--accent)] transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
              >
                {/* Lado izquierdo: Miniatura compacta + Datos del pedido */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Miniaturas si es transferencia con fotos reales */}
                  {hasImageProofs ? (
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap max-w-xs md:max-w-sm">
                      {imageProofs.map((p: any, idx: number) => (
                        <div
                          key={p.id || idx}
                          className="group relative w-12 h-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center hover:border-[var(--accent)] shadow-xs transition"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openProofViewer(imageProofs, idx, payment)
                          }}
                          title={`Comprobante #${idx + 1} de ${imageProofs.length} - Clic para ver en grande`}
                        >
                          {p.fileBase64 ? (
                            <img src={p.fileBase64} alt={`Comprobante ${idx + 1}`} className="h-full w-full object-cover" />
                          ) : (
                            <ProtectedImage endpoint={`/payment-validation/proofs/${p.id}/image`} alt={`Comprobante ${idx + 1}`} className="h-full w-full object-cover" />
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Eye className="h-4 w-4 text-white" />
                          </div>
                          {imageProofs.length > 1 && (
                            <span className="absolute bottom-0 right-0 bg-slate-950/80 text-white text-[9px] font-black px-1 rounded-tl">
                              #{idx + 1}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : isCash ? (
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-xs" title="Pago en Efectivo">
                      <Banknote className="h-6 w-6" />
                    </div>
                  ) : payment.method === 'MIXED' ? (
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black text-sm shadow-xs" title="Pago Mixto">
                      🔀
                    </div>
                  ) : (
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-xs" title={methodLabels[payment.method] || 'Transferencia'}>
                      <Smartphone className="h-6 w-6" />
                    </div>
                  )}

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
                      {hasImageProofs && imageProofs.length > 1 && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                          📸 {imageProofs.length} comprobantes
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
                      {hasImageProofs ? (
                        <>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              openProofViewer(imageProofs, 0, payment)
                            }}
                            className="text-[var(--accent)] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="h-3 w-3" /> {imageProofs.length > 1 ? `Ver comprobantes (${imageProofs.length})` : 'Ver comprobante'}
                          </button>
                        </>
                      ) : isCash ? (
                        <>
                          <span>•</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                            💵 Cobro en efectivo
                          </span>
                        </>
                      ) : payment.method === 'MIXED' ? (
                        <>
                          <span>•</span>
                          <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                            🔀 Pago mixto
                          </span>
                        </>
                      ) : null}
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
      <Dialog open={Boolean(modalViewer)} onOpenChange={(open) => { if (!open) { setModalViewer(null); setProofZoom(1) } }}>
        <DialogContent className="max-w-4xl w-[96vw] h-[94vh] max-h-[900px] p-3 bg-[var(--bg-panel)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center gap-0 [&>button.absolute]:hidden">
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
                setProofZoom(1)
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
                onClick={() => selectProof(modalViewer.index - 1)}
                className="h-7 px-2.5 text-xs font-bold gap-1 rounded-lg cursor-pointer"
              >
                ◀ Anterior
              </Button>
              <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                {modalViewer.items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectProof(i)}
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
                onClick={() => selectProof(modalViewer.index + 1)}
                className="h-7 px-2.5 text-xs font-bold gap-1 rounded-lg cursor-pointer"
              >
                Siguiente ▶
              </Button>
            </div>
          )}

          {/* Visor de comprobante con zoom y desplazamiento */}
          <div
            className="relative mt-2 min-h-0 w-full flex-1 overflow-auto overscroll-contain rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]"
            onWheel={(event) => {
              if (!event.ctrlKey) return
              event.preventDefault()
              changeProofZoom(event.deltaY < 0 ? 0.25 : -0.25)
            }}
          >
            <div className="sticky right-3 top-3 z-20 ml-auto mr-3 flex w-fit items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-panel)]/95 p-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => changeProofZoom(-0.25)}
                disabled={proofZoom <= 0.75}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Alejar comprobante"
                title="Alejar"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="min-w-12 select-none text-center text-[11px] font-black tabular-nums text-[var(--text-primary)]">
                {Math.round(proofZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => changeProofZoom(0.25)}
                disabled={proofZoom >= 3}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Acercar comprobante"
                title="Acercar"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <span className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setProofZoom(1)}
                disabled={proofZoom === 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Restablecer zoom"
                title="Restablecer zoom"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            <div
              className="flex min-h-full items-start justify-center px-4 pb-5 pt-1"
              style={{ minWidth: `${proofZoom * 100}%` }}
            >
              <div
                className="origin-top transition-transform duration-150 ease-out"
                style={{ transform: `scale(${proofZoom})` }}
                onDoubleClick={() => setProofZoom(current => current === 1 ? 2 : 1)}
                title="Doble clic para ampliar o restablecer"
              >
                {modalViewer && (() => {
                  const cur = modalViewer.items[modalViewer.index]
                  if (!cur) return null
                  if (cur.fileBase64) {
                    return (
                      <img
                        src={cur.fileBase64}
                        alt={`Comprobante ${modalViewer.index + 1}`}
                        className="max-h-[68vh] w-auto max-w-full cursor-zoom-in object-contain rounded-xl shadow-md block"
                      />
                    )
                  }
                  return (
                    <ProtectedImage
                      endpoint={`/payment-validation/proofs/${cur.id}/image`}
                      alt={`Comprobante ${modalViewer.index + 1}`}
                      className="max-h-[68vh] w-auto max-w-full cursor-zoom-in object-contain rounded-xl shadow-md block"
                    />
                  )
                })()}
              </div>
            </div>
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
                    setProofZoom(1)
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
                    setProofZoom(1)
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
